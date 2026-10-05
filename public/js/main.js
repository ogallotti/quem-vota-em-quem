// Controlador: par (X, Y), lente, seleção, carga em fases, controles, busca, gaveta do celular e URL compartilhável.
import { A, exclusivos, porUnidade, rPorUnidade, recorte, setPar, unidadesNoRecorte, valorDe } from './analise.js';
import { D, LEVEL_INFO, buildSearchIndex, candOf, focusGeometry, getProps, loadCore, loadLazy, loadPolys, loadSerie, parentChain, search } from './data.js';
import { clear, h } from './fmt.js';
import { MapView } from './map.js';
import { Panel, Tooltip, classeBiv, nomeCand, renderCrumbs, renderLegend } from './panel.js';
import { closePicker, openPicker, pickerAberto } from './picker.js';
import { BIV, DIV, LENTES, NOVOTE, RAMP, SEM_DADO, classeR, classeSeq, classesSeq } from './scales.js';
import { quantis } from './stats.js';

const $ = (id) => document.getElementById(id);
const state = { x: null, y: null, lente: 'bi', mode: 'auto', sel: { level: 'estado', id: 0 } };
const touch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
let view, panel, tooltip, polos = null;

// ------------------------------------------------------------------ layout pelo aparelho, não pela largura do iframe
// Em alguns hosts (ex.: claude.ai no celular) a página é desenhada com largura de desktop e reduzida. Nesse caso o app é
// montado na largura real da tela e ampliado por transform; o CSS de celular vale pela classe html.m.
const UI = { k: 1, m: false, ml: false };
function computeLayout() {
  const sw = screen.width || innerWidth;
  const k = touch && sw < 1000 && innerWidth > sw * 1.15 ? innerWidth / sw : 1;
  const W = innerWidth / k, H = innerHeight / k;
  const m = W <= 900, ml = m && H <= 520;
  const app = $('app');
  if (k !== 1) Object.assign(app.style, { width: `${W}px`, height: `${H}px`, transform: `scale(${k})` });
  else Object.assign(app.style, { width: '', height: '', transform: '' });
  document.documentElement.classList.toggle('m', m);
  document.documentElement.classList.toggle('ml', ml);
  const mudou = UI.k !== k || UI.m !== m || UI.ml !== ml;
  Object.assign(UI, { k, m, ml });
  window.__uiK = k;
  return mudou;
}
const mobile = () => UI.m;
const pixelRatio = () => Math.min(3, (window.devicePixelRatio || 1) * UI.k, touch ? 2.5 : 3);
function rectIn(el) {
  const a = $('app').getBoundingClientRect(), r = el.getBoundingClientRect(), k = UI.k;
  return { top: (r.top - a.top) / k, bottom: (r.bottom - a.top) / k, left: (r.left - a.left) / k, right: (r.right - a.left) / k, width: r.width / k, height: r.height / k };
}
computeLayout();

// ------------------------------------------------------------------ URL
const parseHash = () => Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
let hashTimer = 0;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    if (!view || !state.x) return;
    const c = view.camera();
    const q = new URLSearchParams({ uf: D.meta.uf.toLowerCase(), x: state.x, y: state.y, l: state.lente, c: [c.lng, c.lat, c.z].join(',') });
    if (state.mode !== 'auto') q.set('n', state.mode);
    if (state.sel.level !== 'estado') q.set('s', `${state.sel.level}:${state.sel.id}`);
    history.replaceState(null, '', '#' + q.toString().replace(/%3A/g, ':').replace(/%2C/g, ','));
  }, 350);
}

