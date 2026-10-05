// Lentes do mapa e paletas. Cada cor faz um único trabalho (skill dataviz):
//   bivariada  3×3 (X em amarelo, Y em azul, os dois fortes = verde), classes em relação à média do recorte
//   magnitude  sequencial de um matiz, do claro (pouco) ao saturado (muito); branco = nenhum voto
//   polaridade divergente rosa ↔ verde com meio cinza claro (correlação negativa ↔ positiva)
import { fPct } from './fmt.js';

export const NOVOTE = '#ffffff';
export const SEM_DADO = '#8a8983';
// cor de identidade de X e de Y em toda a interface (chips, eixos, legendas)
export const COR = { x: '#e7c94a', y: '#6f9fd8', xs: '#c9a92c', ys: '#4a7fc0' };

// Bivariada amarelo × azul (somados dão verde), no método de Joshua Stevens (2015). Índice = iy·3 + ix
// (0 abaixo da média, 1 na média, 2 acima): linha de baixo = Y fraco, coluna da direita = X forte.
export const BIV = ['#e8e8e8', '#ece0a0', '#e7c94a', '#b9cde6', '#b5d0a4', '#a8c060', '#6f9fd8', '#5ea79a', '#3f8f4f'];
export const BIV_TXT = [
  'Os dois fracos', 'X na média, Y fraco', 'Só X forte',
  'X fraco, Y na média', 'Os dois na média', 'X forte, Y na média',
  'Só Y forte', 'X na média, Y forte', 'Os dois fortes',
];

export const RAMP = {
  x: ['#fbf5d8', '#f5e9a8', '#eedb72', '#e7c94a', '#c9a92c', '#9a8020', '#6b5915'],
  y: ['#e3edf9', '#c4d8f1', '#9ebfe7', '#6f9fd8', '#4a7fc0', '#33609a', '#234573'],
};
// correlação: rosa (ao contrário) ↔ verde (juntos), segura para daltonismo (PiYG)
export const DIV = ['#c51b7d', '#de77ae', '#f1b6da', '#eceae4', '#b8e186', '#7fbc41', '#4d9221'];
export const R_CORTES = [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5];
export const R_TXT = ['−0,5 ou menos', '−0,5 a −0,3', '−0,3 a −0,1', 'nenhuma (±0,1)', '0,1 a 0,3', '0,3 a 0,5', '0,5 ou mais'];

// "Onde X é forte": no território de X (X acima de 1,25× a média do recorte), cor cheia pela força de Y; fora dele, os
// mesmos três degraus atenuados (o contexto fica, sem competir com a resposta). Índices 0–2 dentro, 3–5 fora.
export const XT = ['#e7c94a', '#a8c060', '#3f8f4f', '#2c2b28', '#353b44', '#43526a'];

export const LENTES = {
  xt: { id: 'xt', label: 'Onde X é forte', curto: 'Onde X é forte', desc: 'Só o território de X (onde X passa de 1,25× a média do recorte) fica colorido, pela força de Y ali: amarelo = Y fraco, verde-claro = na média, verde = Y forte. Fora do território de X, tons atenuados.' },
  bi: { id: 'bi', label: 'Onde os dois são fortes', curto: 'X × Y', desc: 'Cada área comparada com a média do recorte: amarelo = só X acima da média, azul = só Y, verde = os dois. Muito verde e cinza, pouco amarelo e azul: os eleitorados coincidem.' },
  x: { id: 'x', label: 'Votos de X', curto: 'X', desc: 'Participação de X: votos ÷ eleitores que compareceram.' },
  y: { id: 'y', label: 'Votos de Y', curto: 'Y', desc: 'Participação de Y: votos ÷ eleitores que compareceram.' },
  r: { id: 'r', label: 'Correlação local', curto: 'r', clamp: { local: 'bairro', secao: 'bairro' }, desc: 'Dentro de cada área, X e Y sobem e descem juntos de um local de votação para outro? Verde = sim, rosa = ao contrário, cinza = sem relação. Mostra onde a dobradinha funciona.' },
};

/** Faixas de uma escala sequencial a partir dos cortes (quantis). */
export function classesSeq(ramp, cortes) {
  const n = cortes.length + 1;
  const pick = n >= ramp.length ? ramp : Array.from({ length: n }, (_, i) => ramp[Math.round((i * (ramp.length - 1)) / Math.max(1, n - 1))]);
  return pick.map((color, i) => ({
    color, from: i ? cortes[i - 1] : 0, to: i < cortes.length ? cortes[i] : Infinity,
    label: i === 0 ? `até ${fPct(cortes[0] * 100)}` : i === n - 1 ? `${fPct(cortes[i - 1] * 100)} ou mais` : `${fPct(cortes[i - 1] * 100)} – ${fPct(cortes[i] * 100)}`,
  }));
}

export function classeSeq(classes, v) {
  if (!(v > 0)) return -1;
  for (let i = 0; i < classes.length; i++) if (v < classes[i].to) return i;
  return classes.length - 1;
}

export function classeR(r) {
  if (r == null || Number.isNaN(r)) return -1;
  for (let i = 0; i < R_CORTES.length; i++) if (r < R_CORTES[i]) return i;
  return R_CORTES.length;
}

export function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

// Lula × Bolsonaro (mapa do Brasil): margem de Lula sobre o voto dado aos dois, do vermelho (Lula) ao azul (Bolsonaro)
export const LADO = ['#b4232a', '#e5484d', '#f19a9b', '#e6e3de', '#9fb2f7', '#4c6ef5', '#2a43b3'];
const LADO_CORTES = [0.3, 0.15, 0.05, -0.05, -0.15, -0.3];
/** Classe da margem de Lula ((Lula − Bolsonaro) ÷ (Lula + Bolsonaro)). */
export function classeLado(esq, dir) {
  const t = esq + dir;
  if (!(t > 0)) return -1;
  const m = (esq - dir) / t;
  for (let i = 0; i < LADO_CORTES.length; i++) if (m > LADO_CORTES[i]) return i;
  return LADO_CORTES.length;
}
