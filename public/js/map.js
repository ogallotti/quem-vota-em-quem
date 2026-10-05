// Mapa (MapLibre GL): camadas por nível, nível automático pelo zoom, foco na seleção, hover e rótulos.
// As cores mudam a cada par (X, Y): a classe de cada área é calculada em JS e vai para o feature-state "k";
// a camada pinta com `match` sobre a paleta da lente.
import { D, POLY_LEVELS, bboxOf, getFeature, pointInGeometry } from './data.js';
import { luminance } from './scales.js';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const FONT = ['Noto Sans Bold'];
const FONT_REG = ['Noto Sans Regular'];

// Partes (fonte + filtro) de cada nível poligonal. O nível "bairro" completa o mapa com os municípios sem subdivisão.
const PARTS = {
  macro: [{ src: 'macro', lv: 'macro' }],
  municipio: [{ src: 'municipio', lv: 'municipio' }],
  zona: [{ src: 'zona', lv: 'zona' }],
  bairro: [{ src: 'bairro', lv: 'bairro' }, { src: 'municipio', lv: 'municipio', filter: ['==', ['get', 'bb'], 0], suffix: 'm' }],
  local: [{ src: 'local', lv: 'local' }],
  secao: [{ src: 'secao', lv: 'secao' }],
};
const LABEL_SIZE = { macro: 17, municipio: 12, zona: 13, bairro: 11, local: 11, secao: 12 };
const LABEL_MINZOOM = { local: 13.4, secao: 15.6 };
// zoom → nível (modo Auto)
const AUTO_POLY = [[6.9, 'macro'], [9.3, 'municipio'], [10.3, 'zona'], [12.0, 'bairro'], [14.3, 'local'], [Infinity, 'secao']];
const ORDEM = ['macro', 'municipio', 'zona', 'bairro', 'local', 'secao'];

function bboxGeom(g) {
  let w = 181, s = 91, e = -181, n = -91;
  const walk = (c) => { if (typeof c[0] === 'number') { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; } else for (const x of c) walk(x); };
  walk(g.coordinates);
  return [w, s, e, n];
}
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const layerId = (level, part) => `${level}${part.suffix || ''}`;

export class MapView {
  constructor({ container, onHover, onPick, onEmpty, onView, getPadding, lite = false, pixelRatio = null }) {
    Object.assign(this, { container, lite, pixelRatio, getPadding });
    this.cb = { onHover, onPick, onEmpty, onView };
    this.mode = 'auto';
    this.view = { poly: 'macro' };
    this.layerOwner = new Map();
    this.levelLayers = {};
    this.ready = new Set();
    this.paint = null; // { palette, none, k(level, id), label(level, props), clamp }
    this.painted = new Map(); // nível → versão da pintura aplicada
    this.ver = 0;
  }

  async init() {
    const estiloVazio = () => ({
      version: 8, sources: {}, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0c0c0c' } }],
    });
    let style;
    if (this.lite) style = estiloVazio(); // celular: sem mapa-base de terceiros (bateria, dados e memória)
    else {
      try {
        const r = await fetch(STYLE_URL);
        if (!r.ok) throw new Error(r.status);
        style = await r.json();
      } catch (err) {
        console.warn('Mapa-base indisponível, seguindo sem ele:', err);
        style = estiloVazio();
      }
    }
    for (const l of style.layers) {
      if (/^place_(state|country|city|town|village|other)/.test(l.id) || l.id === 'place_city_large') l.minzoom = Math.max(l.minzoom || 0, 11.2);
      const paint = (l.paint = l.paint || {});
      // ruas e prédios viram traços claros e translúcidos, abaixo dos polígonos
      if (l.type === 'line' && (l['source-layer'] === 'transportation' || /^(railway|aeroway)/.test(l.id)) && !/^boundary/.test(l.id)) {
        if (/casing/.test(l.id) || l.id === 'road_pier') paint['line-opacity'] = 0;
        else { paint['line-color'] = 'rgba(255,255,255,0.17)'; paint['line-opacity'] = 1; }
      } else if (l.type === 'symbol' && /^road_oneway/.test(l.id)) paint['icon-opacity'] = 0;
      else if (l.type === 'symbol' && /^(highway_name|place_|water_name)/.test(l.id)) { paint['text-color'] = 'rgba(128,128,138,0.8)'; paint['text-halo-width'] = 0; }
      else if (l.type === 'fill' && /^(building|aeroway-area|road_area_pier)$/.test(l.id)) { paint['fill-color'] = 'rgba(255,255,255,0.09)'; paint['fill-outline-color'] = 'rgba(255,255,255,0.14)'; }
    }
    this.maskAnchor = style.layers.some((l) => l.id === 'highway_name_other') ? 'highway_name_other' : undefined;
    this.map = new maplibregl.Map({
      container: this.container, style, bounds: D.meta.bounds, fitBoundsOptions: { padding: this._pad() },
      minZoom: 3.2, maxZoom: 20, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0,
      renderWorldCopies: false, pixelRatio: this.pixelRatio || Math.min(window.devicePixelRatio || 1, this.lite ? 2 : 3),
    });
    window.__map = this.map; // depuração e testes
    this.map.touchZoomRotate.disableRotation();
    this.map.on('error', (e) => console.error('[mapa]', e.error?.message || e.error || e));
    this.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Dados: TSE 2026 · malhas IBGE · © OpenStreetMap' }), 'bottom-right');
    if (!this.lite) this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    await new Promise((res) => this.map.once('load', res));
    if (this.lite) this.map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    this._initSelection();
    this._initLabels();
    this._events();
    return this;
  }

