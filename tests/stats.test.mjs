// Testes do núcleo estatístico com dados sintéticos de verdade conhecida.  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analisa, forca, goodman, leitura, pearson, terco } from '../public/js/stats.js';

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
