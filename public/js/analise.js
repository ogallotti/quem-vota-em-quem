// Liga dados e estatística: o par (X, Y) escolhido, valores por unidade em cada nível e a análise de cada recorte.
import { D, cargoOf, denomOf, getProps, secsOf } from './data.js';
import { analisa, pearson } from './stats.js';

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

/** Votos e participação de X e Y numa unidade. */
export function valorDe(level, id) {
  if (!A.X) return null;
  if (level === 'estado') { const r = recorte('estado', 0); return { x: r.tx, y: r.ty, dx: r.tdx, dy: r.tdy, px: r.px, py: r.py }; }
  const u = D.un[level], g = u?.pos.get(id);
  if (g == null) return null;
  const v = porUnidade(level);
  return { x: v.x[g], y: v.y[g], dx: v.dx[g], dy: v.dy[g], px: v.dx[g] > 0 ? v.x[g] / v.dx[g] : 0, py: v.dy[g] > 0 ? v.y[g] / v.dy[g] : 0 };
}

const MIN_LOCAIS = 12;
/** Unidade de análise de um recorte: locais de votação; em recortes pequenos, as seções. */
function grupoDe(level, id) {
  if (level === 'local' || level === 'secao') return 'secao';
  if (level === 'estado') return 'local';
  const secs = secsOf(level, id), set = new Set();
  for (const s of secs) set.add(D.sec.li[s]);
  return set.size >= MIN_LOCAIS ? 'local' : 'secao';
}

/** Análise completa de um recorte (seleção). */
export function recorte(level, id) {
  if (!A.X) return null;
  return memo(`r:${level}:${id}`, () => {
    const unidade = grupoDe(level, id);
    const u = D.un[unidade];
    const out = analisa({ secs: secsOf(level, id), grupo: u.idx, nG: u.ids.length, X: A.X, Y: A.Y, DX: A.DX, DY: A.DY, exclusivos: exclusivos() });
    out.unidade = unidade;
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

export const nomeRecorte = (level, id) => (level === 'estado' ? D.meta.uf_nome : getProps(level, id)?.n || '');

/** Análise de X contra uma série qualquer (ex.: os polos Lula e Bolsonaro), no mesmo recorte. */
export function cruzado(level, id, key, Ys) {
  return memo(`cz:${key}:${level}:${id}`, () => {
    const u = D.un.local;
    return analisa({ secs: secsOf(level, id), grupo: u.idx, nG: u.ids.length, X: A.X, Y: Ys, DX: A.DX, DY: denomOf(key), exclusivos: exclusivos(A.x, key) });
  });
}

/** Ids das unidades de um nível que caem dentro do recorte. */
export function unidadesNoRecorte(level, sLevel, sId) {
  return memo(`nr:${level}:${sLevel}:${sId}`, () => {
    if (sLevel === 'estado') return null; // todas
    const u = D.un[level], set = new Set();
    for (const s of secsOf(sLevel, sId)) if (u.idx[s] >= 0) set.add(u.ids[u.idx[s]]);
    return set;
  });
}
