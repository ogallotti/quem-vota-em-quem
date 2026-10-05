// Controlador: Brasil ↔ estado, par (X, Y), lente, recorte, carga sob demanda, endereço compartilhável, teclado e
// gaveta do celular. Zero backend: só arquivos estáticos.
import { A, porUnidade, rPorUnidade, recorte, setPar, unidadesNoRecorte, valorDe } from './analise.js';
import { BR, D, LEVEL_INFO, candOf, focusGeometry, getProps, loadAf, loadBR, loadCands, loadMunPolys, loadNomes, loadSerie, loadUF, loadZB, munOf, parentChain } from './data.js';
import { abrirBusca, buscaAberta, fecharBusca } from './busca.js';
import { clear, h } from './fmt.js';
import { MapView } from './map.js';
import { quemTrouxe } from './ranking.js';
import { Tooltip, classeBiv, renderCrumbs, renderLegend, renderMain, renderMainBR, renderSide, renderSideBR } from './panel.js';
import { BIV, DIV, LENTES, NOVOTE, RAMP, SEM_DADO, YX, classeR, classeSeq, classesSeq } from './scales.js';
import { faixa, quantis, quantisPonderados, terco } from './stats.js';
import { ICON } from './ui.js';

const $ = (id) => document.getElementById(id);
const CRUMBS = $('crumbs'); // mora dentro da barra do mapa (que é refeita a cada mudança)
const state = { modo: 'br', uf: null, x: null, y: null, lente: 'yx', mode: 'auto', sel: { level: 'estado', id: 0 }, tab: 'trouxe', trouxeCargo: null, trouxeOrd: 'est', trouxeRes: null, afCargo: null, ondeOrd: 'x', mais: false };
const touch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
let view, tooltip, polos = null, sugestoes = null;
window.__state = state;

// ------------------------------------------------------------------ layout pelo aparelho (não pela largura do iframe)
const UI = { k: 1, m: false, ml: false };
function computeLayout() {
  const sw = screen.width || innerWidth;
  const k = touch && sw < 1000 && innerWidth > sw * 1.15 ? innerWidth / sw : 1;
  const W = innerWidth / k, H = innerHeight / k;
  const m = W <= 820, ml = m && H <= 520;
  const app = $('app');
  if (k !== 1) Object.assign(app.style, { width: `${W}px`, height: `${H}px`, transform: `scale(${k})` });
  else Object.assign(app.style, { width: '', height: '', transform: '' });
  document.documentElement.classList.toggle('m', m);
  document.documentElement.classList.toggle('ml', ml);
  Object.assign(UI, { k, m, ml });
  window.__uiK = k;
}
const mobile = () => UI.m;
computeLayout();

function padding() {
  if (mobile()) {
    const H = $('app').offsetHeight, sh = UI.ml ? 0 : $('sheet').offsetHeight;
    return UI.ml ? { top: 70, left: 12, right: $('sheet').offsetWidth + 12, bottom: 20 } : { top: 100, left: 16, right: 16, bottom: Math.min(H * 0.6, sh) + 16 };
  }
  const focus = document.body.classList.contains('focus');
  const W = $('app').offsetWidth;
  return { top: 110, left: focus ? 40 : 420 + 40, right: focus || W <= 1100 ? 40 : 360 + 40, bottom: 40 };
}

// ------------------------------------------------------------------ aviso curto
let toastT = 0;
function toast(msg, ms = 2200) {
  const el = $('toast');
  el.textContent = msg; el.hidden = !msg;
  clearTimeout(toastT);
  if (ms && msg) toastT = setTimeout(() => { el.hidden = true; }, ms);
}

// ------------------------------------------------------------------ endereço compartilhável
const parseHash = () => Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
let hashT = 0, aplicandoHash = false;
function writeHash() {
  clearTimeout(hashT);
  hashT = setTimeout(() => {
    if (aplicandoHash) return;
    const q = new URLSearchParams();
    if (state.modo === 'uf') {
      q.set('uf', state.uf); q.set('x', state.x); q.set('y', state.y);
      if (state.lente !== 'yx') q.set('l', state.lente);
      if (state.sel.level !== 'estado') q.set('s', `${state.sel.level}:${state.sel.id}`);
    }
    const s = q.toString().replace(/%3A/g, ':');
    if (location.hash.slice(1) !== s) history.replaceState(null, '', s ? `#${s}` : location.pathname);
  }, 250);
}

