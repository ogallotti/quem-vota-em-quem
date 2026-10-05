#!/usr/bin/env python3
"""Baixa o resultado oficial de cada cargo por UF (nomes, partidos, situação e o código sequencial do candidato) e a foto
de cada candidato na área de divulgação do TSE.

Uso:   .venv/bin/python scripts/fotos.py [--ufs ma,sp] [--trabalhadores 8]
Saída: .cache/<uf>/resultado/c<cargo>.json   e   .cache/fotos/<uf>/<sq>.jpeg   (presidente: .cache/fotos/br/)

As fotos ficam no cache; scripts/build_data.py as reduz e junta em sprites (o site nunca chama o TSE).
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
UFS = "ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to".split()
RES = "https://resultados.tse.jus.br/oficial/ele2026/{e}/dados/{uf}/{uf}-c{c:04d}-e{e:06d}-u.json"
FOTO = "https://resultados.tse.jus.br/oficial/ele2026/{e}/fotos/{uf}/{sq}.jpeg"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(url, tentativas=7):
    for t in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (pesquisa eleitoral)"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404 or t == tentativas - 1:
                raise
            time.sleep((5 * 2 ** t) if e.code == 429 else 1.5 * (t + 1))
        except Exception:  # noqa: BLE001
            if t == tentativas - 1:
                raise
            time.sleep(1.5 * (t + 1))


def cargos(uf):
    return [3, 5, 6, 8] if uf == "df" else [3, 5, 6, 7]


def sqs(path):
    d = json.loads(path.read_text(encoding="utf-8"))
    return [c["sqcand"] for car in d.get("carg", []) for ag in car.get("agr", []) for p in ag.get("par", []) for c in p.get("cand", [])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ufs", default="")
    ap.add_argument("--trabalhadores", type=int, default=8)
    a = ap.parse_args()
    ufs = a.ufs.split(",") if a.ufs else UFS
    tarefas = []  # (eleição, uf da foto, sq)
    # presidente: um arquivo nacional; os demais cargos, por UF
    alvos = [("br", 1, 6257)] + [(uf, c, 6259) for uf in ufs for c in cargos(uf)]
    for uf, c, e in alvos:
        dest = CACHE / uf / "resultado" / f"c{c:04d}.json"
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(get(RES.format(e=e, uf=uf, c=c)))
        tarefas += [(e, uf, sq) for sq in sqs(dest)]
    # o resultado de presidente por UF (usado para conferir os boletins) também vai para o cache de cada UF
    for uf in ufs:
        dest = CACHE / uf / "resultado" / "c0001.json"
        if not dest.exists():
            dest.write_bytes(get(RES.format(e=6257, uf=uf, c=1)))
    falta = [t for t in tarefas if not (CACHE / "fotos" / t[1] / f"{t[2]}.jpeg").exists()]
    log(f"{len(tarefas)} candidatos; {len(falta)} fotos a baixar")
    erros, t0 = [], time.time()

    def baixa(t):
        e, uf, sq = t
        dest = CACHE / "fotos" / uf / f"{sq}.jpeg"
        try:
            dados = get(FOTO.format(e=e, uf=uf, sq=sq))
        except urllib.error.HTTPError as err:
            if err.code == 404:  # candidato sem foto publicada
                return
            raise
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(dados)

    with ThreadPoolExecutor(a.trabalhadores) as ex:
        for i, f in enumerate([ex.submit(baixa, t) for t in falta], 1):
            try:
                f.result()
            except Exception as err:  # noqa: BLE001
                erros.append(repr(err)[:120])
            if i % 1000 == 0:
                log(f"  {i}/{len(falta)} em {time.time() - t0:.0f}s ({len(erros)} erros)")
    log(f"ok: {len(falta) - len(erros)} fotos em {time.time() - t0:.0f}s; {len(erros)} erros")
    if erros:
        sys.exit("há fotos com erro: rode de novo (o cache evita baixar o que já veio)")


if __name__ == "__main__":
    main()
