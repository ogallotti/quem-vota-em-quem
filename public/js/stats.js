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

// gerador determinístico (mulberry32): o bootstrap dá sempre os mesmos números para o mesmo recorte
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pct = (arr, q) => { const v = arr.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))] : null; };

/**
 * Estatísticas pontuais sobre unidades (u = vetor de unidades; m = multiplicidade de cada uma, para o bootstrap).
 *   r       correlação ponderada (pesos = comparecimento)
 *   rw      correlação DENTRO dos agrupamentos (ex.: municípios): x e y menos a média do próprio município. Separa
 *           "fortes na mesma região" (r alto, rw ~ 0) de "fortes nos mesmos lugares dentro das cidades" (rw alto).
 *   lift    afinidade: y no lugar médio do eleitor de X ÷ y no recorte
 *   est     fração dos eleitores de X que votaram em Y: Goodman (y = a + b·x) aplicado a cada unidade e preso aos
 *           limites certos daquela unidade; a soma fecha a conta exata dos votos. demais = o mesmo para quem não votou em X.
 */
function pontos(U, m, comBounds) {
  const n = U.x.length;
  let sw = 0, sx = 0, sy = 0, tvx = 0, tvy = 0, tdy = 0, yx = 0;
  for (let i = 0; i < n; i++) {
    const k = m ? m[i] : 1;
    if (!k) continue;
    const w = U.w[i] * k;
    sw += w; sx += w * U.x[i]; sy += w * U.y[i];
    tvx += U.vx[i] * k; tvy += U.vy[i] * k; tdy += U.dy[i] * k; yx += U.vx[i] * k * U.y[i];
  }
  if (!(sw > 0)) return { r: null, rw: null, lift: null, est: null, demais: null };
  const mx = sx / sw, my = sy / sw;
  let cxx = 0, cyy = 0, cxy = 0;
  for (let i = 0; i < n; i++) {
    const k = m ? m[i] : 1;
    if (!k) continue;
    const w = U.w[i] * k, dx = U.x[i] - mx, dy = U.y[i] - my;
    cxx += w * dx * dx; cyy += w * dy * dy; cxy += w * dx * dy;
  }
  const r = cxx > 0 && cyy > 0 ? cxy / Math.sqrt(cxx * cyy) : null;
  // dentro dos agrupamentos: desvio de cada unidade em relação à média ponderada do próprio agrupamento
  let rw = null;
  if (U.cl) {
    const nc = U.nc, cw = new Float64Array(nc), cx = new Float64Array(nc), cy = new Float64Array(nc), cn = new Int32Array(nc);
    for (let i = 0; i < n; i++) { const k = m ? m[i] : 1; if (!k) continue; const c = U.cl[i], w = U.w[i] * k; cw[c] += w; cx[c] += w * U.x[i]; cy[c] += w * U.y[i]; cn[c] += 1; }
    let wxx = 0, wyy = 0, wxy = 0, usados = 0;
    for (let i = 0; i < n; i++) {
      const k = m ? m[i] : 1, c = U.cl[i];
      if (!k || cn[c] < 2) continue;
      const w = U.w[i] * k, dx = U.x[i] - cx[c] / cw[c], dy = U.y[i] - cy[c] / cw[c];
      wxx += w * dx * dx; wyy += w * dy * dy; wxy += w * dx * dy; usados++;
    }
    rw = usados >= 8 && wxx > 0 && wyy > 0 ? wxy / Math.sqrt(wxx * wyy) : null;
  }
  const lift = tvx > 0 && tvy > 0 && tdy > 0 ? (yx / tvx) / (tvy / tdy) : null;
  let est = null, demais = null, a = null, b = null;
  if (comBounds && tvx > 0) {
    const sxx = (() => { let t = 0; for (let i = 0; i < n; i++) { const k = m ? m[i] : 1; if (k) t += U.w[i] * k * U.x[i] * U.x[i]; } return t; })();
    const det = sw * sxx - sx * sx;
    if (det > 1e-15) {
      let sxy = 0;
      for (let i = 0; i < n; i++) { const k = m ? m[i] : 1; if (k) sxy += U.w[i] * k * U.x[i] * U.y[i]; }
      b = (sw * sxy - sx * sy) / det; a = (sy - b * sx) / sw;
    } else { a = sy / sw; b = 0; }
    let comum = 0, tN = 0;
    for (let i = 0; i < n; i++) {
      const k = m ? m[i] : 1;
      if (!k) continue;
      tN += U.N[i] * k;
      if (!U.vx[i]) continue;
      const beta = Math.min(U.hi[i] / U.vx[i], Math.max(U.lo[i] / U.vx[i], a + b));
      comum += beta * U.vx[i] * k;
    }
    est = comum / tvx;
    demais = tN - tvx > 0 ? Math.min(1, Math.max(0, (tvy - comum) / (tN - tvx))) : null;
  }
  return { r, rw, lift, est, demais, a, b };
}

