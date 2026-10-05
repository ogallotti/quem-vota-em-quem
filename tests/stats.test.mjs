// Testes do núcleo estatístico com dados sintéticos de verdade conhecida.  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analisa, encolhe, faixa, forca, goodman, leitura, pearson, quantisPonderados, respostaEstimativa, terco } from '../public/js/stats.js';

// gerador determinístico (mulberry32)
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Seções com N eleitores; X tem participação variável; 60% dos eleitores de X votam em Y e 20% dos demais. */
function simula(n = 4000, pXY = 0.6, pOY = 0.2, seed = 7) {
  const r = rng(seed);
  const X = new Float64Array(n), Y = new Float64Array(n), D = new Float64Array(n), grupo = new Int32Array(n), cruz = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const N = 150 + Math.floor(r() * 250);
    const px = Math.min(0.9, Math.max(0, 0.05 + 0.4 * r() * r()));
    let x = 0, y = 0, xy = 0;
    for (let i = 0; i < N; i++) {
      const vx = r() < px;
      const vy = r() < (vx ? pXY : pOY);
      x += vx; y += vy; xy += vx && vy;
    }
    X[s] = x; Y[s] = y; D[s] = N; grupo[s] = s; cruz[s] = xy;
  }
  return { X, Y, D, grupo, cruz, secs: Int32Array.from({ length: n }, (_, i) => i) };
}

test('Goodman recupera a fração verdadeira de eleitores de X que votaram em Y', () => {
  const { X, Y, D, grupo, secs } = simula();
  const a = analisa({ secs, grupo, nG: secs.length, X, Y, DX: D, DY: D });
  assert.ok(Math.abs(a.gd.est - 0.6) < 0.03, `estimativa ${a.gd.est}`);
  assert.ok(Math.abs(a.gd.demais - 0.2) < 0.02, `demais ${a.gd.demais}`);
  assert.ok(a.gd.lo <= 0.6 && a.gd.hi >= 0.6, `intervalo ${a.gd.lo}–${a.gd.hi}`);
  assert.ok(a.r > 0.3, `r ${a.r}`);
  assert.ok(a.lift > 1, `afinidade ${a.lift}`);
});

test('os limites certos contêm o número real de votos compartilhados', () => {
  const { X, Y, D, grupo, secs, cruz } = simula(800, 0.35, 0.5, 3);
  const a = analisa({ secs, grupo, nG: secs.length, X, Y, DX: D, DY: D });
  const real = cruz.reduce((t, v) => t + v, 0);
  assert.ok(a.lim.lo <= real && real <= a.lim.hi, `${a.lim.lo} ≤ ${real} ≤ ${a.lim.hi}`);
  assert.ok(a.gd.est >= a.lim.loF && a.gd.est <= a.lim.hiF);
});

test('sem relação: correlação perto de zero e estimativa perto da média', () => {
  const { X, Y, D, grupo, secs } = simula(3000, 0.3, 0.3, 11);
  const a = analisa({ secs, grupo, nG: secs.length, X, Y, DX: D, DY: D });
  assert.ok(Math.abs(a.r) < 0.1, `r ${a.r}`);
  assert.ok(Math.abs(a.gd.est - 0.3) < 0.04, `estimativa ${a.gd.est}`);
  assert.equal(forca(a.r).k, 'zero');
});

test('mesmo cargo (voto exclusivo): sem limites nem estimativa', () => {
  const { X, Y, D, grupo, secs } = simula(200);
  const a = analisa({ secs, grupo, nG: secs.length, X, Y, DX: D, DY: D, exclusivos: true });
  assert.equal(a.lim, undefined);
  assert.equal(a.gd, undefined);
  assert.ok(a.r != null);
});

