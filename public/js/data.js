// Carga dos dados, hierarquia geográfica, séries de votos por seção e agregação por nível.
import { norm } from './fmt.js';

export const LEVELS = ['macro', 'municipio', 'zona', 'bairro', 'local', 'secao'];
export const POLY_LEVELS = ['macro', 'municipio', 'zona', 'bairro'];
export const LEVEL_INFO = {
  estado: { label: 'Estado', plural: 'Estado' },
  macro: { label: 'Região', plural: 'Regiões', hint: 'Regiões intermediárias do IBGE' },
  municipio: { label: 'Município', plural: 'Municípios' },
  zona: { label: 'Zona eleitoral', plural: 'Zonas' },
  bairro: { label: 'Bairro / povoado', plural: 'Bairros', hint: 'Subdivisão das cidades grandes' },
  local: { label: 'Local de votação', plural: 'Locais de votação', hint: 'Escolas e prédios' },
  secao: { label: 'Seção', plural: 'Seções', hint: 'Urna individual' },
};

// ---------------------------------------------------------------- UF exibida
export let UF = 'ma';
let BASE = `data/${UF}/`;
const getJSON = (f) => fetch(BASE + f).then((r) => {
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  return r.json();
});

export const D = {
  meta: null, cargos: new Map(), cand: new Map(), // "cargo:número" → candidato
  sec: null, n: 0,
  lv: Object.fromEntries(LEVELS.map((l) => [l, { fc: null, byId: new Map(), ready: false }])),
  un: {}, // por nível: { idx: Int32Array (seção → unidade), ids: [] (unidade → id), pos: Map(id → unidade) }
  localCoord: [], secByLocal: null, polysReady: false,
  series: new Map(), af: null,
};

export const serieKey = (cargo, num) => `${cargo}:${num}`;
export const cargoOf = (key) => Number(String(key).split(':')[0]);

/** Candidato (ou polo) de uma chave "cargo:número". */
export function candOf(key) { return D.cand.get(key) || null; }

/** Denominador da série: comparecimento da eleição dela (presidente é da eleição federal e inclui voto em trânsito). */
export const denomOf = (key) => (cargoOf(key) === 1 ? D.sec.cpf : D.sec.cp);

