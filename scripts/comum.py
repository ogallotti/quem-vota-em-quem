"""Funções compartilhadas por build_data.py e build_br.py: texto, geometria quantizada, resultado oficial e fotos."""
import gzip
import json
import math
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

import numpy as np
import shapely
from scipy.spatial import cKDTree
from shapely.geometry import Point, Polygon, box
from shapely.ops import polylabel, unary_union

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
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
ELEICAO = "Eleições Gerais 2026 · 1º turno (4 de outubro)"
# Polos do eixo esquerda × direita: candidatos a presidente do PT (Lula) e do PL (Bolsonaro), medidos no voto da seção.
POLOS = {"esq": "PT", "dir": "PL"}
FOTO_PX, FOTO_COLS, FOTO_POR_SPRITE = 64, 8, 64


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


def grava_json(caminho, obj):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return caminho.stat().st_size


# ---------------------------------------------------------------- texto
def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


# nomes que o TSE e o IBGE grafam de jeitos sem semelhança (chave do TSE → chave do IBGE)
APELIDOS = {"BOA SAUDE": "JANUARIO CICCO"}


def pareia_municipios(tse, ibge):
    """tse: {código TSE: nome}; ibge: lista de municípios do IBGE. Pareia pelo nome normalizado; o que sobrar, pelo nome
    mais parecido dentro da UF (grafias divergentes, ex. Embu × Embu das Artes). Devolve {código TSE: município IBGE}."""
    import difflib
    por_chave = {chave(m["nome"]): m for m in ibge}
    out, faltam = {}, []
    for cd, nome in tse.items():
        m = por_chave.get(APELIDOS.get(chave(nome), chave(nome)))
        if m:
            out[cd] = m
        else:
            faltam.append(cd)
    livres = {chave(m["nome"]): m for m in ibge if m["id"] not in {x["id"] for x in out.values()}}
    for cd in faltam:
        k = chave(tse[cd])
        c = difflib.get_close_matches(k, list(livres), n=1, cutoff=0.6)
        # nomes trocados por completo (ex.: Embu → Embu das Artes): um contém o outro
        c = c or [x for x in livres if x.startswith(k + " ") or k.startswith(x + " ")][:1]
        if not c:
            raise SystemExit(f"município do TSE sem par no IBGE: {cd} {tse[cd]}")
        log(f"  pareado por semelhança: {tse[cd]} (TSE) → {livres[c[0]]['nome']} (IBGE)")
        out[cd] = livres.pop(c[0])
    return out


def chave(s):
    k = re.sub(r"[^A-Z0-9]+", " ", sem_acento(s.upper())).strip()
    return k


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
    try:
        p = polylabel(maior, tolerance=max(0.00002, math.sqrt(maior.area) / 200))
    except Exception:  # noqa: BLE001
        p = maior.representative_point()
    return [round(p.x, 5), round(p.y, 5)]


def valida(g):
    if not g.is_valid:
        g = shapely.make_valid(g)
    try:
        g = shapely.set_precision(g, 1e-5)
    except shapely.errors.GEOSException:  # malha com auto-interseção (ex.: CE): corrige com buffer(0) e tenta de novo
        g = shapely.set_precision(shapely.make_valid(g.buffer(0)), 1e-5)
    if not g.is_valid:
        g = shapely.make_valid(g)
    return poligonos(g)


def _anel(coords, q):
    pts = []
    for x, y in coords:
        p = (round(x * q), round(y * q))
        if not pts or pts[-1] != p:
            pts.append(p)
    while len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    if len(pts) < 3:
        return None
    flat = [pts[0][0], pts[0][1]]
    for a, b in zip(pts, pts[1:]):
        flat += [b[0] - a[0], b[1] - a[1]]
    return flat


