#!/usr/bin/env python3
"""Pipeline de dados: boletins de urna (scripts/coleta_bu.py) + resultado oficial do TSE + malhas do IBGE → public/data/<uf>/.

Uso:
    python3 -m venv .venv && .venv/bin/pip install shapely pandas numpy scipy
    .venv/bin/python scripts/build_data.py --uf ma

Saídas (public/data/<uf>/):
    meta.json            UF, eleição, cargos e candidatos (número, nome, partido, situação, votos), polos Lula × Bolsonaro
    macro.geojson        regiões intermediárias (IBGE)
    municipio.geojson    municípios
    zona.geojson         zonas eleitorais (união de municípios; Voronoi dos locais nas cidades com 2+ zonas)
    bairro.geojson       bairros/povoados das cidades grandes (Voronoi dos locais de votação)
    locais.geojson       locais de votação (propriedades; a geometria vem de locais_poly.json)
    locais_poly.json     área de influência de cada local (Voronoi limitado a ~4 km) e pontos de rótulo
    secoes.json          seções (colunar): local, número, aptos, comparecimento
    secoes_poly.json     fatias do local proporcionais aos eleitores de cada seção, e pontos de rótulo
    v/<cargo>/<nº>.json  votos de um candidato por seção, esparso: {"i": [salto entre índices], "v": [votos]}
    afinidades.json      para cada candidato, os que mais (e menos) andam junto com ele em cada cargo, por local de votação

Valida cada candidato: a soma dos boletins tem de bater com a divulgação oficial do TSE (aborta se divergir).
"""
import argparse
import gzip
import io
import json
import math
import re
import sys
import unicodedata
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from scipy.spatial import cKDTree
from shapely.geometry import Point, Polygon, box, mapping, shape
from shapely.ops import polylabel, unary_union

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
CIDADE_GRANDE = 40000  # aptos mínimos para subdividir uma cidade em bairros
RAIO_LOCAL = 0.04      # graus (~4,4 km): limite da área de influência de um local no mapa
UFS = {"AC": (12, "Acre"), "AL": (27, "Alagoas"), "AM": (13, "Amazonas"), "AP": (16, "Amapá"), "BA": (29, "Bahia"),
       "CE": (23, "Ceará"), "DF": (53, "Distrito Federal"), "ES": (32, "Espírito Santo"), "GO": (52, "Goiás"),
       "MA": (21, "Maranhão"), "MG": (31, "Minas Gerais"), "MS": (50, "Mato Grosso do Sul"), "MT": (51, "Mato Grosso"),
       "PA": (15, "Pará"), "PB": (25, "Paraíba"), "PE": (26, "Pernambuco"), "PI": (22, "Piauí"), "PR": (41, "Paraná"),
       "RJ": (33, "Rio de Janeiro"), "RN": (24, "Rio Grande do Norte"), "RO": (11, "Rondônia"), "RR": (14, "Roraima"),
       "RS": (43, "Rio Grande do Sul"), "SC": (42, "Santa Catarina"), "SE": (28, "Sergipe"), "SP": (35, "São Paulo"),
       "TO": (17, "Tocantins")}
# cargo: (nome, eleição no TSE). Presidente é da eleição federal; os demais, da estadual.
CARGOS = {1: ("Presidente", 6257), 3: ("Governador", 6259), 5: ("Senador", 6259), 6: ("Deputado Federal", 6259),
          7: ("Deputado Estadual", 6259), 8: ("Deputado Distrital", 6259)}
URL_RES = "https://resultados.tse.jus.br/oficial/ele2026/{e}/dados/{uf}/{uf}-c{c:04d}-e{e:06d}-u.json"
URL_LOCAIS = "https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_{ano}.zip"
IBGE = "https://servicodados.ibge.gov.br/api"
# Polos do eixo esquerda × direita: os candidatos a presidente do PT (Lula) e do PL (Bolsonaro). Medido no voto da seção,
# sem depender de classificar partidos.
POLOS = {"esq": "PT", "dir": "PL"}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def baixar(url, destino):
    if destino.exists():
        return destino
    destino.parent.mkdir(parents=True, exist_ok=True)
    log("baixando", url)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=600) as r:
        dados = r.read()
    if dados[:2] == b"\x1f\x8b":  # alguns servidores ignoram o identity e mandam gzip
        dados = gzip.decompress(dados)
    destino.write_bytes(dados)
    return destino


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def chave(s):
    return re.sub(r"[^A-Z0-9]+", " ", sem_acento(s.upper())).strip()