let toastTimer = 0;
function toast(msg, ms = 2200) {
  let el = $('toast');
  if (!el) { el = h('div', { id: 'toast', class: 'toast', role: 'status' }); $('app').append(el); }
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

let polysPromise = null;
function ensurePolys() {
  if (D.polysReady) return Promise.resolve();
  if (!polysPromise) {
    toast('Carregando locais e seções…', 0);
    polysPromise = loadPolys().then(() => { view.addPolyLevel('local'); view.addPolyLevel('secao'); toast('Locais e seções prontos', 1200); })
      .catch((err) => { polysPromise = null; toast('Não foi possível carregar locais e seções'); throw err; });
  }
  return polysPromise;
}

// ------------------------------------------------------------------ pintura do mapa (depende de X, Y, lente e recorte)
function pintar() {
  if (!A.X || !view) return;
  const { level: sl, id: si } = state.sel;
  const r = recorte(sl, si);
  const lente = state.lente;
  const ctx = { px: r.px, py: r.py };
  const fora = (lv, id) => { const set = unidadesNoRecorte(lv, sl, si); return set && !set.has(id); }; // fora do recorte: k = −2 (apagado)
  const classesPorNivel = new Map();
  const seq = (lv) => {
    if (!classesPorNivel.has(lv)) {
      const u = D.un[lv], v = porUnidade(lv), set = unidadesNoRecorte(lv, sl, si), vals = [];
      for (let g = 0; g < u.ids.length; g++) if (!set || set.has(u.ids[g])) { const d = lente === 'x' ? v.dx[g] : v.dy[g]; if (d > 0) vals.push((lente === 'x' ? v.x[g] : v.y[g]) / d); }
      classesPorNivel.set(lv, classesSeq(RAMP[lente], quantis(vals, 7)));
    }
    return classesPorNivel.get(lv);
  };
  let paint;
  if (lente === 'bi') {
    paint = { palette: BIV, none: SEM_DADO, k: (lv, id) => (fora(lv, id) ? -2 : classeBiv(valorDe(lv, id), ctx.px, ctx.py)), label: () => '' };
  } else if (lente === 'r') {
    paint = {
      palette: DIV, none: SEM_DADO, clamp: LENTES.r.clamp,
      k: (lv, id) => (fora(lv, id) ? -2 : classeR(rPorUnidade(lv)[D.un[lv].pos.get(id)])),
      label: (lv, p) => { const x = rPorUnidade(lv)[D.un[lv].pos.get(p.id)]; return Number.isNaN(x) ? '' : (x < 0 ? '−' : '') + Math.abs(x).toFixed(2).replace('.', ','); },
    };
  } else {
    paint = {
      palette: RAMP[lente], none: NOVOTE,
      k: (lv, id) => { if (fora(lv, id)) return -2; const v = valorDe(lv, id); return v ? classeSeq(seq(lv), lente === 'x' ? v.px : v.py) : -1; },
      label: (lv, p) => { const v = valorDe(lv, p.id); const x = v && (lente === 'x' ? v.px : v.py); return x > 0 ? `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: x < 0.1 ? 1 : 0 })}%` : ''; },
    };
  }
  state.ctx = ctx;
  state.seq = seq; // antes do setPaint: ele dispara onView, que redesenha a legenda
  view.setPaint(paint);
  legenda();
}

/** A legenda depende do nível visível (faixas das lentes de votos) e do recorte. */
function legenda() {
  if (!state.seq) return;
  const { level: sl, id: si } = state.sel, lente = state.lente;
  renderLegend($('legend'), { lente, classes: lente === 'x' || lente === 'y' ? state.seq(view.view?.poly || 'municipio') : null, escopo: sl === 'estado' ? 'do estado' : `de ${sl === 'secao' ? `Seção ${getProps(sl, si)?.nr}` : getProps(sl, si)?.n || ''}` });
}

// ------------------------------------------------------------------ controle
const ctl = {
  async setPar(x, y) {
    if (!candOf(x) || !candOf(y) || x === y) return;
    const [X, Y] = await Promise.all([loadSerie(x), loadSerie(y)]);
    state.x = x; state.y = y;
    setPar(x, X, y, Y);
    renderPergunta();
    pintar();
    panel.render(state.sel.level, state.sel.id);
    syncControls();
    writeHash();
  },
  setX(x) { return ctl.setPar(x, x === state.y ? state.x : state.y); },
  setY(y) { return ctl.setPar(y === state.x ? state.y : state.x, y); },
  trocar() { return ctl.setPar(state.y, state.x); },
  select(level, id, opts = {}) {
    if (level !== 'estado' && !getProps(level, id)) return;
    if ((level === 'local' || level === 'secao') && !D.polysReady) { ensurePolys().then(() => ctl.select(level, id, opts), () => {}); return; }
    state.sel = { level, id };
    const min = { macro: 'municipio', municipio: getProps('municipio', id)?.bb ? 'bairro' : 'local', zona: 'local', bairro: 'local', local: 'secao', secao: 'secao' }[level];
    view.setMinLevel(min);
    if (min === 'local' || min === 'secao') ensurePolys().catch(() => {});
    view.setSelection(level, id);
    view.setFocus(focusGeometry(level, id));
    pintar();
    panel.render(level, id);
    renderCrumbs($('crumbs'), level, id, (l, i) => ctl.select(l, i));
    document.body.classList.toggle('has-sel', level !== 'estado');
    if (mobile() && $('panel-wrap').dataset.snap === 'full') setSnap('peek', { refit: false });
    if (opts.fit !== false) view.fit(level, id);
    syncControls();
    writeHash();
  },
  setLente(id) {
    if (!LENTES[id]) return;
    state.lente = id;
    pintar();
    syncControls();
    writeHash();
  },
  setMode(mode) {
    if ((mode === 'local' || mode === 'secao') && !D.polysReady) { ensurePolys().then(() => ctl.setMode(mode), () => {}); return; }
    state.mode = mode;
    view.setMode(mode);
    syncControls();
    writeHash();
  },
};
window.__ctl = ctl; // depuração e testes
window.__state = state;

// ------------------------------------------------------------------ a pergunta (topo)
function renderPergunta() {
  const bt = (lado, key) => {
    const c = candOf(key);
    const polo = polos && (key === polos.esq?.key ? 'Esquerda · ' : key === polos.dir?.key ? 'Direita · ' : '');
    return h('button', { type: 'button', class: `q-b q-${lado}`, onclick: () => abrirPicker(lado), title: `Trocar ${lado.toUpperCase()}`, 'aria-label': `${lado.toUpperCase()}: ${c.nome}. Trocar` },
      h('b', null, `${polo || ''}${c.nome}`), h('span', null, `${D.cargos.get(c.cargo).nome} · ${c.partido} ${c.n}`), h('i', { 'aria-hidden': 'true' }, '▾'));
  };
  clear($('q')).append(
    h('span', { class: 'q-t' }, 'Quem vota em'), bt('x', state.x), h('span', { class: 'q-t' }, 'vota em'), bt('y', state.y), h('span', { class: 'q-t q-qm' }, '?'),
    h('button', { type: 'button', class: 'q-swap ghost', onclick: () => ctl.trocar(), title: 'Inverter X e Y', 'aria-label': 'Inverter X e Y' }, '⇄'),
  );
  if (exclusivos()) $('q').append(h('span', { class: 'q-aviso' }, 'mesma vaga: compara territórios'));
}

function abrirPicker(lado) {
  openPicker({
    lado, atual: lado === 'x' ? state.x : state.y, outro: lado === 'x' ? state.y : state.x,
    polos: polos ? { esq: polos.esq?.key, dir: polos.dir?.key } : null,
    onPick: (key) => (lado === 'x' ? ctl.setX(key) : ctl.setY(key)),
  });
}

// ------------------------------------------------------------------ lateral (no celular vira a gaveta "Camadas")
function buildControls() {
  const box = $('lenses');
  for (const L of Object.values(LENTES)) {
    box.append(h('button', { type: 'button', role: 'radio', class: 'chipb lens-chip', dataset: { lente: L.id }, onclick: () => ctl.setLente(L.id) }, h('i', { class: `dot sw-${L.id}` }), L.label));
  }
  const lv = $('levels');
  for (const [id, label] of [['auto', 'Auto'], ...['macro', 'municipio', 'zona', 'bairro', 'local', 'secao'].map((l) => [l, LEVEL_INFO[l].plural.replace('Locais de votação', 'Locais')])]) {
    lv.append(h('button', { type: 'button', role: 'radio', class: 'chipb', dataset: { l: id }, disabled: id !== 'auto' && !['macro', 'municipio'].includes(id), onclick: () => ctl.setMode(id) }, label));
  }
  for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => ctl.select('estado', 0));
}

