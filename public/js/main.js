// Controlador: Brasil ↔ estado, par (X, Y), lente, recorte, carga sob demanda, endereço compartilhável, teclado e
// gaveta do celular. Zero backend: só arquivos estáticos.
import { A, porUnidade, rPorUnidade, recorte, setPar, unidadesNoRecorte, valorDe } from './analise.js';
import { BR, D, LEVEL_INFO, candOf, focusGeometry, getProps, loadBR, loadCands, loadMunPolys, loadNomes, loadSerie, loadUF, loadZB, munOf, parentChain } from './data.js';
import { abrirBusca, buscaAberta, fecharBusca } from './busca.js';
import { clear, h } from './fmt.js';
import { MapView } from './map.js';
import { eleitoresDe, posicao, quemVotouEm } from './ranking.js';
import { Tooltip, classeBiv, renderCrumbs, renderLegend, renderMain, renderMainBR, renderSide, renderSideBR } from './panel.js';
import { BIV, DIV, LENTES, NOVOTE, RAMP, SEM_DADO, YX, classeR, classeSeq, classesSeq } from './scales.js';
import { faixa, quantis, quantisPonderados, terco } from './stats.js';
import { ICON } from './ui.js';

const $ = (id) => document.getElementById(id);
const CRUMBS = $('crumbs'); // mora dentro da barra do mapa (que é refeita a cada mudança)
const state = { modo: 'br', uf: null, x: null, y: null, lente: 'yx', mode: 'auto', sel: { level: 'estado', id: 0 }, tab: 'comum', sentido: 'para', comumCargo: { de: null, para: null }, ordem: 'pct', comumRes: null, ondeOrd: 'x', mais: false };
const touch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
let view, tooltip, polos = null, sugestoes = null;
window.__state = state;

