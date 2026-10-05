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

// "Onde X é forte" (valor × transparência, Roth et al. 2010): o BRILHO diz onde X é forte (quintis do eleitorado, do
// apagado ao cheio) e a COR diz como Y foi ali (amarelo = Y fraco, X sozinho; amarelo-esverdeado = na média; verde =
// Y forte, interseção). Índice = faixa de X (0 apagada … 4 cheia) × 3 + faixa de Y (0, 1, 2).
const BG_MAPA = [15, 14, 13];
export const XT_COR = ['#e7c94a', '#b3c35a', '#3f9a52'];
export const XT_ALFA = [0.12, 0.26, 0.45, 0.7, 1];
const mistura = (hex, a) => '#' + [1, 3, 5].map((i, k) => Math.round(BG_MAPA[k] + a * (parseInt(hex.slice(i, i + 2), 16) - BG_MAPA[k])).toString(16).padStart(2, '0')).join('');
export const XT = XT_ALFA.flatMap((a) => XT_COR.map((c) => mistura(c, a)));

// Bolhas: tamanho = votos de X no lugar; cor = força de Y ali (÷ média do recorte), do amarelo (X sozinho) ao verde (juntos)
export const BOLHA = ['#f2c94c', '#e3d48f', '#cfccc0', '#86c06e', '#3f9a52']; // amarelo · neutro · verde: só os desvios ganham cor
export const BOLHA_CORTES = [0.6, 0.85, 1.18, 1.65];
export const BOLHA_TXT = ['bem abaixo da média', 'abaixo da média', 'na média', 'acima da média', 'bem acima da média'];
export const classeBolha = (rel) => { let i = 0; while (i < BOLHA_CORTES.length && rel >= BOLHA_CORTES[i]) i++; return i; };

// Luz e cor: Y é a LUZ (escala de cinza, do apagado ao branco, por quintis do eleitorado) e X é a COR por cima
// (amarelo, da ausência à saturação máxima). Amarelo claro e vivo = os dois fortes. Cores em OKLCH, para a luminosidade
// ser percebida igual em todas as casas. Índice = faixa de Y (0–4) × 5 + faixa de X (0–4).
function oklch(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return '#' + lin.map((v) => { const g = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, g)) * 255).toString(16).padStart(2, '0'); }).join('');
}
export const YX_L = [0.25, 0.42, 0.59, 0.76, 0.94];
export const YX_C = [0, 0.05, 0.095, 0.14, 0.18];
export const YX = YX_L.flatMap((L) => YX_C.map((C) => oklch(L, C * Math.min(1, (L + 0.05) / 0.75), 96)));

export const LENTES = {
  yx: { id: 'yx', label: 'Luz e cor', curto: 'Luz e cor', desc: 'Luz = onde Y tem voto (branco onde mais tem, apagado onde não tem). Cor = onde X tem voto (amarelo mais vivo onde X é mais forte). Amarelo claro e vivo: os dois fortes.' },
  bo: { id: 'bo', label: 'Eleitores de X', curto: 'Bolhas', desc: 'Cada bolha são os eleitores de X naquele lugar (tamanho = votos de X). A cor diz como Y foi ali: amarelo = Y fraco (X sozinho), verde = Y forte (os dois juntos). Bolhas grandes e verdes: quem vota em X também vota em Y.' },
  xt: { id: 'xt', label: 'Onde X é forte', curto: 'Onde X é forte', desc: 'Brilho = onde X é forte (cheio nos 20% do eleitorado em que X vai melhor, apagando nos demais). Cor = como Y foi ali: amarelo = Y fraco, verde = Y forte. Área brilhante e verde: interseção.' },
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