test('pearson e goodman em casos triviais', () => {
  assert.equal(pearson([1, 2, 3], [2, 4, 6], [1, 1, 1]).toFixed(6), '1.000000');
  assert.equal(pearson([1, 1, 1], [2, 4, 6], [1, 1, 1]), null);
  const g = goodman([0, 0.5, 1], [0.1, 0.35, 0.6], [1, 1, 1]);
  assert.ok(Math.abs(g.est - 0.6) < 1e-9 && Math.abs(g.a - 0.1) < 1e-9);
  assert.equal(terco(0, 0.1), 0);
  assert.equal(terco(0.1, 0.1), 1);
  assert.equal(terco(0.2, 0.1), 2);
});

test('leitura combina correlação e afinidade', () => {
  assert.deepEqual(leitura(0.5, 1.1), { k: 'pos', nivel: 3 });
  assert.deepEqual(leitura(-0.1, 0.27), { k: 'neg', nivel: 3 }); // correlação fraca, mas Y quase some onde X vota
  assert.deepEqual(leitura(0.05, 1.05), { k: 'zero', nivel: 0 });
  assert.deepEqual(leitura(0.15, 2.4), { k: 'pos', nivel: 3 });
  assert.equal(leitura(0.3, 0.6).k, 'mix');
  assert.deepEqual(leitura(null, null), { k: 'zero', nivel: 0 });
});

/** Municípios onde X e Y são fortes JUNTOS (efeito regional), mas dentro de cada município o voto em um não muda o outro. */
function regional(nMun = 60, porMun = 25, seed = 5) {
  const r = rng(seed);
  const X = [], Y = [], D = [], grupo = [], cl = [];
  let g = 0;
  for (let m = 0; m < nMun; m++) {
    const forca = r(); // a mesma "força regional" puxa os dois
    for (let k = 0; k < porMun; k++, g++) {
      const N = 300;
      const px = 0.02 + 0.2 * forca, py = 0.05 + 0.3 * forca; // dentro do município: independentes, só ruído binomial
      let x = 0, y = 0;
      for (let i = 0; i < N; i++) { x += r() < px; y += r() < py; }
      X.push(x); Y.push(y); D.push(N); grupo.push(g); cl.push(m);
    }
  }
  return { X: Float64Array.from(X), Y: Float64Array.from(Y), D: Float64Array.from(D), grupo: Int32Array.from(grupo), cl: Int32Array.from(cl), secs: Int32Array.from(grupo) };
}

test('coincidência só regional: r alto, mas a correlação dentro dos municípios fica perto de zero', () => {
  const { X, Y, D, grupo, cl, secs } = regional();
  const a = analisa({ secs, grupo, nG: secs.length, cluster: cl, X, Y, DX: D, DY: D });
  assert.ok(a.r > 0.6, `r ${a.r}`);
  assert.ok(Math.abs(a.rw) < 0.12, `rw ${a.rw}`);
  assert.ok(a.ci.rw[0] < 0 && a.ci.rw[1] > 0, `ic rw ${a.ci.rw}`);
});

test('dobradinha de verdade: correlação alta também dentro dos municípios', () => {
  const { X, Y, D, grupo, secs } = simula(3000, 0.7, 0.1, 9);
  const cl = Int32Array.from(grupo, (g) => g % 50);
  const a = analisa({ secs, grupo, nG: secs.length, cluster: cl, X, Y, DX: D, DY: D });
  assert.ok(a.rw > 0.3, `rw ${a.rw}`);
});

test('estimativa limitada local a local: sempre dentro dos limites certos e perto da verdade', () => {
  const { X, Y, D, grupo, secs } = simula(2000, 0.45, 0.15, 13);
  const a = analisa({ secs, grupo, nG: secs.length, X, Y, DX: D, DY: D });
  assert.ok(a.gd.est >= a.lim.loF - 1e-9 && a.gd.est <= a.lim.hiF + 1e-9);
  assert.ok(Math.abs(a.gd.est - 0.45) < 0.03, `est ${a.gd.est}`);
  assert.ok(a.gd.lo <= 0.45 && a.gd.hi >= 0.45, `ic ${a.gd.lo}–${a.gd.hi}`);
  // a conta fecha: votos de Y = comuns + vindos dos demais
  const comum = a.gd.est * a.tx, demais = a.gd.demais * (a.tdx - a.tx);
  assert.ok(Math.abs(comum + demais - a.ty) / a.ty < 0.01, `${comum + demais} × ${a.ty}`);
});