// ------------------------------------------------------------------ layout pelo aparelho (não pela largura do iframe)
const UI = { k: 1, m: false, ml: false };
function computeLayout() {
  const sw = screen.width || innerWidth;
  const k = touch && sw < 1000 && innerWidth > sw * 1.15 ? innerWidth / sw : 1;
  const W = innerWidth / k, H = innerHeight / k;
  // celular deitado (ex.: 844 × 390) também é celular: a altura baixa não comporta o layout de mesa
  const m = W <= 820 || (touch && H <= 520 && W <= 1100), ml = m && H <= 520;
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
    const topo = $('mapbar').hidden ? 70 : $('mapbar').getBoundingClientRect().bottom / UI.k + 12;
    return UI.ml ? { top: topo, left: 12, right: $('sheet').offsetWidth + 12, bottom: 20 } : { top: topo, left: 16, right: 16, bottom: Math.min(H * 0.6, sh) + 16 };
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
      q.set('uf', state.uf); q.set('x', state.x); if (state.y) q.set('y', state.y);
      if (state.y && state.lente !== 'yx') q.set('l', state.lente);
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
  const lente = lenteAtiva();
  const r = state.y ? recorte(sl, si) : { px: valorDe(sl, si)?.px || 0, py: 0 };
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

/** Sem Y, só existe a lente de X. */
const lenteAtiva = () => (state.y ? state.lente : 'x');

function legenda() {
  $('legend').hidden = false;
  if (state.modo !== 'uf' || !state.seq) return;
  const { level: sl, id: si } = state.sel, lente = lenteAtiva();
  renderLegend($('legend'), { lente, classes: lente === 'x' || lente === 'y' ? state.seq(view.view?.poly || 'municipio') : null, escopo: sl === 'estado' ? 'do estado' : `de ${getProps(sl, si)?.n || ''}` });
}

// ------------------------------------------------------------------ cartões
const ctxSide = () => ({
  tab: state.tab, ondeOrd: state.ondeOrd, mais: state.mais, polos,
  onTab: (t) => { state.tab = t; renderCards(); },
  onOndeOrd: (o) => { state.ondeOrd = o; renderCards(); },
  onMais: () => { state.mais = true; renderCards(); },
  onY: (k) => ctl.setY(k), onSelect: (l, i) => ctl.select(l, i),
  onPick: (lado) => abrirPicker(lado), onSwap: () => ctl.trocar(),
  sentido: sentidoAtivo(), comumCargo: cargoComum(sentidoAtivo()), ordem: state.ordem, comum: pedirComum,
  onSentido: (s) => { state.sentido = s; renderCards(); },
  onComumCargo: (c) => { state.comumCargo[sentidoAtivo()] = c; renderCards(); },
  onOrdem: (o) => { state.ordem = o; renderCards(); },
  onX: (k) => ctl.setX(k),
  onSolo: () => ctl.setPar(state.x, null),
  distribuicao: pedirDistribuicao,
  posicao: () => { const { level, id } = state.sel, cargo = candOf(state.x)?.cargo; return assincrono('pos', `${state.x}|${level}:${id}`, () => posicao(state.x, cargo, level, id)); },
  sugestoesSolo: pedirSugestoesSolo,
});
/** Sentido da aba Em comum: sem Y só existe "eleitores de X". */
function sentidoAtivo() { return state.y ? state.sentido : 'de'; }
/** Modo de um candidato só: em quem mais votaram os eleitores de X no cargo "par natural" (estimativa). */
function pedirSugestoesSolo() {
  const { level, id } = state.sel, cargo = cargoComum('de');
  return assincrono('sug', `${A.ver}|${cargo}|${level}:${id}`, () => eleitoresDe(state.x, A.X, cargo, level, id)
    .then(({ lista }) => ({ cargo: (D.cargos.get(cargo)?.nome || '').toLowerCase(), lista: lista.slice(0, 3) })));
}
/** Cálculos assíncronos do painel: devolve {loading} e redesenha quando o resultado chega. */
const pend = new Map();
function assincrono(nome, k, f) {
  const r = pend.get(nome);
  if (r?.k === k) return r.res ?? { loading: true };
  const item = { k, res: null };
  pend.set(nome, item);
  f().then((res) => { item.res = res; if (pend.get(nome) === item) renderCards(); }).catch(() => {});
  return { loading: true };
}
/** Como os eleitores de X se dividiram entre os principais candidatos do cargo de Y (quadro do cartão principal). */
function pedirDistribuicao() {
  const { level, id } = state.sel, cargo = candOf(state.y)?.cargo;
  return assincrono('dist', `${A.ver}|${cargo}|${level}:${id}`, () => eleitoresDe(state.x, A.X, cargo, level, id).then(({ lista }) => {
    const top = new Set((D.cargos.get(cargo)?.cands || []).filter((c) => c.key !== state.x).slice(0, 6).map((c) => c.key));
    return lista.filter((l) => top.has(l.key)).map((l) => ({ key: l.key, modelos: [Math.min(l.est, l.viz), Math.max(l.est, l.viz)], demais: l.demais ? [Math.min(...l.demais), Math.max(...l.demais)] : [0, 0] }));
  }));
}
/** Par natural de um cargo (deputado estadual ↔ federal; governador ↔ senador; presidente → governador). */
function parNatural(c) {
  const tem = (k) => D.cargos.has(k);
  return { 6: tem(7) ? 7 : 8, 7: 6, 8: 6, 3: 5, 5: 3, 1: 3 }[c];
}
/** Cargo da aba "Em comum": o escolhido, ou o cargo do outro candidato, ou o par natural; nunca a vaga exclusiva. */
function cargoComum(sentido) {
  const fixo = candOf(sentido === 'de' || !state.y ? state.x : state.y)?.cargo, outro = state.y ? candOf(sentido === 'de' ? state.y : state.x)?.cargo : null;
  const ok = (c) => c && D.cargos.has(c) && (c !== fixo || c === 5);
  return [state.comumCargo[sentido], outro, parNatural(fixo)].find(ok) || [...D.cargos.keys()].find(ok);
}
function pedirComum() {
  const s = sentidoAtivo(), cargo = cargoComum(s), { level, id } = state.sel;
  return s === 'de'
    ? assincrono('comum', `de|${A.ver}|${cargo}|${level}:${id}`, () => eleitoresDe(state.x, A.X, cargo, level, id))
    : assincrono('comum', `para|${A.ver}|${cargo}|${level}:${id}`, () => quemVotouEm(state.y, A.Y, cargo, level, id));
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
  alturaPeek();
}

const curtoNome = (k) => { const p = (candOf(k)?.nome || '').split(' '); return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : p.join(' '); };
function renderTop() {
  $('uf-pill').textContent = state.modo === 'uf' ? D.meta.uf_nome : 'Brasil';
  const mb = $('mapbar');
  clear(mb);
  if (state.modo !== 'uf') { mb.hidden = true; clear(CRUMBS); return; }
  mb.hidden = false;
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'O que pintar' });
  const nomes = { yx: 'Os dois', bi: 'Acima da média', x: curtoNome(state.x), y: curtoNome(state.y), r: 'Correlação' };
  for (const id of ['yx', 'bi', 'x', 'y', 'r']) seg.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(state.lente === id), class: state.lente === id ? 'on' : '', title: LENTES[id].desc, onclick: () => ctl.setLente(id) }, nomes[id]));
  const niv = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Nível do mapa' });
  for (const [id, t] of [['auto', 'Auto'], ['municipio', 'Municípios'], ['bairro', 'Bairros'], ['local', 'Locais'], ['secao', 'Seções']]) niv.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(state.mode === id), class: state.mode === id ? 'on' : '', onclick: () => ctl.setMode(id) }, t));
  mb.append(...(state.y ? [seg] : []), niv, CRUMBS);
}

