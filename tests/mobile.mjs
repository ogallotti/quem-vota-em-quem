// Celular: toque em retrato (390×844), retrato pequeno (375×600) e paisagem (844×390), mais o caso do host que desenha a
// página com 1.100 px numa tela de 412 px. Confere layout, toque no mapa, gaveta e seletor.
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
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

for (const [nome, vw, vh, tela] of [['retrato', 390, 844], ['retrato pequeno', 375, 600], ['paisagem', 844, 390], ['página larga em tela de 412 px', 1100, 2000, 412]]) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, screen: tela ? { width: tela, height: 915 } : undefined, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${nome}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/openfreemap|Failed to load/.test(m.text())) errors.push(`${nome} console: ${m.text().slice(0, 200)}`); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ctl && !document.getElementById('loading'), null, { timeout: 40000 });
  await page.waitForTimeout(900);
  console.log(`— ${nome}`);
  const lay = await page.evaluate(() => {
    const k = window.__uiK || 1, r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: b.top / k, bottom: b.bottom / k, left: b.left / k, right: b.right / k, h: b.height / k }; };
    const H = innerHeight / k, W = innerWidth / k;
    const mq = r('mq'), pw = r('panel-wrap'), mb = r('mbottom');
    return { m: document.documentElement.classList.contains('m'), ml: document.documentElement.classList.contains('ml'), k, W, H, mq, pw, mb,
      livre: ((document.documentElement.classList.contains('ml') ? H : Math.min(pw.top, mb.top || H)) - mq.bottom) / H,
      scrollX: document.documentElement.scrollWidth > innerWidth + 1, qTxt: document.getElementById('q').textContent };
  });
  ok('layout de celular ativo', lay.m, JSON.stringify(lay));
  ok('pergunta visível no topo', lay.mq.bottom < lay.H * (lay.ml ? 0.34 : 0.25) && lay.qTxt.includes('Lula'), JSON.stringify(lay.mq));
  ok(`mapa com ao menos metade da tela livre (${Math.round(lay.livre * 100)}%)`, lay.livre >= (lay.ml ? 0.6 : 0.45), lay.livre);
  ok('sem rolagem horizontal', !lay.scrollX);
  if (tela) ok('app ampliado para a largura real', lay.k > 2.5, lay.k);
  // toque no meio do mapa livre seleciona uma área
  const alvo = await page.evaluate(() => { const k = window.__uiK || 1; const a = document.getElementById('mq').getBoundingClientRect(), p = document.getElementById('panel-wrap').getBoundingClientRect(); const ml = document.documentElement.classList.contains('ml'); return { x: ml ? p.left / 2 : innerWidth / 2, y: (a.bottom + (ml ? innerHeight : Math.min(p.top, document.getElementById('mbottom').getBoundingClientRect().top))) / 2 }; });
  await page.touchscreen.tap(alvo.x, alvo.y);
  await page.waitForTimeout(1600);
  const sel = await page.evaluate(() => window.__state.sel);
  ok('toque no mapa seleciona uma área', sel.level !== 'estado', JSON.stringify(sel));
  ok('gaveta recolhida mostra a resposta', await page.isVisible('.answer-t'));
  if (!lay.ml) {
    await page.tap('#sheet-handle');
    await page.waitForTimeout(500);
    ok('alça abre a gaveta pela metade', (await page.getAttribute('#panel-wrap', 'data-snap')) === 'half');
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/m-${nome.replace(/\W+/g, '-')}.png` });
  await page.tap('.q-y');
  await page.waitForSelector('.pk-row');
  const pk = await page.evaluate(() => { const k = window.__uiK || 1; const b = document.querySelector('.pk').getBoundingClientRect(); return { w: b.width / k, W: innerWidth / k }; });
  ok('seletor em tela cheia', Math.abs(pk.w - pk.W) < 2, JSON.stringify(pk));
  await page.tap('.pk-polo.dir');
  await page.waitForTimeout(600);
  ok('atalho Direita troca o Y', (await page.evaluate(() => window.__state.y)) === '1:22');
  await ctx.close();
}
await browser.close();
console.log(`\n${n} verificações · ${errors.length ? errors.length + ' problema(s)' : 'tudo certo'}`);
for (const e of errors) console.log('  ' + e);
process.exit(errors.length ? 1 : 0);