/**
 * Análise completa de um recorte.
 * @param {object} o
 *   secs       índices das seções do recorte
 *   grupo/nG   agrupamento das seções nas unidades de análise (normalmente locais de votação)
 *   cluster    (opcional) agrupamento das unidades em blocos maiores (municípios): correlação dentro deles e bootstrap
 *   X, Y       votos por seção; DX, DY = comparecimento da eleição de cada um (presidente inclui o voto em trânsito)
 *   exclusivos true quando X e Y disputam a mesma vaga (mesmo cargo, um voto por eleitor): ninguém vota nos dois
 *   B          réplicas do bootstrap (0 = sem intervalos)
 */
export function analisa({ secs, grupo, nG, cluster = null, X, Y, DX, DY, exclusivos = false, B = 200 }) {
  const { gx, gy, gdx, gdy } = somaGrupos(secs, grupo, nG, X, Y, DX, DY);
  // limites certos seção a seção, somados por unidade (e no recorte)
  const glo = new Float64Array(nG), ghi = new Float64Array(nG), gN = new Float64Array(nG);
  let lo = 0, hi = 0;
  for (const s of secs) {
    const g = grupo[s];
    const N = Math.max(DX[s], DY[s]);
    const h = Math.min(X[s], Y[s]), l = Math.max(0, X[s] + Y[s] - N);
    hi += h; lo += l;
    if (g >= 0) { ghi[g] += h; glo[g] += l; gN[g] += N; }
  }
  let tx = 0, ty = 0, tdx = 0, tdy = 0;
  const U = { x: [], y: [], w: [], vx: [], vy: [], dy: [], lo: [], hi: [], N: [], cl: cluster ? [] : null, nc: 0 };
  const gi = [], clMap = new Map();
  for (let g = 0; g < nG; g++) {
    if (!(gdx[g] > 0 && gdy[g] > 0)) continue;
    tx += gx[g]; ty += gy[g]; tdx += gdx[g]; tdy += gdy[g];
    U.x.push(gx[g] / gdx[g]); U.y.push(gy[g] / gdy[g]); U.w.push(gdx[g]); U.vx.push(gx[g]); U.vy.push(gy[g]); U.dy.push(gdy[g]);
    U.lo.push(glo[g]); U.hi.push(ghi[g]); U.N.push(gN[g]); gi.push(g);
    if (cluster) { const c = cluster[g]; if (!clMap.has(c)) clMap.set(c, clMap.size); U.cl.push(clMap.get(c)); }
  }
  U.nc = clMap.size;
  const px = tdx > 0 ? tx / tdx : 0, py = tdy > 0 ? ty / tdy : 0;
  const p = pontos(U, null, !exclusivos);
  const out = {
    tx, ty, tdx, tdy, px, py, n: U.x.length, xs: U.x, ys: U.y, ws: U.w, gi, nc: U.nc,
    r: p.r, rw: p.rw, yx: p.lift != null ? p.lift * py : null, lift: p.lift, exclusivos, ci: {},
  };
  if (!exclusivos) {
    out.lim = { lo, hi, loF: tx > 0 ? lo / tx : null, hiF: tx > 0 ? hi / tx : null };
    if (p.est != null) {
      const bruto = p.a + p.b;
      out.gd = { est: p.est, demais: p.demais, a: p.a, b: p.b, raw: bruto, fora: bruto < out.lim.loF - 1e-9 || bruto > out.lim.hiF + 1e-9 };
    }
  }
  // bootstrap em blocos: reamostra municípios (se houver 8 ou mais) ou as próprias unidades
  const n = U.x.length;
  if (B > 0 && n >= 3) {
    const blocos = U.nc >= 8 ? U.nc : n, deBloco = U.nc >= 8 ? U.cl : null;
    const rnd = rng(0x5eed + n * 31 + Math.round(tx));
    const m = new Int32Array(n), cnt = new Int32Array(blocos);
    const reps = { r: [], rw: [], lift: [], est: [] };
    for (let b = 0; b < B; b++) {
      cnt.fill(0);
      for (let j = 0; j < blocos; j++) cnt[Math.floor(rnd() * blocos)]++;
      for (let i = 0; i < n; i++) m[i] = cnt[deBloco ? deBloco[i] : i];
      const q = pontos(U, m, !exclusivos);
      reps.r.push(q.r); reps.rw.push(q.rw); reps.lift.push(q.lift); reps.est.push(q.est);
    }
    for (const k of Object.keys(reps)) { const lo95 = pct(reps[k], 0.025), hi95 = pct(reps[k], 0.975); if (lo95 != null) out.ci[k] = [lo95, hi95]; }
    out.ci.blocos = deBloco ? 'municípios' : 'unidades';
    if (out.gd && out.ci.est) { out.gd.lo = out.ci.est[0]; out.gd.hi = out.ci.est[1]; }
  }
  return out;
}

