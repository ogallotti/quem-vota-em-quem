#!/usr/bin/env python3
"""Pipeline de dados (formato v2, leve): boletins de urna + resultado oficial do TSE + malhas do IBGE → public/data/<uf>/.

Uso:
    python3 -m venv .venv && .venv/bin/pip install shapely pandas numpy scipy pillow brotli
    .venv/bin/python scripts/build_data.py --uf ma

Entradas: .cache/<uf>/secoes.jsonl ou secoes.p<k>.jsonl[.gz] (scripts/coleta_bu.py), .cache/<uf>/resultado/ e
.cache/fotos/<uf>/ (scripts/fotos.py), cadastro de locais do TSE e malhas do IBGE (baixados e guardados em .cache/).

Saídas (public/data/<uf>/), geometria quantizada ("qgeom": polígonos → anéis → [x0, y0, dx1, dy1, ...] na escala q):
    base.json            carga inicial: candidatos, municípios e regiões, locais e seções em colunas (totais por área: o
                         navegador soma as seções)
    zb.json              zonas e bairros (sob demanda)
    nomes.json           nome, endereço e bairro de cada local (sob demanda)
    m/<ibge>.json        polígonos de locais e seções de um município (sob demanda, ao aproximar)
    v/<cargo>-<k>.json   votos por seção, esparsos, em pacotes de ~120 KB: {"<nº>": {"i": [saltos], "v": [votos]}}
public/fotos/<uf>/<cargo>-<k>.webp  sprites 8×8 de fotos 64×64, por votos (presidente: public/fotos/br/, por build_br.py)
.cache/<uf>/resumo.json             totais por município e geometria leve, para scripts/build_br.py

Valida cada candidato: a soma dos boletins tem de bater com a divulgação oficial do TSE (aborta se divergir).
"""
import argparse
import gzip
import json
import math
import shutil
import sys
import zipfile
from array import array
from datetime import date

import numpy as np
import pandas as pd
import scipy.sparse as sp
import shapely
from shapely.geometry import Point, shape
from shapely.ops import unary_union

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from comum import (CACHE, CARGOS, ELEICAO, POLOS, ROOT, UFS, afasta, baixar, candidatos_oficiais, celulas_voronoi, chave,  # noqa: E402
                   grava_json, limpa_bairro, log, pareia_municipios, particiona, poligonos, ponto_rotulo, qgeom, sprites,
                   sprites_presidente, titulo, valida)

CIDADE_GRANDE = 40000   # aptos mínimos para subdividir uma cidade em bairros
RAIO_LOCAL = 0.04       # graus (~4,4 km): limite da área de influência de um local no mapa
PACOTE = 120_000        # bytes por pacote de votos
URL_LOCAIS = "https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_{ano}.zip"
IBGE = "https://servicodados.ibge.gov.br/api"
Q_REG, Q_FINO = 10_000, 100_000