// ------------------------------------------------------------------ controle
const ctl = {
  /** Abre um estado. y: chave = par; null = só X; omitido = par padrão (governador × senador). */
  async entrar(uf, { x = null, y, sel = null, lente = null } = {}) {
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
    y = y === null ? null : y && candOf(y) && y !== x ? y : padraoY;
    const [X, Y] = await Promise.all([loadSerie(x), y ? loadSerie(y) : null]);
    polos = { esq: pk.esq && { key: pk.esq }, dir: pk.dir && { key: pk.dir } }; // só para os atalhos do seletor
    Object.assign(state, { modo: 'uf', x, y, mais: false });
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
    loadNomes().then(() => { if (state.uf === uf && state.modo === 'uf') renderCards(); }).catch(() => {});
  },
  irBrasil() {
    fecharBusca();
    Object.assign(state, { modo: 'br', sel: { level: 'br', id: 0 } });
    document.body.classList.remove('uf');
    view.setFocus(null); view.setSelection(null); view.setModo('br');
    if (mobile()) setSnap('half');
    pintarBR(); renderTop(); renderCards(); view.fit('br', 0);
    writeHash();
  },
  /** y = null: só X ("voo só de ida"). */
  async setPar(x, y) {
    if (!candOf(x) || (y != null && (!candOf(y) || x === y))) return;
    const [X, Y] = await Promise.all([loadSerie(x), y ? loadSerie(y) : null]);
    state.x = x; state.y = y;
    setPar(x, X, y, Y);
    pintar(); renderTop(); renderCards(); writeHash();
    if (mobile()) setSnap('peek');
  },
  setX(x) { return ctl.setPar(x, !state.y ? null : x === state.y ? state.x : state.y); },
  setY(y) { if (!state.y && y === state.x) return; return ctl.setPar(y === state.x ? state.y : state.x, y); },
  trocar() { if (state.y) return ctl.setPar(state.y, state.x); },
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
    // celular: ao escolher uma área, a gaveta recolhe e mostra a resposta sobre o mapa
    if (mobile()) setSnap('peek');
    writeHash();
  },
  setLente(id) { if (!LENTES[id] || !state.y) return; state.lente = id; pintar(); renderTop(); writeHash(); },
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

