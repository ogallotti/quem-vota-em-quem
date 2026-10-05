// Teste de fumaça: abre o mapa num Chromium real e percorre o par padrão, troca de candidatos, lentes, recortes,
// locais/seções e o seletor. Falha se houver erro no console ou número inconsistente com a divulgação oficial.
//   pnpm serve   (em outro terminal)   e   BASE_URL=http://127.0.0.1:4190/ pnpm smoke
// CHROME_PATH aponta para um Chromium/Chrome (padrão: cache do Playwright). SHOTS=pasta salva capturas de tela.
import os from 'os';
import fs from 'fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4190/';
const SHOTS = process.env.SHOTS || '';
const cache = `${os.homedir()}/Library/Caches/ms-playwright`;
const cache2 = `${os.homedir()}/.cache/ms-playwright`;
const guess = [cache, cache2].filter(fs.existsSync).flatMap((c) => fs.readdirSync(c).filter((d) => d.startsWith('chromium-')).sort().reverse()
  .map((d) => `${c}/${d}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`)).find(fs.existsSync);
const exe = process.env.CHROME_PATH || guess;

const errors = [];
let n = 0;
const ok = (name, cond, extra = '') => { n++; console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ` → ${extra}`}`); if (!cond) errors.push(name); };
const shot = async (page, nome) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${nome}.png` }); };

const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 920 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 240)}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ctl && !document.getElementById('loading'), null, { timeout: 40000 });
await page.waitForTimeout(800);

const info = () => page.evaluate(async () => {
  const { D } = await import('/js/data.js');
  const { A, recorte } = await import('/js/analise.js');
  const s = window.__state.sel;
  const r = recorte(s.level, s.id);
  return { x: A.x, y: A.y, tx: r.tx, ty: r.ty, r: r.r, n: r.n, unidade: r.unidade, lim: r.lim, gd: r.gd && { est: r.gd.est }, exc: r.exclusivos,
    cx: D.cand.get(A.x)?.votos, cy: D.cand.get(A.y)?.votos, h2: document.querySelector('.ph h2')?.textContent, answer: document.querySelector('.answer-t')?.textContent,
    legend: document.getElementById('legend').textContent, cont: D.meta.contagens };
});

// ---- par padrão: governador mais votado × Lula (esquerda)
let s = await info();
ok('par padrão = governador mais votado × esquerda (Lula)', s.x === '3:55' && s.y === '1:13', `${s.x} × ${s.y}`);
ok('total de X no estado = divulgação oficial', s.tx === s.cx, `${s.tx} × ${s.cx}`);
ok('total de Y no estado = divulgação oficial', s.ty === s.cy, `${s.ty} × ${s.cy}`);
ok('18.093 seções e 5.834 locais', s.cont.secao === 18093 && s.cont.local === 5834, JSON.stringify(s.cont));
ok('correlação calculada por local de votação', s.unidade === 'local' && s.r != null && s.n > 5000, `${s.unidade} ${s.r} ${s.n}`);
ok('limites certos: mínimo ≤ máximo ≤ votos de X', s.lim && s.lim.lo <= s.lim.hi && s.lim.hi <= s.tx, JSON.stringify(s.lim));
ok('estimativa dentro dos limites', s.gd && s.gd.est >= s.lim.loF - 1e-9 && s.gd.est <= s.lim.hiF + 1e-9, JSON.stringify(s.gd));
ok('resposta em palavras', !!s.answer && s.answer.length > 5, s.answer);
ok('legenda bivariada', await page.$('.biv-grid i') !== null);
ok('cartão esquerda × direita', await page.$('.lado-bar') !== null);
ok('cartão "quem mais anda junto"', (await page.$$('.af-row')).length >= 5);
await shot(page, '1-estado');

// ---- dobradinha: deputado estadual × deputado federal
await page.evaluate(() => window.__ctl.setPar('7:12000', '6:4444'));
await page.waitForTimeout(400);
s = await info();
ok('troca de par (estadual × federal)', s.x === '7:12000' && s.y === '6:4444' && s.tx === s.cx && s.ty === s.cy, `${s.x} ${s.y}`);
ok('botões da pergunta mostram os nomes', (await page.textContent('#q')).includes('Maedja Campos'));

