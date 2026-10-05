// Dados: carga sob demanda (Brasil → UF → município), decodificação da geometria quantizada, séries de votos em pacotes,
// hierarquia geográfica e índices seção → unidade. Formato descrito em scripts/build_data.py (v2).
import { norm } from './fmt.js';

export const LEVELS = ['macro', 'municipio', 'zona', 'bairro', 'local', 'secao'];
export const POLY_LEVELS = ['macro', 'municipio', 'zona', 'bairro'];
export const LEVEL_INFO = {
  br: { label: 'Brasil', plural: 'Brasil' },
  estado: { label: 'Estado', plural: 'Estado' },
  macro: { label: 'Região', plural: 'Regiões' },
  municipio: { label: 'Município', plural: 'Municípios' },
  zona: { label: 'Zona eleitoral', plural: 'Zonas' },
  bairro: { label: 'Bairro', plural: 'Bairros' },
  local: { label: 'Local de votação', plural: 'Locais' },
  secao: { label: 'Seção', plural: 'Seções' },
};

const get = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); });
const once = new Map();
/** fetch com memória: o mesmo arquivo nunca é pedido duas vezes. */
const getOnce = (url) => { if (!once.has(url)) { const p = get(url); once.set(url, p); p.catch(() => once.delete(url)); } return once.get(url); };

/** Geometria quantizada → GeoJSON. Anéis: [x0, y0, dx1, dy1, ...] em inteiros na escala q. */
export function dq(g, q) {
  const polys = g.map((poly) => poly.map((ring) => {
    const out = [];
    let x = 0, y = 0;
    for (let i = 0; i < ring.length; i += 2) { x += ring[i]; y += ring[i + 1]; out.push([x / q, y / q]); }
    if (out.length) out.push(out[0]);
    return out;
  }));
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}
const fc = (features) => ({ type: 'FeatureCollection', features });
const feat = (geometry, properties) => ({ type: 'Feature', geometry, properties });

// ---------------------------------------------------------------- Brasil
export const BR = { meta: null, ufs: new Map(), states: null, mun: null, cands: null };

export async function loadBR() {
  const b = await getOnce('data/br.json');
  BR.meta = b;
  BR.states = fc(b.ufs.map((u, i) => feat(dq(u.g, b.q), { id: i + 1, uf: u.uf, n: u.nome, lx: u.lx, ly: u.ly, ap: u.ap, cp: u.cp, esq: u.esq, dir: u.dir, ok: u.ok })));
  for (const f of BR.states.features) BR.ufs.set(f.properties.uf, f.properties);
  return b;
}

/** Municípios do Brasil inteiro (mapa nacional Lula × Bolsonaro), depois do primeiro desenho. */
export async function loadBrMun() {
  if (BR.mun) return BR.mun;
  const b = await getOnce('data/br-mun.json');
  BR.mun = fc(b.mun.map(([id, uf, n, g, lx, ly, esq, dir, cp]) => feat(dq(g, b.q), { id, uf, n, lx, ly, esq, dir, cp })));
  return BR.mun;
}

/** Índice nacional de candidatos (busca), só quando a pessoa vai buscar. */
export async function loadCands() {
  if (BR.cands) return BR.cands;
  const b = await getOnce('data/cands.json');
  BR.cands = b.c.map(([uf, cargo, n, nome, nc, partido, votos, sit, valido, s, p]) => ({
    uf: uf.toLowerCase(), cargo, n: String(n), key: `${cargo}:${n}`, nome, nc, partido, votos, sit, valido: !!valido, s, p,
    k: norm(`${nome} ${nc} ${partido} ${n}`),
  }));
  return BR.cands;
}

export function searchCands(q, { uf = null, cargo = null, limit = 40 } = {}) {
  const s = norm(q);
  const src = uf ? [...D.cand.values()] : BR.cands || [];
  const out = [];
  for (const c of src) {
    if (cargo && c.cargo !== cargo) continue;
    const k = c.k || (c.k = norm(`${c.nome} ${c.nc || ''} ${c.partido} ${c.n}`));
    if (s) {
      const i = k.indexOf(s);
      if (i < 0) continue;
      c._sc = (i === 0 ? 0 : k[i - 1] === ' ' ? 1 : 2);
    } else c._sc = 0;
    out.push(c);
  }
  out.sort((a, b) => a._sc - b._sc || b.votos - a.votos);
  return out.slice(0, limit);
}

// ---------------------------------------------------------------- UF
export const D = {
  uf: null, base: null, meta: null, cargos: new Map(), cand: new Map(),
  sec: null, n: 0, loc: null, nl: 0,
  lv: Object.fromEntries(LEVELS.map((l) => [l, { fc: null, byId: new Map(), ready: false }])),
  un: {}, secByLocal: null, munPolys: new Set(), af: null, nomes: null,
};

