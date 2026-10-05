// Estatística ecológica entre duas séries de votos (X e Y) por seção. Funções puras: recebem vetores e devolvem números.
//
// O voto é secreto: ninguém sabe em quem cada eleitor de X votou. O que os dados permitem é comparar ONDE os votos caem:
//   correlação  r ponderado entre a participação de X e a de Y nas unidades (locais de votação, por padrão)
//   afinidade   participação de Y no lugar médio onde vota o eleitor de X ÷ participação de Y no recorte
//   estimativa  regressão de Goodman: y = a + b·x ⇒ fração dos eleitores de X que votaram em Y ≈ a + b (dos demais, a)
//   limites     certos, seção a seção (Duncan e Davis): dos X votos, no máximo min(X, Y) e no mínimo max(0, X + Y − N)
//               podem ter ido também para Y. Valem sempre, sem hipótese nenhuma.

/**
 * Soma por grupo. `secs` = índices das seções do recorte; `grupo[s]` = índice do grupo da seção (ou −1).
 * Devolve somas de X, Y e dos denominadores (comparecimento) por grupo.
 */
export function somaGrupos(secs, grupo, nG, X, Y, DX, DY) {
  const gx = new Float64Array(nG), gy = new Float64Array(nG), gdx = new Float64Array(nG), gdy = new Float64Array(nG);
  for (const s of secs) {
    const g = grupo[s];
    if (g < 0) continue;
    gx[g] += X[s]; gy[g] += Y[s]; gdx[g] += DX[s]; gdy[g] += DY[s];
  }
  return { gx, gy, gdx, gdy };
}

/** Correlação de Pearson ponderada entre x e y (pesos w). Nulo se não houver variação. */
export function pearson(x, y, w) {
  let sw = 0, sx = 0, sy = 0;
  for (let i = 0; i < x.length; i++) { sw += w[i]; sx += w[i] * x[i]; sy += w[i] * y[i]; }
  if (!(sw > 0)) return null;
  const mx = sx / sw, my = sy / sw;
  let cxx = 0, cyy = 0, cxy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    cxx += w[i] * dx * dx; cyy += w[i] * dy * dy; cxy += w[i] * dx * dy;
  }
  if (!(cxx > 0 && cyy > 0)) return null;
  return cxy / Math.sqrt(cxx * cyy);
}

/**
 * Regressão de Goodman por mínimos quadrados ponderados: y = a + b·x, unidades como observações (pesos normalizados
 * para média 1). Devolve a fração estimada dos eleitores de X que votaram em Y (a + b), a dos demais eleitores (a) e o
 * intervalo de 95% de a + b.
 */
export function goodman(x, y, w) {
  const m = x.length;
  if (m < 3) return null;
  let wsum = 0;
  for (let i = 0; i < m; i++) wsum += w[i];
  const k = m / wsum;
  let Sw = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
  for (let i = 0; i < m; i++) {
    const wi = w[i] * k;
    Sw += wi; Sx += wi * x[i]; Sy += wi * y[i]; Sxx += wi * x[i] * x[i]; Sxy += wi * x[i] * y[i];
  }
  const det = Sw * Sxx - Sx * Sx;
  if (!(det > 1e-15)) return null;
  const b = (Sw * Sxy - Sx * Sy) / det;
  const a = (Sy - b * Sx) / Sw;
  let rss = 0;
  for (let i = 0; i < m; i++) { const e = y[i] - a - b * x[i]; rss += w[i] * k * e * e; }
  const s2 = rss / (m - 2);
  const se = Math.sqrt(Math.max(0, (s2 / det) * (Sxx - 2 * Sx + Sw)));
  return { a, b, est: a + b, lo: a + b - 1.96 * se, hi: a + b + 1.96 * se, se };
}

/**
 * Análise completa de um recorte.
 * @param {object} o
 *   secs       índices das seções do recorte
 *   grupo/nG   agrupamento das seções nas unidades de análise (normalmente locais de votação)
 *   X, Y       votos por seção; DX, DY = comparecimento da eleição de cada um (presidente inclui o voto em trânsito)
 *   exclusivos true quando X e Y disputam a mesma vaga (mesmo cargo, um voto por eleitor): ninguém vota nos dois
 */
