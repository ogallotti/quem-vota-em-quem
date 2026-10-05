// Lentes do mapa e paletas. Cada cor faz um único trabalho (skill dataviz):
//   luz e cor  Y é a luz (cinza ao branco), X é a cor (azul): azul claro e vivo = os dois fortes
//   bivariada  3×3 (X em azul, Y em amarelo, os dois fortes = verde), classes em relação à média do recorte
//   magnitude  sequencial de um matiz, do claro (pouco) ao saturado (muito); branco = nenhum voto
//   polaridade divergente rosa ↔ verde com meio cinza claro (correlação negativa ↔ positiva)
import { fPct } from './fmt.js';

export const NOVOTE = '#ffffff';
export const SEM_DADO = '#8a8983';
// cor de identidade de X e de Y em toda a interface (chips, eixos, legendas)
export const COR = { x: '#5b9cf0', y: '#f2efe8', xs: '#4a7fc0', ys: '#c9a92c' };

// Bivariada azul (X) × amarelo (Y), somados dão verde, no método de Joshua Stevens (2015). Índice = iy·3 + ix
// (0 abaixo da média, 1 na média, 2 acima): linha de baixo = Y fraco, coluna da direita = X forte.
export const BIV = ['#e8e8e8', '#b9cde6', '#6f9fd8', '#ece0a0', '#b5d0a4', '#5ea79a', '#e7c94a', '#a8c060', '#3f8f4f'];
export const BIV_TXT = [
  'Os dois fracos', 'X na média, Y fraco', 'Só X forte',
  'X fraco, Y na média', 'Os dois na média', 'X forte, Y na média',
  'Só Y forte', 'X na média, Y forte', 'Os dois fortes',
];

export const RAMP = {
  x: ['#e3edf9', '#c4d8f1', '#9ebfe7', '#6f9fd8', '#4a7fc0', '#33609a', '#234573'],
  y: ['#fbf5d8', '#f5e9a8', '#eedb72', '#e7c94a', '#c9a92c', '#9a8020', '#6b5915'],
};
// correlação: rosa (ao contrário) ↔ verde (juntos), segura para daltonismo (PiYG)
export const DIV = ['#c51b7d', '#de77ae', '#f1b6da', '#eceae4', '#b8e186', '#7fbc41', '#4d9221'];
export const R_CORTES = [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5];
export const R_TXT = ['−0,5 ou menos', '−0,5 a −0,3', '−0,3 a −0,1', 'nenhuma (±0,1)', '0,1 a 0,3', '0,3 a 0,5', '0,5 ou mais'];

// Votos dos dois (lente padrão): Y é a LUZ (do apagado ao claro, por quintis do eleitorado) e X é a COR (azul, da
// ausência à saturação máxima). Cores em OKLCH. Índice = faixa de Y (0–4) × 5 + faixa de X (0–4).
// O azul só atinge a saturação máxima numa luz média (L ≈ 0,72): acima disso ele desbota até o branco. Por isso a luz
// de cada linha desliza do cinza claro (sem X) até essa luz (X máximo): a casa "os dois fortes" é a mais saturada do
// mapa, e a saturação cresce com X em toda linha e com Y em toda coluna.
function oklchLin(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
/** OKLCH → hex, reduzindo a croma até caber na tela (o matiz e a luz ficam; só a saturação cede). */
function oklch(L, C, hDeg) {
  let lo = 0, hi = C;
  const cabe = (c) => oklchLin(L, c, hDeg).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  if (!cabe(C)) { for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (cabe(mid)) lo = mid; else hi = mid; } C = lo; }
  return '#' + oklchLin(L, C, hDeg).map((v) => { const g = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, g)) * 255).toString(16).padStart(2, '0'); }).join('');
}
export const YX_L = [0.24, 0.40, 0.56, 0.72, 0.88]; // luz de cada faixa de Y sem voto de X (cinza)
const YX_LB = [0.24, 0.355, 0.47, 0.585, 0.70]; // luz de cada faixa de Y com X máximo (até o pico de saturação do azul)
export const YX_F = [0, 0.32, 0.58, 0.82, 1]; // fração da saturação máxima que cabe na tela naquela luz
export const YX_H = 240;
/** Croma máxima de um matiz numa luz (busca binária no gamut sRGB). */
function cromaMax(L, hDeg) {
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (oklchLin(L, mid, hDeg).every((v) => v >= -1e-4 && v <= 1 + 1e-4)) lo = mid; else hi = mid; }
  return lo;
}
export const YX = YX_L.flatMap((Lg, fy) => YX_F.map((f, fx) => {
  const t = fx / (YX_F.length - 1), L = Lg + (YX_LB[fy] - Lg) * t;
  return oklch(L, f * cromaMax(L, YX_H), YX_H);
}));

export const LENTES = {
  yx: { id: 'yx', label: 'Votos dos dois', curto: 'Os dois', desc: 'Cada área mostra os dois candidatos ao mesmo tempo: quanto mais clara, mais votos de Y; quanto mais azul, mais votos de X. Azul-claro vivo = os dois fortes; escuro = nenhum dos dois.' },
  bi: { id: 'bi', label: 'Acima da média', curto: 'Acima da média', desc: 'Cada área comparada com a média do recorte: azul = só X acima da média, amarelo = só Y, verde = os dois. Muito verde e cinza, pouco azul e amarelo: os eleitorados coincidem.' },
  x: { id: 'x', label: 'Votos de X', curto: 'X', desc: 'Participação de X: votos ÷ eleitores que compareceram.' },
  y: { id: 'y', label: 'Votos de Y', curto: 'Y', desc: 'Participação de Y: votos ÷ eleitores que compareceram.' },
  r: { id: 'r', label: 'Correlação local', curto: 'r', clamp: { local: 'bairro', secao: 'bairro' }, desc: 'Dentro de cada área, X e Y sobem e descem juntos de um local de votação para outro? Verde = sim, rosa = ao contrário, cinza = sem relação. Mostra onde os votos andam juntos (coincidência, não causa).' },
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
