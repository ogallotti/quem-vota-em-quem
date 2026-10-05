// "Quem trouxe votos para Y": para cada candidato X de um cargo, a fração estimada dos eleitores de X que votaram em Y
// e os votos que isso representa, no recorte. Mesma estatística do painel (Goodman por seção preso, urna a urna, aos
// limites certos), em tempo real: cada X percorre só as seções onde teve voto, então São Paulo inteiro sai em segundos.
import { D, cargoOf, denomOf, loadCargo, secsOf } from './data.js';

const cache = new Map();

/**
 * @returns Promise<{lista: [{key, tx, est, comum, demais, r, lift}], minimo}> ordenada pela fração estimada.
 */
export function quemTrouxe(yKey, Y, cargo, level, id) {
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
    let comum = 0;
    for (let j = 0; j < sp.s.length; j++) {
      const s = sp.s[j];
      if (!no[s]) continue;
      const X = sp.v[j], N = Math.max(DXa[s], DYa[s]);
      const lo = Math.max(0, X + Y[s] - N) / X, hi = Math.min(X, Y[s]) / X;
      comum += Math.min(hi, Math.max(lo, beta)) * X;
    }
    const vy = W * SYY - SY * SY;
    lista.push({
      key, tx, comum, est: comum / tx, demais: TN - tx > 0 ? Math.max(0, (TY - comum) / (TN - tx)) : null,
      r: vy > 0 ? (W * Sxy - Sx * SY) / Math.sqrt(det * vy) : null, lift: py > 0 ? Sxy / tx / py : null,
    });
  }
  lista.sort((p, q) => q.est - p.est);
  return { lista, minimo };
}
