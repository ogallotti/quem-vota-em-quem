// Formatação pt-BR e helper de DOM. Todo texto vindo dos dados entra via textContent (nunca innerHTML).
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fInt = (n) => (n == null || !isFinite(n) ? '—' : nf0.format(Math.round(n)));
export const fSigned = (n) => (n == null || !isFinite(n) ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + nf0.format(Math.abs(Math.round(n))));

export function fPct(x) {
  if (x == null || !isFinite(x)) return '—';
  if (x === 0) return '0%';
  if (x < 0.01) return '<0,01%';
  return (x < 1 ? nf2.format(x) : nf1.format(x)) + '%';
}

export function fMult(x) {
  if (x == null || !isFinite(x)) return '—';
  return (x >= 10 ? nf0.format(x) : nf1.format(x)) + '×';
}

export function fCompact(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  const trim = (x) => x.replace(/,0$/, '');
  if (a >= 1e6) return trim(nf1.format(n / 1e6)) + ' mi';
  if (a >= 1e4) return trim(nf1.format(n / 1e3)) + ' mil';
  return nf0.format(Math.round(n));
}

export const ord = (n) => (n > 0 ? n + 'º' : '—');

export function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** h('div', {class:'x', onclick}, 'texto', outroNo) — cria elementos sem innerHTML. */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const svg = (tag, attrs, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
};

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