def qgeom(g, q):
    """Polygon/MultiPolygon → [[anel, anel...], ...] com inteiros na escala q (primeiro par absoluto, depois diferenças)."""
    g = poligonos(g)
    polys = list(g.geoms) if g.geom_type == "MultiPolygon" else ([g] if not g.is_empty else [])
    out = []
    for p in polys:
        ext = _anel(p.exterior.coords, q)
        if not ext:
            continue
        aneis = [ext] + [a for a in (_anel(i.coords, q) for i in p.interiors) if a]
        out.append(aneis)
    if not out and not g.is_empty:  # pedaço menor que a grade: quadradinho de uma unidade no lugar
        c = g.representative_point()
        x, y = round(c.x * q), round(c.y * q)
        out = [[[x, y, 1, 0, 0, 1, -1, 0]]]
    return out


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
    """Afasta pontos a menos de `dmin` (~45 m) uns dos outros, só para o desenho."""
    P = np.array(pts, dtype=float)
    vistos = {}
    for i in range(len(P)):
        k = (round(P[i, 0], 7), round(P[i, 1], 7))
        n = vistos.get(k, 0)
        vistos[k] = n + 1
        if n:
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


# ---------------------------------------------------------------- resultado oficial
def resultado(uf, cargo):
    """Resultado oficial de um cargo (cache de scripts/fotos.py ou baixa agora). uf 'br' = presidente nacional."""
    _, e = CARGOS[cargo]
    return json.loads(baixar(URL_RES.format(e=e, uf=uf, c=cargo), CACHE / uf / "resultado" / f"c{cargo:04d}.json").read_text(encoding="utf-8"))


def candidatos_oficiais(uf, cargo):
    d = resultado(uf, cargo)
    cands, partidos = {}, {}
    for car in d.get("carg", []):
        for ag in car.get("agr", []):
            for p in ag.get("par", []):
                partidos[str(p["n"])] = p["sg"]
                for c in p.get("cand", []):
                    cands[str(c["n"])] = {"nome": titulo(c["nmu"]), "completo": titulo(c.get("nm") or c["nmu"]), "partido": p["sg"],
                                          "sit": c.get("st", ""), "valido": c.get("dvt", "").startswith("Válido"),
                                          "votos": int(c["vap"] or 0), "sq": str(c.get("sqcand", ""))}
    return cands, partidos


# ---------------------------------------------------------------- fotos (sprites)
def _miniatura(caminho):
    from PIL import Image
    im = Image.open(caminho).convert("RGB")
    w, h = im.size
    lado = min(w, h)
    topo = 0 if h <= w else min(h - lado, round(h * 0.04))  # foto 3×4: quadrado colado no topo, com leve margem
    esq = (w - lado) // 2
    return im.crop((esq, topo, esq + lado, topo + lado)).resize((FOTO_PX, FOTO_PX), Image.LANCZOS)


def sprites(itens, pasta_fotos, destino_prefixo):
    """itens: lista de (chave, sq) já na ordem desejada. Grava <prefixo>-<k>.webp e devolve {chave: (s, p)}.
    Candidatos sem foto no cache ficam fora (s = −1 para quem chama)."""
    from PIL import Image
    com = [(k, pasta_fotos / f"{sq}.jpeg") for k, sq in itens if sq and (pasta_fotos / f"{sq}.jpeg").exists()]
    pos = {}
    destino_prefixo.parent.mkdir(parents=True, exist_ok=True)
    for s in range(0, len(com), FOTO_POR_SPRITE):
        lote = com[s:s + FOTO_POR_SPRITE]
        linhas = math.ceil(len(lote) / FOTO_COLS)
        sheet = Image.new("RGB", (FOTO_COLS * FOTO_PX, linhas * FOTO_PX), (24, 24, 23))
        for p, (k, arq) in enumerate(lote):
            try:
                sheet.paste(_miniatura(arq), ((p % FOTO_COLS) * FOTO_PX, (p // FOTO_COLS) * FOTO_PX))
                pos[k] = (s // FOTO_POR_SPRITE, p)
            except Exception as e:  # noqa: BLE001 - foto corrompida: fica sem foto
                log(f"  foto ilegível {arq.name}: {e}")
        sheet.save(f"{destino_prefixo}-{s // FOTO_POR_SPRITE}.webp", "WEBP", quality=70, method=6)
    return pos


def sprites_presidente():
    """Sprites nacionais de presidente (public/fotos/br/1-<k>.webp), ordem = votos no Brasil. Devolve {num: (s, p)}."""
    oficial, _ = candidatos_oficiais("br", 1)
    ordem = sorted(oficial.items(), key=lambda kv: -kv[1]["votos"])
    return sprites([(n, c["sq"]) for n, c in ordem], CACHE / "fotos" / "br", ROOT / "public" / "fotos" / "br" / "1"), oficial