// ---- mesma vaga (exclusivos): sem limites nem estimativa
await page.evaluate(() => window.__ctl.setPar('7:12000', '7:15700'));
await page.waitForTimeout(300);
s = await info();
ok('mesma vaga: exclusivos, sem teto nem estimativa', s.exc && !s.lim && !s.gd, JSON.stringify({ exc: s.exc, lim: s.lim }));
ok('aviso de mesma vaga no topo', (await page.textContent('#q')).includes('mesma vaga'));

// ---- lentes
for (const l of ['x', 'y', 'r', 'bi']) {
  await page.evaluate((id) => window.__ctl.setLente(id), l);
  await page.waitForTimeout(250);
  const leg = await page.textContent('#legend');
  ok(`lente ${l} com legenda`, leg.length > 5, leg);
}

// ---- recorte: São Luís
await page.evaluate(() => window.__ctl.setPar('3:55', '1:22'));
await page.evaluate(() => window.__ctl.select('municipio', 2111300));
await page.waitForTimeout(1500);
s = await info();
ok('seleção de município (São Luís)', s.h2 === 'São Luís' && s.tx > 0 && s.tx < s.cx, `${s.h2} ${s.tx}`);
ok('subunidades listadas', (await page.$$('.ch-row')).length >= 10);
ok('dispersão desenhada', await page.$('.sc-cv') !== null);
await shot(page, '2-sao-luis');

// ---- locais e seções (polígonos sob demanda)
await page.evaluate(() => { __map.jumpTo({ center: [-44.265, -2.545], zoom: 14.6 }); });
await page.waitForFunction(() => window.__map.getLayer('secao-fill') && window.__map.getLayer('local-fill'), null, { timeout: 40000 });
await page.waitForTimeout(800);
const liId = await page.evaluate(async () => { const { D } = await import('/js/data.js'); return D.lv.local.fc.features.find((f) => f.properties.mi === 2111300 && f.properties.ns >= 8).properties.id; });
await page.evaluate((id) => window.__ctl.select('local', id), liId);
await page.waitForTimeout(800);
s = await info();
ok('local de votação: análise por seção', s.unidade === 'secao' && s.n >= 8, `${s.unidade} ${s.n}`);
await shot(page, '3-local');

// ---- seletor
await page.evaluate(() => window.__ctl.select('estado', 0));
await page.keyboard.press('y');
await page.waitForSelector('.pk-row');
ok('seletor abre com atalhos esquerda/direita', (await page.$$('.pk-polo')).length === 2);
await page.fill('.pk-q', 'lula');
await page.waitForTimeout(150);
ok('busca no seletor encontra Lula', (await page.textContent('.pk-list')).includes('Lula'));
await shot(page, '4-seletor');
await page.keyboard.press('Escape');
ok('seletor fecha com Esc', (await page.$('.pk')) === null);

// ---- URL compartilhável
await page.waitForTimeout(500);
const hash = await page.evaluate(() => location.hash);
ok('estado na URL', hash.includes('x=3:55') && hash.includes('y=1:22'), hash);
const p2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
p2.on('pageerror', (e) => errors.push(`pageerror (url): ${e.message}`));
await p2.goto(`${BASE}#x=6:4444&y=1:13&s=municipio:2111300&l=r`, { waitUntil: 'load' });
await p2.waitForFunction(() => window.__state?.sel?.level === 'municipio', null, { timeout: 40000 });
const st2 = await p2.evaluate(() => ({ x: window.__state.x, y: window.__state.y, l: window.__state.lente }));
ok('URL restaura par, lente e seleção', st2.x === '6:4444' && st2.y === '1:13' && st2.l === 'r', JSON.stringify(st2));

await browser.close();
const reais = errors.filter((e) => !/tiles\.openfreemap|Failed to load resource/.test(e));
console.log(`\n${n} verificações · ${reais.length ? reais.length + ' problema(s)' : 'tudo certo'}`);
for (const e of reais) console.log('  ' + e);
process.exit(reais.length ? 1 : 0);