MINUSCULAS = {"DE", "DA", "DO", "DAS", "DOS", "E", "EM", "NA", "NO", "A", "O"}
ROMANOS = {"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"}


def titulo(s):
    out = []
    for i, w in enumerate(str(s).strip().split()):
        u = w.upper()
        if u in ROMANOS:
            out.append(u)
        elif u in MINUSCULAS and i > 0:
            out.append(u.lower())
        else:
            out.append("-".join(p[:1].upper() + p[1:].lower() for p in w.split("-")))
    return " ".join(out)


SUFIXO_ZONA = re.compile(r"\s*[-–]?\s*ZONA\s+(URBANA|RURAL)\b", re.I)


def limpa_bairro(s):
    s = SUFIXO_ZONA.sub("", s if isinstance(s, str) else "").strip(" -.,")
    return re.sub(r"\s+", " ", s) or "Sem bairro"


# ---------------------------------------------------------------- geometria
def arredonda(obj, nd=5):
    if isinstance(obj, (list, tuple)):
        return [arredonda(o, nd) for o in obj]
    return round(obj, nd)


def geojson_fc(features, caminho):
    fs = []
    for geom, props in features:
        if hasattr(geom, "geom_type") and geom.geom_type in ("Polygon", "MultiPolygon"):
            props["lx"], props["ly"] = ponto_rotulo(geom)
        g = mapping(geom) if hasattr(geom, "geom_type") else geom
        fs.append({"type": "Feature", "properties": props,
                   "geometry": {"type": g["type"], "coordinates": arredonda(g["coordinates"])}})
    caminho.write_text(json.dumps({"type": "FeatureCollection", "features": fs},
                                  separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    log(f"  {caminho.name}: {len(fs)} feições, {caminho.stat().st_size / 1e6:.2f} MB")


def poligonos(g):
    """Mantém só a parte poligonal de uma geometria (descarta linhas/pontos de interseções)."""
    if g.is_empty:
        return g
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    partes = [p for p in getattr(g, "geoms", []) if p.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(partes) if partes else Polygon()


def ponto_rotulo(g):
    """Ponto bem dentro do maior pedaço do polígono (para rótulos no mapa)."""
    partes = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
    maior = max(partes, key=lambda p: p.area)
    p = polylabel(maior, tolerance=0.0005)
    return [round(p.x, 5), round(p.y, 5)]


def valida(g):
    g = shapely.set_precision(g, 1e-5)
    if not g.is_valid:
        g = shapely.make_valid(g)
    return poligonos(g)


def jitter_duplicados(pts):
    """Desloca ~1-3 m pontos com coordenadas idênticas, para cada um ter a própria célula de Voronoi."""
    vistos, out = {}, []
    for lon, lat in pts:
        k = (round(lon, 6), round(lat, 6))
        n = vistos.get(k, 0)
        vistos[k] = n + 1
        if n:
            ang = n * 2.399963
            r = 1.2e-5 * math.sqrt(n)
            lon, lat = lon + r * math.cos(ang), lat + r * math.sin(ang)
        out.append((lon, lat))
    return out


def afasta(pts, dmin=0.0004, iters=40):
    """Afasta pontos a menos de `dmin` (~45 m) uns dos outros, só para o desenho: escolas geocodificadas quase no
    mesmo endereço ganham célula própria em vez de uma sobra de poucos metros quadrados."""
    P = np.array(pts, dtype=float)
    vistos = {}
    for i in range(len(P)):
        k = (round(P[i, 0], 7), round(P[i, 1], 7))
        n = vistos.get(k, 0)
        vistos[k] = n + 1
        if n:  # coordenadas idênticas: espiral inicial
            ang = n * 2.399963
            P[i] += (dmin * 0.5 * math.sqrt(n) * math.cos(ang), dmin * 0.5 * math.sqrt(n) * math.sin(ang))
    for _ in range(iters):
        pares = cKDTree(P).query_pairs(dmin, output_type="ndarray")
        if len(pares) == 0:
            break
        d = P[pares[:, 0]] - P[pares[:, 1]]
        dist = np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-9)
        delta = d * (((dmin - dist) / 2) / dist)[:, None]
        np.add.at(P, pares[:, 0], delta)
        np.subtract.at(P, pares[:, 1], delta)
    return [tuple(x) for x in P]


def particiona(poly, pesos):
    """Divide `poly` em len(pesos) pedaços com área proporcional aos pesos (cortes recursivos pelo lado maior)."""
    n = len(pesos)
    if n == 1:
        return [poly]
    if poly.is_empty:
        return [Polygon() for _ in pesos]
    k = n // 2
    frac = sum(pesos[:k]) / sum(pesos)
    minx, miny, maxx, maxy = poly.bounds
    vertical = (maxx - minx) >= (maxy - miny)
    lo, hi = (minx, maxx) if vertical else (miny, maxy)
    alvo = poly.area * frac
    for _ in range(14):
        mid = (lo + hi) / 2
        meia = box(minx, miny, mid, maxy) if vertical else box(minx, miny, maxx, mid)
        if poly.intersection(meia).area < alvo:
            lo = mid
        else:
            hi = mid
    mid = (lo + hi) / 2
    a, b = (box(minx - 1, miny - 1, mid, maxy + 1), box(mid, miny - 1, maxx + 1, maxy + 1)) if vertical else \
           (box(minx - 1, miny - 1, maxx + 1, mid), box(minx - 1, mid, maxx + 1, maxy + 1))
    return particiona(poligonos(poly.intersection(a)), pesos[:k]) + particiona(poligonos(poly.intersection(b)), pesos[k:])


def celulas_voronoi(pts, limite):
    """Uma célula de Voronoi (recortada ao polígono `limite`) por ponto, na mesma ordem de `pts`."""
    if len(pts) == 1:
        return [limite]
    pts = jitter_duplicados(pts)
    vor = shapely.voronoi_polygons(shapely.MultiPoint(pts), extend_to=limite.envelope.buffer(0.5))
    polys = list(vor.geoms)
    arvore = shapely.STRtree(polys)
    cel = []
    for p in pts:
        pt = Point(p)
        idx = list(arvore.query(pt, predicate="within")) or list(arvore.query(pt.buffer(1e-7), predicate="intersects"))
        c = polys[idx[0]] if idx else Polygon()
        cel.append(poligonos(c.intersection(limite)))
    return cel


def poligono_json(g):
    g0 = g
    g = poligonos(shapely.set_precision(g, 1e-5))  # encaixa na grade de 5 casas: o JSON arredonda igual e segue válido
    if g.is_empty:  # fatia menor que 1 m: disco de segurança de ~5 m no mesmo lugar
        g = poligonos(shapely.set_precision(g0.representative_point().buffer(5e-5, quad_segs=4), 1e-5))
    if not g.is_valid:
        g = poligonos(shapely.make_valid(g))
    m = mapping(g)
    return {"type": m["type"], "coordinates": arredonda(m["coordinates"])}


def salva_poly(caminho, polys, n):
    gs, ls = [], []
    for i in range(n):
        gs.append(poligono_json(polys[i]))
        ls.append(ponto_rotulo(polys[i]))
    caminho.write_text(json.dumps({"g": gs, "l": ls}, separators=(",", ":")), encoding="utf-8")
    log(f"  {caminho.name}: {n} polígonos, {caminho.stat().st_size / 1e6:.2f} MB")


# ---------------------------------------------------------------- candidatos (divulgação oficial)
def candidatos_oficiais(uf, cargo, cache):
    _, e = CARGOS[cargo]
    url = URL_RES.format(e=e, uf=uf.lower(), c=cargo)
    d = json.loads(baixar(url, cache / "resultado" / f"c{cargo:04d}.json").read_text(encoding="utf-8"))
    cands, partidos = {}, {}
    for car in d.get("carg", []):
        for ag in car.get("agr", []):
            for p in ag.get("par", []):
                partidos[str(p["n"])] = p["sg"]
                for c in p.get("cand", []):
                    cands[str(c["n"])] = {"nome": titulo(c["nmu"]), "partido": p["sg"], "sit": c.get("st", ""),
                                          "valido": c.get("dvt", "").startswith("Válido"), "votos": int(c["vap"] or 0)}
    return cands, partidos


def esparso(vec):
    """Vetor denso por seção → {"i": saltos entre índices não nulos, "v": valores}."""
    nz = np.flatnonzero(vec)
    return {"i": np.diff(np.concatenate([[-1], nz])).astype(int).tolist(), "v": vec[nz].astype(int).tolist()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uf", required=True)
    a = ap.parse_args()
    UF = a.uf.upper()
    uf = UF.lower()
    cod_ibge, nome_uf = UFS[UF]
    cache = CACHE / uf
    OUT = ROOT / "public" / "data" / uf
    (OUT / "v").mkdir(parents=True, exist_ok=True)
    log(f"{nome_uf} · saída {OUT}")

    # ---- 1. seções (boletins de urna)
    secs = [json.loads(l) for l in (cache / "secoes.jsonl").read_text().splitlines() if l.strip()]
    secs.sort(key=lambda r: (r["m"], r["z"], r["s"]))
    n = len(secs)
    cargos = sorted({int(c) for r in secs for c in r["c"]})
    log(f"  {n} seções com boletim; cargos {cargos}")
    det = pd.DataFrame({"CD_MUNICIPIO": [r["m"] for r in secs], "NR_ZONA": [r["z"] for r in secs],
                        "NR_SECAO": [r["s"] for r in secs], "NR_LOCAL_VOTACAO": [r["l"] for r in secs],
                        "QT_APTOS": [r["ap"] for r in secs]})
    est = str(next(c for c in (3, 7, 6, 5, 8) if c in cargos))
    det["cp"] = [r["c"][est]["cp"] for r in secs]  # comparecimento da eleição estadual
    if 1 in cargos:
        dif = np.abs(np.array([r["c"]["1"]["cp"] for r in secs]) - det.cp.values)
        log(f"  comparecimento presidente × estadual: diferença máxima {dif.max()} em {(dif > 0).sum()} seções")
    det["si"] = det.index
    K = ["CD_MUNICIPIO", "NR_ZONA", "NR_SECAO"]

    # ---- 2. votos por candidato e conferência com a divulgação oficial
    meta_cargos, series = [], {}
    for cg in cargos:
        oficial, partidos = candidatos_oficiais(uf, cg, cache)
        nums = sorted({num for r in secs for num in r["c"].get(str(cg), {}).get("v", {})} | set(oficial))
        idx = {num: j for j, num in enumerate(nums)}
        M = np.zeros((n, len(nums)), dtype=np.int32)
        for i, r in enumerate(secs):
            for num, q in r["c"].get(str(cg), {}).get("v", {}).items():
                M[i, idx[num]] += q
        tot = M.sum(0)
        div = [(num, int(tot[idx[num]]), c["votos"]) for num, c in oficial.items() if c["valido"] and tot[idx[num]] != c["votos"]]
        log(f"  {CARGOS[cg][0]}: {len(oficial)} candidatos; {len(oficial) - len(div)} idênticos à divulgação oficial")
        for d in div[:10]:
            log("    divergência", d)
        if div:
            sys.exit(f"{CARGOS[cg][0]}: boletins não batem com a divulgação oficial")
        cands = []
        pasta = OUT / "v" / str(cg)
        pasta.mkdir(exist_ok=True)
        for num in nums:
            c = oficial.get(num) or {"nome": f"Candidato {num}", "partido": partidos.get(num[:2], ""), "sit": "", "valido": False}
            v = int(tot[idx[num]])
            if v == 0:
                continue
            (pasta / f"{num}.json").write_text(json.dumps(esparso(M[:, idx[num]]), separators=(",", ":")))
            series[f"{cg}:{num}"] = M[:, idx[num]]
            cands.append([num, c["nome"], c["partido"], c["sit"], v, 1 if c["valido"] else 0])
        cands.sort(key=lambda x: -x[4])
        cps = np.array([r["c"].get(str(cg), {}).get("cp", 0) for r in secs])
        meta_cargos.append({"cd": cg, "nome": CARGOS[cg][0], "vagas": 2 if cg == 5 else 1, "cands": cands,
                            "cp": int(cps.sum()), "leg": int(sum(r["c"].get(str(cg), {}).get("leg", 0) for r in secs)),
                            "br": int(sum(r["c"].get(str(cg), {}).get("br", 0) for r in secs)),
                            "nu": int(sum(r["c"].get(str(cg), {}).get("nu", 0) for r in secs))})
    polos = {}
    pres = next((c for c in meta_cargos if c["cd"] == 1), None)
    if pres:
        for k, sg in POLOS.items():
            c = next((c for c in pres["cands"] if c[2] == sg), None)
            if c:
                polos[k] = f"1:{c[0]}"
    log(f"  polos esquerda × direita: {polos}")

    # ---- 3. malhas do IBGE e mapeamento TSE → IBGE
    log("malhas do IBGE")
    mun_geo = json.loads(baixar(f"{IBGE}/v3/malhas/estados/{cod_ibge}?intrarregiao=municipio&formato=application/vnd.geo+json&qualidade=maxima",
                                cache / "mun_malha.json").read_text())
    mun_meta = json.loads(baixar(f"{IBGE}/v1/localidades/estados/{cod_ibge}/municipios", cache / "mun_meta.json").read_text())
    ib_por_chave = {chave(m["nome"]): m for m in mun_meta}
    conf = json.loads(next(cache.glob(f"{uf}-p00*-cs.json")).read_text())
    nome_tse = {int(m["cd"]): m["nm"] for m in conf["abr"][0]["mu"]}
    tse2ib = {}
    for cd in det.CD_MUNICIPIO.unique():
        m = ib_por_chave.get(chave(nome_tse[cd]))
        if not m:
            sys.exit(f"município do TSE sem par no IBGE: {cd} {nome_tse[cd]} (acrescente um apelido em chave())")
        tse2ib[cd] = m
    geo_mun = {int(f["properties"]["codarea"]): valida(shape(f["geometry"])) for f in mun_geo["features"]}
    det["ib"] = det.CD_MUNICIPIO.map(lambda c: tse2ib[c]["id"])
    det["macro"] = det.CD_MUNICIPIO.map(lambda c: tse2ib[c]["regiao-imediata"]["regiao-intermediaria"]["id"])

    # ---- 4. locais de votação: nome, endereço, bairro e coordenadas (cadastro do TSE)
    log("cadastro de locais (TSE)")
    LK = ["CD_MUNICIPIO", "NR_ZONA", "NR_LOCAL_VOTACAO"]

    def cadastro(ano):
        """Locais do cadastro do TSE de `ano` na UF (o zip traz um CSV por UF e um do Brasil inteiro)."""
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
        for c in LK:
            loc[c] = loc[c].astype(int)
        # 2022 usa ponto decimal; 2026, vírgula
        loc["lat"] = loc.NR_LATITUDE.str.replace(",", ".").astype(float)
        loc["lon"] = loc.NR_LONGITUDE.str.replace(",", ".").astype(float)
        return loc.groupby(LK).agg(nome=("NM_LOCAL_VOTACAO", "first"), end=("DS_ENDERECO", "first"),
                                   bairro=("NM_BAIRRO", "first"), lat=("lat", "first"), lon=("lon", "first")).reset_index()

    try:
        info_loc, cadastro_ano = cadastro(2026), 2026
    except Exception as e:  # noqa: BLE001 - o TSE limita downloads logo após a eleição
        log(f"  aviso: cadastro de locais de 2026 indisponível ({e}); usando o de 2022 (mesmo número de local)")
        info_loc, cadastro_ano = cadastro(2022), 2022

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
        for k, r in enumerate(ruins.itertuples()):
            ref = bons[bons.bk == r.bk] if len(bons) else bons
            if len(ref):
                lat, lon = ref.lat.mean(), ref.lon.mean()
            elif len(bons):
                lat, lon = bons.lat.mean(), bons.lon.mean()
            else:
                lat, lon = centro_mun.y, centro_mun.x
            ang, rad = (k + 1) * 2.399963, 0.0015 * math.sqrt(k + 1)  # ~170 m por passo, só para não empilhar
            L.loc[r.Index, "lat"] = lat + rad * math.sin(ang)
            L.loc[r.Index, "lon"] = lon + rad * math.cos(ang)

    # bairros: só nas cidades grandes
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

    def soma(df, by):
        return df.groupby(by).agg(ap=("QT_APTOS", "sum"), cp=("cp", "sum"))

    muns = soma(det, "ib")
    feats = [(geo_mun[ib].simplify(0.00005, preserve_topology=True),
              {"id": int(ib), "n": mun_nome[ib], "rm": int(mun_macro[ib]), "ap": int(r.ap), "cp": int(r.cp), "bb": 1 if ib in grandes else 0})
             for ib, r in muns.iterrows()]
    geojson_fc(feats, OUT / "municipio.geojson")

    fm = []
    for k, r in soma(det, "macro").iterrows():
        ibs = [i for i in geo_mun if mun_macro[i] == k]
        geom = poligonos(unary_union([geo_mun[i] for i in ibs]).buffer(0.00012).buffer(-0.00012)).simplify(0.0008, preserve_topology=True)
        fm.append((geom, {"id": int(k), "n": macro_nome[k], "nm": len(ibs), "ap": int(r.ap), "cp": int(r.cp)}))
    geojson_fc(fm, OUT / "macro.geojson")

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
    salva_poly(OUT / "locais_poly.json", poly_local, len(L))
    salva_poly(OUT / "secoes_poly.json", poly_secao, len(det))

    fb = []
    zb = soma(det.merge(L[["li", "bid"]], on="li"), "bid")
    for r in chaves_b.itertuples():
        sub = L[L.bid == r.bid]
        geom = poligonos(unary_union([celula[li] for li in sub.li if li in celula])).buffer(0.00004).buffer(-0.00004)
        geom = geom.simplify(0.00008, preserve_topology=True)
        if geom.is_empty:
            continue
        zs = zb.loc[r.bid]
        fb.append((geom, {"id": int(r.bid), "n": titulo(sub.bnome.value_counts().index[0]), "mn": mun_nome[r.ib],
                          "mi": int(r.ib), "nl": int(len(sub)), "ap": int(zs.ap), "cp": int(zs.cp)}))
    geojson_fc(fb, OUT / "bairro.geojson")

    zon = soma(det, "NR_ZONA")
    multi = det.groupby("ib").NR_ZONA.nunique()
    multi = set(multi[multi > 1].index)
    fz = []
    for z, r in zon.iterrows():
        partes = []
        mz_ib = sorted(det[det.NR_ZONA == z].ib.unique())
        for ib in mz_ib:
            if ib in multi:
                partes += [celula[li] for li in L[(L.ib == ib) & (L.NR_ZONA == z)].li if li in celula]
            else:
                partes.append(geo_mun[ib])
        geom = poligonos(unary_union(partes).buffer(0.00012).buffer(-0.00012)).simplify(0.0003, preserve_topology=True)
        fz.append((geom, {"id": int(z), "n": f"Zona {z}", "nm": len(mz_ib),
                          "mn": ", ".join(mun_nome[i] for i in mz_ib[:4]) + (f" e mais {len(mz_ib) - 4}" if len(mz_ib) > 4 else ""),
                          "ap": int(r.ap), "cp": int(r.cp)}))
    geojson_fc(fz, OUT / "zona.geojson")

    fl = [({"type": "Point", "coordinates": [round(r.lon, 6), round(r.lat, 6)]},
           {"i": int(r.li), "n": titulo(r.nome), "e": (r.end if isinstance(r.end, str) else "").strip().title(), "b": titulo(r.bnome),
            "mi": int(r.ib), "z": int(r.NR_ZONA), "bi": int(r.bid), "ns": int(r.ns), "g": int(r.geo), "ap": int(r.ap), "cp": int(r.cp)})
          for r in L.itertuples()]
    geojson_fc(fl, OUT / "locais.geojson")

    # cp = comparecimento da eleição estadual; cpf = da federal (presidente), que inclui o voto em trânsito
    sec = {"li": det.li.tolist(), "nr": det.NR_SECAO.tolist(), "ap": det.QT_APTOS.tolist(), "cp": det.cp.tolist(),
           "cpf": [r["c"].get("1", {}).get("cp", c) for r, c in zip(secs, det.cp)]}
    (OUT / "secoes.json").write_text(json.dumps(sec, separators=(",", ":")), encoding="utf-8")
    log(f"  secoes.json: {(OUT / 'secoes.json').stat().st_size / 1e6:.2f} MB")

    # ---- 7. afinidades: por local de votação, quem anda junto com quem (correlação e afinidade)
    log("afinidades")
    ids = list(series)
    li = det.li.values
    nl = len(L)
    V = np.zeros((nl, len(ids)))
    for j, k in enumerate(ids):
        V[:, j] = np.bincount(li, weights=series[k], minlength=nl)
    cargo_de = np.array([int(k.split(":")[0]) for k in ids])
    C = np.bincount(li, weights=det.cp.values, minlength=nl).astype(float)
    Cf = np.bincount(li, weights=np.array(sec["cpf"], dtype=float), minlength=nl)
    ok = C > 0
    V, C, Cf = V[ok], C[ok], Cf[ok]
    D = np.where(cargo_de[None, :] == 1, Cf[:, None], C[:, None])  # denominador de cada série: comparecimento da eleição dela
    S = V / np.maximum(D, 1)
    w = C / C.sum()
    with np.errstate(all="ignore"):  # o BLAS do macOS emite avisos espúrios no matmul
        Z = (S - w @ S) * np.sqrt(w)[:, None]
        cov = Z.T @ Z
        sd = np.sqrt(np.clip(np.diag(cov), 1e-30, None))
        R = cov / np.outer(sd, sd)
        # afinidade de k para j: participação de k no local médio do eleitor de j ÷ participação de k no estado
        A = (V.T @ S) / V.sum(0)[:, None] / (V.sum(0) / D.sum(0))[None, :]
    tot = V.sum(0)
    af = {}
    for j, k in enumerate(ids):
        if tot[j] < 50:  # poucos votos: correlação sem sentido
            continue
        por = {}
        for cg in cargos:
            sel = np.flatnonzero((cargo_de == cg) & (np.arange(len(ids)) != j) & (tot >= 50))
            if not len(sel):
                continue
            ordem = sel[np.argsort(-R[j, sel])]
            pick = list(ordem[:8]) + [x for x in ordem[-3:] if x not in ordem[:8]]
            por[str(cg)] = [[ids[x].split(":")[1], round(float(R[j, x]), 3), round(float(A[j, x]), 2)] for x in pick]
        af[k] = por
    (OUT / "afinidades.json").write_text(json.dumps(af, separators=(",", ":")), encoding="utf-8")
    log(f"  afinidades.json: {len(af)} candidatos, {(OUT / 'afinidades.json').stat().st_size / 1e6:.2f} MB")

    # ---- 8. meta
    b = unary_union([g for g, _ in feats]).bounds
    meta = {
        "gerado_em": date.today().isoformat(), "uf": UF, "uf_nome": nome_uf, "cod_ibge": cod_ibge,
        "eleicao": "Eleições Gerais 2026 · 1º turno (4 de outubro)", "turno": 1,
        "fonte": f"Boletins de urna e divulgação oficial do TSE (configuração de {conf['dg']} {conf['hg']}); malhas do IBGE",
        "cadastro_locais": cadastro_ano, "bounds": [[round(b[0], 3), round(b[1], 3)], [round(b[2], 3), round(b[3], 3)]],
        "estado": {"ap": int(det.QT_APTOS.sum()), "cp": int(det.cp.sum())},
        "cargos": meta_cargos, "polos": polos,
        "contagens": {"macro": len(fm), "municipio": len(feats), "zona": len(fz), "bairro": len(fb), "local": len(L),
                      "secao": n, "locais_sem_coordenada": int((L.geo == 0).sum())},
    }
    (OUT / "meta.json").write_text(json.dumps(meta, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    ufs_path = ROOT / "public" / "data" / "ufs.json"
    ufs = json.loads(ufs_path.read_text()) if ufs_path.exists() else {}
    ufs[uf] = nome_uf
    ufs_path.write_text(json.dumps(dict(sorted(ufs.items())), ensure_ascii=False), encoding="utf-8")
    log("ok", json.dumps(meta["contagens"]))


if __name__ == "__main__":
    main()
