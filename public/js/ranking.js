// Aba "Em comum", nos dois sentidos, no recorte:
//   quemVotouEm(Y): para cada candidato C de um cargo, a fração estimada dos eleitores de C que também votou em Y;
//   eleitoresDe(X): para cada candidato C de um cargo, a fração estimada dos eleitores de X que votou em C.
// Sempre nas duas hipóteses (regressão de Goodman e vizinhança), presas urna a urna aos limites certos: a mesma
// estatística do painel, em tempo real (cada série percorre só as seções onde teve voto). Eleitorado em comum, não
// transferência.
import { D, cargoOf, denomOf, loadCargo, secsOf } from './data.js';

const cache = new Map();

/**
 * @returns Promise<{lista: [{key, tx, est, comum, demais, r, lift}], minimo}> ordenada pela fração estimada.
 */
export function quemVotouEm(yKey, Y, cargo, level, id) {
  const k = `${yKey}|${cargo}|${level}:${id}`;
  if (cache.has(k)) return cache.get(k);
  const p = loadCargo(cargo).then((series) => calcula(yKey, Y, cargo, series, secsOf(level, id)));
  cache.set(k, p);
  p.catch(() => cache.delete(k));
  return p;
}

function calcula(yKey, Y, cargo, series, secs) {
  const DXa = denomOf(`${cargo}:0`), DYa = denomOf(yKey);
  const no = new Uint8Array(D.n);
  // contexto de Y no recorte (pesos = comparecimento da eleição de X)
  let W = 0, SY = 0, SYY = 0, TY = 0, TDY = 0, TN = 0;
  const y = new Float64Array(D.n);
  for (const s of secs) {
    if (!(DXa[s] > 0 && DYa[s] > 0)) continue;
    no[s] = 1;
    y[s] = Y[s] / DYa[s];
    W += DXa[s]; SY += DXa[s] * y[s]; SYY += DXa[s] * y[s] * y[s];
    TY += Y[s]; TDY += DYa[s]; TN += Math.max(DXa[s], DYa[s]);
  }
  const py = TDY > 0 ? TY / TDY : 0;
  // abaixo disso a fração oscila demais (poucas urnas com voto): 0,15% de quem compareceu no recorte, ao menos 300
  const minimo = Math.max(300, Math.round(W * 0.0015));
  const lista = [];
  for (const [key, sp] of series) {
    if (key === yKey || cargoOf(key) !== cargo) continue;
    let tx = 0, Sxx = 0, Sxy = 0;
    for (let j = 0; j < sp.s.length; j++) {
      const s = sp.s[j];
      if (!no[s]) continue;
      const X = sp.v[j];
      tx += X; Sxx += (X * X) / DXa[s]; Sxy += X * y[s];
    }
    if (tx < minimo) continue;
    const Sx = tx, det = W * Sxx - Sx * Sx;
    if (!(det > 0)) continue;
    const b = (W * Sxy - Sx * SY) / det, a = (SY - b * Sx) / W, beta = a + b;
    let comum = 0, comumV = 0;
    for (let j = 0; j < sp.s.length; j++) {
      const s = sp.s[j];
      if (!no[s]) continue;
      const X = sp.v[j], N = Math.max(DXa[s], DYa[s]);
      const lo = Math.max(0, X + Y[s] - N) / X, hi = Math.min(X, Y[s]) / X;
      comum += Math.min(hi, Math.max(lo, beta)) * X;
      comumV += Math.min(hi, Math.max(lo, y[s])) * X; // vizinhança: vota como os vizinhos da mesma urna
    }
    const vy = W * SYY - SY * SY;
    lista.push({
      key, tx, comum, est: comum / tx, viz: comumV / tx, demais: TN - tx > 0 ? Math.max(0, (TY - comum) / (TN - tx)) : null,
      r: vy > 0 ? (W * Sxy - Sx * SY) / Math.sqrt(det * vy) : null, lift: py > 0 ? Sxy / tx / py : null,
    });
  }
  lista.sort((p, q) => q.est - p.est);
  return { lista, minimo };
}

