#!/usr/bin/env python3
"""Arquivos nacionais (depois de scripts/build_data.py nas UFs):
    public/data/br.json       UFs (geometria leve, Lula × Bolsonaro, comparecimento) e os polos, para a abertura
    public/data/br-mun.json   todos os municípios com Lula × Bolsonaro (sob demanda, mapa do Brasil por município)
    public/data/cands.json    índice nacional de candidatos para a busca (presidente uma vez só, com uf "br")
    public/fotos/br/1-<k>.webp sprites de presidente

Uso: .venv/bin/python scripts/build_br.py
"""
import json
import sys
from datetime import date
from pathlib import Path

from shapely.geometry import MultiPolygon, Polygon, shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comum import CACHE, ELEICAO, POLOS, ROOT, UFS, baixar, grava_json, log, ponto_rotulo, qgeom, sprites_presidente, valida  # noqa: E402

DATA = ROOT / "public" / "data"
SIMPLIFICA_MUN = 0.008  # graus: municípios no mapa do Brasil inteiro (zoom ≤ 6)


def de_qgeom(g, q):
    """qgeom → MultiPolygon do shapely (inverso de comum.qgeom)."""
    polys = []
    for pol in g:
        aneis = []
        for a in pol:
            x, y, pts = a[0], a[1], [(a[0] / q, a[1] / q)]
            for k in range(2, len(a), 2):
                x += a[k]; y += a[k + 1]
                pts.append((x / q, y / q))
            aneis.append(pts)
        polys.append(Polygon(aneis[0], aneis[1:]))
    return MultiPolygon(polys)


def main():
    pos, oficial = sprites_presidente()
    malha = json.loads(baixar("https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&formato=application/vnd.geo+json&qualidade=intermediaria",
                              CACHE / "br" / "malha_uf.json").read_text())
    geo = {int(f["properties"]["codarea"]): valida(shape(f["geometry"])) for f in malha["features"]}
    ufs, muns, cands = [], [], []
    for UF, (cod, nome) in sorted(UFS.items()):
        uf = UF.lower()
        g = geo[cod]
        b = g.bounds
        item = {"uf": uf, "nome": nome, "cod": cod, "b": [[round(b[0], 3), round(b[1], 3)], [round(b[2], 3), round(b[3], 3)]],
                "g": qgeom(g.simplify(0.01, preserve_topology=True), 1000), "lx": 0, "ly": 0, "ap": 0, "cp": 0, "esq": 0, "dir": 0, "ok": 0}
        item["lx"], item["ly"] = ponto_rotulo(g)
        rp, bp = CACHE / uf / "resumo.json", DATA / uf / "base.json"
        if rp.exists() and bp.exists():
            r = json.loads(rp.read_text())
            item.update({"ap": r["ap"], "cp": r["cp"], "esq": r["esq"], "dir": r["dir"], "ok": 1})
            for m in r["mun"]:  # [ibge, uf, nome, qgeom, lx, ly, esq, dir, cp]: mais leve para o país inteiro
                g = valida(de_qgeom(m[3], 10000)).simplify(SIMPLIFICA_MUN, preserve_topology=True)
                muns.append(m[:3] + [qgeom(g, 10000)] + m[4:])
            base = json.loads(bp.read_text())
            for c in base["cargos"]:
                if c["cd"] == 1:
                    continue
                for num, nm, comp, part, sit, v, val, _, s, p in c["c"]:
                    cands.append([uf, c["cd"], num, nm, comp, part, v, sit, val, s, p])
        ufs.append(item)
    for num, c in sorted(oficial.items(), key=lambda kv: -kv[1]["votos"]):
        s, p = pos.get(num, (-1, 0))
        cands.append(["br", 1, num, c["nome"], c["completo"], c["partido"], c["votos"], c["sit"], 1 if c["valido"] else 0, s, p])
    polos = {}
    for k, sg in POLOS.items():
        num, c = next(((n, c) for n, c in oficial.items() if c["partido"] == sg), (None, None))
        if num:
            s, p = pos.get(num, (-1, 0))
            polos[k] = {"n": num, "nome": c["nome"], "partido": sg, "s": s, "p": p}
    t1 = grava_json(DATA / "br.json", {"v": 2, "gerado_em": date.today().isoformat(), "eleicao": ELEICAO, "q": 1000, "ufs": ufs, "polos": polos})
    t2 = grava_json(DATA / "br-mun.json", {"q": 10000, "mun": muns})
    t3 = grava_json(DATA / "cands.json", {"c": cands})
    log(f"br.json {t1 / 1e3:.0f} KB ({sum(u['ok'] for u in ufs)} UFs com dados); br-mun.json {t2 / 1e6:.2f} MB ({len(muns)} municípios); "
        f"cands.json {t3 / 1e6:.2f} MB ({len(cands)} candidatos)")
    velho = DATA / "ufs.json"
    if velho.exists():
        velho.unlink()


if __name__ == "__main__":
    main()
