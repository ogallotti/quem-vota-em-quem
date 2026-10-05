// Lentes do mapa e paletas. Cada cor faz um único trabalho (skill dataviz):
//   bivariada  3×3 (X em ciano, Y em magenta, os dois fortes = azul-violeta escuro), classes em relação à média do recorte
//   magnitude  sequencial de um matiz, do claro (pouco) ao saturado (muito); branco = nenhum voto
//   polaridade divergente vermelho ↔ azul com meio cinza claro (correlação negativa ↔ positiva)
import { fPct } from './fmt.js';

export const NOVOTE = '#ffffff';
export const SEM_DADO = '#8a8983';
// cor de identidade de X e de Y em toda a interface (chips, eixos, legendas)
export const COR = { x: '#4fbcbc', y: '#d77fc2', xs: '#2a9a9f', ys: '#a94595' };

// Joshua Stevens, "Bivariate choropleth maps" (2015). Índice = iy·3 + ix (0 abaixo da média, 1 na média, 2 acima).
export const BIV = ['#e8e8e8', '#ace4e4', '#5ac8c8', '#dfb0d6', '#a5add3', '#5698b9', '#be64ac', '#8c62aa', '#3b4994'];
export const BIV_TXT = [
  'Os dois fracos', 'X na média, Y fraco', 'Só X forte',
  'X fraco, Y na média', 'Os dois na média', 'X forte, Y na média',
  'Só Y forte', 'X na média, Y forte', 'Os dois fortes',
];

export const RAMP = {
  x: ['#dff4f4', '#b5e6e6', '#84d4d4', '#4fbcbc', '#2a9a9f', '#1c767f', '#11545e'],
  y: ['#f7e1f1', '#eebfe2', '#df94cc', '#cc66b3', '#a94595', '#823075', '#5b1f53'],
};
export const DIV = ['#9c1a24', '#da534f', '#f5b5af', '#f0efec', '#c0dafc', '#3987e5', '#0b4a99'];
export const R_CORTES = [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5];
export const R_TXT = ['−0,5 ou menos', '−0,5 a −0,3', '−0,3 a −0,1', 'nenhuma (±0,1)', '0,1 a 0,3', '0,3 a 0,5', '0,5 ou mais'];

export const LENTES = {
  bi: { id: 'bi', label: 'Onde os dois são fortes', curto: 'X × Y', desc: 'Cada área comparada com a média do recorte: ciano = só X acima da média, magenta = só Y, azul-violeta escuro = os dois. Muito azul-violeta e cinza, pouco ciano e magenta: os eleitorados coincidem.' },
  x: { id: 'x', label: 'Votos de X', curto: 'X', desc: 'Participação de X: votos ÷ eleitores que compareceram.' },
  y: { id: 'y', label: 'Votos de Y', curto: 'Y', desc: 'Participação de Y: votos ÷ eleitores que compareceram.' },
  r: { id: 'r', label: 'Correlação local', curto: 'r', clamp: { local: 'bairro', secao: 'bairro' }, desc: 'Dentro de cada área, X e Y sobem e descem juntos de um local de votação para outro? Azul = sim, vermelho = ao contrário, cinza = sem relação. Mostra onde a dobradinha funciona.' },
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
