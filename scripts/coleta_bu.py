#!/usr/bin/env python3
"""Coleta os boletins de urna (BU) de todas as seções de uma UF e extrai os votos de TODOS os cargos.

Uso:   .venv/bin/python scripts/coleta_bu.py --uf ma [--trabalhadores 16] [--parte 2/6] [--sem-cache] [--limite N]
       --parte k/n   só a k-ésima de n fatias contíguas das seções (para rodar em paralelo, ex.: GitHub Actions)
       --sem-cache   não guarda o BU bruto (~14 KB por seção): decodifica em memória e guarda só o resumo
Saída: .cache/<uf>/secoes.jsonl (ou secoes.p<k>.jsonl com --parte), uma linha por seção:
    {"m": município TSE, "z": zona, "l": local, "s": seção, "ap": aptos,
     "c": {"<cargo>": {"cp": comparecimento, "nom": nominais, "leg": legenda, "br": brancos, "nu": nulos,
                       "v": {"<número>": votos nominais}, "lg": {"<partido>": votos de legenda}}}}

Cargos: 1 presidente (eleição federal), 3 governador, 5 senador, 6 deputado federal, 7 deputado estadual,
8 deputado distrital (DF). O BU de cada seção traz as duas eleições (federal e estadual).

Por que BU: logo depois da eleição o TSE publica só os boletins por seção (binários BER/ASN.1); os CSVs consolidados
saem dias depois. O formato de 2026 tem campos INTEGER a mais que a especificação de 2022, por isso a leitura é feita
por posição/etiqueta BER, sem depender da versão da especificação:
  ResultadoVotacaoPorEleicao ≈ SEQUENCE { idEleicao INT, qtdEleitoresAptos INT, ..., resultadosVotacao SEQUENCE OF }
  ResultadoVotacao           ≈ SEQUENCE { tipoCargo ENUM, qtdComparecimento INT, totaisVotosCargo SEQUENCE OF }
  TotalVotosCargo            ≈ SEQUENCE { [1] cargo ENUM | [2] consulta, ordemImpressao INT, votosVotaveis SEQUENCE OF }
  TotalVotosVotavel          ≈ SEQUENCE { [1] tipoVoto, [2] quantidadeVotos, [3] identificacaoVotavel {partido, codigo}?, ... }

O TSE responde HTTP 429 por IP sob carga. Para uma UF grande, rode na VPS e traga .cache/<uf>/ com scp.
Seções agregadas não têm boletim próprio (404): os votos e eleitores delas estão no BU da seção principal.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLEITO = 3220  # 1º turno de 2026
BASE = f"https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/{PLEITO}"
TIPO = {1: "nominal", 2: "branco", 3: "nulo", 4: "legenda", 5: "sem_candidato"}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(url, tentativas=8):
    for t in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (pesquisa eleitoral)"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404 or t == tentativas - 1:  # 404: não existe (seção agregada), não adianta repetir
                raise
            time.sleep((5 * 2 ** t) if e.code == 429 else 1.5 * (t + 1))  # 429 = limite por IP
        except Exception:  # noqa: BLE001 - falha de rede vira nova tentativa
            if t == tentativas - 1:
                raise
            time.sleep(1.5 * (t + 1))


# ---------------------------------------------------------------- BER cru
def tlv(b, i):
    t0 = b[i]; i += 1
    if t0 & 0x1f == 0x1f:
        while b[i] & 0x80:
            i += 1
        i += 1
    ln = b[i]; i += 1
    if ln & 0x80:
        n = ln & 0x7f
        ln = int.from_bytes(b[i:i + n], "big"); i += n
    return t0, i, i + ln


def kids(b, s, e):
    out, i = [], s
    while i < e:
        t0, cs, ce = tlv(b, i)
        out.append((t0, cs, ce)); i = ce
    return out


def inteiro(b, s, e):
    return int.from_bytes(b[s:e], "big", signed=True)


def conteudo_bu(dados):
    """Envelope genérico: SEQUENCE { cabecalho, fase, identificacao, tipoEnvelope, conteudo OCTET STRING }."""
    _, s, e = tlv(dados, 0)
    octs = [k for k in kids(dados, s, e) if k[0] == 0x04]
    _, cs, ce = max(octs, key=lambda k: k[2] - k[1])
    return dados[cs:ce]


def decodifica(dados):
    b = conteudo_bu(dados)
    _, s, e = tlv(b, 0)
    filhos = kids(b, s, e)
    # identificacaoSecao (4º elemento): SEQUENCE { SEQUENCE {municipio, zona}, local, secao }
    _, s4, e4 = filhos[3]
    idk = kids(b, s4, e4)
    mz = kids(b, idk[0][1], idk[0][2])
    sec = {"m": inteiro(b, *mz[0][1:]), "z": inteiro(b, *mz[1][1:]), "l": inteiro(b, *idk[1][1:]),
           "s": inteiro(b, *idk[2][1:]), "c": {}}
    # resultados por eleição: maior bloco construído após a identificação
    bloco = max([k for k in filhos[4:] if k[0] in (0x30, 0xA3)], key=lambda k: k[2] - k[1])
    for _, es, ee in kids(b, bloco[1], bloco[2]):
        partes = kids(b, es, ee)
        ints = [inteiro(b, p[1], p[2]) for p in partes if p[0] == 0x02]
        if not ints:
            continue
        sec["ap"] = max(sec.get("ap", 0), ints[1])
        resultados = [p for p in partes if p[0] == 0x30][-1]
        for _, rs, re_ in kids(b, resultados[1], resultados[2]):
            rp = kids(b, rs, re_)
            comparec = inteiro(b, rp[1][1], rp[1][2])
            for _, cs, ce in kids(b, rp[2][1], rp[2][2]):
                cp = kids(b, cs, ce)
                if cp[0][0] != 0x81:  # [2] = consulta popular, não é cargo
                    continue
                cargo = inteiro(b, cp[0][1], cp[0][2])
                r = {"cp": comparec, "nom": 0, "leg": 0, "br": 0, "nu": 0, "v": {}, "lg": {}}
                lista = [p for p in cp if p[0] == 0x30][-1]
                for _, vs, ve in kids(b, lista[1], lista[2]):
                    tipo = qtd = num = None
                    for t0v, xs, xe in kids(b, vs, ve):
                        if t0v == 0x81:
                            tipo = TIPO.get(inteiro(b, xs, xe), "outro")
                        elif t0v == 0x82:
                            qtd = inteiro(b, xs, xe)
                        elif t0v == 0xA3:
                            idv = kids(b, xs, xe)
                            num = inteiro(b, idv[-1][1], idv[-1][2])
                    if tipo == "nominal" and num is not None:
                        r["nom"] += qtd
                        r["v"][str(num)] = r["v"].get(str(num), 0) + qtd
                    elif tipo == "legenda" and num is not None:
                        r["leg"] += qtd
                        r["lg"][str(num)] = r["lg"].get(str(num), 0) + qtd
                    elif tipo == "branco":
                        r["br"] += qtd
                    elif tipo == "nulo":
                        r["nu"] += qtd
                sec["c"][str(cargo)] = r
    return sec


def processa(uf, m, z, s, cache, sem_bu, guarda=True):
    """Baixa (com cache) o aux e o BU de uma seção e devolve o registro decodificado (ou None se não há BU)."""
    chave = f"{m}/{z}/{s}"
    if chave in sem_bu:
        return None
    arq = cache / "bu" / m / z / f"{s}.dat"
    if not guarda or not arq.exists():
        base = f"{BASE}/dados/{uf}/{m}/{z}/{s}"
        try:
            aux = json.loads(get(f"{base}/p00{PLEITO}-{uf}-m{m}-z{z}-s{s}-aux.json"))
        except urllib.error.HTTPError as e:
            if e.code == 404:  # seção agregada: os votos dela estão no boletim da seção principal
                return chave
            raise
        # "bu" = boletim da urna; "busa" = boletim do Sistema de Apuração (urna substituída ou voto em cédula): mesmo formato
        tipo = next((t for t in ("bu", "busa") if any(a["tp"] == t for h in aux.get("hashes", []) for a in h["arq"])), None)
        if not tipo:
            raise RuntimeError(f"seção {chave} sem BU (situação {aux.get('st')})")
        h = [h for h in aux["hashes"] if any(a["tp"] == tipo for a in h["arq"])][-1]  # o mais recente
        nome = next(a["nm"] for a in h["arq"] if a["tp"] == tipo)
        dados = get(f"{base}/{h['hash']}/{nome}")
        if not guarda:
            return decodifica(dados)
        arq.parent.mkdir(parents=True, exist_ok=True)
        arq.write_bytes(dados)
    return decodifica(arq.read_bytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uf", required=True)
    ap.add_argument("--limite", type=int, default=0)
    ap.add_argument("--trabalhadores", type=int, default=16)
    ap.add_argument("--parte", default="")
    ap.add_argument("--sem-cache", action="store_true")
    a = ap.parse_args()
    uf = a.uf.lower()
    cache = ROOT / ".cache" / uf
    cache.mkdir(parents=True, exist_ok=True)
    cfg = cache / f"{uf}-p00{PLEITO}-cs.json"
    if not cfg.exists():
        cfg.write_bytes(get(f"{BASE}/config/{uf}/{uf}-p00{PLEITO}-cs.json"))
    conf = json.loads(cfg.read_text())
    lista = [(mu["cd"], z["cd"], sc["ns"]) for mu in conf["abr"][0]["mu"] for z in mu["zon"] for sc in z["sec"]]
    if a.limite:
        lista = lista[: a.limite]
    sufixo = ""
    if a.parte:
        k, n = (int(x) for x in a.parte.split("/"))
        lista = lista[(k - 1) * len(lista) // n: k * len(lista) // n]
        sufixo = f".p{k}"
    arq_sem = cache / f"sem_bu{sufixo}.txt"
    sem_bu = set(arq_sem.read_text().split()) if arq_sem.exists() else set()
    log(f"{uf.upper()}: {len(lista)} seções na configuração de {conf['dg']} {conf['hg']} ({len(sem_bu)} já sabidas sem BU)")
    out, t0 = [], time.time()
    pendentes, erros = lista, []
    for rodada in range(4):  # seções que falharam (429, rede) voltam para a fila, com pausa crescente
        if rodada:
            log(f"  rodada {rodada + 1}: {len(pendentes)} seções com erro; esperando {60 * rodada}s")
            time.sleep(60 * rodada)
        erros = []
        with ThreadPoolExecutor(a.trabalhadores) as ex:
            fut = {ex.submit(processa, uf, *x, cache, sem_bu, not a.sem_cache): x for x in pendentes}
            for i, f in enumerate(as_completed(fut), 1):
                try:
                    r = f.result()
                    if isinstance(r, str):
                        sem_bu.add(r)
                    elif r is not None:
                        out.append(r)
                except Exception as e:  # noqa: BLE001
                    erros.append((fut[f], repr(e)[:160]))
                if i % 2000 == 0:
                    log(f"  {i}/{len(pendentes)} em {time.time() - t0:.0f}s ({len(erros)} erros)")
        if not erros:
            break
        pendentes = [e[0] for e in erros]
    arq_sem.write_text("\n".join(sorted(sem_bu)) + "\n")
    out.sort(key=lambda r: (r["m"], r["z"], r["s"]))
    with open(cache / f"secoes{sufixo}.jsonl", "w") as f:
        for r in out:
            f.write(json.dumps(r, separators=(",", ":")) + "\n")
    cargos = sorted({c for r in out for c in r["c"]}, key=int)
    log(f"ok: {len(out)} seções com BU, {len(sem_bu)} sem BU (agregadas), {len(erros)} erros, cargos {cargos}, "
        f"{time.time() - t0:.0f}s")
    for e in erros[:10]:
        log("  erro", e)
    if erros:
        sys.exit("há seções com erro: rode de novo (o cache evita baixar o que já veio)")


if __name__ == "__main__":
    main()