// ------------------------------------------------------------------ pintura
/** Brasil: mapa neutro (sem leitura partidária); estados com dados em tom claro, clique abre o estado. */
function pintarBR() {
  const porId = new Map(BR.states.features.map((f) => [f.properties.id, f.properties]));
  view.setPaint({ palette: ['#34312c', '#24221f'], none: '#24221f', k: (lv, id) => (porId.get(id)?.ok ? 0 : 1), label: () => '' });
  $('legend').hidden = true;
}

function pintar() {
  if (!A.X || !view || state.modo !== 'uf') return;
  const { level: sl, id: si } = state.sel;
  const r = recorte(sl, si);
  const lente = state.lente;
  state.ctx = { px: r.px, py: r.py };
  const fora = (lv, id) => { const set = unidadesNoRecorte(lv, sl, si); return set && !set.has(id); };
  const cache = new Map();
  const seq = (lv) => {
    if (!cache.has(lv)) {
      const u = D.un[lv], v = porUnidade(lv), set = unidadesNoRecorte(lv, sl, si), vals = [];
      for (let g = 0; g < u.ids.length; g++) if (!set || set.has(u.ids[g])) { const d = lente === 'x' ? v.dx[g] : v.dy[g]; if (d > 0) vals.push((lente === 'x' ? v.x[g] : v.y[g]) / d); }
      cache.set(lv, classesSeq(RAMP[lente] || RAMP.x, quantis(vals, 7)));
    }
    return cache.get(lv);
  };
  state.seq = seq;
  let paint;
  if (lente === 'yx') {
    // luz = quintis do eleitorado pela força de Y; cor = quintis pela força de X (cada nível com a sua régua)
    const cortes = new Map();
    const cortesDe = (lv, qual) => {
      const k = `${lv}:${qual}`;
      if (!cortes.has(k)) {
        const u = D.un[lv], set = unidadesNoRecorte(lv, sl, si), vals = [], pesos = [];
        for (const id of u.ids) if (!set || set.has(id)) { const v = valorDe(lv, id); if (v && v.dx > 0) { vals.push(qual === 'x' ? (v.x > 0 ? v.ex : 0) : (v.y > 0 ? v.ey : 0)); pesos.push(v.dx); } }
        // com poucas áreas, faixas de 20% do eleitorado não fazem sentido: régua pela média do recorte
        const media = qual === 'x' ? r.px : r.py;
        cortes.set(k, vals.length < 15 ? [0.5, 0.8, 1.25, 2].map((f) => f * media) : quantisPonderados(vals, pesos, 5));
      }
      return cortes.get(k);
    };
    paint = {
      palette: YX, none: SEM_DADO,
      k: (lv, id) => {
        if (fora(lv, id)) return -2;
        const v = valorDe(lv, id);
        if (!v || !(v.dx > 0)) return -1;
        const fy = v.y > 0 ? faixa(v.ey, cortesDe(lv, 'y')) : 0, fx = v.x > 0 ? faixa(v.ex, cortesDe(lv, 'x')) : 0;
        return fy * 5 + fx;
      },
      label: () => '',
    };
  } else if (lente === 'bi') paint = { palette: BIV, none: SEM_DADO, k: (lv, id) => (fora(lv, id) ? -2 : classeBiv(valorDe(lv, id), r.px, r.py)), label: () => '' };
  else if (lente === 'r') {
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
  view.setPaint(paint);
  legenda();
}

function legenda() {
  $('legend').hidden = false;
  if (state.modo !== 'uf' || !state.seq) return;
  const { level: sl, id: si } = state.sel, lente = state.lente;
  renderLegend($('legend'), { lente, classes: lente === 'x' || lente === 'y' ? state.seq(view.view?.poly || 'municipio') : null, escopo: sl === 'estado' ? 'do estado' : `de ${getProps(sl, si)?.n || ''}` });
}

// ------------------------------------------------------------------ cartões
const ctxSide = () => ({
  tab: state.tab, afCargo: state.afCargo, ondeOrd: state.ondeOrd, mais: state.mais, polos,
  onTab: (t) => { state.tab = t; renderCards(); },
  onAfCargo: (c) => { state.afCargo = c; renderCards(); },
  onOndeOrd: (o) => { state.ondeOrd = o; renderCards(); },
  onMais: () => { state.mais = true; renderCards(); },
  onY: (k) => ctl.setY(k), onSelect: (l, i) => ctl.select(l, i),
  onPick: (lado) => abrirPicker(lado), onSwap: () => ctl.trocar(),
  trouxeCargo: cargoTrouxe(), trouxeOrd: state.trouxeOrd, trouxe: pedirTrouxe,
  onTrouxeCargo: (c) => { state.trouxeCargo = c; renderCards(); },
  onTrouxeOrd: (o) => { state.trouxeOrd = o; renderCards(); },
  onX: (k) => ctl.setX(k),
});
/** Cargo do ranking: o escolhido ou o "par natural" de Y (estadual ↔ federal; majoritários → estadual). */
function cargoTrouxe() {
  const cy = candOf(state.y)?.cargo, tem = (c) => D.cargos.has(c);
  if (state.trouxeCargo && tem(state.trouxeCargo) && (state.trouxeCargo !== cy || cy === 5)) return state.trouxeCargo;
  const par = { 6: tem(7) ? 7 : 8, 7: 6, 8: 6, 3: tem(7) ? 7 : 8, 5: tem(7) ? 7 : 8, 1: tem(7) ? 7 : 8 }[cy];
  return par && tem(par) ? par : [...D.cargos.keys()].find((c) => c !== cy);
}
/** Ranking do recorte atual (assíncrono: devolve {loading} e redesenha quando terminar). */
function pedirTrouxe() {
  const cargo = cargoTrouxe(), { level, id } = state.sel;
  const k = `${state.uf}|${state.y}|${cargo}|${level}:${id}`;
  if (state.trouxeRes?.k === k) return state.trouxeRes.res;
  if (state.trouxePend !== k) {
    state.trouxePend = k;
    quemTrouxe(state.y, A.Y, cargo, level, id).then((res) => { state.trouxeRes = { k, res }; if (state.trouxePend === k && state.tab === 'trouxe') renderCards(); }).catch(() => {});
  }
  return { loading: true };
}
function renderCards() {
  if (state.modo === 'br') {
    renderMainBR($('main-card'), { onSearch: () => abrirPicker('livre'), onCand: escolherCand, sugestoes });
    renderSideBR($('side-card'), (uf) => ctl.entrar(uf));
    return;
  }
  const c = ctxSide();
  renderMain($('main-card'), state.sel.level, state.sel.id, c);
  renderSide($('side-card'), state.sel.level, state.sel.id, c);
  state.afCargo = c.afCargo;
}

const curtoNome = (k) => { const p = (candOf(k)?.nome || '').split(' '); return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : p.join(' '); };
function renderTop() {
  $('uf-pill').textContent = state.modo === 'uf' ? D.meta.uf_nome : 'Brasil';
  const mb = $('mapbar');
  clear(mb);
  if (state.modo !== 'uf') { mb.hidden = true; clear(CRUMBS); return; }
  mb.hidden = false;
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'O que pintar' });
  const nomes = { yx: 'Luz e cor', bi: 'Os dois', x: curtoNome(state.x), y: curtoNome(state.y), r: 'Correlação' };
  for (const id of ['yx', 'bi', 'x', 'y', 'r']) seg.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(state.lente === id), class: state.lente === id ? 'on' : '', title: LENTES[id].desc, onclick: () => ctl.setLente(id) }, nomes[id]));
  const niv = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Nível do mapa' });
  for (const [id, t] of [['auto', 'Auto'], ['municipio', 'Municípios'], ['bairro', 'Bairros'], ['local', 'Locais'], ['secao', 'Seções']]) niv.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(state.mode === id), class: state.mode === id ? 'on' : '', onclick: () => ctl.setMode(id) }, t));
  mb.append(seg, niv, CRUMBS);
}