def cadastro(UF, ano):
    """Cadastro de locais do TSE de `ano` na UF (o zip traz um CSV por UF e um do Brasil inteiro). Devolve
    {(município, zona, seção): (local, eleitores)} das seções principais e a tabela de locais."""
    csv_loc = CACHE / f"eleitorado_local_votacao_{ano}_{UF}.csv"
    if not csv_loc.exists():
        with zipfile.ZipFile(baixar(URL_LOCAIS.format(ano=ano), CACHE / f"locais{ano}.zip")) as z:
            nomes = [x for x in z.namelist() if x.endswith(".csv")]
            nome = next((x for x in nomes if x.endswith(f"_{UF}.csv")), None) or next(x for x in nomes if "BRASIL" in x or len(nomes) == 1)
            csv_loc.write_bytes(z.read(nome))
    loc = pd.read_csv(csv_loc, sep=";", encoding="latin1", dtype=str)
    loc = loc[(loc.SG_UF == UF) & (loc.NR_TURNO == "1") & (loc.CD_TIPO_SECAO_AGREGADA == "1")].copy()
    # o boletim identifica o local pelo número original; nome, endereço e coordenadas são do local onde a seção votou
    if "NR_LOCAL_VOTACAO_ORIGINAL" in loc:
        loc["NR_LOCAL_VOTACAO"] = loc.NR_LOCAL_VOTACAO_ORIGINAL
    LK = ["CD_MUNICIPIO", "NR_ZONA", "NR_LOCAL_VOTACAO"]
    for c in LK:
        loc[c] = loc[c].astype(int)
    loc["lat"] = loc.NR_LATITUDE.str.replace(",", ".").astype(float)  # 2022: ponto decimal; 2026: vírgula
    loc["lon"] = loc.NR_LONGITUDE.str.replace(",", ".").astype(float)
    por_secao = {(r.CD_MUNICIPIO, r.NR_ZONA, int(r.NR_SECAO)): (r.NR_LOCAL_VOTACAO, int(r.QT_ELEITOR_SECAO)) for r in loc.itertuples()}
    return por_secao, loc.groupby(LK).agg(nome=("NM_LOCAL_VOTACAO", "first"), end=("DS_ENDERECO", "first"),
                               bairro=("NM_BAIRRO", "first"), lat=("lat", "first"), lon=("lon", "first")).reset_index()


def le_secoes(cache):
    """Lê as seções em fluxo, guardando só o necessário: (município, zona, seção, local, aptos), comparecimento por cargo,
    totais de brancos/nulos/legenda e as triplas (seção, número, votos) de cada cargo."""
    arqs = sorted(cache.glob("secoes.p*.jsonl*")) or [cache / "secoes.jsonl"]
    chaves, cps = [], {}
    trip = {}   # cargo → (linhas, colunas, votos) em array('i')
    nums = {}   # cargo → {número: coluna}
    tot = {}    # cargo → [legenda, brancos, nulos]
    i = 0
    for arq in arqs:
        txt = gzip.decompress(arq.read_bytes()).decode() if arq.suffix == ".gz" else arq.read_text()
        for linha in txt.splitlines():
            if not linha.strip():
                continue
            r = json.loads(linha)
            chaves.append((r["m"], r["z"], r["s"], r["l"], r["ap"]))
            for cg, c in r["c"].items():
                cg = int(cg)
                if cg not in trip:
                    trip[cg] = (array("i"), array("i"), array("i"))
                    nums[cg], tot[cg], cps[cg] = {}, [0, 0, 0], {}
                cps[cg][i] = c["cp"]
                t = tot[cg]
                t[0] += c["leg"]; t[1] += c["br"]; t[2] += c["nu"]
                rows, cols, vs = trip[cg]
                for num, q in c["v"].items():
                    j = nums[cg].setdefault(num, len(nums[cg]))
                    rows.append(i); cols.append(j); vs.append(q)
            i += 1
        del txt
    log(f"  {len(arqs)} arquivo(s), {i} seções")
    return chaves, cps, trip, nums, tot


def reparte(total, pesos):
    """Divide um inteiro em partes proporcionais aos pesos (maiores restos)."""
    pesos = np.asarray(pesos, dtype=float)
    if total <= 0 or pesos.sum() <= 0:
        return np.zeros(len(pesos), dtype=int)
    bruto = total * pesos / pesos.sum()
    base = np.floor(bruto).astype(int)
    for k in np.argsort(-(bruto - base))[: total - base.sum()]:
        base[k] += 1
    return base


URL_ZONA = "https://resultados.tse.jus.br/oficial/ele2026/{e}/dados/{uf}/{uf}{m:05d}-z{z:04d}-c{c:04d}-e{e:06d}-u.json"