/** Proporção encolhida em direção à média (bayes empírico simples): unidades pequenas não viram extremos falsos. */
export const encolhe = (v, d, media, k = 40) => (d + k > 0 ? (v + k * media) / (d + k) : media);

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
export function leitura(r, lift, ci = {}) {
  const nr = r == null ? 0 : Math.abs(r) >= 0.4 ? 3 : Math.abs(r) >= 0.2 ? 2 : Math.abs(r) >= 0.1 ? 1 : 0;
  const sr = r == null || nr === 0 ? 0 : Math.sign(r);
  let nl = 0, sl = 0;
  if (lift != null && lift > 0) {
    const f = lift >= 1 ? lift : 1 / lift; // 0,5× é tão forte (ao contrário) quanto 2×
    nl = f >= 2 ? 3 : f >= 1.5 ? 2 : f >= 1.2 ? 1 : 0;
    sl = nl ? (lift >= 1 ? 1 : -1) : 0;
  }
  // com intervalos: se os dois cruzam o neutro (r = 0 e afinidade = 1), o sinal não se distingue do acaso
  const cruzaR = ci.r && ci.r[0] <= 0 && ci.r[1] >= 0, cruzaL = !ci.lift || (ci.lift[0] <= 1 && ci.lift[1] >= 1);
  if ((nr || nl) && cruzaR && cruzaL) return { k: 'inc', nivel: 0 };
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

/**
 * Cortes que dividem os valores em k faixas com o mesmo peso total (ex.: quintis do eleitorado). Devolve k − 1 cortes.
 * Ex.: com pesos = eleitores, a faixa de cima reúne os 20% de eleitores que estão onde o valor é mais alto.
 */
export function quantisPonderados(valores, pesos, k = 5) {
  const idx = valores.map((_, i) => i).filter((i) => pesos[i] > 0 && Number.isFinite(valores[i])).sort((a, b) => valores[a] - valores[b]);
  const tot = idx.reduce((t, i) => t + pesos[i], 0);
  const out = [];
  let acc = 0, j = 1;
  for (const i of idx) {
    acc += pesos[i];
    while (j < k && acc >= (tot * j) / k) { out.push(valores[i]); j++; }
  }
  while (out.length < k - 1) out.push(Infinity);
  return out;
}
/** Faixa (0 = mais baixa … cortes.length = mais alta) de um valor. */
export const faixa = (v, cortes) => { let f = 0; while (f < cortes.length && v > cortes[f]) f++; return f; };