// ------------------------------------------------------------------ controle
const ctl = {
  /** Abre um estado (com par, lente e seleção opcionais). */
  async entrar(uf, { x = null, y = null, sel = null, lente = null } = {}) {
    if (!BR.ufs.get(uf)?.ok) { toast('Os dados deste estado ainda estão sendo processados'); return; }
    fecharBusca();
    const trocou = state.uf !== uf;
    if (trocou) {
      toast(`Abrindo ${BR.ufs.get(uf).n}…`, 0);
      await loadUF(uf);
      view.clearUF();
      state.uf = uf;
      state.mode = 'auto'; view.setMode('auto');
    }
    const pk = D.meta.polos || {};
    const gov = D.cargos.get(3)?.cands[0]?.key || [...D.cand.keys()][0];
    x = x && candOf(x) ? x : state.x && !trocou && state.modo === 'uf' ? state.x : gov;
    // par padrão só com disputas do estado (governador × senador mais votados); presidente só se a pessoa escolher
    const padraoY = [D.cargos.get(5)?.cands[0]?.key, D.cargos.get(3)?.cands[1]?.key, D.cargos.get(6)?.cands[0]?.key].find((k) => k && k !== x);
    y = y && candOf(y) && y !== x ? y : padraoY;
    const [X, Y] = await Promise.all([loadSerie(x), loadSerie(y)]);
    polos = { esq: pk.esq && { key: pk.esq }, dir: pk.dir && { key: pk.dir } }; // só para os atalhos do seletor
    Object.assign(state, { modo: 'uf', x, y, afCargo: null, mais: false });
    if (lente && LENTES[lente]) state.lente = lente;
    setPar(x, X, y, Y);
    view.setModo('uf');
    for (const l of ['macro', 'municipio']) view.addLevel(l);
    toast('');
    document.body.classList.add('uf');
    if (sel && getProps(sel.level, sel.id)) await ctl.select(sel.level, sel.id);
    else ctl.select('estado', 0, { fit: trocou || state.sel.level === 'br' });
    // camadas e listas em segundo plano
    loadZB().then(() => { if (state.uf === uf) { view.addLevel('zona'); view.addLevel('bairro'); pintar(); renderCards(); } }).catch(() => {});
    loadAf().then(() => { if (state.uf === uf) renderCards(); }).catch(() => {});
    loadNomes().then(() => { if (state.uf === uf && state.modo === 'uf') renderCards(); }).catch(() => {});
  },
  irBrasil() {
    fecharBusca();
    Object.assign(state, { modo: 'br', sel: { level: 'br', id: 0 } });
    document.body.classList.remove('uf');
    view.setFocus(null); view.setSelection(null); view.setModo('br');
    pintarBR(); renderTop(); renderCards(); view.fit('br', 0);
    writeHash();
  },
  async setPar(x, y) {
    if (!candOf(x) || !candOf(y) || x === y) return;
    const [X, Y] = await Promise.all([loadSerie(x), loadSerie(y)]);
    state.x = x; state.y = y; state.afCargo = null;
    setPar(x, X, y, Y);
    pintar(); renderTop(); renderCards(); writeHash();
  },
  setX(x) { return ctl.setPar(x, x === state.y ? state.x : state.y); },
  setY(y) { return ctl.setPar(y === state.x ? state.y : state.x, y); },
  trocar() { return ctl.setPar(state.y, state.x); },
  async select(level, id, { fit = true } = {}) {
    if (state.modo !== 'uf' || (level !== 'estado' && !getProps(level, id))) return;
    state.sel = { level, id };
    state.mais = false;
    const min = { estado: 'municipio', macro: 'municipio', municipio: getProps('municipio', id)?.bb ? 'bairro' : 'local', zona: 'local', bairro: 'local', local: 'secao', secao: 'secao' }[level];
    view.setMinLevel(min);
    const mi = munOf(level, id);
    if (mi != null && (min === 'local' || min === 'secao')) carregarPolys([mi]);
    if (level === 'estado') filaPolys.length = 0;
    view.setSelection(level, id);
    view.setFocus(focusGeometry(level, id));
    pintar();
    renderCards();
    renderTop();
    renderCrumbs(CRUMBS, level, id, (l, i) => ctl.select(l, i));
    if (fit) view.fit(level, id);
    if (mobile() && $('sheet').dataset.snap === 'full') setSnap('half');
    writeHash();
  },
  setLente(id) { if (!LENTES[id]) return; state.lente = id; pintar(); renderTop(); writeHash(); },
  setMode(m) { state.mode = m; view.setMode(m); if (m === 'local' || m === 'secao') carregarPolys(view.municipiosVisiveis()); renderTop(); },
};
window.__ctl = ctl;