function syncControls() {
  document.querySelectorAll('[data-lente]').forEach((b) => { const on = b.dataset.lente === state.lente; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  document.querySelectorAll('[data-l]').forEach((b) => { const on = b.dataset.l === state.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  $('lens-desc').textContent = LENTES[state.lente].desc.replace(/\bX\b/g, nomeCand(state.x) || 'X').replace(/\bY\b/g, nomeCand(state.y) || 'Y');
}

function enableLevels() {
  document.querySelectorAll('[data-l]').forEach((b) => { const l = b.dataset.l; b.disabled = l !== 'auto' && !(l === 'local' || l === 'secao' || D.lv[l]?.ready); });
}

// ------------------------------------------------------------------ celular
function place(el, mobileParent, desktopParent, before) {
  if (mobile()) mobileParent.append(el);
  else if (before) desktopParent.insertBefore(el, before); else desktopParent.append(el);
}
function placeControls() {
  place($('search-box'), $('mtop-search'), $('rail'), $('rail').querySelector('section'));
  place($('btn-rail'), $('mtop-btn'), document.querySelector('.tools'), document.querySelector('.tools').firstChild);
  place($('q'), $('mq'), $('q-home'));
  place($('legend'), $('mbottom-legend'), $('app'), $('panel-wrap'));
  document.body.classList.toggle('is-mobile', mobile());
  if (!mobile()) closeRail();
  measureSheet();
  view?.resize();
}
function openRail() { document.body.classList.add('rail-open'); $('btn-rail').setAttribute('aria-expanded', 'true'); $('scrim').hidden = false; }
function closeRail() { document.body.classList.remove('rail-open'); $('btn-rail').setAttribute('aria-expanded', 'false'); $('scrim').hidden = true; }

function mobilePadding() {
  const W = $('app').offsetWidth, H = $('app').offsetHeight;
  const top = rectIn($('mq')).bottom + 10;
  const mb = rectIn($('mbottom')), pw = rectIn($('panel-wrap'));
  if (UI.ml) return { top, left: 12, right: Math.max(12, W - pw.left + 12), bottom: Math.max(12, H - mb.top + 10) };
  const limite = Math.min(mb.height ? mb.top : H, pw.top);
  return { top, left: 12, right: 12, bottom: Math.max(12, H - limite + 10) };
}

const SNAPS = ['peek', 'half', 'full'];
let snapTimer = 0;
function setSnap(s, { refit = true } = {}) {
  const wrap = $('panel-wrap');
  if (wrap.dataset.snap === s) return;
  wrap.dataset.snap = s;
  document.body.dataset.snap = s;
  requestAnimationFrame(measureSheet);
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => { measureSheet(); if (refit && s !== 'full' && view) view.fit(state.sel.level, state.sel.id, { duration: 450 }); }, 280);
}
function measureSheet() {
  const root = document.documentElement.style;
  if (!mobile()) { root.removeProperty('--sheet-h'); root.removeProperty('--bottom-h'); return; }
  const pw = $('panel-wrap');
  root.setProperty('--sheet-h', `${UI.ml ? 0 : pw.offsetHeight}px`);
  const mb = rectIn($('mbottom')), H = $('app').offsetHeight;
  root.setProperty('--bottom-h', `${Math.round(H - (mb.height ? mb.top : H))}px`);
}
function setupSheet() {
  const wrap = $('panel-wrap');
  let y0 = null, arrastou = false;
  const podeArrastar = (e) => mobile() && !UI.ml && (e.target.closest('#sheet-handle') || wrap.dataset.snap === 'peek');
  wrap.addEventListener('pointerdown', (e) => { if (!podeArrastar(e) || e.target.closest('button:not(#sheet-handle), a, input, select, summary, canvas')) return; y0 = e.clientY; arrastou = false; });
  wrap.addEventListener('pointermove', (e) => { if (y0 != null && Math.abs(e.clientY - y0) / UI.k > 10) arrastou = true; });
  wrap.addEventListener('pointerup', (e) => {
    if (y0 == null) return;
    const dy = (e.clientY - y0) / UI.k; y0 = null;
    const i = SNAPS.indexOf(wrap.dataset.snap);
    if (Math.abs(dy) >= 28) setSnap(SNAPS[Math.max(0, Math.min(SNAPS.length - 1, i + (dy < 0 ? 1 : -1)))]);
  });
  wrap.addEventListener('pointercancel', () => { y0 = null; });
  wrap.addEventListener('click', (e) => {
    if (!mobile() || UI.ml || arrastou) { arrastou = false; return; }
    if (e.target.closest('#sheet-handle')) { const i = SNAPS.indexOf(wrap.dataset.snap); setSnap(SNAPS[(i + 1) % SNAPS.length]); return; }
    if (wrap.dataset.snap === 'peek' && !e.target.closest('button, a, input, select, summary')) setSnap('half');
  });
  new ResizeObserver(measureSheet).observe(wrap);
  new ResizeObserver(measureSheet).observe($('mbottom'));
}

// ------------------------------------------------------------------ busca de lugares
function setupSearch() {
  const input = $('search'), list = $('results');
  let items = [], cur = -1;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); cur = -1; };
  const pick = (it) => { close(); input.value = ''; input.blur(); ctl.select(it.level, it.id); };
  const draw = () => {
    items = search(input.value);
    clear(list);
    if (!items.length) { close(); return; }
    items.forEach((it, i) => list.append(h('li', { role: 'option', id: `r${i}`, class: i === cur ? 'on' : '', onpointerdown: (ev) => { ev.preventDefault(); pick(it); } },
      h('b', null, it.name), h('span', null, `${LEVEL_INFO[it.level].label}${it.sub ? ' · ' + it.sub : ''}`))));
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('input', () => { cur = -1; draw(); });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(items.length, 1); draw(); }
    else if (e.key === 'Enter' && items.length) pick(items[Math.max(cur, 0)]);
    else if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
  });
}