export const serieKey = (cargo, num) => `${cargo}:${num}`;
export const cargoOf = (key) => Number(String(key).split(':')[0]);
export const candOf = (key) => D.cand.get(key) || null;
/** Denominador da série: comparecimento da eleição dela (presidente é da eleição federal e inclui voto em trânsito). */
export const denomOf = (key) => (cargoOf(key) === 1 ? D.sec.cpf : D.sec.cp);
/** Pasta do sprite de fotos: presidente é nacional. */
export const fotoDe = (c) => (c && c.s >= 0 ? { url: `fotos/${c.cargo === 1 ? 'br' : c.uf}/${c.cargo}-${c.s}.webp`, p: c.p } : null);

function resetUF() {
  D.cargos = new Map(); D.cand = new Map(); D.munPolys = new Set(); D.af = null; D.nomes = null; D.un = {};
  for (const l of LEVELS) D.lv[l] = { fc: null, byId: new Map(), ready: false };
  series.clear(); scopeCache.clear(); bboxCache.clear();
}

export async function loadUF(uf) {
  const b = await getOnce(`data/${uf}/base.json`);
  resetUF();
  D.uf = uf; D.base = b;
  D.meta = { uf: b.uf, uf_nome: b.uf_nome, bounds: b.bounds, eleicao: b.eleicao, fonte: b.fonte, contagens: b.contagens, polos: b.polos, estado: b.estado };
  for (const c of b.cargos) {
    const cands = c.c.map(([n, nome, nc, partido, sit, votos, valido, chunk, s, p]) => ({ key: serieKey(c.cd, n), uf, cargo: c.cd, n: String(n), nome, nc, partido, sit, votos, valido: !!valido, chunk, s, p }));
    D.cargos.set(c.cd, { ...c, cands });
    for (const x of cands) D.cand.set(x.key, x);
  }
  // seções e locais (colunar)
  const s = b.sec, n = s.li.length;
  D.n = n;
  D.sec = { li: Int32Array.from(s.li), nr: s.nr, ap: Float64Array.from(s.ap), cp: Float64Array.from(s.cp), cpf: Float64Array.from(s.cp, (v, i) => v + (s.tf?.[i] || 0)) };
  const L = b.loc;
  D.nl = L.mi.length;
  D.loc = { mi: L.mi, z: L.z, bi: L.bi, x: L.x.map((v) => v / 1e5), y: L.y.map((v) => v / 1e5), ok: L.ok, ns: L.ns };
  D.secByLocal = Array.from({ length: D.nl }, () => []);
  for (let i = 0; i < n; i++) D.secByLocal[D.sec.li[i]].push(i);
  // níveis com geometria no arquivo inicial; totais somados das seções
  setLevel('macro', b.macro.map(([id, nome, g, lx, ly]) => feat(dq(g, b.q), { id, n: nome, lx, ly })));
  setLevel('municipio', b.mun.map(([id, nome, rm, bb, g, lx, ly]) => feat(dq(g, b.q), { id, n: nome, rm, bb, lx, ly })));
  // locais e seções: propriedades já; geometria chega por município (loadMunPolys)
  setLevel('local', Array.from({ length: D.nl }, (_, i) => feat(null, { id: i, i, mi: L.mi[i], z: L.z[i], bi: L.bi[i], ns: L.ns[i], n: `Local ${i + 1}` })));
  setLevel('secao', Array.from({ length: n }, (_, i) => feat(null, { id: i, i, li: D.sec.li[i], nr: s.nr[i], n: `Seção ${s.nr[i]}` })));
  buildUnits();
  for (const l of ['macro', 'municipio', 'local', 'secao']) somaTotais(l);
  return b;
}

function setLevel(level, features) {
  const L = D.lv[level];
  L.fc = fc(features);
  L.byId = new Map(features.map((f) => [f.properties.id, f]));
  L.ready = true;
}