test('bootstrap determinístico: o mesmo recorte dá os mesmos intervalos', () => {
  const { X, Y, D, grupo, secs } = simula(500, 0.5, 0.2, 21);
  const a = analisa({ secs, grupo, nG: secs.length, X, Y, DX: D, DY: D });
  const b = analisa({ secs, grupo, nG: secs.length, X, Y, DX: D, DY: D });
  assert.deepEqual(a.ci, b.ci);
  assert.ok(a.ci.r[0] < a.r && a.r < a.ci.r[1]);
});

test('sinal fraco que o acaso explica vira "inconclusivo"', () => {
  assert.equal(leitura(0.12, 1.05, { r: [-0.02, 0.25], lift: [0.97, 1.12] }).k, 'inc');
  assert.equal(leitura(0.12, 1.05, { r: [0.05, 0.2], lift: [1.01, 1.1] }).k, 'pos');
});

test('encolhimento: unidade pequena puxada para a média, grande quase intacta', () => {
  const media = 0.1;
  assert.ok(Math.abs(encolhe(10, 50, media) - 0.1556) < 0.001); // 20% em 50 eleitores vira ~15,6%
  assert.ok(Math.abs(encolhe(200, 1000, media) - 0.1962) < 0.001); // 20% em 1.000 fica ~19,6%
});

test('quintis ponderados pelo eleitorado', () => {
  // 5 lugares de mesmo peso: um em cada quintil
  const c = quantisPonderados([5, 1, 4, 2, 3], [1, 1, 1, 1, 1]);
  assert.deepEqual(c, [1, 2, 3, 4]);
  assert.deepEqual([1, 2, 3, 4, 5].map((v) => faixa(v, c)), [0, 1, 2, 3, 4]);
  // empates no corte ficam na faixa de baixo: lugares sem voto (zero) nunca sobem de faixa
  const z = quantisPonderados([0, 0, 0, 0, 5], [1, 1, 1, 1, 1]);
  assert.equal(faixa(0, z), 0);
  assert.equal(faixa(5, z), 4);
});

test('a resposta vem da estimativa individual (e não da correlação)', () => {
  // X pequeno cujos eleitores votam em peso em Y: correlação baixa, mas a resposta é "sim"
  const a = respostaEstimativa(0.74, 0.44, 1, 0.31);
  assert.equal(a.k, 'sim'); assert.ok(a.impreciso); assert.ok(a.forte); // 74% ≥ 1,5 × 31%: bem mais, mas impreciso
  assert.equal(respostaEstimativa(0.6, 0.55, 0.65, 0.2).forte, true);
  assert.equal(respostaEstimativa(0.4, 0.36, 0.44, 0.31).forte, false); // sim, mas só um pouco
  assert.equal(respostaEstimativa(0.05, 0.02, 0.08, 0.3).k, 'nao');
  assert.equal(respostaEstimativa(0.33, 0.2, 0.45, 0.31).k, 'igual'); // a faixa inclui os demais
  // e, de ponta a ponta, um X pequeno com 70% de transferência dá "sim" mesmo com correlação modesta
  const r = rng(17), n = 3000, X = new Float64Array(n), Y = new Float64Array(n), D = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const N = 300, px = 0.005 + 0.06 * r() ** 3;
    let x = 0, y = 0;
    for (let i = 0; i < N; i++) { const vx = r() < px; x += vx; y += r() < (vx ? 0.7 : 0.3); }
    X[s] = x; Y[s] = y; D[s] = N;
  }
  const secs = Int32Array.from({ length: n }, (_, i) => i);
  const an = analisa({ secs, grupo: secs, nG: n, X, Y, DX: D, DY: D });
  assert.ok(an.r < 0.35, `r ${an.r}`);
  assert.equal(respostaEstimativa(an.gd.est, an.gd.lo, an.gd.hi, an.gd.demais).k, 'sim');
});