/**
 * Polígonos de locais e seções: por município, os da tela (ou o selecionado), 6 por vez, mais próximos do centro
 * primeiro. O mapa se atualiza a cada leva: os municípios por baixo seguram a cor até o detalhe chegar.
 */
let carregando = 0;
const filaPolys = [];
function carregarPolys(ibges) {
  const centro = view.map.getCenter();
  const dist = (i) => { const f = D.lv.municipio.byId.get(i); return f ? (f.properties.lx - centro.lng) ** 2 + (f.properties.ly - centro.lat) ** 2 : 1e9; };
  for (const i of ibges) if (!D.munPolys.has(i) && !filaPolys.includes(i)) filaPolys.push(i);
  filaPolys.sort((a, b) => dist(a) - dist(b));
  puxar();
}
function puxar() {
  const uf = state.uf;
  while (carregando < 6 && filaPolys.length) {
    const i = filaPolys.shift();
    if (D.munPolys.has(i)) continue;
    carregando++;
    loadMunPolys(i).catch(() => false).then((novo) => {
      carregando--;
      if (novo && state.modo === 'uf' && state.uf === uf) { view.addLevel('local'); view.addLevel('secao'); agendarRefresh(); }
      puxar();
    });
  }
}
let refreshT = 0;
function agendarRefresh() { clearTimeout(refreshT); refreshT = setTimeout(() => view.refreshFine(), 120); }

