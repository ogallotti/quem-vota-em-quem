// Liga dados e estatística: o par (X, Y) escolhido, valores por unidade em cada nível e a análise de cada recorte.
import { D, cargoOf, denomOf, getProps, secsOf } from './data.js';
import { analisa, encolhe, pearson } from './stats.js';

// Sem Y (yKey null) é o modo de um candidato só ("voo só de ida"): Y, DY e as somas de Y ficam zeradas e o painel
// mostra o perfil de X em vez do cruzamento.
export const A = { x: null, y: null, X: null, Y: null, DX: null, DY: null, ver: 0, cache: new Map() };

export const solo = () => !A.y;

export function setPar(xKey, X, yKey, Y) {
  Object.assign(A, { x: xKey, y: yKey || null, X, Y: yKey ? Y : null, DX: denomOf(xKey), DY: yKey ? denomOf(yKey) : null, ver: A.ver + 1 });
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
    const Y = A.Y, DY = A.DY;
    for (let s = 0; s < D.n; s++) {
      const g = u.idx[s];
      if (g < 0) continue;
      x[g] += A.X[s]; dx[g] += A.DX[s];
      if (Y) { y[g] += Y[s]; dy[g] += DY[s]; }
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
    for (let s = 0; s < D.n; s++) { x += A.X[s]; dx += A.DX[s]; if (A.Y) { y += A.Y[s]; dy += A.DY[s]; } }
    return { x, y, dx, dy, px: dx > 0 ? x / dx : 0, py: dy > 0 ? y / dy : 0 };
  });
}

/**
 * Unidade de análise: a SEÇÃO (urna), a base de tudo. Blocos (correlação "dentro" e bootstrap): municípios quando o
 * recorte tem vários; num município só, os locais de votação (seções do mesmo prédio ficam no mesmo bloco).
 */
function blocosDoRecorte(level, id) {
  const set = new Set();
  for (const s of secsOf(level, id)) set.add(D.loc.mi[D.sec.li[s]]);
  return set.size >= 2 ? 'municipio' : 'local';
}
function blocosDe(tipo) {
  return Int32Array.from({ length: D.n }, (_, s) => (tipo === 'municipio' ? D.loc.mi[D.sec.li[s]] : D.sec.li[s]));
}

/** Análise completa de um recorte (seleção), com intervalos por bootstrap. */
export function recorte(level, id, { B = 200 } = {}) {
  if (!A.X) return null;
  return memo(`r:${level}:${id}:${B}`, () => {
    const u = D.un.secao, tipo = blocosDoRecorte(level, id);
    const secs = secsOf(level, id);
    const out = analisa({
      secs, grupo: u.idx, nG: u.ids.length, cluster: memo(`bl:${tipo}`, () => blocosDe(tipo)),
      X: A.X, Y: A.Y, DX: A.DX, DY: A.DY, exclusivos: exclusivos(), B: secs.length > 30000 ? Math.min(B, 80) : B,
    });
    out.unidade = 'secao';
    out.blocos = tipo === 'municipio' ? 'municípios' : 'locais';
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
 * Território de X no recorte: as seções onde X vai melhor (proporção encolhida), somando 20% do eleitorado
 * do recorte. Quanto dos votos de X e de Y saiu dali. Sem relação entre os dois, o território daria a Y ~20% dos votos.
 */
export function territorio(level, id, fatia = 0.2) {
  return memo(`tt:${level}:${id}`, () => {
    const r = recorte(level, id);
    const u = D.un.secao, nL = u.ids.length, secs = secsOf(level, id); // seções (a base de tudo)
    const gx = new Float64Array(nL), gy = new Float64Array(nL), gd = new Float64Array(nL);
    for (const s of secs) { const g = u.idx[s]; gx[g] += A.X[s]; gy[g] += A.Y[s]; gd[g] += A.DX[s]; }
    const gs = [];
    let el = 0, vx = 0, vy = 0;
    for (let g = 0; g < nL; g++) if (gd[g] > 0) { gs.push(g); el += gd[g]; vx += gx[g]; vy += gy[g]; }
    gs.sort((a, b) => encolhe(gx[b], gd[b], r.px) - encolhe(gx[a], gd[a], r.px));
    let elT = 0, vxT = 0, vyT = 0, n = 0;
    for (const g of gs) {
      if (elT >= fatia * el || !(gx[g] > 0)) break;
      elT += gd[g]; vxT += gx[g]; vyT += gy[g]; n++;
    }
    return { n, eleitores: el > 0 ? elT / el : 0, votosX: vx > 0 ? vxT / vx : 0, votosY: vy > 0 ? vyT / vy : 0 };
  });
}



/**
 * Perfil de X sozinho no recorte: votos, participação e como o voto se distribui (fatos, sem estimativa).
 * conc = parte dos votos de X que saiu das seções onde ele é mais forte, somando 20% do eleitorado (sem concentração
 * nenhuma daria 20%); nMeio = quantos municípios somam metade dos votos dele.
 */
export function perfil(level, id) {
  return memo(`pf:${level}:${id}`, () => {
    const secs = secsOf(level, id);
    let tx = 0, td = 0;
    for (const s of secs) { tx += A.X[s]; td += A.DX[s]; }
    const px = td > 0 ? tx / td : 0;
    const ord = Array.from(secs).filter((s) => A.DX[s] > 0).sort((a, b) => encolhe(A.X[b], A.DX[b], px) - encolhe(A.X[a], A.DX[a], px));
    let el = 0, vx = 0;
    for (const s of ord) { if (el >= 0.2 * td) break; el += A.DX[s]; vx += A.X[s]; }
    const porMun = new Map();
    for (const s of secs) { const m = D.loc.mi[D.sec.li[s]]; porMun.set(m, (porMun.get(m) || 0) + A.X[s]); }
    const mv = [...porMun.values()].sort((a, b) => b - a);
    let acc = 0, nMeio = 0;
    for (const v of mv) { if (acc >= tx / 2) break; acc += v; nMeio++; }
    return { tx, td, px, conc: tx > 0 ? vx / tx : 0, concEl: td > 0 ? el / td : 0, nMun: porMun.size, nMeio, comVoto: mv.filter((v) => v > 0).length };
  });
}
