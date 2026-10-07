// Celular: toque em retrato (390×844), retrato pequeno (360×640), paisagem (844×390) e o caso do host que desenha a
// página com 1.100 px numa tela de 412 px. Confere layout, gaveta, toque no mapa, busca e o modo de um candidato só.
//   pnpm serve   e   BASE_URL=http://127.0.0.1:4190/ pnpm test:mobile      (SHOTS=pasta salva capturas)
import os from 'os';
import fs from 'fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4190/';
const SHOTS = process.env.SHOTS || '';
const caches = [`${os.homedir()}/Library/Caches/ms-playwright`, `${os.homedir()}/.cache/ms-playwright`];
const exe = process.env.CHROME_PATH || caches.filter(fs.existsSync).flatMap((c) => fs.readdirSync(c).filter((d) => d.startsWith('chromium-')).sort().reverse()
  .map((d) => `${c}/${d}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`)).find(fs.existsSync);

const errors = [];
let n = 0;
const ok = (name, cond, extra = '') => { n++; console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ` → ${extra}`}`); if (!cond) errors.push(name); };
const browser = await chromium.launch({ executablePath: exe });
const PAR = '#uf=ma&x=3:55&y=1:13';

for (const [nome, vw, vh, tela] of [['retrato', 390, 844], ['retrato pequeno', 360, 640], ['paisagem', 844, 390], ['página larga em tela de 412 px', 1100, 2000, 412]]) {
  console.log(`— ${nome}`);
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, screen: tela ? { width: tela, height: 915 } : undefined, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const pageErr = [];
  p.on('pageerror', (e) => pageErr.push(e.message));
  const shot = (s) => SHOTS && p.screenshot({ path: `${SHOTS}/${nome.replace(/\W+/g, '-')}-${s}.png` });
  const st = () => p.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width && b.height ? { t: b.top, b: b.bottom, l: b.left, r: b.right } : null; };
    return {
      cls: document.documentElement.className, sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight,
      snap: document.getElementById('sheet').dataset.snap, verdict: r('.verdict'), legend: r('#legend'), mapbar: r('#mapbar'),
      lentes: !!document.querySelector('#mapbar .seg[aria-label="O que pintar"]'), hash: location.hash, sel: window.__state?.sel || null,
      k: window.__uiK || 1,
    };
  });
  await p.goto(BASE + PAR, { waitUntil: 'load' });
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => document.querySelector('.verdict'), null, { timeout: 30000 });
  await p.waitForTimeout(2500);
  let s = await st();
  const deitado = vh <= 520;
  ok('layout de celular', s.cls.includes('m'), s.cls);
  ok(deitado ? 'paisagem com painel lateral' : 'retrato sem painel lateral', s.cls.includes('ml') === deitado, s.cls);
  ok('sem rolagem horizontal', s.sw <= s.iw + 1, `${s.sw} > ${s.iw}`);
  if (tela) ok('página larga ampliada para a tela', s.k > 2.4, `k = ${s.k}`);
  ok('barra de lentes visível', !!s.mapbar && s.lentes);
  ok('legenda visível', !!s.legend);
  const alto = s.ih / s.k;
  if (!deitado) {
    ok('gaveta recolhida ao abrir', s.snap === 'peek', s.snap);
    ok('manchete inteira visível na gaveta recolhida', s.verdict && s.verdict.b / s.k <= alto + 1, JSON.stringify(s.verdict));
    ok('legenda acima da gaveta', s.legend && s.verdict && s.legend.b <= s.verdict.t, JSON.stringify([s.legend, s.verdict]));
  } else ok('manchete visível no painel', s.verdict && s.verdict.t / s.k < alto, JSON.stringify(s.verdict));
  await shot('par');

  // toque no mapa seleciona uma área e mantém a resposta à vista
  const mapa = deitado ? { x: (vw * 0.27), y: vh * 0.6 } : { x: vw / 2, y: (s.mapbar.b + s.legend.t) / 2 };
  await p.touchscreen.tap(mapa.x, mapa.y);
  await p.waitForTimeout(2500);
  s = await st();
  ok('toque no mapa seleciona uma área', s.sel && s.sel.level !== 'estado', JSON.stringify(s.sel));
  ok('endereço guarda a seleção', /[&#]s=/.test(s.hash), s.hash);
  if (!deitado) {
    ok('gaveta segue recolhida após o toque', s.snap === 'peek', s.snap);
    await p.locator('#sheet-handle').tap();
    await p.waitForTimeout(700);
    s = await st();
    ok('alça abre a gaveta até a metade', s.snap === 'half', s.snap);
    ok('legenda some com a gaveta aberta', !s.legend);
    await p.locator('#sheet-handle').tap();
    await p.waitForTimeout(700);
    s = await st();
    ok('alça abre a gaveta inteira', s.snap === 'full', s.snap);
    ok('barra do mapa some com a gaveta inteira', !s.mapbar);
  }

  // busca geral → um candidato só
  await p.locator('#search-btn').tap();
  await p.waitForSelector('.pal-q');
  await p.keyboard.type('Duarte');
  await p.waitForTimeout(800);
  ok('busca em tela cheia', await p.$eval('.pal', (e) => e.getBoundingClientRect().width >= innerWidth / (window.__uiK || 1) - 2));
  await p.locator('.pal-list .row').first().tap();
  await p.waitForTimeout(3500);
  s = await st();
  ok('candidato da busca abre sozinho (sem y)', /x=/.test(s.hash) && !/y=/.test(s.hash), s.hash);
  ok('sem Y, sem seletor de lentes', !s.lentes);
  ok('manchete do candidato sozinho', /teve [\d.]+ votos/.test(await p.$eval('.verdict', (e) => e.textContent)));
  if (!deitado) ok('gaveta recolhida após escolher candidato', s.snap === 'peek', s.snap);
  await shot('solo');
  await p.locator('.cc-add').tap();
  await p.waitForTimeout(600);
  ok('"Comparar com…" abre o seletor do Y', await p.$('.pal') != null);
  ok('sem erros na página', !pageErr.length, pageErr.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`\n${n - errors.length}/${n} verificações`);
if (errors.length) { console.log('Falharam:', errors.join('; ')); process.exit(1); }