function escolherCand(c) {
  if (c.uf === 'br' || (c.cargo === 1 && state.modo !== 'uf')) { escolherEstado(c); return; }
  if (state.modo === 'uf' && (c.uf === state.uf || c.cargo === 1)) return ctl.setX(c.key);
  return ctl.entrar(c.uf, { x: c.key });
}

/** Presidente concorre no país inteiro: pergunta em qual estado olhar. */
function escolherEstado(c) {
  const ufs = [...BR.ufs.values()].sort((a, b) => a.n.localeCompare(b.n, 'pt-BR'));
  const lista = h('div', { class: 'pal-list' });
  const bg = h('div', { class: 'pal-bg', onclick: (e) => { if (e.target === bg) bg.remove(); } });
  for (const u of ufs) lista.append(h('button', { type: 'button', class: 'row', disabled: !u.ok || null, onclick: () => { bg.remove(); ctl.entrar(u.uf, { x: c.key }); } },
    h('span', { class: 'av', style: { width: '30px', height: '30px' } }, h('b', { style: { fontSize: '11px', color: 'var(--ink-2)' } }, u.uf.toUpperCase())),
    h('span', { class: 'row-n' }, h('b', null, u.n), h('span', null, u.ok ? '' : 'em processamento')), h('span')));
  bg.append(h('div', { class: 'pal', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'pal-ctx', style: { padding: '16px' } }, `${c.nome} concorre no Brasil inteiro. Em qual estado você quer ver quem vota em ${c.nome}?`), lista));
  $('app').append(bg);
}

function abrirPicker(modo) {
  abrirBusca({
    modo, polos: polos ? { esq: polos.esq?.key, dir: polos.dir?.key } : null,
    onCand: (c) => {
      if (modo === 'y') {
        if (c.uf !== state.uf && c.cargo !== 1) { toast('Para comparar, Y precisa ser do mesmo estado (ou candidato a presidente)'); return; }
        return ctl.setY(c.key);
      }
      return escolherCand(c);
    },
    onLugar: (l, i) => ctl.select(l, i),
  });
}

// ------------------------------------------------------------------ gaveta do celular
const SNAPS = ['peek', 'half', 'full'];
function setSnap(s) {
  const sh = $('sheet');
  if (sh.dataset.snap === s) return;
  sh.dataset.snap = s;
  if (s !== 'full') sh.scrollTop = 0;
  setTimeout(() => { medir(); if (s !== 'full' && view && state.modo === 'uf') view.fit(state.sel.level, state.sel.id, { duration: 400 }); }, 280);
}
function medir() { document.documentElement.style.setProperty('--sheet-h', `${mobile() && !UI.ml ? $('sheet').offsetHeight : 0}px`); }
function setupSheet() {
  const sh = $('sheet'), handle = $('sheet-handle');
  let y0 = null;
  handle.addEventListener('pointerdown', (e) => { y0 = e.clientY; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointerup', (e) => {
    if (y0 == null) return;
    const dy = (e.clientY - y0) / UI.k; y0 = null;
    const i = SNAPS.indexOf(sh.dataset.snap);
    if (Math.abs(dy) < 8) setSnap(SNAPS[(i + 1) % SNAPS.length]);
    else setSnap(SNAPS[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]);
  });
  new ResizeObserver(medir).observe(sh);
}

// ------------------------------------------------------------------ boot
async function aplicarHash() {
  const q = parseHash();
  aplicandoHash = true;
  try {
    if (q.uf && BR.ufs.get(q.uf)?.ok) {
      const [lv, idS] = (q.s || '').split(':');
      await ctl.entrar(q.uf, { x: q.x, y: q.y, lente: q.l });
      if (lv) {
        if (['zona', 'bairro'].includes(lv)) await loadZB().catch(() => {});
        await ctl.select(lv, Number(idS));
      }
    } else ctl.irBrasil();
  } finally { aplicandoHash = false; writeHash(); }
}