export async function loadCore() {
  try {
    const ufs = await fetch('data/ufs.json').then((r) => r.json());
    const pedida = /(?:^#|&)uf=([a-z]{2})/.exec(location.hash)?.[1];
    UF = pedida && ufs[pedida] ? pedida : Object.keys(ufs)[0];
  } catch { /* sem índice: usa o padrão */ }
  BASE = `data/${UF}/`;
  const [meta, macro, municipio, locais, sec] = await Promise.all([
    getJSON('meta.json'), getJSON('macro.geojson'), getJSON('municipio.geojson'), getJSON('locais.geojson'), getJSON('secoes.json'),
  ]);
  D.meta = meta;
  for (const c of meta.cargos) {
    const cands = c.cands.map(([n, nome, partido, sit, votos, valido]) => ({ key: serieKey(c.cd, n), cargo: c.cd, n, nome, partido, sit, votos, valido: !!valido }));
    D.cargos.set(c.cd, { ...c, cands });
    for (const x of cands) D.cand.set(x.key, x);
  }
  indexLevel('macro', macro);
  indexLevel('municipio', municipio);
  for (const f of locais.features) { D.localCoord[f.properties.i] = f.geometry.coordinates; f.properties.id = f.properties.i; }
  indexLevel('local', locais);
  buildSections(sec);
  buildUnits();
}

function indexLevel(level, fc) {
  const L = D.lv[level];
  L.fc = fc;
  L.byId = new Map(fc.features.map((f) => [f.properties.id, f]));
  L.ready = true;
}

function buildSections(sec) {
  const n = sec.li.length;
  D.n = n;
  D.sec = { li: Int32Array.from(sec.li), nr: sec.nr, ap: Float64Array.from(sec.ap), cp: Float64Array.from(sec.cp), cpf: Float64Array.from(sec.cpf || sec.cp) };
  D.secByLocal = new Map();
  const feats = new Array(n);
  for (let s = 0; s < n; s++) {
    const li = sec.li[s];
    if (!D.secByLocal.has(li)) D.secByLocal.set(li, []);
    D.secByLocal.get(li).push(s);
    feats[s] = { type: 'Feature', properties: { id: s, i: s, li, nr: sec.nr[s], n: `Seção ${sec.nr[s]}`, ap: sec.ap[s], cp: sec.cp[s] }, geometry: null };
  }
  indexLevel('secao', { type: 'FeatureCollection', features: feats });
}

/** Índices seção → unidade em cada nível (base de toda agregação e de todo recorte). */
function buildUnits() {
  const n = D.n, li = D.sec.li;
  const lp = (i) => D.lv.local.byId.get(i).properties;
  const de = {
    secao: (s) => s,
    local: (s) => li[s],
    municipio: (s) => lp(li[s]).mi,
    macro: (s) => D.lv.municipio.byId.get(lp(li[s]).mi).properties.rm,
    zona: (s) => lp(li[s]).z,
    bairro: (s) => { const b = lp(li[s]).bi; return b >= 0 ? b : null; },
    estado: () => 0,
  };
  for (const [level, f] of Object.entries(de)) {
    const idx = new Int32Array(n), ids = [], pos = new Map();
    for (let s = 0; s < n; s++) {
      const id = f(s);
      if (id == null) { idx[s] = -1; continue; }
      let u = pos.get(id);
      if (u == null) { u = ids.length; ids.push(id); pos.set(id, u); }
      idx[s] = u;
    }
    D.un[level] = { idx, ids, pos };
  }
}

/** Zonas, bairros e afinidades: em segundo plano, depois do primeiro desenho. */
export function loadLazy(onReady) {
  const zonaP = getJSON('zona.geojson').then((fc) => { indexLevel('zona', fc); onReady?.('zona'); });
  const bairroP = getJSON('bairro.geojson').then((fc) => { indexLevel('bairro', fc); onReady?.('bairro'); });
  const afP = getJSON('afinidades.json').then((a) => { D.af = a; onReady?.('af'); });
  return Promise.all([zonaP, bairroP, afP]);
}

/** Geometrias de locais e seções (6 MB): só quando o usuário se aproxima. */
export function loadPolys() {
  return Promise.all([getJSON('locais_poly.json'), getJSON('secoes_poly.json')]).then(([lpoly, spoly]) => {
    for (const f of D.lv.local.fc.features) { const i = f.properties.i; [f.properties.lx, f.properties.ly] = lpoly.l[i]; f.geometry = lpoly.g[i]; }
    for (const f of D.lv.secao.fc.features) { const s = f.properties.i; [f.properties.lx, f.properties.ly] = spoly.l[s]; f.geometry = spoly.g[s]; }
    D.polysReady = true;
  });
}

/** Votos de um candidato por seção (Float64Array). O arquivo é esparso: saltos entre índices e valores. */
export function loadSerie(key) {
  if (D.series.has(key)) return D.series.get(key);
  const [cg, num] = key.split(':');
  const p = getJSON(`v/${cg}/${num}.json`).then((sp) => {
    const v = new Float64Array(D.n);
    let s = -1;
    for (let k = 0; k < sp.i.length; k++) { s += sp.i[k]; v[s] = sp.v[k]; }
    return v;
  });
  D.series.set(key, p);
  p.catch(() => D.series.delete(key));
  return p;
}

// ---------------------------------------------------------------- entidades e recortes
export function getProps(level, id) {
  if (level === 'estado') return { id: 0, n: D.meta.uf_nome, ...D.meta.estado };
  return D.lv[level]?.byId.get(id)?.properties || null;
}
export const getFeature = (level, id) => D.lv[level]?.byId.get(id) || null;

export function entityName(level, p) {
  if (level === 'estado') return D.meta.uf_nome;
  if (level === 'bairro') return `${p.n} · ${p.mn}`;
  if (level === 'local') return p.n;
  return p.n;
}

/** Índices das seções de um recorte. */
const scopeCache = new Map();
export function secsOf(level, id) {
  const k = `${level}:${id}`;
  if (scopeCache.has(k)) return scopeCache.get(k);
  let out;
  if (level === 'estado') out = Int32Array.from({ length: D.n }, (_, i) => i);
  else {
    const u = D.un[level], g = u.pos.get(id), arr = [];
    for (let s = 0; s < D.n; s++) if (u.idx[s] === g) arr.push(s);
    out = Int32Array.from(arr);
  }
  scopeCache.set(k, out);
  return out;
}

/** Geometria que "acende" no mapa (o resto apaga). Local e seção focam o município. */
export function focusGeometry(level, id) {
  if (level === 'estado') return null;
  if (level === 'secao') { const l = getProps('local', getProps('secao', id)?.li); return l ? getFeature('municipio', l.mi)?.geometry : null; }
  if (level === 'local') { const p = getProps('local', id); return p ? getFeature('municipio', p.mi)?.geometry : null; }
  return getFeature(level, id)?.geometry || null;
}

export function pointInGeometry(lng, lat, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    let inside = false;
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

const bboxCache = new Map();
export function bboxOf(level, id) {
  if (level === 'estado') return D.meta.bounds;
  const k = `${level}:${id}`;
  if (bboxCache.has(k)) return bboxCache.get(k);
  const f = getFeature(level, id);
  if (!f?.geometry) {
    const c = level === 'local' ? D.localCoord[id] : null;
    return c ? [[c[0] - 0.004, c[1] - 0.004], [c[0] + 0.004, c[1] + 0.004]] : null;
  }
  let w = 181, s = 91, e = -181, n = -91;
  const walk = (c) => { if (typeof c[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else for (const x of c) walk(x); };
  walk(f.geometry.coordinates);
  const b = [[w, s], [e, n]];
  bboxCache.set(k, b);
  return b;
}

export function parentChain(level, id) {
  const chain = [{ level: 'estado', id: 0, name: D.meta.uf_nome }];
  const p = getProps(level, id);
  if (!p || level === 'estado') return chain;
  const add = (lv, i) => { const q = getProps(lv, i); if (q) chain.push({ level: lv, id: i, name: entityName(lv, q) }); };
  const munOf = (mi) => { const m = getProps('municipio', mi); if (!m) return; add('macro', m.rm); add('municipio', mi); };
  switch (level) {
    case 'municipio': add('macro', p.rm); break;
    case 'bairro': munOf(p.mi); break;
    case 'local': munOf(p.mi); if (p.bi >= 0) add('bairro', p.bi); else add('zona', p.z); break;
    case 'secao': { const l = getProps('local', p.li); if (l) { munOf(l.mi); if (l.bi >= 0) add('bairro', l.bi); else add('zona', l.z); add('local', l.i); } break; }
    default: break;
  }
  return chain;
}

/** Subunidades de um recorte (nível e ids), para a lista do painel. */
export function childrenOf(level, id) {
  const all = (lv) => (D.lv[lv].ready ? D.lv[lv].fc.features.map((f) => f.properties) : []);
  switch (level) {
    case 'estado': return { level: 'municipio', items: all('municipio') };
    case 'macro': return { level: 'municipio', items: all('municipio').filter((p) => p.rm === id) };
    case 'municipio': {
      const m = getProps('municipio', id);
      if (m.bb && D.lv.bairro.ready) return { level: 'bairro', items: all('bairro').filter((p) => p.mi === id) };
      return { level: 'local', items: all('local').filter((p) => p.mi === id) };
    }
    case 'zona': return { level: 'local', items: all('local').filter((p) => p.z === id) };
    case 'bairro': return { level: 'local', items: all('local').filter((p) => p.bi === id) };
    case 'local': return { level: 'secao', items: (D.secByLocal.get(id) || []).map((s) => D.lv.secao.byId.get(s).properties) };
    default: return { level: null, items: [] };
  }
}

// ---------------------------------------------------------------- busca de lugares
let searchIndex = null;
export function buildSearchIndex() {
  const items = [];
  for (const lv of ['municipio', 'bairro', 'zona', 'macro', 'local']) {
    if (!D.lv[lv].ready) continue;
    for (const f of D.lv[lv].fc.features) {
      const p = f.properties;
      const sub = lv === 'bairro' ? p.mn : lv === 'local' ? `${getProps('municipio', p.mi)?.n || ''} · ${p.b}` : lv === 'zona' ? (p.mn || '') : '';
      items.push({ level: lv, id: p.id, name: p.n, sub, key: norm(`${p.n} ${sub}`), ap: p.ap });
    }
  }
  searchIndex = items;
}
const ORDER = { municipio: 0, macro: 1, zona: 2, bairro: 3, local: 4 };
export function search(q, limit = 9) {
  const s = norm(q);
  if (!s || !searchIndex) return [];
  const hits = [];
  for (const it of searchIndex) {
    const i = it.key.indexOf(s);
    if (i < 0) continue;
    hits.push({ it, score: (i === 0 ? 0 : it.key[i - 1] === ' ' ? 1 : 2) * 10 + ORDER[it.level] });
  }
  hits.sort((a, b) => a.score - b.score || b.it.ap - a.it.ap);
  return hits.slice(0, limit).map((h) => h.it);
}

/** Busca de candidatos (nome, partido ou número), opcionalmente num cargo. */
export function searchCands(q, cargo = null, limit = 60) {
  const s = norm(q);
  const out = [];
  for (const c of D.cand.values()) {
    if (cargo && c.cargo !== cargo) continue;
    if (s && !norm(`${c.nome} ${c.partido} ${c.n}`).includes(s)) continue;
    out.push(c);
  }
  out.sort((a, b) => b.votos - a.votos);
  return out.slice(0, limit);
}