// ------------------------------------------------------------------ boot
function setLoading(text, sub) { $('loading-t').textContent = text; $('loading-s').textContent = sub || ''; }
function fail(err) {
  console.error(err);
  setLoading('Não foi possível carregar os dados', location.protocol === 'file:' ? 'Abra por um servidor web (por exemplo: python3 -m http.server --directory public).' : String(err.message || err));
  $('loading').classList.add('error');
}

/** Par inicial: o da URL; senão o governador mais votado × Lula (esquerda). */
function parInicial(q) {
  const ok = (k) => k && candOf(k);
  const gov = D.cargos.get(3)?.cands[0]?.key || [...D.cand.keys()][0];
  const x = ok(q.x) ? q.x : gov;
  let y = ok(q.y) && q.y !== x ? q.y : D.meta.polos?.esq || D.cargos.get(1)?.cands[0]?.key;
  if (y === x) y = D.cargos.get(1)?.cands[1]?.key;
  return [x, y];
}

async function boot() {
  buildControls();
  setupSheet();
  try {
    setLoading('Carregando a votação…', 'municípios, locais de votação e seções');
    await loadCore();
    document.title = `Quem vota em quem · ${D.meta.uf_nome} 2026`;
    $('brand-s').textContent = `Eleições 2026 · ${D.meta.uf_nome}`;
    const q = parseHash();
    const [x, y] = parInicial(q);
    // polos esquerda × direita: votos em Lula e em Bolsonaro para presidente (carregados junto com o par)
    const pk = D.meta.polos || {};
    const [X, Y, E, Dr] = await Promise.all([loadSerie(x), loadSerie(y), pk.esq ? loadSerie(pk.esq) : null, pk.dir ? loadSerie(pk.dir) : null]);
    polos = { esq: E && { key: pk.esq, serie: E }, dir: Dr && { key: pk.dir, serie: Dr } };
    state.x = x; state.y = y;
    if (LENTES[q.l]) state.lente = q.l;
    setPar(x, X, y, Y);
    tooltip = new Tooltip($('tip'));
    panel = new Panel($('panel'), { onSelect: (l, i) => ctl.select(l, i), onY: (k) => ctl.setY(k), polos });
    view = new MapView({
      container: 'map', lite: touch, pixelRatio: pixelRatio(),
      getPadding: () => {
        if (mobile()) return mobilePadding();
        const focus = document.body.classList.contains('focus');
        return { top: 140, left: focus ? 40 : 330, right: focus ? 40 : 440, bottom: 60 };
      },
      onHover: (hit, pt) => { if (!hit || !pt || touch) { tooltip.hide(); return; } tooltip.show(hit.level, hit.id, pt, { ...state.ctx, lente: state.lente }); },
      onPick: (hit) => ctl.select(hit.level, hit.id, { fit: !(hit.level === 'local' || hit.level === 'secao') }),
      onEmpty: () => {
        if (state.sel.level === 'estado') return;
        const pais = parentChain(state.sel.level, state.sel.id);
        const pai = pais[pais.length - 1] || { level: 'estado', id: 0 };
        ctl.select(pai.level, pai.id);
      },
      onView: (v) => {
        const names = { macro: 'regiões', municipio: 'municípios', zona: 'zonas', bairro: 'bairros e municípios', local: 'locais de votação', secao: 'seções' };
        $('level-hint').textContent = state.mode === 'auto' ? `Automático: ${names[v.poly] || ''}. Aproxime para detalhar.` : (LEVEL_INFO[state.mode]?.hint || '');
        legenda();
        enableLevels();
        syncControls();
      },
    });
    await view.init();
    for (const l of ['macro', 'municipio']) view.addPolyLevel(l);
    renderPergunta();
    setupSearch();
    placeControls();
    if (q.n && LEVEL_INFO[q.n] && !['local', 'secao'].includes(q.n)) { state.mode = q.n; view.mode = q.n; }
    ctl.select('estado', 0, { fit: false });
    if (q.c) { const [lng, lat, z] = q.c.split(',').map(Number); if ([lng, lat, z].every(Number.isFinite)) view.jump({ lng, lat, z }); }
    $('loading').classList.add('done');
    setTimeout(() => $('loading').remove(), 600);
    view.map.on('moveend', writeHash);
    view.map.on('zoomend', () => { if (view.map.getZoom() >= 10.8) ensurePolys().catch(() => {}); });
    buildSearchIndex();
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 50));
    idle(() => loadLazy((name) => {
      if (name === 'zona' || name === 'bairro') { view.addPolyLevel(name); buildSearchIndex(); }
      enableLevels();
      panel.render(state.sel.level, state.sel.id);
      aplicarSelecaoDaUrl(q);
    }).catch(fail));
  } catch (err) { fail(err); }
}

