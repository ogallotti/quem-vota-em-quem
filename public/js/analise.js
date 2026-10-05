// Liga dados e estatística: o par (X, Y) escolhido, valores por unidade em cada nível e a análise de cada recorte.
import { D, cargoOf, denomOf, getProps, secsOf } from './data.js';
import { analisa, encolhe, pearson, terco } from './stats.js';

export const A = { x: null, y: null, X: null, Y: null, DX: null, DY: null, ver: 0, cache: new Map() };

export function setPar(xKey, X, yKey, Y) {
  Object.assign(A, { x: xKey, y: yKey, X, Y, DX: denomOf(xKey), DY: denomOf(yKey), ver: A.ver + 1 });
  A.cache.clear();
}

/** Mesma vaga, um voto por eleitor: ninguém vota nos dois (senador tem dois votos em 2026, então não é exclusivo). */
export const exclusivos = (x = A.x, y = A.y) => cargoOf(x) === cargoOf(y) && cargoOf(x) !== 5;

function memo(k, f) {
  if (!A.cache.has(k)) A.cache.set(k, f());
  return A.cache.get(k);
}

/** Somas de X, Y e denominadores por unidade de um nível (índice compacto de D.un[level]). */
export function porUnidade(level) {
  return memo(`u:${level}`, () => {
    const u = D.un[level], nU = u.ids.length;
    const x = new Float64Array(nU), y = new Float64Array(nU), dx = new Float64Array(nU), dy = new Float64Array(nU);
    for (let s = 0; s < D.n; s++) {
      const g = u.idx[s];
      if (g < 0) continue;
      x[g] += A.X[s]; y[g] += A.Y[s]; dx[g] += A.DX[s]; dy[g] += A.DY[s];
    }
    return { x, y, dx, dy };
  });
}

/**
 * Votos e participação de X e Y numa unidade. px/py = proporção observada; ex/ey = encolhida em direção à média do
 * estado (para colorir o mapa: uma seção de 50 eleitores não vira extremo por acaso).
 */
export function valorDe(level, id) {
  if (!A.X) return null;
  const e = estado();
  if (level === 'estado') return { x: e.x, y: e.y, dx: e.dx, dy: e.dy, px: e.px, py: e.py, ex: e.px, ey: e.py };
  const u = D.un[level], g = u?.pos.get(id);
  if (g == null) return null;
  const v = porUnidade(level);
  const x = v.x[g], y = v.y[g], dx = v.dx[g], dy = v.dy[g];
  return { x, y, dx, dy, px: dx > 0 ? x / dx : 0, py: dy > 0 ? y / dy : 0, ex: encolhe(x, dx, e.px), ey: encolhe(y, dy, e.py) };
}

/** Totais do estado (sem bootstrap: barato). */
function estado() {
  return memo('est', () => {
    let x = 0, y = 0, dx = 0, dy = 0;
    for (let s = 0; s < D.n; s++) { x += A.X[s]; y += A.Y[s]; dx += A.DX[s]; dy += A.DY[s]; }
    return { x, y, dx, dy, px: dx > 0 ? x / dx : 0, py: dy > 0 ? y / dy : 0 };
  });
}

const MIN_LOCAIS = 12;
/** Unidade de análise de um recorte: locais de votação; em recortes pequenos, as seções. */
function grupoDe(level, id) {
  if (level === 'local' || level === 'secao') return 'secao';
  if (level === 'estado') return 'local';
  const set = new Set();
  for (const s of secsOf(level, id)) set.add(D.sec.li[s]);
  return set.size >= MIN_LOCAIS ? 'local' : 'secao';
}

/** Bloco de cada unidade (correlação dentro dos blocos e bootstrap): local → município; seção → local. */
function blocosDe(unidade) {
  const u = D.un[unidade];
  return Int32Array.from(u.ids, (id) => (unidade === 'local' ? D.loc.mi[id] : D.sec.li[id]));
}

/** Análise completa de um recorte (seleção), com intervalos por bootstrap. */
export function recorte(level, id, { B = 200 } = {}) {
  if (!A.X) return null;
  return memo(`r:${level}:${id}:${B}`, () => {
    const unidade = grupoDe(level, id);
    const u = D.un[unidade];
    const out = analisa({
      secs: secsOf(level, id), grupo: u.idx, nG: u.ids.length, cluster: memo(`bl:${unidade}`, () => blocosDe(unidade)),
      X: A.X, Y: A.Y, DX: A.DX, DY: A.DY, exclusivos: exclusivos(), B,
    });
    out.unidade = unidade;
    out.blocos = unidade === 'local' ? 'municípios' : 'locais';
    out.ids = out.gi.map((g) => u.ids[g]);
    return out;
  });
}

/**
 * Correlação dentro de cada unidade de um nível (lente "Correlação local"): entre os locais de votação da unidade
 * (6 ou mais) ou, se forem poucos, entre as seções (8 ou mais). Devolve Float64Array por unidade (NaN = poucos dados).
 */
