// Peças visuais reutilizadas: avatar (foto em sprite, ou iniciais na cor do partido), chip de candidato, ícones.
import { D, fotoDe } from './data.js';
import { h, svg } from './fmt.js';

// Cor de identificação de cada partido (logos oficiais, ajustadas para o fundo escuro). Só para anel e sigla.
export const PARTIDO = {
  PT: '#e5484d', PCDOB: '#d23f3a', 'PC DO B': '#d23f3a', PV: '#3fb36b', PSOL: '#f0a531', REDE: '#3fc3ae', PSB: '#f2c94c', PDT: '#dc4c92',
  PSTU: '#f38c8e', PCB: '#b7535d', PCO: '#c7514a', UP: '#e0703b',
  PL: '#4c6ef5', NOVO: '#f2994a', 'MISSÃO': '#cea608', PP: '#5fb8e0', 'UNIÃO': '#3d86d6', REPUBLICANOS: '#4181ad', PSD: '#e6b23a',
  MDB: '#2fa35c', PSDB: '#4aa3df', PODE: '#ab6bd6', PRD: '#14938d', SOLIDARIEDADE: '#f08a3c', AVANTE: '#3fb6c8', CIDADANIA: '#f0289b',
  DC: '#bc8c30', PRTB: '#28a650', MOBILIZA: '#8fae3b', AGIR: '#7d6bd6', DEMOCRATA: '#c86bb0', PMB: '#c86bb0',
};
export const corPartido = (sg) => PARTIDO[String(sg || '').toUpperCase()] || '#8c8577';

const iniciais = (nome) => String(nome || '?').split(/\s+/).filter((w) => w.length > 2 || /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** Avatar redondo: foto do candidato (sprite 8 × 64 px) ou iniciais. `size` em px. */
export function avatar(c, size = 36, extra = '') {
  const f = fotoDe(c);
  const el = h('span', { class: `av ${extra}`, style: { width: `${size}px`, height: `${size}px`, '--pc': corPartido(c?.partido) }, 'aria-hidden': 'true' });
  if (f) {
    const i = h('i', { style: { backgroundImage: `url(${f.url})`, backgroundSize: `${size * 8}px auto`, backgroundPosition: `${-(f.p % 8) * size}px ${-Math.floor(f.p / 8) * size}px` } });
    el.append(i);
  } else el.append(h('b', { style: { fontSize: `${Math.round(size * 0.36)}px` } }, iniciais(c?.nome)));
  return el;
}

export const cargoCurto = (cd) => ({ 1: 'Presidente', 3: 'Governador', 5: 'Senador', 6: 'Dep. federal', 7: 'Dep. estadual', 8: 'Dep. distrital' }[cd] || '');
export const situacao = (sit) => {
  const s = String(sit || '').toLowerCase();
  if (!s) return '';
  if (s.startsWith('eleito')) return 'eleito';
  if (s.includes('2º turno') || s.includes('2o turno') || s.includes('segundo')) return '2º turno';
  if (s.startsWith('suplente')) return 'suplente';
  return '';
};

/** Primeiro e último nome (para frases). */
export function curto(nome) {
  const p = String(nome || '').split(/\s+/);
  return p.length <= 2 ? nome : `${p[0]} ${p[p.length - 1]}`;
}

export const ICON = {
  busca: () => svg('svg', { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': 'true' }, svg('circle', { cx: 8.5, cy: 8.5, r: 5.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }), svg('path', { d: 'M13 13l4 4', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' })),
  trocar: () => svg('svg', { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': 'true' }, svg('path', { d: 'M6 4v12M6 16l-3-3M6 16l3-3M14 16V4M14 4l-3 3M14 4l3 3', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
  link: () => svg('svg', { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': 'true' }, svg('path', { d: 'M8.5 11.5l3-3M7 9.5l-1.6 1.6a2.8 2.8 0 004 4L11 13.5M13 10.5l1.6-1.6a2.8 2.8 0 00-4-4L9 6.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round' })),
  voltar: () => svg('svg', { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': 'true' }, svg('path', { d: 'M12 4l-6 6 6 6', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
  fechar: () => svg('svg', { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': 'true' }, svg('path', { d: 'M5 5l10 10M15 5L5 15', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' })),
  mais: () => svg('svg', { viewBox: '0 0 20 20', width: 14, height: 14, 'aria-hidden': 'true' }, svg('path', { d: 'M10 4v12M4 10h12', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' })),
  info: () => svg('svg', { viewBox: '0 0 20 20', width: 14, height: 14, 'aria-hidden': 'true' }, svg('circle', { cx: 10, cy: 10, r: 7.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }), svg('path', { d: 'M10 9v5M10 6.2v.1', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round' })),
};

/** Botão-chip de candidato (a pergunta no topo do painel). */
export function chipCand(lado, c, { onClick, rotulo }) {
  return h('button', { type: 'button', class: `cc cc-${lado}`, onclick: onClick, 'aria-label': `${rotulo}: ${c?.nome || 'escolher'}. Trocar` },
    c ? avatar(c, 44) : h('span', { class: 'av av-vazio' }, ICON.mais()),
    h('span', { class: 'cc-t', style: { '--pc': corPartido(c?.partido) } }, h('b', null, c?.nome || 'Escolher candidato'), h('span', null, c ? [`${cargoCurto(c.cargo)} · `, h('em', null, c.partido), ` ${c.n}`] : 'qualquer cargo')),
    h('span', { class: 'cc-i', 'aria-hidden': 'true' }, '▾'));
}

export const ufNome = (uf) => D.meta?.uf === uf?.toUpperCase() ? D.meta.uf_nome : uf?.toUpperCase();
