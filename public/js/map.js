// Mapa (MapLibre GL), sem mapa-base de terceiros: só os dados, com rótulos em fontes servidas pelo próprio site.
// Dois modos: "br" (estados e municípios do país) e "uf" (níveis de um estado, do município à seção).
// As cores mudam a cada par (X, Y): a classe de cada área é calculada em JS e vai para o feature-state "k"; a camada pinta
// com `match` sobre a paleta da lente. k = −2: dentro do foco mas fora do recorte (quase o fundo); −1: sem dado.
import { BR, D, bboxGeom, bboxOf, comGeometria, getFeature, pointInGeometry } from './data.js';
import { luminance } from './scales.js';

const FONT = ['Noto Sans Bold'];
const FONT_REG = ['Noto Sans Regular'];
const BG = '#0f0e0d';
const FORA = '#1f1d1b';
export const BRASIL = [[-74.2, -33.9], [-34.6, 5.4]];

// Partes (fonte + filtro) de cada nível. O nível "bairro" completa o mapa com os municípios sem subdivisão.
const PARTS = {
  uf: [{ src: 'br-uf', lv: 'uf' }],
  brmun: [{ src: 'br-mun', lv: 'brmun' }],
  macro: [{ src: 'macro', lv: 'macro' }],
  municipio: [{ src: 'municipio', lv: 'municipio' }],
  zona: [{ src: 'zona', lv: 'zona' }],
  bairro: [{ src: 'bairro', lv: 'bairro' }, { src: 'municipio', lv: 'municipio', filter: ['==', ['get', 'bb'], 0], suffix: 'm' }],
  local: [{ src: 'local', lv: 'local' }],
  secao: [{ src: 'secao', lv: 'secao' }],
};
const UF_LEVELS = ['macro', 'municipio', 'zona', 'bairro', 'local', 'secao'];
const LABEL_SIZE = { uf: 13, brmun: 11, macro: 16, municipio: 12, zona: 13, bairro: 11, local: 11, secao: 12 };
const LABEL_MINZOOM = { local: 13.4, secao: 15.6, brmun: 6.5 };
const AUTO_POLY = [[6.9, 'macro'], [9.3, 'municipio'], [10.3, 'zona'], [12.0, 'bairro'], [14.3, 'local'], [Infinity, 'secao']];
const ORDEM = ['macro', 'municipio', 'zona', 'bairro', 'local', 'secao'];
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const layerId = (level, part) => `${level}${part.suffix || ''}`;
const featuresOf = (src) => (src === 'br-uf' ? BR.states.features : src === 'br-mun' ? BR.mun?.features || [] : D.lv[src].fc?.features || []);

export class MapView {
  constructor({ container, onHover, onPick, onEmpty, onView, onMoveEnd, getPadding, pixelRatio = null }) {
    Object.assign(this, { container, pixelRatio, getPadding });
    this.cb = { onHover, onPick, onEmpty, onView, onMoveEnd };
    this.modo = 'br';
    this.mode = 'auto';
    this.view = { poly: 'uf' };
    this.layerOwner = new Map();
    this.levelLayers = {};
    this.ready = new Set();
    this.paint = null;
    this.painted = new Map();
    this.ver = 0;
  }

  async init() {
    const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
    const style = {
      version: 8, sources: {}, glyphs: `${base}fonts/glyphs/{fontstack}/{range}.pbf`,
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': BG } }],
    };
    this.map = new maplibregl.Map({
      container: this.container, style, bounds: BRASIL, fitBoundsOptions: { padding: this._pad() },
      minZoom: 2.5, maxZoom: 19, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0,
      renderWorldCopies: false, pixelRatio: this.pixelRatio || Math.min(window.devicePixelRatio || 1, 2.5),
    });
    window.__map = this.map;
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation();
    this.map.on('error', (e) => { if (!/glyph|pbf/.test(String(e.error?.message))) console.error('[mapa]', e.error?.message || e.error || e); });
    await new Promise((res) => this.map.once('load', res));
    this._initSelection();
    this._initLabels();
    this._events();
    return this;
  }