/**
 * Em quem votaram os eleitores de X, entre os candidatos de um cargo.
 * @returns Promise<{lista: [{key, ty, est, viz, demais: [g, v]}], tx, minimo}> ordenada pelo meio da faixa.
 */
export function eleitoresDe(xKey, X, cargo, level, id) {
  const k = `de|${xKey}|${cargo}|${level}:${id}`;
  if (cache.has(k)) return cache.get(k);
  const p = loadCargo(cargo).then((series) => calculaDe(xKey, X, cargo, series, secsOf(level, id)));
  cache.set(k, p);
  p.catch(() => cache.delete(k));
  return p;
}

function calculaDe(xKey, X, cargo, series, secs) {
  const DXa = denomOf(xKey), DYa = denomOf(`${cargo}:0`);
  const no = new Uint8Array(D.n);
  // x = participação de X; pesos = comparecimento da eleição de X
  let W = 0, tx = 0, Sxx = 0, TN = 0;
  for (const s of secs) {
    if (!(DXa[s] > 0 && DYa[s] > 0)) continue;
    no[s] = 1;
    W += DXa[s]; tx += X[s]; Sxx += (X[s] * X[s]) / DXa[s]; TN += Math.max(DXa[s], DYa[s]);
  }
  const minimo = Math.max(300, Math.round(W * 0.0015));
  const det = W * Sxx - tx * tx, lista = [];
  if (!(tx > 0) || !(det > 0)) return { lista, tx, minimo };
  for (const [key, sp] of series) {
    if (key === xKey || cargoOf(key) !== cargo) continue;
    let ty = 0, Sy = 0, Sxy = 0;
    for (let j = 0; j < sp.s.length; j++) {
      const s = sp.s[j];
      if (!no[s]) continue;
      const yv = sp.v[j] / DYa[s];
      ty += sp.v[j]; Sy += DXa[s] * yv; Sxy += X[s] * yv;
    }
    if (!(ty > 0)) continue;
    const b = (W * Sxy - tx * Sy) / det, a = (Sy - b * tx) / W, beta = a + b;
    // seções sem voto em C não entram: lá o teto é zero
    let comum = 0, comumV = 0;
    for (let j = 0; j < sp.s.length; j++) {
      const s = sp.s[j], Xs = X[s];
      if (!no[s] || !(Xs > 0)) continue;
      const Ys = sp.v[j], N = Math.max(DXa[s], DYa[s]);
      const lo = Math.max(0, Xs + Ys - N) / Xs, hi = Math.min(Xs, Ys) / Xs;
      comum += Math.min(hi, Math.max(lo, beta)) * Xs;
      comumV += Math.min(hi, Math.max(lo, Ys / DYa[s])) * Xs;
    }
    const resto = TN - tx;
    lista.push({
      key, ty, est: comum / tx, viz: comumV / tx,
      demais: resto > 0 ? [Math.max(0, (ty - comum) / resto), Math.max(0, (ty - comumV) / resto)] : null,
    });
  }
  lista.sort((p, q) => q.est + q.viz - p.est - p.viz);
  return { lista, tx, minimo };
}

/** Posição de X entre os candidatos do cargo dele, em votos, no recorte. @returns Promise<{pos, n}> */
export function posicao(xKey, cargo, level, id) {
  const k = `pos|${xKey}|${level}:${id}`;
  if (cache.has(k)) return cache.get(k);
  const p = loadCargo(cargo).then((series) => {
    const no = new Uint8Array(D.n);
    for (const s of secsOf(level, id)) no[s] = 1;
    const tot = [];
    for (const [key, sp] of series) {
      if (cargoOf(key) !== cargo) continue;
      let t = 0;
      for (let j = 0; j < sp.s.length; j++) if (no[sp.s[j]]) t += sp.v[j];
      if (t > 0) tot.push([key, t]);
    }
    const meu = tot.find(([key]) => key === xKey)?.[1] || 0;
    return { pos: meu > 0 ? 1 + tot.filter(([, t]) => t > meu).length : null, n: tot.length };
  });
  cache.set(k, p);
  p.catch(() => cache.delete(k));
  return p;
}