  _pad() { return this.getPadding ? this.getPadding() : { top: 70, left: 40, right: 40, bottom: 40 }; }

  // ------------------------------------------------------------ fontes e camadas
  addPolyLevel(level) {
    if (this.ready.has(level)) return;
    const map = this.map, lay = { fill: [], line: [], hl: [] };
    for (const part of PARTS[level]) {
      const src = part.src;
      if (!map.getSource(src)) map.addSource(src, { type: 'geojson', data: D.lv[src].fc, promoteId: 'id', buffer: 16, tolerance: 0.3 });
      const id = layerId(level, part);
      const base = { source: src, ...(part.filter ? { filter: part.filter } : {}) };
      const own = { level: part.lv, src };
      const add = (spec, before) => { map.addLayer(spec, before); this.layerOwner.set(spec.id, own); };
      add({ ...base, id: `${id}-fill`, type: 'fill', layout: { visibility: 'none' }, paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.94 } }, 'mask-fill');
      add({ ...base, id: `${id}-line`, type: 'line', layout: { visibility: 'none', 'line-join': 'round' }, paint: { 'line-color': 'rgba(10,10,10,0.5)', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 0.8, 13, 1.1] } }, 'sel-glow');
      // realce com "casing": filete escuro por baixo e branco por cima, legível sobre qualquer cor
      const hov = (w) => ['case', ['boolean', ['feature-state', 'hover'], false], w, 0];
      add({ ...base, id: `${id}-hl`, type: 'line', layout: { visibility: 'none', 'line-join': 'round' }, paint: { 'line-color': '#0a0a0a', 'line-width': hov(5), 'line-opacity': 0.9 } }, 'sel-glow');
      add({ ...base, id: `${id}-hl2`, type: 'line', layout: { visibility: 'none', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': hov(2.2) } }, 'sel-glow');
      lay.fill.push(`${id}-fill`); lay.line.push(`${id}-line`); lay.hl.push(`${id}-hl`, `${id}-hl2`);
    }
    this.levelLayers[level] = lay;
    this.ready.add(level);
    this._applyView(true);
  }

  _initSelection() {
    const map = this.map;
    // véu que "apaga" tudo fora da região em foco (mesma cor do fundo)
    map.addSource('mask', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'mask-fill', source: 'mask', type: 'fill', paint: { 'fill-color': '#0c0c0c', 'fill-opacity': 0.97, 'fill-antialias': false } }, this.maskAnchor);
    map.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'sel-glow', source: 'sel', type: 'line', paint: { 'line-color': '#6da7ec', 'line-width': 9, 'line-blur': 7, 'line-opacity': 0.75 } });
    map.addLayer({ id: 'sel-case', source: 'sel', type: 'line', paint: { 'line-color': '#0a0a0a', 'line-width': 5.4, 'line-opacity': 0.9 }, layout: { 'line-join': 'round' } });
    map.addLayer({ id: 'sel-line', source: 'sel', type: 'line', paint: { 'line-color': '#ffffff', 'line-width': 2.4 }, layout: { 'line-join': 'round' } });
  }

  _initLabels() {
    this.map.addSource('labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    this.map.addLayer({
      id: 'labels-sym', source: 'labels', type: 'symbol',
      layout: {
        'text-field': ['get', 'n'], 'text-font': FONT, 'text-size': 13, 'text-max-width': 8, 'text-line-height': 1.15,
        'text-optional': true, 'symbol-sort-key': ['*', -1, ['get', 'ap']], 'text-padding': 2,
      },
      paint: { 'text-color': ['get', 'tc'], 'text-halo-color': ['get', 'hc'], 'text-halo-width': 1.5 },
    });
  }

  // ------------------------------------------------------------ pintura
  /** Define a pintura: paleta, classe de cada área (k) e rótulo. Aplicada a todos os níveis prontos. */
  setPaint(paint) {
    this.paint = paint;
    this.ver++;
    this._applyView(true);
  }

  _paintLevel(level) {
    const lay = this.levelLayers[level];
    if (!lay || !this.paint || this.painted.get(level) === this.ver) return;
    const { palette, none } = this.paint;
    // −2 = fora do recorte (dentro do foco, mas não faz parte da seleção): quase o fundo
    const expr = ['match', ['coalesce', ['feature-state', 'k'], -1], ...palette.flatMap((c, i) => [i, c]), -2, '#2a2a28', none];
    PARTS[level].forEach((part, i) => {
      this.map.setPaintProperty(lay.fill[i], 'fill-color', expr);
      for (const f of D.lv[part.src].fc.features) {
        if (part.filter && f.properties.bb) continue;
        this.map.setFeatureState({ source: part.src, id: f.properties.id }, { k: this.paint.k(part.lv, f.properties.id) });
      }
    });
    this.painted.set(level, this.ver);
  }

  // ------------------------------------------------------------ foco na seleção
  setFocus(geom) {
    this.activeFocus = geom || null;
    if (geom) this._focusBox = bboxGeom(geom);
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
    let poly = this.mode === 'auto' ? AUTO_POLY.find(([zmax]) => this.map.getZoom() < zmax)[1] : this.mode;
    // no modo Auto, a seleção pede ao menos o nível logo abaixo dela (região → municípios etc.): senão ela vira um bloco só
    if (this.mode === 'auto' && this.minLevel && ORDEM.indexOf(poly) < ORDEM.indexOf(this.minLevel)) poly = this.minLevel;
    const clamped = this.paint?.clamp?.[poly] || poly;
    return { poly: this.ready.has(clamped) ? clamped : this.ready.has(poly) ? poly : 'municipio', want: poly };
  }

  setMode(mode) { this.mode = mode; this._applyView(true); }

  /** Nível mínimo exibido no modo Auto (o das subunidades da seleção). */
  setMinLevel(level) { this.minLevel = level || null; }

  _setVis(ids, on) {
    for (const id of ids) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  _applyView(force = false) {
    if (!this.map) return;
    const next = this._computeView();
    const sig = [next.poly, this.ver, [...this.ready].join(''), this.activeFocus ? this._focusBox.join() : ''].join('|');
    if (!force && sig === this._sig) return;
    const mudouNivel = next.poly !== this.view.poly;
    this._sig = sig;
    this.view = next;
    const fine = next.poly === 'local' || next.poly === 'secao';
    for (const level of POLY_LEVELS.concat(['local', 'secao'])) {
      const lay = this.levelLayers[level];
      if (!lay) continue;
      const show = next.poly === level;
      this._setVis(lay.fill, show); this._setVis(lay.line, show); this._setVis(lay.hl, show);
      if (show) {
        this._paintLevel(level);
        const op = fine ? 0.92 : ['interpolate', ['linear'], ['zoom'], 9, 0.96, 12.5, 0.8, 15.5, 0.5];
        for (const id of lay.fill) this.map.setPaintProperty(id, 'fill-opacity', op);
        for (const id of lay.line) this.map.setPaintProperty(id, 'line-width', fine ? ['interpolate', ['linear'], ['zoom'], 12, 0.3, 16, 0.9, 19, 1.6] : ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 0.8, 13, 1.1]);
      }
    }
    // em local/seção, o contorno dos municípios dá o contexto
    if (fine && this.levelLayers.municipio) { this._setVis(this.levelLayers.municipio.line, true); this._setVis(this.levelLayers.municipio.hl, true); }
    this._labels();
    if (force || mudouNivel) this.cb.onView?.({ ...next, mode: this.mode });
  }

  _labels() {
    const src = this.map.getSource('labels');
    if (!src) return;
    const level = this.view.poly;
    if (!this.paint || !D.lv[level]?.ready) { src.setData({ type: 'FeatureCollection', features: [] }); return; }
    const { palette, none, k, label } = this.paint;
    const feats = [];
    const push = (lv, f) => {
      const p = f.properties;
      if (p.lx == null || !this._inFocus(p.lx, p.ly)) return;
      const c = k(lv, p.id);
      if (c === -2) return;
      const dark = luminance(c >= 0 ? palette[c] : none) > 0.32; // fundo claro → texto escuro
      feats.push({ type: 'Feature', properties: { n: p.n, ap: p.ap, v: label(lv, p) || '', tc: dark ? '#0d0d0d' : '#ffffff', hc: dark ? 'rgba(255,255,255,0.8)' : 'rgba(8,8,8,0.85)' }, geometry: { type: 'Point', coordinates: [p.lx, p.ly] } });
    };
    for (const part of PARTS[level]) for (const f of D.lv[part.src].fc.features) if (!(part.filter && f.properties.bb)) push(part.lv, f);
    src.setData({ type: 'FeatureCollection', features: feats });
    const temValor = feats.some((f) => f.properties.v);
    this.map.setLayoutProperty('labels-sym', 'text-field', temValor
      ? ['format', ['get', 'n'], { 'text-font': ['literal', FONT_REG], 'font-scale': 0.88 }, '\n', {}, ['get', 'v'], { 'text-font': ['literal', FONT], 'font-scale': 1.12 }]
      : ['get', 'n']);
    this.map.setLayoutProperty('labels-sym', 'text-size', ['interpolate', ['linear'], ['zoom'], 5, LABEL_SIZE[level] * 0.7, 12, LABEL_SIZE[level], 16, LABEL_SIZE[level] * 1.25]);
    this.map.setLayerZoomRange('labels-sym', LABEL_MINZOOM[level] || 0, 24);
  }

  // ------------------------------------------------------------ interação
  _events() {
    const map = this.map;
    let raf = 0;
    map.on('mousemove', (e) => { this._lastPoint = e.point; if (raf) return; raf = requestAnimationFrame(() => { raf = 0; this._setHover(this._pick(e.point), e.point); }); });
    map.on('mouseout', () => this._setHover(null));
    map.on('movestart', () => this._setHover(null));
    map.on('click', (e) => { const hit = this._pick(e.point); if (hit) this.cb.onPick?.(hit); else this.cb.onEmpty?.(); });
    let zraf = 0;
    map.on('zoom', () => { if (zraf) return; zraf = requestAnimationFrame(() => { zraf = 0; if (this.mode === 'auto') this._applyView(); }); });
    map.on('zoomend', () => this._applyView());
  }

  _pick(point) {
    const map = this.map;
    const lay = this.levelLayers[this.view.poly];
    const layers = (lay?.fill || []).filter((id) => map.getLayer(id));
    if (!layers.length) return null;
    if (this.activeFocus) { const ll = map.unproject(point); if (!this._inFocus(ll.lng, ll.lat)) return null; }
    // longe demais, a consulta do MapLibre não é confiável (volta vazia ou com tudo): vale a geometria
    if (map.getZoom() < 6) return this._pickGeo(point);
    const hits = map.queryRenderedFeatures(point, { layers });
    if (!hits.length) return this._pickGeo(point);
    const owner = this.layerOwner.get(hits[0].layer.id);
    return { level: owner.level, id: hits[0].properties.id, src: owner.src };
  }

  _pickGeo(point) {
    const level = this.view.poly;
    if (!D.lv[level]?.ready) return null;
    const { lng, lat } = this.map.unproject(point);
    for (const part of PARTS[level]) {
      for (const f of D.lv[part.src].fc.features) {
        if (!f.geometry || (part.filter && f.properties.bb)) continue;
        const b = f._bb || (f._bb = bboxGeom(f.geometry));
        if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
        if (pointInGeometry(lng, lat, f.geometry)) return { level: part.lv, id: f.properties.id, src: part.src };
      }
    }
    return null;
  }

  _setHover(hit, point) {
    const prev = this.hover;
    const same = prev && hit && prev.src === hit.src && prev.id === hit.id;
    if (!same) {
      if (prev) this.map.setFeatureState({ source: prev.src, id: prev.id }, { hover: false });
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
    const f = level && level !== 'estado' ? getFeature(level, id) : null;
    src.setData({ type: 'FeatureCollection', features: f?.geometry ? [{ type: 'Feature', properties: {}, geometry: f.geometry }] : [] });
  }

  fit(level, id, opts = {}) {
    const b = bboxOf(level, id);
    if (!b) return;
    const maxZoom = { bairro: 15, local: 16.8, secao: 18.4 }[level] || 13;
    this.map.fitBounds(b, { padding: this._pad(), duration: reduceMotion() ? 0 : (opts.duration ?? 1100), maxZoom });
  }

  camera() {
    const c = this.map.getCenter();
    return { lng: +c.lng.toFixed(4), lat: +c.lat.toFixed(4), z: +this.map.getZoom().toFixed(2) };
  }

  jump({ lng, lat, z }) { this.map.jumpTo({ center: [lng, lat], zoom: z }); }

  resize() { this.map?.resize(); }
}