export function analisa({ secs, grupo, nG, X, Y, DX, DY, exclusivos = false }) {
  const { gx, gy, gdx, gdy } = somaGrupos(secs, grupo, nG, X, Y, DX, DY);
  let tx = 0, ty = 0, tdx = 0, tdy = 0;
  const xs = [], ys = [], ws = [], vx = [], gi = [];
  for (let g = 0; g < nG; g++) {
    if (!(gdx[g] > 0 && gdy[g] > 0)) continue;
    tx += gx[g]; ty += gy[g]; tdx += gdx[g]; tdy += gdy[g];
    xs.push(gx[g] / gdx[g]); ys.push(gy[g] / gdy[g]); ws.push(gdx[g]); vx.push(gx[g]); gi.push(g);
  }
  const px = tdx > 0 ? tx / tdx : 0, py = tdy > 0 ? ty / tdy : 0;
  // afinidade: Y no lugar médio do eleitor de X (média de y ponderada pelos votos de X) ÷ Y no recorte
  let yx = 0;
  for (let i = 0; i < ys.length; i++) yx += vx[i] * ys[i];
  yx = tx > 0 ? yx / tx : null;
  const out = {
    tx, ty, tdx, tdy, px, py, n: xs.length, xs, ys, ws, gi,
    r: pearson(xs, ys, ws), yx, lift: yx != null && py > 0 ? yx / py : null, exclusivos,
  };
  // limites certos, seção a seção
  if (!exclusivos) {
    let lo = 0, hi = 0;
    for (const s of secs) {
      const N = Math.max(DX[s], DY[s]);
      hi += Math.min(X[s], Y[s]);
      lo += Math.max(0, X[s] + Y[s] - N);
    }
    out.lim = { lo, hi, loF: tx > 0 ? lo / tx : null, hiF: tx > 0 ? hi / tx : null };
    const g = goodman(xs, ys, ws);
    if (g && tx > 0) {
      const c = (v) => Math.min(out.lim.hiF, Math.max(out.lim.loF, v));
      out.gd = { ...g, raw: g.est, est: c(g.est), lo: c(g.lo), hi: c(g.hi), fora: g.est < out.lim.loF || g.est > out.lim.hiF, demais: Math.min(1, Math.max(0, g.a)) };
    }
  }
  return out;
}

/** Leitura em palavras da correlação. */
export function forca(r) {
  if (r == null) return { k: 'nd', txt: 'sem dados suficientes' };
  const a = Math.abs(r);
  const t = a >= 0.6 ? 'muito forte' : a >= 0.4 ? 'forte' : a >= 0.2 ? 'moderada' : a >= 0.1 ? 'fraca' : 'nenhuma';
  return { k: a < 0.1 ? 'zero' : r > 0 ? 'pos' : 'neg', a, txt: t };
}

/**
 * Leitura combinada de correlação e afinidade. Em candidatos de voto concentrado a correlação fica baixa mesmo quando
 * os territórios claramente coincidem (ou se excluem); a afinidade capta isso. Nível 0 (nada) a 3 (forte).
 */
export function leitura(r, lift) {
  const nr = r == null ? 0 : Math.abs(r) >= 0.4 ? 3 : Math.abs(r) >= 0.2 ? 2 : Math.abs(r) >= 0.1 ? 1 : 0;
  const sr = r == null || nr === 0 ? 0 : Math.sign(r);
  let nl = 0, sl = 0;
  if (lift != null && lift > 0) {
    const f = lift >= 1 ? lift : 1 / lift; // 0,5× é tão forte (ao contrário) quanto 2×
    nl = f >= 2 ? 3 : f >= 1.5 ? 2 : f >= 1.2 ? 1 : 0;
    sl = nl ? (lift >= 1 ? 1 : -1) : 0;
  }
  if (sr && sl && sr !== sl) return { k: 'mix', nivel: Math.max(nr, nl) };
  const nivel = Math.max(nr, nl), s = sr || sl;
  return { k: nivel === 0 ? 'zero' : s > 0 ? 'pos' : 'neg', nivel };
}

/** Classe 0 (abaixo), 1 (na média) ou 2 (acima) de um valor em relação à média do recorte. */
export const BIV_CORTE = [0.8, 1.25];
export function terco(v, media) {
  if (!(media > 0) || !(v > 0)) return 0;
  const ix = v / media;
  return ix < BIV_CORTE[0] ? 0 : ix <= BIV_CORTE[1] ? 1 : 2;
}

/** Quantis (para as faixas das escalas sequenciais). */
export function quantis(valores, k) {
  const v = valores.filter((x) => x > 0 && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [];
  const out = [];
  for (let i = 1; i < k; i++) {
    const q = v[Math.min(v.length - 1, Math.floor((i / k) * v.length))];
    if (!out.length || q > out[out.length - 1]) out.push(q);
  }
  return out;
}