let selUrlFeita = false;
function aplicarSelecaoDaUrl(q) {
  if (selUrlFeita || !q.s) return;
  const [level, idStr] = q.s.split(':');
  const id = Number(idStr);
  if ((D.lv[level]?.ready || level === 'local' || level === 'secao') && getProps(level, id)) { selUrlFeita = true; ctl.select(level, id, { fit: !q.c }); }
}

// ------------------------------------------------------------------ ferramentas e atalhos
$('btn-focus').addEventListener('click', toggleFocus);
$('btn-rail').addEventListener('click', () => (document.body.classList.contains('rail-open') ? closeRail() : openRail()));
$('rail-close').addEventListener('click', closeRail);
$('scrim').addEventListener('click', closeRail);
$('rail').addEventListener('click', (e) => { if (mobile() && e.target.closest('.chipb')) closeRail(); });

function toggleFocus() {
  const on = document.body.classList.toggle('focus');
  $('btn-focus').setAttribute('aria-pressed', String(on));
  setTimeout(() => view?.resize(), 50);
}

addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (pickerAberto()) { if (e.key === 'Escape') closePicker(); return; }
  const k = e.key.toLowerCase();
  const ids = Object.keys(LENTES);
  if (/^[1-4]$/.test(k)) ctl.setLente(ids[Number(k) - 1]);
  else if (k === 'x' || k === 'y') { e.preventDefault(); abrirPicker(k); }
  else if (k === 'i') ctl.trocar();
  else if (k === 'f') toggleFocus();
  else if (k === '/') { e.preventDefault(); $('search').focus(); }
  else if (k === 'escape') { closeRail(); if (state.sel.level !== 'estado') ctl.select('estado', 0); }
});

addEventListener('resize', () => {
  if (computeLayout()) placeControls();
  view?.map?.setPixelRatio?.(pixelRatio());
  view?.resize();
  measureSheet();
});
boot();