def reconstroi(uf, cache, chaves, cps, trip, nums, por_secao):
    """Seções principais que o TSE totalizou mas cujo boletim não foi publicado (404 no aux.json, sem ser agregada).
    Os votos delas são o resíduo entre o resultado oficial da ZONA (o TSE publica por município e zona) e a soma dos
    boletins da zona, repartido entre as seções faltantes da zona na proporção dos eleitores do cadastro. Sem seção
    faltante, resíduo diferente de zero continua sendo erro (a validação do estado aborta)."""
    sem = {tuple(int(x) for x in l.split("/")) for f in cache.glob("sem_bu*.txt") for l in f.read_text().split()}
    tem = {c[:3] for c in chaves}
    faltam = sorted(k for k in sem if k in por_secao and k not in tem)
    if not faltam:
        return []
    grupos = {}
    for k in faltam:
        grupos.setdefault(k[:2], []).append(k)
    mz_de = np.array([(c[0] << 16) | c[1] for c in chaves], dtype=np.int64)  # (município, zona) de cada seção lida
    novos = {}
    for k in faltam:
        novos[k] = len(chaves)
        chaves.append((k[0], k[1], k[2], por_secao[k][0], por_secao[k][1]))
    for cg, (rows, cols, vs) in trip.items():
        _, e = CARGOS[cg]
        r_ = np.frombuffer(rows, dtype=np.int32).copy()
        c_ = np.frombuffer(cols, dtype=np.int32).copy()
        v_ = np.frombuffer(vs, dtype=np.int32).copy()
        validos = {n for n, c in candidatos_oficiais(uf, cg)[0].items() if c["valido"]}
        for (m, z), ks in grupos.items():
            z_json = json.loads(baixar(URL_ZONA.format(e=e, uf=uf, m=m, z=z, c=cg), cache / "resultado" / "zona" / f"{m}-{z}-c{cg}.json").read_text())
            sel = mz_de[r_[r_ < len(mz_de)]] == ((m << 16) | z)
            tot_bu = np.bincount(c_[r_ < len(mz_de)][sel], weights=v_[r_ < len(mz_de)][sel], minlength=len(nums[cg]))
            pesos = [por_secao[k][1] for k in ks]
            for car in z_json.get("carg", []):
                for ag in car.get("agr", []):
                    for p in ag.get("par", []):
                        for c in p.get("cand", []):
                            num = str(c["n"])
                            if num not in validos:
                                continue
                            j = nums[cg].setdefault(num, len(nums[cg]))
                            res = int(c["vap"] or 0) - (int(tot_bu[j]) if j < len(tot_bu) else 0)
                            if res < 0:
                                raise SystemExit(f"{uf} zona {m}/{z} cargo {cg} nº {num}: boletins somam mais que o oficial da zona")
                            for k, q in zip(ks, reparte(res, pesos)):
                                if q:
                                    rows.append(novos[k]); cols.append(j); vs.append(int(q))
            cp_bu = sum(q for i, q in cps[cg].items() if i < len(mz_de) and mz_de[i] == ((m << 16) | z))
            for k, q in zip(ks, reparte(max(0, int(z_json["e"]["c"]) - cp_bu), pesos)):
                cps[cg][novos[k]] = int(q)
    log(f"  {len(faltam)} seções totalizadas sem boletim publicado em {len(grupos)} zona(s): reconstruídas pelo resíduo oficial da zona")
    return [c[:3] for c in chaves[len(mz_de):]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uf", required=True)
    a = ap.parse_args()
    UF = a.uf.upper()
    uf = UF.lower()
    cod_ibge, nome_uf = UFS[UF]
    cache = CACHE / uf
    OUT = ROOT / "public" / "data" / uf
    FOTOS = ROOT / "public" / "fotos" / uf
    for pasta in (OUT, FOTOS):  # recomeça do zero (remove também o formato antigo)
        if pasta.exists():
            shutil.rmtree(pasta)
    (OUT / "v").mkdir(parents=True)
    (OUT / "m").mkdir()
    log(f"{nome_uf} · saída {OUT}")

    # ---- 1. seções (boletins de urna), ordenadas por município, zona e seção
    chaves, cps, trip, nums, totc = le_secoes(cache)
    try:
        (por_secao, info_loc), cadastro_ano = cadastro(UF, 2026), 2026
    except Exception as e:  # noqa: BLE001 - o TSE limita downloads logo após a eleição
        log(f"  aviso: cadastro de locais de 2026 indisponível ({e}); usando o de 2022 (mesmo número de local)")
        (por_secao, info_loc), cadastro_ano = cadastro(UF, 2022), 2022
    est_chaves = reconstroi(uf, cache, chaves, cps, trip, nums, por_secao)
    ordem = sorted(range(len(chaves)), key=lambda k: chaves[k][:3])
    novo = np.empty(len(chaves), dtype=np.int64)
    novo[np.array(ordem)] = np.arange(len(chaves))
    n = len(chaves)
    cargos = sorted(trip)
    det = pd.DataFrame([chaves[k] for k in ordem], columns=["CD_MUNICIPIO", "NR_ZONA", "NR_SECAO", "NR_LOCAL_VOTACAO", "QT_APTOS"])
    est = next(c for c in (3, 7, 8, 6, 5) if c in cargos)
    cp_de = lambda cg: np.array([cps[cg].get(k, 0) for k in ordem], dtype=np.int64)  # noqa: E731
    det["cp"] = cp_de(est)
    cpf = cp_de(1) if 1 in cargos else det.cp.values
    log(f"  cargos {cargos}; comparecimento presidente × estadual difere em {(cpf != det.cp.values).sum()} seções")
    det["si"] = det.index

    # ---- 2. votos por candidato: conferência com a divulgação oficial
    pres_pos, _ = sprites_presidente() if 1 in cargos else ({}, None)
    meta_cargos, mats = [], {}
    for cg in cargos:
        oficial, partidos = candidatos_oficiais(uf, cg)
        rows, cols, vs = trip.pop(cg)
        idx = nums[cg]
        M = sp.coo_matrix((np.frombuffer(vs, dtype=np.int32), (novo[np.frombuffer(rows, dtype=np.int32)], np.frombuffer(cols, dtype=np.int32))),
                          shape=(n, len(idx))).tocsc()
        M.sum_duplicates(); M.sort_indices()
        tot = np.asarray(M.sum(0)).ravel()
        div = [(num, int(tot[idx[num]]) if num in idx else 0, c["votos"]) for num, c in oficial.items()
               if c["valido"] and (int(tot[idx[num]]) if num in idx else 0) != c["votos"]]
        log(f"  {CARGOS[cg][0]}: {len(oficial)} candidatos; {len(oficial) - len(div)} idênticos à divulgação oficial")
        for d in div[:10]:
            log("    divergência", d)
        if div:
            sys.exit(f"{UF} {CARGOS[cg][0]}: boletins não batem com a divulgação oficial")
        lista = sorted(((num, int(tot[j])) for num, j in idx.items() if tot[j] > 0), key=lambda x: -x[1])
        # fotos (sprites por votos) e pacotes de votos (guloso por tamanho, também por votos)
        pos = pres_pos if cg == 1 else sprites([(num, oficial.get(num, {}).get("sq")) for num, _ in lista], CACHE / "fotos" / uf, FOTOS / str(cg))
        cands, pacote, k, tam = [], {}, 0, 0
        for num, v in lista:
            col = M.indices[M.indptr[idx[num]]:M.indptr[idx[num] + 1]]
            val = M.data[M.indptr[idx[num]]:M.indptr[idx[num] + 1]]
            ser = {"i": np.diff(np.concatenate([[-1], col])).astype(int).tolist(), "v": val.astype(int).tolist()}
            t = len(json.dumps(ser, separators=(",", ":")))
            if pacote and tam + t > PACOTE:
                grava_json(OUT / "v" / f"{cg}-{k}.json", pacote)
                pacote, k, tam = {}, k + 1, 0
            pacote[num] = ser
            tam += t
            c = oficial.get(num) or {"nome": f"Candidato {num}", "completo": "", "partido": partidos.get(num[:2], ""), "sit": "", "valido": False}
            s_, p_ = pos.get(num, (-1, 0))
            cands.append([num, c["nome"], c["completo"], c["partido"], c["sit"], v, 1 if c["valido"] else 0, k, s_, p_])
        if pacote:
            grava_json(OUT / "v" / f"{cg}-{k}.json", pacote)
        mats[cg] = (M, idx)
        meta_cargos.append({"cd": cg, "nome": CARGOS[cg][0], "vagas": 2 if cg == 5 else 1, "cp": int((cpf if cg == 1 else det.cp.values).sum()),
                            "leg": totc[cg][0], "br": totc[cg][1], "nu": totc[cg][2], "c": cands})
        log(f"    {len(cands)} com votos, {k + 1} pacote(s), {len(pos)} fotos")
    del trip
    polos = {}
    pres = next((c for c in meta_cargos if c["cd"] == 1), None)
    if pres:
        for k_, sg in POLOS.items():
            c = next((c for c in pres["c"] if c[3] == sg), None)
            if c:
                polos[k_] = f"1:{c[0]}"

    # ---- 3. malhas do IBGE e mapeamento TSE → IBGE
    log("malhas do IBGE")
    mun_geo = json.loads(baixar(f"{IBGE}/v3/malhas/estados/{cod_ibge}?intrarregiao=municipio&formato=application/vnd.geo+json&qualidade=maxima",
                                cache / "mun_malha.json").read_text())
    mun_meta = json.loads(baixar(f"{IBGE}/v1/localidades/estados/{cod_ibge}/municipios", cache / "mun_meta.json").read_text())
    conf = json.loads(next(cache.glob(f"{uf}-p00*-cs.json")).read_text())
    nome_tse = {int(m["cd"]): m["nm"] for m in conf["abr"][0]["mu"]}
    tse2ib = pareia_municipios({cd: nome_tse[cd] for cd in det.CD_MUNICIPIO.unique()}, mun_meta)
    geo_mun = {int(f["properties"]["codarea"]): valida(shape(f["geometry"])) for f in mun_geo["features"]}
    # município novo, ainda sem malha no IBGE (ex.: Boa Esperança do Norte, MT, 2024): contorno dos próprios locais + ~3 km
    for cd, m in tse2ib.items():
        if m["id"] not in geo_mun:
            pts = info_loc[info_loc.CD_MUNICIPIO == cd][["lon", "lat"]].dropna()
            geo_mun[m["id"]] = shapely.MultiPoint(pts.values.tolist()).convex_hull.buffer(0.03)
            log(f"  sem malha no IBGE: {m['nome']} ({m['id']}); área aproximada pelos locais de votação")
    det["ib"] = det.CD_MUNICIPIO.map(lambda c: tse2ib[c]["id"])
    det["macro"] = det.CD_MUNICIPIO.map(lambda c: tse2ib[c]["regiao-imediata"]["regiao-intermediaria"]["id"])

    # ---- 4. locais de votação: nome, endereço, bairro e coordenadas (cadastro do TSE)
    log("cadastro de locais (TSE)")
    LK = ["CD_MUNICIPIO", "NR_ZONA", "NR_LOCAL_VOTACAO"]

    # boletins do Sistema de Apuração (seção sem BU de urna) trazem um número de local que não existe no cadastro:
    # vale o local que o cadastro atribui à (município, zona, seção)
    existentes = set(zip(info_loc.CD_MUNICIPIO, info_loc.NR_ZONA, info_loc.NR_LOCAL_VOTACAO))
    remap = 0
    for i, r in enumerate(det[LK[:2] + ["NR_SECAO", "NR_LOCAL_VOTACAO"]].itertuples(index=False)):
        if (r.CD_MUNICIPIO, r.NR_ZONA, r.NR_LOCAL_VOTACAO) not in existentes:
            novo_l = por_secao.get((r.CD_MUNICIPIO, r.NR_ZONA, r.NR_SECAO))
            if novo_l is not None:
                det.iat[i, det.columns.get_loc("NR_LOCAL_VOTACAO")] = novo_l[0]
                remap += 1
    log(f"  seções com local remapeado pelo cadastro (local do boletim inexistente): {remap}")

    # ---- 5. tabela de locais
    L = det.groupby(LK).agg(ib=("ib", "first"), macro=("macro", "first"), ap=("QT_APTOS", "sum"), cp=("cp", "sum"),
                            ns=("si", "size")).reset_index()
    L = L.merge(info_loc, on=LK, how="left").sort_values(LK).reset_index(drop=True)
    L["li"] = L.index
    det = det.merge(L[LK + ["li"]], on=LK, how="left").sort_values("si").reset_index(drop=True)
    sem_cad = int(L.nome.isna().sum())
    L["nome"] = [x if isinstance(x, str) else f"Local {n_}" for x, n_ in zip(L.nome, L.NR_LOCAL_VOTACAO)]

    def coord_ok(r):  # dentro do município (tolerância ~3 km) e não -1/0
        if not (isinstance(r.lat, float) and isinstance(r.lon, float)) or math.isnan(r.lat) or math.isnan(r.lon):
            return False
        if r.lat in (0, -1) or r.lon in (0, -1):
            return False
        return geo_mun[r.ib].buffer(0.03).contains(Point(r.lon, r.lat))
    L["geo"] = [1 if coord_ok(r) else 0 for r in L.itertuples()]
    log(f"  {len(L)} locais; {sem_cad} fora do cadastro de {cadastro_ano}; {int((L.geo == 0).sum())} sem coordenada confiável")
    L["bk"] = L.bairro.map(lambda s: chave(limpa_bairro(s)))
    L["bnome"] = L.bairro.map(limpa_bairro)
    # posição aproximada para locais sem coordenada: centro do bairro; senão dos outros locais; senão do município
    for ib, grp in L.groupby("ib"):
        ruins = grp[grp.geo == 0]
        if ruins.empty:
            continue
        bons = grp[grp.geo == 1]
        centro_mun = geo_mun[ib].representative_point()
        for k_, r in enumerate(ruins.itertuples()):
            ref = bons[bons.bk == r.bk] if len(bons) else bons
            if len(ref):
                lat, lon = ref.lat.mean(), ref.lon.mean()
            elif len(bons):
                lat, lon = bons.lat.mean(), bons.lon.mean()
            else:
                lat, lon = centro_mun.y, centro_mun.x
            ang, rad = (k_ + 1) * 2.399963, 0.0015 * math.sqrt(k_ + 1)  # ~170 m por passo, só para não empilhar
            L.loc[r.Index, "lat"] = lat + rad * math.sin(ang)
            L.loc[r.Index, "lon"] = lon + rad * math.cos(ang)

    # bairros: só nas cidades grandes (no DF, um município só, são as regiões do cadastro)
    grandes = det.groupby("ib").QT_APTOS.sum()
    grandes = set(grandes[grandes >= CIDADE_GRANDE].index)
    chaves_b = L[L.ib.isin(grandes)][["ib", "bk"]].drop_duplicates().reset_index(drop=True)
    chaves_b["bid"] = chaves_b.index
    L = L.merge(chaves_b, on=["ib", "bk"], how="left").sort_values("li").reset_index(drop=True)
    L["bid"] = L.bid.fillna(-1).astype(int)

    # ---- 6. geometria
    log("geometria")
    mun_nome = {m["id"]: m["nome"] for m in mun_meta}
    macro_nome = {m["regiao-imediata"]["regiao-intermediaria"]["id"]: m["regiao-imediata"]["regiao-intermediaria"]["nome"] for m in mun_meta}
    mun_macro = {m["id"]: m["regiao-imediata"]["regiao-intermediaria"]["id"] for m in mun_meta}
    ibs = sorted(det.ib.unique())
    mun_out = []
    for ib in ibs:
        g = geo_mun[ib].simplify(0.0005, preserve_topology=True)  # ~55 m: invisível até o zoom 11 (depois valem bairros e locais)
        mun_out.append([int(ib), mun_nome[ib], int(mun_macro[ib]), 1 if ib in grandes else 0, qgeom(g, Q_REG), *ponto_rotulo(geo_mun[ib])])
    macro_out = []
    for k_ in sorted({mun_macro[i] for i in ibs}):
        geom = poligonos(unary_union([geo_mun[i] for i in geo_mun if mun_macro[i] == k_]).buffer(0.00012).buffer(-0.00012))
        macro_out.append([int(k_), macro_nome[k_], qgeom(geom.simplify(0.002, preserve_topology=True), Q_REG), *ponto_rotulo(geom)])

    log("polígonos de locais e seções")
    celula, poly_local = {}, {}
    for ib, sub in L.groupby("ib"):
        pts = afasta([(r.lon, r.lat) for r in sub.itertuples()])
        for r, pt, c in zip(sub.itertuples(), pts, celulas_voronoi(pts, geo_mun[ib])):
            celula[r.li] = c
            lim = poligonos(c.intersection(Point(pt).buffer(RAIO_LOCAL, quad_segs=6)))
            if lim.is_empty:
                lim = Point(pt).buffer(0.0004, quad_segs=6)
            poly_local[r.li] = lim.simplify(0.00003, preserve_topology=True)
    poly_secao, vazias = {}, 0
    for li, grp in det.groupby("li"):
        for si, g in zip(grp.si, particiona(poly_local[li], [max(int(x), 1) for x in grp.QT_APTOS])):
            if g.is_empty or g.area < 1e-12:  # fatia degenerada: disco de ~9 m no local
                vazias += 1
                g = Point(*poly_local[li].representative_point().coords[0]).buffer(0.00008, quad_segs=4)
            poly_secao[int(si)] = g
    log(f"  seções com fatia degenerada: {vazias}")
    tam_m = 0
    for ib, sub in L.groupby("ib"):
        lis = sub.li.tolist()
        sis = det[det.ib == ib].si.tolist()
        tam_m += grava_json(OUT / "m" / f"{ib}.json", {
            "q": Q_FINO, "li": lis, "lg": [qgeom(poly_local[i], Q_FINO) for i in lis], "ll": [ponto_rotulo(poly_local[i]) for i in lis],
            "si": sis, "sg": [qgeom(poly_secao[i], Q_FINO) for i in sis], "sl": [ponto_rotulo(poly_secao[i]) for i in sis]})
    log(f"  m/: {len(ibs)} municípios, {tam_m / 1e6:.2f} MB")

    bairros = []
    for r in chaves_b.itertuples():
        sub = L[L.bid == r.bid]
        geom = poligonos(unary_union([celula[li] for li in sub.li if li in celula])).buffer(0.00004).buffer(-0.00004)
        if geom.is_empty:
            continue
        bairros.append([int(r.bid), titulo(sub.bnome.value_counts().index[0]), int(r.ib),
                        qgeom(geom.simplify(0.00008, preserve_topology=True), Q_REG), *ponto_rotulo(geom)])
    multi = det.groupby("ib").NR_ZONA.nunique()
    multi = set(multi[multi > 1].index)
    zonas = []
    for z in sorted(det.NR_ZONA.unique()):
        partes = []
        mz_ib = sorted(det[det.NR_ZONA == z].ib.unique())
        for ib in mz_ib:
            if ib in multi:
                partes += [celula[li] for li in L[(L.ib == ib) & (L.NR_ZONA == z)].li if li in celula]
            else:
                partes.append(geo_mun[ib])
        geom = poligonos(unary_union(partes).buffer(0.00012).buffer(-0.00012))
        mn = mun_nome[mz_ib[0]] + (f" e mais {len(mz_ib) - 1}" if len(mz_ib) > 1 else "")
        zonas.append([int(z), f"Zona {z}", mn, qgeom(geom.simplify(0.0003, preserve_topology=True), Q_REG), *ponto_rotulo(geom)])
    tz = grava_json(OUT / "zb.json", {"zona": zonas, "bairro": bairros})
    tn = grava_json(OUT / "nomes.json", {"loc": [[titulo(r.nome), (r.end if isinstance(r.end, str) else "").strip().title(), titulo(r.bnome)]
                                                 for r in L.itertuples()]})
    log(f"  zb.json {tz / 1e6:.2f} MB ({len(zonas)} zonas, {len(bairros)} bairros); nomes.json {tn / 1e6:.2f} MB")

    # ---- 7. base.json e resumo para o nacional
    b = unary_union([geo_mun[i] for i in ibs]).bounds
    base = {
        "v": 2, "uf": UF, "uf_nome": nome_uf, "cod_ibge": cod_ibge, "eleicao": ELEICAO, "turno": 1,
        "fonte": f"Boletins de urna e divulgação oficial do TSE (configuração de {conf['dg']} {conf['hg']}); malhas do IBGE",
        "gerado_em": date.today().isoformat(), "cadastro_locais": cadastro_ano,
        "bounds": [[round(b[0], 3), round(b[1], 3)], [round(b[2], 3), round(b[3], 3)]], "q": Q_REG,
        "estado": {"ap": int(det.QT_APTOS.sum()), "cp": int(det.cp.sum())},
        "cargos": meta_cargos, "polos": polos,
        "contagens": {"macro": len(macro_out), "municipio": len(ibs), "zona": len(zonas), "bairro": len(bairros), "local": len(L),
                      "secao": n, "locais_sem_coordenada": int((L.geo == 0).sum())},
        "macro": macro_out, "mun": mun_out,
        "loc": {"mi": L.ib.astype(int).tolist(), "z": L.NR_ZONA.astype(int).tolist(), "bi": L.bid.astype(int).tolist(),
                "x": [round(x * 1e5) for x in L.lon], "y": [round(y * 1e5) for y in L.lat], "ok": L.geo.astype(int).tolist(),
                "ns": L.ns.astype(int).tolist()},
        "sec": {"li": det.li.astype(int).tolist(), "nr": det.NR_SECAO.astype(int).tolist(), "ap": det.QT_APTOS.astype(int).tolist(),
                "cp": det.cp.astype(int).tolist(), "tf": (cpf - det.cp.values).astype(int).tolist(),
                # seções sem boletim publicado, reconstruídas pelo resíduo da divulgação oficial (estimadas)
                "est": [int(i) for i, k in enumerate(zip(det.CD_MUNICIPIO, det.NR_ZONA, det.NR_SECAO)) if k in set(est_chaves)]},
    }
    tb = grava_json(OUT / "base.json", base)
    log(f"  base.json: {tb / 1e6:.2f} MB")
    # resumo por município para o mapa nacional (Lula × Bolsonaro, comparecimento federal) e geometria leve
    resumo = {"uf": uf, "nome": nome_uf, "ap": base["estado"]["ap"], "cp": int(cpf.sum()), "esq": 0, "dir": 0, "mun": []}
    if 1 in mats:
        M, idx = mats[1]
        porm = {}
        for k_, sg in POLOS.items():
            num = polos.get(k_, ":").split(":")[1]
            v = np.asarray(M[:, idx[num]].todense()).ravel() if num in idx else np.zeros(n)
            resumo[k_] = int(v.sum())
            porm[k_] = pd.Series(v).groupby(det.ib.values).sum()
        cpm = pd.Series(cpf).groupby(det.ib.values).sum()
        for ib in ibs:
            g = geo_mun[ib].simplify(0.003, preserve_topology=True)
            resumo["mun"].append([int(ib), uf, mun_nome[ib], qgeom(g, Q_REG), *ponto_rotulo(geo_mun[ib]),
                                  int(porm["esq"][ib]), int(porm["dir"][ib]), int(cpm[ib])])
    grava_json(cache / "resumo.json", resumo)
    log("ok", json.dumps(base["contagens"]))


if __name__ == "__main__":
    main()
