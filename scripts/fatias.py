#!/usr/bin/env python3
"""Matriz de fatias para a coleta em paralelo (GitHub Actions): uma entrada por pedaço de ~N seções de cada UF.

Uso: python3 scripts/fatias.py [--ufs ac,ma] [--tamanho 10000]   → imprime JSON {"include": [{"uf": "sp", "parte": "3/11"}, ...]}
"""
import argparse
import json
import math
import urllib.request

UFS = "ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to".split()
BASE = "https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/3220/config"

ap = argparse.ArgumentParser()
ap.add_argument("--ufs", default="")
ap.add_argument("--tamanho", type=int, default=10000)
a = ap.parse_args()
inc = []
for uf in (a.ufs.split(",") if a.ufs else UFS):
    req = urllib.request.Request(f"{BASE}/{uf}/{uf}-p003220-cs.json", headers={"User-Agent": "Mozilla/5.0 (pesquisa eleitoral)"})
    conf = json.loads(urllib.request.urlopen(req, timeout=60).read())
    n = sum(len(z["sec"]) for m in conf["abr"][0]["mu"] for z in m["zon"])
    partes = max(1, math.ceil(n / a.tamanho))
    inc += [{"uf": uf, "parte": f"{k}/{partes}"} for k in range(1, partes + 1)]
print(json.dumps({"include": inc}))