async function boot() {
  $('sb-i').append(ICON.busca());
  setupSheet();
  try {
    await loadBR();
    if (!window.maplibregl) await new Promise((r) => addEventListener('load', r, { once: true }));
    tooltip = new Tooltip($('tip'));
    view = new MapView({
      container: 'map', pixelRatio: Math.min(2.5, (window.devicePixelRatio || 1) * UI.k), getPadding: padding,
      onHover: (hit, pt) => {
        if (!hit || !pt || touch) { tooltip.hide(); return; }
        if (hit.level === 'uf' || hit.level === 'brmun') {
          const p = (hit.level === 'uf' ? BR.states : BR.mun).features.find((f) => f.properties.id === hit.id)?.properties;
          if (p) tooltip.showBR(p, hit.level, pt);
          return;
        }
        tooltip.show(hit.level, hit.id, pt, { ...state.ctx, lente: state.lente });
      },
      onPick: (hit) => {
        if (hit.level === 'uf') { const p = BR.states.features.find((f) => f.properties.id === hit.id)?.properties; if (p) ctl.entrar(p.uf); return; }
        if (hit.level === 'brmun') { const p = BR.mun.features.find((f) => f.properties.id === hit.id)?.properties; if (p) ctl.entrar(p.uf, { sel: { level: 'municipio', id: p.id } }); return; }
        ctl.select(hit.level, hit.id, { fit: !(hit.level === 'local' || hit.level === 'secao') });
      },
      onEmpty: () => {
        if (state.modo !== 'uf' || state.sel.level === 'estado') return;
        const pais = parentChain(state.sel.level, state.sel.id);
        const pai = pais[pais.length - 1] || { level: 'estado', id: 0 };
        ctl.select(pai.level, pai.id);
      },
      onView: () => legenda(),
      onMoveEnd: () => {
        // detalhe de locais e seções: municípios na tela, ao aproximar ou quando o nível pedido é local/seção
        const fino = ['local', 'secao'].includes(view.view?.want) || ['local', 'secao'].includes(state.mode);
        if (state.modo === 'uf' && (view.map.getZoom() >= 11 || fino)) carregarPolys(view.municipiosVisiveis());
      },
    });
    await view.init();
    await aplicarHash();
    $('loading').classList.add('done');
    setTimeout(() => $('loading')?.remove(), 500);
    // depois do primeiro desenho: municípios do Brasil e índice nacional de candidatos
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
    idle(() => {
      loadCands().then((cs) => { sugestoes = cs.slice().sort((a, b) => b.votos - a.votos).filter((c) => c.cargo !== 1).slice(0, 8); if (state.modo === 'br') renderCards(); }).catch(() => {});
    });
  } catch (err) {
    console.error(err);
    $('loading-t').textContent = location.protocol === 'file:' ? 'Abra por um servidor web (python3 -m http.server --directory public).' : `Não foi possível carregar: ${err.message || err}`;
  }
}

// ------------------------------------------------------------------ topo, atalhos e redimensionamento
$('brand').addEventListener('click', (e) => { e.preventDefault(); ctl.irBrasil(); });
$('uf-pill').addEventListener('click', () => { if (state.modo === 'uf') ctl.irBrasil(); else abrirPicker('livre'); });
$('search-btn').addEventListener('click', () => abrirPicker('livre'));
$('btn-share').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); toast('Link copiado'); } catch { toast('Copie o endereço da barra do navegador'); }
});
addEventListener('hashchange', () => { if (!aplicandoHash) aplicarHash(); });
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirPicker('livre'); return; }
  if (e.target.closest?.('input, textarea') || e.metaKey || e.ctrlKey || e.altKey || buscaAberta()) return;
  const k = e.key.toLowerCase();
  if (k === '/') { e.preventDefault(); abrirPicker('livre'); return; }
  if (state.modo !== 'uf') return;
  if (k === 'x' || k === 'y') { e.preventDefault(); abrirPicker(k); }
  else if (k === 'i') ctl.trocar();
  else if (/^[1-5]$/.test(k)) ctl.setLente(['yx', 'bi', 'x', 'y', 'r'][Number(k) - 1]);
  else if (k === 'f') { document.body.classList.toggle('focus'); setTimeout(() => view?.resize(), 30); }
  else if (k === 'escape') { if (state.sel.level !== 'estado') ctl.select('estado', 0); else ctl.irBrasil(); }
});
addEventListener('resize', () => { computeLayout(); medir(); view?.resize(); });
void LEVEL_INFO;
boot();