/** Índices seção → unidade em cada nível (base de toda agregação e de todo recorte). */
function buildUnits() {
  const n = D.n, li = D.sec.li, L = D.loc;
  const rm = new Map(D.lv.municipio.fc.features.map((f) => [f.properties.id, f.properties.rm]));
  const de = {
    secao: (s) => s, local: (s) => li[s], municipio: (s) => L.mi[li[s]], macro: (s) => rm.get(L.mi[li[s]]),
    zona: (s) => L.z[li[s]], bairro: (s) => (L.bi[li[s]] >= 0 ? L.bi[li[s]] : null), estado: () => 0,
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

/** Eleitores aptos e comparecimento por unidade (somados das seções). */
function somaTotais(level) {
  const u = D.un[level], ap = new Float64Array(u.ids.length), cp = new Float64Array(u.ids.length);
  for (let s = 0; s < D.n; s++) { const g = u.idx[s]; if (g >= 0) { ap[g] += D.sec.ap[s]; cp[g] += D.sec.cp[s]; } }
  for (const [id, f] of D.lv[level].byId) { const g = u.pos.get(id); f.properties.ap = g == null ? 0 : ap[g]; f.properties.cp = g == null ? 0 : cp[g]; }
}

/** Zonas e bairros: em segundo plano, depois do primeiro desenho. */
export async function loadZB() {
  if (D.lv.zona.ready) return;
  const uf = D.uf, b = await getOnce(`data/${uf}/zb.json`);
  if (uf !== D.uf) return;
  const q = D.base.q;
  setLevel('zona', b.zona.map(([id, nome, mn, g, lx, ly]) => feat(dq(g, q), { id, n: nome, mn, lx, ly })));
  const mn = new Map(D.lv.municipio.fc.features.map((f) => [f.properties.id, f.properties.n]));
  setLevel('bairro', b.bairro.map(([id, nome, mi, g, lx, ly]) => feat(dq(g, q), { id, n: nome, mi, mn: mn.get(mi) || '', lx, ly })));
  somaTotais('zona'); somaTotais('bairro');
}

/** Nomes, endereços e bairros dos locais (rótulos, dicas, busca). */
export async function loadNomes() {
  if (D.nomes) return D.nomes;
  const uf = D.uf, b = await getOnce(`data/${uf}/nomes.json`);
  if (uf !== D.uf) return null;
  D.nomes = b.loc;
  for (const f of D.lv.local.fc.features) { const [n, e, bairro] = b.loc[f.properties.i] || []; Object.assign(f.properties, { n: n || f.properties.n, e: e || '', b: bairro || '' }); }
  return D.nomes;
}

/** Polígonos de locais e seções de um município (só ao aproximar). Devolve true se chegou algo novo. */
export async function loadMunPolys(ibge) {
  if (D.munPolys.has(ibge)) return false;
  D.munPolys.add(ibge);
  const uf = D.uf;
  let b;
  try { b = await getOnce(`data/${uf}/m/${ibge}.json`); } catch (e) { D.munPolys.delete(ibge); throw e; }
  if (uf !== D.uf) return false;
  b.li.forEach((i, k) => { const f = D.lv.local.byId.get(i); f.geometry = dq(b.lg[k], b.q); [f.properties.lx, f.properties.ly] = b.ll[k]; });
  b.si.forEach((i, k) => { const f = D.lv.secao.byId.get(i); f.geometry = dq(b.sg[k], b.q); [f.properties.lx, f.properties.ly] = b.sl[k]; });
  return true;
}
/** Só as feições com geometria (as dos municípios já carregados) vão para o mapa. */
export const comGeometria = (level) => fc(D.lv[level].fc.features.filter((f) => f.geometry));

/** Votos de um candidato por seção (Float64Array). Os candidatos vêm em pacotes por cargo. */
const series = new Map();
export function loadSerie(key) {
  if (series.has(key)) return series.get(key);
  const c = candOf(key);
  if (!c) return Promise.reject(new Error(`candidato ${key} não está em ${D.uf}`));
  const n = D.n;
  const p = getOnce(`data/${D.uf}/v/${c.cargo}-${c.chunk}.json`).then((pk) => {
    const sp = pk[c.n], v = new Float64Array(n);
    if (!sp) return v;
    let s = -1;
    for (let k = 0; k < sp.i.length; k++) { s += sp.i[k]; v[s] = sp.v[k]; }
    return v;
  });
  series.set(key, p);
  p.catch(() => series.delete(key));
  return p;
}

export async function loadAf() {
  if (D.af) return D.af;
  const uf = D.uf, a = await getOnce(`data/${uf}/af.json`);
  if (uf === D.uf) D.af = a;
  return D.af;
}

// ---------------------------------------------------------------- entidades e recortes
export function getProps(level, id) {
  if (level === 'estado') return { id: 0, n: D.meta.uf_nome, ap: D.meta.estado.ap, cp: D.meta.estado.cp };
  return D.lv[level]?.byId.get(id)?.properties || null;
}
export const getFeature = (level, id) => D.lv[level]?.byId.get(id) || null;
export function entityName(level, p) {
  if (level === 'estado') return D.meta.uf_nome;
  if (level === 'secao') return `Seção ${p.nr}`;
  if (level === 'bairro') return `${p.n} · ${p.mn}`;
  return p.n;
}

const scopeCache = new Map();
export function secsOf(level, id) {
  const k = `${level}:${id}`;
  if (scopeCache.has(k)) return scopeCache.get(k);
  let out;
  if (level === 'estado') out = Int32Array.from({ length: D.n }, (_, i) => i);
  else if (level === 'local') out = Int32Array.from(D.secByLocal[id] || []);
  else if (level === 'secao') out = Int32Array.of(id);
  else {
    const u = D.un[level], g = u.pos.get(id), arr = [];
    for (let s = 0; s < D.n; s++) if (u.idx[s] === g) arr.push(s);
    out = Int32Array.from(arr);
  }
  scopeCache.set(k, out);
  return out;
}

/** Município de uma entidade (para foco e para carregar polígonos). */
export function munOf(level, id) {
  if (level === 'municipio') return id;
  if (level === 'local') return D.loc.mi[id];
  if (level === 'secao') return D.loc.mi[D.sec.li[id]];
  if (level === 'bairro') return getProps('bairro', id)?.mi ?? null;
  return null;
}

export function focusGeometry(level, id) {
  if (level === 'estado') return null;
  if (level === 'local' || level === 'secao') return getFeature('municipio', munOf(level, id))?.geometry || null;
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

export function bboxGeom(g) {
  let w = 181, s = 91, e = -181, n = -91;
  const walk = (c) => { if (typeof c[0] === 'number') { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; } else for (const x of c) walk(x); };
  walk(g.coordinates);
  return [[w, s], [e, n]];
}

const bboxCache = new Map();
export function bboxOf(level, id) {
  if (level === 'estado') return D.meta.bounds;
  const k = `${level}:${id}`;
  if (bboxCache.has(k)) return bboxCache.get(k);
  const f = getFeature(level, id);
  let b = null;
  if (f?.geometry) b = bboxGeom(f.geometry);
  else if (level === 'local') { const x = D.loc.x[id], y = D.loc.y[id]; b = [[x - 0.004, y - 0.004], [x + 0.004, y + 0.004]]; }
  else if (level === 'secao') return bboxOf('local', D.sec.li[id]);
  if (b && f?.geometry) bboxCache.set(k, b);
  return b;
}

export function parentChain(level, id) {
  const chain = [{ level: 'estado', id: 0, name: D.meta.uf_nome }];
  const p = getProps(level, id);
  if (!p || level === 'estado') return chain;
  const add = (lv, i) => { const q = getProps(lv, i); if (q) chain.push({ level: lv, id: i, name: entityName(lv, q) }); };
  const mun = (mi) => { const m = getProps('municipio', mi); if (!m) return; add('macro', m.rm); add('municipio', mi); };
  switch (level) {
    case 'municipio': add('macro', p.rm); break;
    case 'bairro': mun(p.mi); break;
    case 'local': mun(p.mi); if (p.bi >= 0) add('bairro', p.bi); break;
    case 'secao': { const l = getProps('local', p.li); if (l) { mun(l.mi); if (l.bi >= 0) add('bairro', l.bi); add('local', l.i); } break; }
    default: break;
  }
  return chain;
}

/** Subunidades de um recorte (para a lista "Onde"). */
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
    case 'local': return { level: 'secao', items: (D.secByLocal[id] || []).map((s) => D.lv.secao.byId.get(s).properties) };
    default: return { level: null, items: [] };
  }
}

// ---------------------------------------------------------------- busca de lugares
export function searchPlaces(q, limit = 8) {
  const s = norm(q);
  if (!s || !D.uf) return [];
  const hits = [];
  const ORDER = { municipio: 0, macro: 1, bairro: 2, zona: 3, local: 4 };
  for (const lv of ['municipio', 'macro', 'bairro', 'zona', 'local']) {
    if (!D.lv[lv].ready || (lv === 'local' && !D.nomes)) continue;
    for (const f of D.lv[lv].fc.features) {
      const p = f.properties;
      const sub = lv === 'bairro' ? p.mn : lv === 'local' ? `${getProps('municipio', p.mi)?.n || ''} · ${p.b || ''}` : lv === 'zona' ? p.mn || '' : '';
      const k = p._k || (p._k = norm(`${p.n} ${sub}`));
      const i = k.indexOf(s);
      if (i < 0) continue;
      hits.push({ level: lv, id: p.id, name: p.n, sub, ap: p.ap || 0, sc: (i === 0 ? 0 : k[i - 1] === ' ' ? 1 : 2) * 10 + ORDER[lv] });
    }
  }
  hits.sort((a, b) => a.sc - b.sc || b.ap - a.ap);
  return hits.slice(0, limit);
}