/** Candidato escolhido na busca geral ou na capa: abre só ele (sem comparação). */
function escolherCand(c) {
  if (c.uf === 'br' || (c.cargo === 1 && state.modo !== 'uf')) { escolherEstado(c); return; }
  if (state.modo === 'uf' && (c.uf === state.uf || c.cargo === 1)) return ctl.setPar(c.key, null);
  return ctl.entrar(c.uf, { x: c.key, y: null });
}

/** Presidente concorre no país inteiro: pergunta em qual estado olhar. */
function escolherEstado(c) {
  const ufs = [...BR.ufs.values()].sort((a, b) => a.n.localeCompare(b.n, 'pt-BR'));
  const lista = h('div', { class: 'pal-list' });
  const bg = h('div', { class: 'pal-bg', onclick: (e) => { if (e.target === bg) bg.remove(); } });
  for (const u of ufs) lista.append(h('button', { type: 'button', class: 'row', disabled: !u.ok || null, onclick: () => { bg.remove(); ctl.entrar(u.uf, { x: c.key, y: null }); } },
    h('span', { class: 'av', style: { width: '30px', height: '30px' } }, h('b', { style: { fontSize: '11px', color: 'var(--ink-2)' } }, u.uf.toUpperCase())),
    h('span', { class: 'row-n' }, h('b', null, u.n), h('span', null, u.ok ? '' : 'em processamento')), h('span')));
  bg.append(h('div', { class: 'pal', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'pal-ctx', style: { padding: '16px' } }, `${c.nome} concorre no Brasil inteiro. Em qual estado você quer ver quem vota em ${c.nome}?`), lista));
  $('app').append(bg);
}

function abrirPicker(modo) {
  abrirBusca({
    modo, polos: polos ? { esq: polos.esq?.key, dir: polos.dir?.key } : null,
    sugerir: modo === 'y' ? (cg) => eleitoresDe(state.x, A.X, cg, state.sel.level, state.sel.id).then((r) => r.lista.slice(0, 5).map((l) => l.key)) : null,
    onCand: (c) => {
      if (modo === 'y') {
        if (c.uf !== state.uf && c.cargo !== 1) { toast('Para comparar, Y precisa ser do mesmo estado (ou candidato a presidente)'); return; }
        return ctl.setY(c.key);
      }
      if (modo === 'x' && state.modo === 'uf' && (c.uf === state.uf || c.cargo === 1)) return ctl.setX(c.key);
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
/** Gaveta recolhida: alta o bastante para mostrar a pergunta e a resposta (manchete), no máximo metade da tela. */
function alturaPeek() {
  if (!mobile() || UI.ml) return;
  const sh = $('sheet'), alvo = $('main-card').querySelector('.answer, .hero');
  if (!alvo) return;
  const fim = alvo.offsetTop + alvo.offsetHeight + 14;
  sh.style.setProperty('--peek-h', `${Math.round(Math.max(170, Math.min(fim, $('app').offsetHeight * 0.5)))}px`);
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
  // toque na gaveta recolhida (fora de botões) abre até a metade
  sh.addEventListener('click', (e) => { if (sh.dataset.snap === 'peek' && !e.target.closest('button, a, input, summary')) setSnap('half'); });
}

// ------------------------------------------------------------------ boot
async function aplicarHash() {
  const q = parseHash();
  aplicandoHash = true;
  try {
    if (q.uf && BR.ufs.get(q.uf)?.ok) {
      const [lv, idS] = (q.s || '').split(':');
      await ctl.entrar(q.uf, { x: q.x, y: q.x ? q.y ?? null : undefined, lente: q.l });
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
        tooltip.show(hit.level, hit.id, pt, { ...state.ctx, lente: lenteAtiva() });
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