  _pad() { return this.getPadding ? this.getPadding() : { top: 70, left: 40, right: 40, bottom: 40 }; }

  // ------------------------------------------------------------ fontes e camadas
  _source(src) {
    const map = this.map;
    if (map.getSource(src)) return;
    const data = src === 'br-uf' ? BR.states : src === 'br-mun' ? BR.mun : src === 'local' || src === 'secao' ? comGeometria(src) : D.lv[src].fc;
    map.addSource(src, { type: 'geojson', data, promoteId: 'id', buffer: 16, tolerance: src === 'br-mun' ? 0.5 : 0.3 });
  }

  addLevel(level) {
    if (this.ready.has(level)) return;
    const map = this.map, lay = { fill: [], line: [], hl: [] };
    for (const part of PARTS[level]) {
      this._source(part.src);
      const id = layerId(level, part), base = { source: part.src, ...(part.filter ? { filter: part.filter } : {}) };
      const own = { level: part.lv, src: part.src };
      const add = (spec, before) => { map.addLayer(spec, before); this.layerOwner.set(spec.id, own); };
      add({ ...base, id: `${id}-fill`, type: 'fill', layout: { visibility: 'none' }, paint: { 'fill-color': '#444', 'fill-opacity': 1 } }, 'mask-fill');
      add({ ...base, id: `${id}-line`, type: 'line', layout: { visibility: 'none', 'line-join': 'round' }, paint: { 'line-color': BG, 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.3, 8, 0.6, 13, 1] } }, 'sel-glow');
      const hov = (w) => ['case', ['boolean', ['feature-state', 'hover'], false], w, 0];
      add({ ...base, id: `${id}-hl`, type: 'line', layout: { visibility: 'none', 'line-join': 'round' }, paint: { 'line-color': BG, 'line-width': hov(4.5) } }, 'sel-glow');
      add({ ...base, id: `${id}-hl2`, type: 'line', layout: { visibility: 'none', 'line-join': 'round' }, paint: { 'line-color': '#fafaf9', 'line-width': hov(1.8) } }, 'sel-glow');
      lay.fill.push(`${id}-fill`); lay.line.push(`${id}-line`); lay.hl.push(`${id}-hl`, `${id}-hl2`);
    }
    this.levelLayers[level] = lay;
    this.ready.add(level);
    this._applyView(true);
  }

  /** Contorno dos estados por cima dos municípios no modo Brasil. */
  _ufOutline() {
    if (this.map.getLayer('uf-outline')) return;
    this._source('br-uf');
    this.map.addLayer({ id: 'uf-outline', source: 'br-uf', type: 'line', layout: { visibility: 'none' }, paint: { 'line-color': BG, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 6, 1.8] } }, 'sel-glow');
  }

  /** Chegaram polígonos de locais/seções de mais um município: atualiza as fontes e repinta. */
  refreshFine() {
    for (const src of ['local', 'secao']) {
      const s = this.map.getSource(src);
      if (s) { s.setData(comGeometria(src)); this.painted.delete(src); }
    }
    this._applyView(true);
  }

  _initSelection() {
    const map = this.map;
    map.addSource('mask', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'mask-fill', source: 'mask', type: 'fill', paint: { 'fill-color': BG, 'fill-opacity': 0.94, 'fill-antialias': false } });
    map.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'sel-glow', source: 'sel', type: 'line', paint: { 'line-color': '#fafaf9', 'line-width': 8, 'line-blur': 8, 'line-opacity': 0.22 } });
    map.addLayer({ id: 'sel-case', source: 'sel', type: 'line', paint: { 'line-color': BG, 'line-width': 4.5 }, layout: { 'line-join': 'round' } });
    map.addLayer({ id: 'sel-line', source: 'sel', type: 'line', paint: { 'line-color': '#fafaf9', 'line-width': 1.8 }, layout: { 'line-join': 'round' } });
  }

  _initLabels() {
    this.map.addSource('labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    this.map.addLayer({
      id: 'labels-sym', source: 'labels', type: 'symbol',
      layout: { 'text-field': ['get', 'n'], 'text-font': FONT, 'text-size': 12, 'text-max-width': 8, 'text-line-height': 1.1, 'text-optional': true, 'symbol-sort-key': ['*', -1, ['get', 'ap']], 'text-padding': 3 },
      paint: { 'text-color': ['get', 'tc'], 'text-halo-color': ['get', 'hc'], 'text-halo-width': 1.3 },
    });
  }

  // ------------------------------------------------------------ modo e pintura
  /** "br" = Brasil (estados e municípios); "uf" = dentro de um estado. */
  setModo(modo) {
    this.modo = modo;
    if (modo === 'br') { this.addLevel('uf'); this._ufOutline(); }
    this._applyView(true);
  }

  /** Remove as camadas e fontes do estado anterior (troca de UF). */
  clearUF() {
    const map = this.map;
    for (const level of UF_LEVELS) {
      const lay = this.levelLayers[level];
      if (!lay) continue;
      for (const id of [...lay.fill, ...lay.line, ...lay.hl]) { if (map.getLayer(id)) map.removeLayer(id); this.layerOwner.delete(id); }
      delete this.levelLayers[level];
      this.ready.delete(level);
      this.painted.delete(level);
    }
    for (const src of UF_LEVELS) if (map.getSource(src)) map.removeSource(src);
    if (this.hover && UF_LEVELS.includes(this.hover.src)) this.hover = null;
  }

  setPaint(paint) { this.paint = paint; this.ver++; this._applyView(true); }


  _paintLevel(level) {
    const lay = this.levelLayers[level];
    if (!lay || !this.paint || this.painted.get(level) === this.ver) return;
    const { palette, none } = this.paint;
    const expr = ['match', ['coalesce', ['feature-state', 'k'], -1], ...palette.flatMap((c, i) => [i, c]), -2, FORA, none];
    PARTS[level].forEach((part, i) => {
      this.map.setPaintProperty(lay.fill[i], 'fill-color', expr);
      for (const f of featuresOf(part.src)) {
        if (part.filter && f.properties.bb) continue;
        this.map.setFeatureState({ source: part.src, id: f.properties.id }, { k: this.paint.k(part.lv, f.properties.id) });
      }
    });
    this.painted.set(level, this.ver);
  }

  // ------------------------------------------------------------ foco na seleção
  setFocus(geom) {
    this.activeFocus = geom || null;
    if (geom) { const b = bboxGeom(geom); this._focusBox = [b[0][0], b[0][1], b[1][0], b[1][1]]; }
    const area = (r) => r.reduce((a, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return a + (x * y2 - x2 * y); }, 0);
    const cw = (r) => (area(r) > 0 ? r.slice().reverse() : r);
    const outers = geom ? (geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map((p) => p[0])) : [];
    const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
    this.map.getSource('mask')?.setData({ type: 'FeatureCollection', features: geom ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, ...outers.map(cw)] } }] : [] });
    this._applyView(true);
  }

  _inFocus(lng, lat) {
    if (!this.activeFocus) return true;
    const [w, s, e, n] = this._focusBox;
    return lng >= w && lng <= e && lat >= s && lat <= n && pointInGeometry(lng, lat, this.activeFocus);
  }

  // ------------------------------------------------------------ nível / visão
  _computeView() {
    if (this.modo === 'br') return { poly: this.ready.has('brmun') && this.map.getZoom() >= 4.4 ? 'brmun' : 'uf' };
    let poly = this.mode === 'auto' ? AUTO_POLY.find(([zmax]) => this.map.getZoom() < zmax)[1] : this.mode;
    if (this.mode === 'auto' && this.minLevel && ORDEM.indexOf(poly) < ORDEM.indexOf(this.minLevel)) poly = this.minLevel;
    const clamped = this.paint?.clamp?.[poly] || poly;
    const ok = (l) => this.ready.has(l) && ((l !== 'local' && l !== 'secao') || D.munPolys.size > 0);
    return { poly: ok(clamped) ? clamped : ok(poly) ? poly : 'municipio', want: poly };
  }

  setMode(mode) { this.mode = mode; this._applyView(true); }
  setMinLevel(level) { this.minLevel = level || null; }

  _setVis(ids, on) {
    for (const id of ids) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  _applyView(force = false) {
    if (!this.map) return;
    const next = this._computeView();
    const sig = [this.modo, next.poly, this.ver, [...this.ready].join(''), this.activeFocus ? this._focusBox.join() : ''].join('|');
    if (!force && sig === this._sig) return;
    const mudou = next.poly !== this.view.poly;
    this._sig = sig;
    this.view = next;
    const fine = next.poly === 'local' || next.poly === 'secao';
    for (const [level, lay] of Object.entries(this.levelLayers)) {
      const show = next.poly === level;
      this._setVis(lay.fill, show); this._setVis(lay.line, show); this._setVis(lay.hl, show);
      if (show) {
        this._paintLevel(level);
        for (const id of lay.fill) this.map.setPaintProperty(id, 'fill-opacity', fine ? 0.95 : ['interpolate', ['linear'], ['zoom'], 9, 1, 13, 0.85, 16, 0.6]);
      }
    }
    // em local/seção, os municípios ficam por baixo (atenuados): onde o detalhe ainda não chegou, o mapa não some
    if (fine && this.levelLayers.municipio) {
      const mun = this.levelLayers.municipio;
      this._paintLevel('municipio');
      this._setVis(mun.fill, true); this._setVis(mun.line, true);
      for (const id of mun.fill) this.map.setPaintProperty(id, 'fill-opacity', 1); // a cor do município segura até o detalhe chegar
    }
    this._setVis(['uf-outline'], this.modo === 'br' && next.poly === 'brmun');
    this._labels();
    if (force || mudou) this.cb.onView?.({ ...next, modo: this.modo, mode: this.mode });
  }

  _labels() {
    const src = this.map.getSource('labels');
    if (!src) return;
    const level = this.view.poly;
    if (!this.paint || !this.levelLayers[level]) { src.setData({ type: 'FeatureCollection', features: [] }); return; }
    const { palette, none, k, label } = this.paint;
    const feats = [];
    for (const part of PARTS[level]) {
      for (const f of featuresOf(part.src)) {
        const p = f.properties;
        if ((part.filter && p.bb) || p.lx == null || !this._inFocus(p.lx, p.ly)) continue;
        const c = k(part.lv, p.id);
        if (c === -2) continue;
        const dark = luminance(c >= 0 ? palette[c] : none) > 0.3;
        const nome = level === 'uf' ? p.uf.toUpperCase() : p.n;
        feats.push({ type: 'Feature', properties: { n: nome, ap: p.ap || p.cp || 0, v: label(part.lv, p) || '', tc: dark ? '#0f0e0d' : '#fafaf9', hc: dark ? 'rgba(250,250,249,0.55)' : 'rgba(15,14,13,0.7)' }, geometry: { type: 'Point', coordinates: [p.lx, p.ly] } });
      }
    }
    src.setData({ type: 'FeatureCollection', features: feats });
    const temValor = feats.some((f) => f.properties.v);
    this.map.setLayoutProperty('labels-sym', 'text-field', temValor
      ? ['format', ['get', 'n'], { 'text-font': ['literal', FONT_REG], 'font-scale': 0.9 }, '\n', {}, ['get', 'v'], { 'text-font': ['literal', FONT], 'font-scale': 1.08 }]
      : ['get', 'n']);
    const sz = LABEL_SIZE[level];
    this.map.setLayoutProperty('labels-sym', 'text-size', ['interpolate', ['linear'], ['zoom'], 4, sz * 0.75, 12, sz, 16, sz * 1.2]);
    this.map.setLayerZoomRange('labels-sym', LABEL_MINZOOM[level] || 0, 24);
  }

  // ------------------------------------------------------------ interação
  _events() {
    const map = this.map;
    let raf = 0;
    map.on('mousemove', (e) => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; this._setHover(this._pick(e.point), e.point); }); });
    map.on('mouseout', () => this._setHover(null));
    map.on('movestart', () => this._setHover(null));
    map.on('click', (e) => { const hit = this._pick(e.point); if (hit) this.cb.onPick?.(hit); else this.cb.onEmpty?.(); });
    let zraf = 0;
    map.on('zoom', () => { if (zraf) return; zraf = requestAnimationFrame(() => { zraf = 0; if (this.mode === 'auto' || this.modo === 'br') this._applyView(); }); });
    map.on('moveend', () => { this._applyView(); this.cb.onMoveEnd?.(); });
  }

  _pick(point) {
    const map = this.map;
    const layers = (this.levelLayers[this.view.poly]?.fill || []).filter((id) => map.getLayer(id));
    if (!layers.length) return null;
    if (this.activeFocus) { const ll = map.unproject(point); if (!this._inFocus(ll.lng, ll.lat)) return null; }
    if (map.getZoom() < 6) return this._pickGeo(point); // longe demais a consulta do MapLibre não é confiável
    const hits = map.queryRenderedFeatures(point, { layers });
    if (!hits.length) return this._pickGeo(point);
    const owner = this.layerOwner.get(hits[0].layer.id);
    return { level: owner.level, id: hits[0].properties.id, src: owner.src };
  }

  _pickGeo(point) {
    const { lng, lat } = this.map.unproject(point);
    for (const part of PARTS[this.view.poly] || []) {
      for (const f of featuresOf(part.src)) {
        if (!f.geometry || (part.filter && f.properties.bb)) continue;
        const b = f._bb || (f._bb = bboxGeom(f.geometry));
        if (lng < b[0][0] || lng > b[1][0] || lat < b[0][1] || lat > b[1][1]) continue;
        if (pointInGeometry(lng, lat, f.geometry)) return { level: part.lv, id: f.properties.id, src: part.src };
      }
    }
    return null;
  }

  _setHover(hit, point) {
    const prev = this.hover;
    const same = prev && hit && prev.src === hit.src && prev.id === hit.id;
    if (!same) {
      if (prev && this.map.getSource(prev.src)) this.map.setFeatureState({ source: prev.src, id: prev.id }, { hover: false });
      if (hit) this.map.setFeatureState({ source: hit.src, id: hit.id }, { hover: true });
      this.hover = hit;
      this.map.getCanvas().style.cursor = hit ? 'pointer' : '';
    }
    this.cb.onHover?.(hit, point);
  }

  // ------------------------------------------------------------ seleção e câmera
  setSelection(level, id) {
    const src = this.map.getSource('sel');
    if (!src) return;
    const f = level && !['estado', 'br'].includes(level) ? getFeature(level, id) : null;
    src.setData({ type: 'FeatureCollection', features: f?.geometry ? [{ type: 'Feature', properties: {}, geometry: f.geometry }] : [] });
  }

  fitBounds(b, { maxZoom = 13, duration } = {}) {
    if (!b) return;
    this.map.fitBounds(b, { padding: this._pad(), duration: reduceMotion() ? 0 : (duration ?? 900), maxZoom });
  }

  fit(level, id, opts = {}) {
    if (level === 'br') return this.fitBounds(BRASIL, { maxZoom: 5, ...opts });
    this.fitBounds(bboxOf(level, id), { maxZoom: { bairro: 15, local: 16.6, secao: 18 }[level] || 13, ...opts });
  }

  /** Municípios cujo retângulo cruza a tela (para baixar os polígonos de locais e seções). */
  municipiosVisiveis() {
    const b = this.map.getBounds();
    const out = [];
    for (const f of D.lv.municipio.fc?.features || []) {
      const bb = f._bb || (f._bb = bboxGeom(f.geometry));
      if (bb[1][0] < b.getWest() || bb[0][0] > b.getEast() || bb[1][1] < b.getSouth() || bb[0][1] > b.getNorth()) continue;
      out.push(f.properties.id);
    }
    return out;
  }

  camera() { const c = this.map.getCenter(); return { lng: +c.lng.toFixed(4), lat: +c.lat.toFixed(4), z: +this.map.getZoom().toFixed(2) }; }
  jump({ lng, lat, z }) { this.map.jumpTo({ center: [lng, lat], zoom: z }); }
  resize() { this.map?.resize(); }
}