export function rPorUnidade(level) {
  return memo(`rl:${level}`, () => {
    const u = D.un[level], nU = u.ids.length;
    const calc = (gIdx, nG, minimo) => {
      const gx = new Float64Array(nG), gy = new Float64Array(nG), gdx = new Float64Array(nG), gdy = new Float64Array(nG), uni = new Int32Array(nG).fill(-1);
      for (let s = 0; s < D.n; s++) {
        const g = gIdx[s];
        gx[g] += A.X[s]; gy[g] += A.Y[s]; gdx[g] += A.DX[s]; gdy[g] += A.DY[s];
        uni[g] = u.idx[s];
      }
      const porU = Array.from({ length: nU }, () => ({ x: [], y: [], w: [] }));
      for (let g = 0; g < nG; g++) {
        if (uni[g] < 0 || !(gdx[g] > 0 && gdy[g] > 0)) continue;
        const b = porU[uni[g]];
        b.x.push(gx[g] / gdx[g]); b.y.push(gy[g] / gdy[g]); b.w.push(gdx[g]);
      }
      return porU.map((b) => (b.x.length >= minimo ? pearson(b.x, b.y, b.w) : null));
    };
    const porLocal = calc(D.un.local.idx, D.un.local.ids.length, 6);
    const porSecao = calc(D.un.secao.idx, D.n, 8);
    return Float64Array.from({ length: nU }, (_, i) => porLocal[i] ?? porSecao[i] ?? NaN);
  });
}

/**
 * Para que lado pende o eleitor de X: no lugar médio onde ele vota, quanto Lula (esquerda) e Bolsonaro (direita) fazem
 * do voto dos dois, contra o recorte inteiro. `E` e `Dr` = votos dos dois polos por seção.
 */
export function lado(level, id, E, Dr) {
  return memo(`ld:${level}:${id}`, () => {
    const secs = secsOf(level, id), nL = D.un.local.ids.length;
    const gx = new Float64Array(nL), ge = new Float64Array(nL), gd = new Float64Array(nL);
    let te = 0, td = 0;
    for (const s of secs) { const g = D.un.local.idx[s]; gx[g] += A.X[s]; ge[g] += E[s]; gd[g] += Dr[s]; te += E[s]; td += Dr[s]; }
    let sx = 0, se = 0;
    for (let g = 0; g < nL; g++) if (gx[g] > 0 && ge[g] + gd[g] > 0) { sx += gx[g]; se += gx[g] * (ge[g] / (ge[g] + gd[g])); }
    const media = te + td > 0 ? te / (te + td) : null;
    return { media, doX: sx > 0 ? se / sx : null, dif: sx > 0 && media != null ? se / sx - media : null };
  });
}

/** Análise de X contra uma série qualquer (ex.: os polos Lula e Bolsonaro), no mesmo recorte, sem bootstrap. */
export function cruzado(level, id, key, Ys) {
  return memo(`cz:${key}:${level}:${id}`, () => {
    const u = D.un.local;
    return analisa({ secs: secsOf(level, id), grupo: u.idx, nG: u.ids.length, X: A.X, Y: Ys, DX: A.DX, DY: denomOf(key), exclusivos: exclusivos(A.x, key), B: 0 });
  });
}

/** Ids das unidades de um nível que caem dentro do recorte (null = todas). */
export function unidadesNoRecorte(level, sLevel, sId) {
  return memo(`nr:${level}:${sLevel}:${sId}`, () => {
    if (sLevel === 'estado') return null;
    const u = D.un[level], set = new Set();
    for (const s of secsOf(sLevel, sId)) if (u.idx[s] >= 0) set.add(u.ids[u.idx[s]]);
    return set;
  });
}

export const nomeRecorte = (level, id) => (level === 'estado' ? D.meta.uf_nome : getProps(level, id)?.n || '');

/**
 * Território de X no recorte: locais de votação onde X é forte (acima de 1,25× a média do recorte, proporção encolhida). Quanto
 * dos eleitores ele reúne e quanto dos votos de X e de Y saiu dali. Se o território de X dá a Y bem mais do que o seu
 * peso no eleitorado, Y depende dele; se dá o mesmo, não.
 */
export function territorio(level, id) {
  return memo(`tt:${level}:${id}`, () => {
    const r = recorte(level, id);
    const u = D.un.local, nL = u.ids.length, secs = secsOf(level, id);
    const gx = new Float64Array(nL), gy = new Float64Array(nL), gd = new Float64Array(nL), gdy = new Float64Array(nL);
    for (const s of secs) { const g = u.idx[s]; gx[g] += A.X[s]; gy[g] += A.Y[s]; gd[g] += A.DX[s]; gdy[g] += A.DY[s]; }
    let el = 0, elT = 0, vx = 0, vxT = 0, vy = 0, vyT = 0, n = 0;
    for (let g = 0; g < nL; g++) {
      if (!(gd[g] > 0)) continue;
      el += gd[g]; vx += gx[g]; vy += gy[g];
      if (gx[g] > 0 && terco(encolhe(gx[g], gd[g], r.px), r.px) === 2) { elT += gd[g]; vxT += gx[g]; vyT += gy[g]; n++; }
    }
    return { n, eleitores: el > 0 ? elT / el : 0, votosX: vx > 0 ? vxT / vx : 0, votosY: vy > 0 ? vyT / vy : 0 };
  });
}
