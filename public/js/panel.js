// Painel da seleção (a resposta), dica do mapa, legenda e trilha.
import { A, cruzado, lado, rPorUnidade, recorte, valorDe } from './analise.js';
import { D, LEVEL_INFO, candOf, cargoOf, childrenOf, entityName, getProps, parentChain } from './data.js';
import { clear, fInt, fPct, h, svg } from './fmt.js';
import { BIV, BIV_TXT, COR, DIV, LENTES, R_TXT, SEM_DADO, classeR } from './scales.js';
import { BIV_CORTE, forca, leitura, terco } from './stats.js';

const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fR = (r) => (r == null || Number.isNaN(r) ? '—' : (r < 0 ? '−' : '') + nf2.format(Math.abs(r)));
const fX = (x) => (x == null ? '—' : nf2.format(x) + '×');
const fP = (x) => fPct(x * 100); // fração → "12,3%"
const fPP = (x) => `${x >= 0 ? '+' : '−'}${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Math.abs(x * 100))} p.p.`;
const kv = (k, v, strong) => h('div', { class: 'kv' + (strong ? ' strong' : '') }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));

/** Nome curto de um candidato, com o cargo quando ajuda. */
export const nomeCand = (key) => candOf(key)?.nome || key;
const cargoNome = (key) => D.cargos.get(cargoOf(key))?.nome || '';
const tag = (lado, key) => h('b', { class: `who who-${lado}` }, nomeCand(key));

/** Classe bivariada de uma unidade em relação a médias dadas. */
export function classeBiv(v, px, py) {
  if (!v) return -1;
  return terco(v.px, px) + 3 * terco(v.py, py);
}
const textoBiv = (k) => (k < 0 ? 'Sem eleitores' : BIV_TXT[k].replace('X', nomeCand(A.x)).replace('Y', nomeCand(A.y)));

// ------------------------------------------------------------------ dica do mapa
export class Tooltip {
  constructor(el) { this.el = el; this.last = ''; }

  show(level, id, point, ctx) {
    const p = getProps(level, id), v = valorDe(level, id);
    if (!p || !v) return this.hide();
    const key = `${level}:${id}:${A.ver}:${ctx.lente}`;
    if (key !== this.last) {
      this.last = key;
      const k = classeBiv(v, ctx.px, ctx.py);
      const rl = ctx.lente === 'r' ? rPorUnidade(level)[D.un[level].pos.get(id)] : null;
      clear(this.el).append(
        h('div', { class: 'tip-head' }, h('span', { class: 'chip lv' }, LEVEL_INFO[level].label),
          ctx.lente === 'r' ? h('span', { class: 'chip' }, `r local ${fR(rl)}`) : h('span', { class: 'chip biv' }, h('i', { style: { background: k >= 0 ? BIV[k] : SEM_DADO } }), textoBiv(k))),
        h('div', { class: 'tip-name' }, entityName(level, p)),
        h('div', { class: 'tip-grid' },
          kv(nomeCand(A.x), `${fInt(v.x)} · ${fP(v.px)}`, true), kv(nomeCand(A.y), `${fInt(v.y)} · ${fP(v.py)}`, true),
          kv('Média do recorte', `${fP(ctx.px)} · ${fP(ctx.py)}`), kv('Compareceram', fInt(v.dx))),
      );
    }
    this.el.hidden = false;
    const r = this.el.getBoundingClientRect();
    let x = point.x + 18, y = point.y + 18;
    if (x + r.width > innerWidth - 12) x = point.x - r.width - 18;
    if (y + r.height > innerHeight - 12) y = point.y - r.height - 18;
    this.el.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }

  hide() { this.el.hidden = true; this.last = ''; }
}

// ------------------------------------------------------------------ legenda
export function renderLegend(el, { lente, classes, escopo }) {
  clear(el);
  el.hidden = false;
  el.classList.toggle('legend-biv', lente === 'bi');
  el.classList.toggle('legend-cat', lente === 'r');
  const L = LENTES[lente];
  if (lente === 'bi') {
    const grade = h('div', { class: 'biv-grid', role: 'img', 'aria-label': 'Legenda bivariada: 3 faixas de X por 3 faixas de Y' });
    for (let iy = 2; iy >= 0; iy--) for (let ix = 0; ix < 3; ix++) grade.append(h('i', { style: { background: BIV[iy * 3 + ix] }, title: textoBiv(iy * 3 + ix) }));
    el.append(
      h('div', { class: 'legend-title' }, 'Onde cada um é forte ', h('span', null, `× média ${escopo}`)),
      h('div', { class: 'biv-wrap' },
        h('div', { class: 'biv-y' }, h('span', { class: 'who-y' }, nomeCand(A.y)), ' →'),
        grade,
        h('div', { class: 'biv-x' }, h('span', { class: 'who-x' }, nomeCand(A.x)), ' →')),
      h('div', { class: 'legend-ends' }, h('span', null, 'abaixo'), h('span', null, 'na média'), h('span', null, 'acima')),
      h('div', { class: 'legend-note' }, `Abaixo = menos de ${String(BIV_CORTE[0]).replace('.', ',')}× a média do recorte; acima = mais de ${String(BIV_CORTE[1]).replace('.', ',')}×. Zonas e bairros são aproximações (áreas em volta dos locais de votação).`),
    );
    return;
  }
  if (lente === 'r') {
    el.append(h('div', { class: 'legend-title' }, L.label, h('span', null, ' entre os locais de cada área')));
    const list = h('div', { class: 'legend-list' });
    DIV.slice().reverse().forEach((c, i) => list.append(h('div', { class: 'legend-row' }, h('i', { style: { background: c } }), R_TXT[DIV.length - 1 - i])));
    list.append(h('div', { class: 'legend-row' }, h('i', { style: { background: SEM_DADO } }), 'poucos locais'));
    el.append(list, h('div', { class: 'legend-bar' }, ...DIV.map((c) => h('i', { style: { background: c } }))), h('div', { class: 'legend-ends' }, h('span', null, 'ao contrário'), h('span', null, 'juntos')));
    return;
  }
  const quem = lente === 'x' ? A.x : A.y;
  el.append(h('div', { class: 'legend-title' }, h('span', { class: `who-${lente}` }, nomeCand(quem)), h('span', null, ' · % de quem compareceu')));
  const list = h('div', { class: 'legend-list' });
  list.append(h('div', { class: 'legend-row' }, h('i', { class: 'none', style: { background: '#ffffff' } }), 'Sem votos'));
  for (const c of classes) list.append(h('div', { class: 'legend-row' }, h('i', { style: { background: c.color } }), c.label));
  el.append(list, h('div', { class: 'legend-bar' }, ...classes.map((c) => h('i', { style: { background: c.color } }))),
    h('div', { class: 'legend-ends' }, h('span', null, classes[0]?.label || ''), h('span', null, classes[classes.length - 1]?.label || '')));
}

export function renderCrumbs(el, level, id, onGo) {
  clear(el);
  const chain = parentChain(level, id);
  if (level !== 'estado' && chain[chain.length - 1]?.level !== level) chain.push({ level, id, name: entityName(level, getProps(level, id)) });
  const lean = chain.filter((c, i) => !(i < chain.length - 1 && chain[i + 1].name === c.name && c.level !== 'estado'));
  lean.forEach((c, i) => {
    const last = i === lean.length - 1;
    if (i) el.append(h('span', { class: 'sep', 'aria-hidden': 'true' }, '›'));
    el.append(h('button', { class: 'crumb' + (last ? ' cur' : ''), type: 'button', 'aria-current': last ? 'true' : null, onclick: () => onGo(c.level, c.id) }, c.name));
  });
}

// ------------------------------------------------------------------ a resposta em palavras
function veredito(r, escopo) {
  const f = forca(r.r);
  const X = nomeCand(A.x), Y = nomeCand(A.y);
  if (r.exclusivos) {
    const t = { pos: f.a >= 0.4 ? 'Disputam os mesmos lugares' : 'Disputam em parte os mesmos lugares', neg: 'Têm bases em lugares diferentes', zero: 'Bases sem relação', nd: 'Sem dados suficientes' }[f.k];
    return { tom: f.k === 'pos' ? 'up' : f.k === 'neg' ? 'down' : 'none', titulo: t, linhas: [`${X} e ${Y} concorrem à mesma vaga: cada eleitor vota em um só. A pergunta passa a ser se os dois buscam voto nos mesmos lugares.`] };
  }
  const l = r.r == null && r.lift == null ? { k: 'nd' } : leitura(r.r, r.lift);
  const titulo = {
    pos: ['', 'Pouco: a sobreposição é fraca', 'Em parte: há sobreposição', 'Sim: onde um é forte, o outro também é'][l.nivel],
    neg: ['', 'Não: tendência leve ao contrário', 'Não: onde um é forte, o outro é fraco', 'Não: os dois têm bases em lugares diferentes'][l.nivel],
    zero: 'Não há relação', mix: 'Sinais mistos: veja a dispersão', nd: 'Sem dados suficientes',
  }[l.k];
  const linhas = [];
  if (r.yx != null) linhas.push(`Nos ${r.unidade === 'local' ? 'locais' : 'seções'} onde vota o eleitor de ${X}, ${Y} faz ${fP(r.yx)} dos votos, contra ${fP(r.py)} ${escopo.em} (${fX(r.lift)}).`);
  if (r.gd?.fora) {
    linhas.push(`Estimativa: perto de ${fP(r.gd.est)} dos eleitores de ${X} votaram em ${Y}, contra ${fP(r.gd.demais)} dos demais (a regressão bateu no limite do possível).`);
  } else if (r.gd) {
    const largo = r.gd.hi - r.gd.lo > 0.4;
    linhas.push(`${largo ? 'Estimativa imprecisa' : 'Estimativa'}: ${fP(r.gd.est)} dos eleitores de ${X} votaram em ${Y} (faixa provável de ${fP(r.gd.lo)} a ${fP(r.gd.hi)}), contra ${fP(r.gd.demais)} dos demais eleitores.`);
  }
  if (r.n < 20) linhas.push(`Só ${r.n} ${r.unidade === 'local' ? 'locais' : 'seções'} no recorte: leitura frágil, use o teto certo.`);
  return { tom: l.k === 'pos' ? 'up' : l.k === 'neg' ? 'down' : 'none', titulo, linhas };
}

// ------------------------------------------------------------------ dispersão (canvas)
function scatter(r, onPick) {
  const W = 360, H = 250, P = { l: 56, r: 10, t: 10, b: 34 };
  const wrap = h('div', { class: 'sc' });
  const cv = h('canvas', { class: 'sc-cv', width: W * 2, height: H * 2, role: 'img', 'aria-label': `Dispersão: participação de ${nomeCand(A.x)} (horizontal) e de ${nomeCand(A.y)} (vertical) em ${r.n} unidades` });
  const tip = h('div', { class: 'sc-tip', hidden: true });
  wrap.append(cv, tip);
  const q = (arr, f) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))] || 0; };
  const mx = Math.max(q(r.xs, 0.995), r.px * 2, 1e-4) * 1.05, my = Math.max(q(r.ys, 0.995), r.py * 2, 1e-4) * 1.05;
  const X = (v) => P.l + (Math.min(v, mx) / mx) * (W - P.l - P.r), Y = (v) => H - P.b - (Math.min(v, my) / my) * (H - P.t - P.b);
  const wmax = Math.max(...r.ws);
  const pts = r.xs.map((x, i) => ({ i, x: X(x), y: Y(r.ys[i]), rad: 1.6 + 5 * Math.sqrt(r.ws[i] / wmax), k: terco(x, r.px) + 3 * terco(r.ys[i], r.py) }));
  const c = cv.getContext('2d');
  c.scale(2, 2);
  c.font = '10.5px system-ui, sans-serif';
  // grade e eixos
  c.strokeStyle = '#2c2c2a'; c.lineWidth = 1; c.fillStyle = '#898781';
  for (let t = 0; t <= 4; t++) {
    const vx = (mx * t) / 4, vy = (my * t) / 4;
    c.beginPath(); c.moveTo(X(vx), P.t); c.lineTo(X(vx), H - P.b); c.stroke();
    c.beginPath(); c.moveTo(P.l, Y(vy)); c.lineTo(W - P.r, Y(vy)); c.stroke();
    c.textAlign = 'center'; c.fillText(fPct(vx * 100), X(vx), H - P.b + 13);
    c.textAlign = 'right'; c.fillText(fPct(vy * 100), P.l - 5, Y(vy) + 3.5);
  }
  // médias do recorte (tracejado)
  c.setLineDash([3, 3]); c.strokeStyle = '#5b5a54';
  c.beginPath(); c.moveTo(X(r.px), P.t); c.lineTo(X(r.px), H - P.b); c.stroke();
  c.beginPath(); c.moveTo(P.l, Y(r.py)); c.lineTo(W - P.r, Y(r.py)); c.stroke();
  c.setLineDash([]);
  // pontos: maiores por baixo, anel da cor do fundo para separar sobreposições
  for (const p of pts.slice().sort((a, b) => b.rad - a.rad)) {
    c.beginPath(); c.arc(p.x, p.y, p.rad, 0, Math.PI * 2);
    c.fillStyle = BIV[p.k]; c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
    c.lineWidth = 0.8; c.strokeStyle = '#181817'; c.stroke();
  }
  // reta de Goodman
  if (r.gd) {
    c.strokeStyle = '#ffffff'; c.lineWidth = 2;
    c.beginPath();
    const x1 = Math.min(mx, r.gd.b < 0 ? (my - r.gd.a) / r.gd.b : mx);
    c.moveTo(X(0), Y(Math.max(0, r.gd.a))); c.lineTo(X(Math.max(0, x1)), Y(Math.max(0, Math.min(my, r.gd.a + r.gd.b * x1)))); c.stroke();
  }
  c.fillStyle = COR.x; c.textAlign = 'right'; c.fillText(`${nomeCand(A.x)} →`, W - P.r, H - 6);
  c.save(); c.translate(10, P.t); c.rotate(-Math.PI / 2); c.fillStyle = COR.y; c.textAlign = 'right'; c.fillText(`${nomeCand(A.y)} →`, 0, 0); c.restore();
  // hover e clique no ponto mais próximo
  const near = (ev) => {
    const b = cv.getBoundingClientRect(), sx = W / b.width;
    const x = (ev.clientX - b.left) * sx, y = (ev.clientY - b.top) * sx;
    let best = null, bd = 12 * 12;
    for (const p of pts) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
    return best && { p: best, b, sx };
  };
  cv.addEventListener('pointermove', (ev) => {
    const n = near(ev);
    if (!n) { tip.hidden = true; cv.style.cursor = ''; return; }
    const id = r.ids[n.p.i], lv = r.unidade, pr = getProps(lv, id);
    clear(tip).append(h('b', null, pr ? entityName(lv, pr) : ''), h('span', null, `${nomeCand(A.x)} ${fP(r.xs[n.p.i])} · ${nomeCand(A.y)} ${fP(r.ys[n.p.i])}`));
    tip.hidden = false;
    tip.style.left = `${Math.min(n.p.x / n.sx, n.b.width - 200)}px`;
    tip.style.top = `${n.p.y / n.sx + 12}px`;
    cv.style.cursor = 'pointer';
  });
  cv.addEventListener('pointerleave', () => { tip.hidden = true; });
  cv.addEventListener('click', (ev) => { const n = near(ev); if (n) onPick(r.unidade, r.ids[n.p.i]); });
  return wrap;
}

function fold(card, open = false) {
  const t = card.querySelector('.card-t');
  const d = h('details', { class: 'card fold', open: open || null });
  d.append(h('summary', { class: 'card-t' }, ...t.childNodes));
  t.remove();
  d.append(...card.childNodes);
  return d;
}

// ------------------------------------------------------------------ painel
export class Panel {
  constructor(el, { onSelect, onY, polos }) {
    this.el = el;
    this.cb = { onSelect, onY };
    this.polos = polos; // { esq: {key, serie}, dir: {...} } quando carregados
    this.afCargo = null;
    this.mais = false;
  }

  render(level, id) {
    const p = getProps(level, id);
    if (!p || !A.X) return;
    if (this._sel !== `${level}:${id}`) this.mais = false;
    this._sel = `${level}:${id}`;
    const r = recorte(level, id);
    // "no estado" / "em São Luís"; "do estado" / "de São Luís"
    const escopo = level === 'estado' ? { em: 'no estado', de: 'do estado' } : { em: `em ${level === 'secao' ? `Seção ${p.nr}` : p.n}`, de: `de ${level === 'secao' ? `Seção ${p.nr}` : p.n}` };
    const body = h('div', { class: 'panel-body' });
    const sub = level === 'estado' ? `${fInt(D.meta.contagens.municipio)} municípios · ${fInt(D.n)} seções` : level === 'secao' ? `${getProps('local', p.li)?.n || ''}` : level === 'local' ? `${p.e || ''} · ${p.ns} seç${p.ns > 1 ? 'ões' : 'ão'}` : level === 'bairro' ? p.mn : '';
    body.append(h('div', { class: 'ph' },
      h('div', { class: 'ph-top' }, h('span', { class: 'chip lv' }, LEVEL_INFO[level].label),
        level !== 'estado' ? h('button', { class: 'ghost', type: 'button', onclick: () => this.cb.onSelect('estado', 0) }, 'Voltar ao estado') : null),
      h('h2', null, level === 'secao' ? `Seção ${p.nr}` : p.n),
      h('div', { class: 'ph-sub' }, `${sub ? sub + ' · ' : ''}${fInt(p.ap)} eleitores`)));

    // as duas séries no recorte
    body.append(h('div', { class: 'pair' },
      h('div', { class: 'pair-r x' }, h('i'), h('div', null, h('b', null, nomeCand(A.x)), h('span', null, cargoNome(A.x))), h('div', { class: 'pair-v' }, h('b', null, fInt(r.tx)), h('span', null, fP(r.px)))),
      h('div', { class: 'pair-r y' }, h('i'), h('div', null, h('b', null, nomeCand(A.y)), h('span', null, cargoNome(A.y))), h('div', { class: 'pair-v' }, h('b', null, fInt(r.ty)), h('span', null, fP(r.py))))));

    const v = veredito(r, escopo);
    body.append(h('div', { class: `answer tone-${v.tom}` }, h('div', { class: 'answer-q' }, 'Quem vota em ', tag('x', A.x), ' vota em ', tag('y', A.y), '?'),
      h('div', { class: 'answer-t' }, v.titulo), ...v.linhas.map((l) => h('p', null, l))));

    // números-chave
    const f = forca(r.r);
    const unid = r.unidade === 'local' ? 'locais de votação' : 'seções';
    const kpi = (l, val, s, cls) => h('div', { class: 'kpi ' + (cls || '') }, h('div', { class: 'kpi-l' }, l), h('div', { class: 'kpi-v' }, val), h('div', { class: 'kpi-s' }, s));
    const kpis = h('div', { class: 'kpis' },
      kpi('Correlação', fR(r.r), `${f.txt} · ${fInt(r.n)} ${unid}`, 'lead'),
      kpi('Afinidade', fX(r.lift), `${nomeCand(A.y)} onde ${nomeCand(A.x)} vota ÷ média`));
    if (r.lim) {
      kpis.append(
        kpi('Estimativa', r.gd ? fP(r.gd.est) : '—', r.gd ? `dos eleitores de ${nomeCand(A.x)} votaram em ${nomeCand(A.y)}` : 'sem variação suficiente'),
        kpi('Teto certo', fInt(r.lim.hi), `votos de ${nomeCand(A.y)} que podem ter vindo de eleitores de ${nomeCand(A.x)} (${fP(r.lim.hiF)})`, 'warn'));
    }
    body.append(kpis);

    if (r.lim && r.tx > 0) {
      body.append(h('div', { class: 'card' }, h('div', { class: 'card-t' }, 'O que é certo, seção a seção'),
        h('p', { class: 'txt' }, `Em cada urna, os eleitores de ${nomeCand(A.x)} que também votaram em ${nomeCand(A.y)} não podem passar do menor dos dois números. Somando as urnas ${escopo.de}: `,
          h('b', null, `entre ${fInt(r.lim.lo)} e ${fInt(r.lim.hi)}`), ` dos ${fInt(r.tx)} votos de ${nomeCand(A.x)} podem ter ido também para ${nomeCand(A.y)}. Quem disser que transferiu mais do que ${fInt(r.lim.hi)} votos está afirmando algo que as urnas não permitem.`),
        r.gd?.fora ? h('p', { class: 'note warn' }, 'A regressão saiu do intervalo possível e foi limitada a ele: sinal de que a relação entre os dois não é uniforme no recorte.') : null));
    }

    if (r.n >= 3) {
      body.append(h('div', { class: 'card' }, h('div', { class: 'card-t' }, `Cada ponto é ${r.unidade === 'local' ? 'um local de votação' : 'uma seção'} `, h('em', null, `(tamanho = eleitores; reta = tendência)`)),
        scatter(r, (lv, i) => this.cb.onSelect(lv, i)),
        h('div', { class: 'note' }, 'Tracejado = média do recorte. Pontos acima e à direita: os dois acima da média.')));
    }

    this._lado(body, level, id, escopo);
    this._afinidades(body);
    this._filhos(body, level, id, r);
    body.append(fold(h('div', { class: 'card' }, h('div', { class: 'card-t' }, 'Como ler (e o que não dá para saber)'),
      h('p', { class: 'txt' }, 'O voto é secreto: ninguém sabe em quem cada eleitor votou. O que existe é o resultado de cada urna. Daí saem três leituras, da mais segura para a menos segura:'),
      h('ul', { class: 'txt' },
        h('li', null, h('b', null, 'Teto certo. '), 'Em cada seção, os eleitores comuns a X e Y não passam de min(X, Y) nem ficam abaixo de X + Y − comparecimento. Vale sempre, sem hipótese.'),
        h('li', null, h('b', null, 'Correlação e afinidade. '), 'Medem se os votos caem nos mesmos lugares (por local de votação). Correlação alta é compatível com dobradinha, mas também com dois candidatos fortes no mesmo tipo de bairro.'),
        h('li', null, h('b', null, 'Estimativa. '), 'Regressão ecológica de Goodman: supõe que o comportamento do eleitor de X é parecido em todo o recorte. Use como ordem de grandeza, com a faixa provável.')),
      h('p', { class: 'txt' }, 'Esquerda e direita: votos em Lula (PT) e em Flávio Bolsonaro (PL) para presidente na mesma seção. Mede alinhamento pelo voto, sem classificar partidos.'),
      h('p', { class: 'txt muted' }, `Fonte: ${D.meta.fonte}. Zonas e bairros são áreas em volta dos locais de votação (aproximação, não limite oficial).`))));
    clear(this.el).append(body);
  }

  _lado(body, level, id, escopo) {
    const pl = this.polos;
    if (!pl?.esq || !pl?.dir || A.x === pl.esq.key || A.x === pl.dir.key) return;
    const ld = lado(level, id, pl.esq.serie, pl.dir.serie);
    if (ld.doX == null) return;
    const ce = cruzado(level, id, pl.esq.key, pl.esq.serie), cd = cruzado(level, id, pl.dir.key, pl.dir.serie);
    const pende = ld.dif;
    const txt = Math.abs(pende) < 0.02 ? `Igual ao eleitorado ${escopo.de}.` : `${fPP(Math.abs(pende)).replace('+', '')} mais ${pende > 0 ? 'à esquerda' : 'à direita'} que o eleitorado ${escopo.de}.`;
    const pos = (x) => `${Math.max(0, Math.min(100, x * 100))}%`;
    body.append(h('div', { class: 'card lado' }, h('div', { class: 'card-t' }, `Para que lado pende o eleitor de ${nomeCand(A.x)}?`),
      h('div', { class: 'lado-bar' },
        h('i', { class: 'esq', style: { width: pos(ld.doX) } }), h('i', { class: 'dir' }),
        h('b', { class: 'mk media', style: { left: pos(ld.media) }, title: `Média ${escopo.de}` }),
        h('b', { class: 'mk eleitor', style: { left: pos(ld.doX) }, title: `Onde vota o eleitor de ${nomeCand(A.x)}` })),
      h('div', { class: 'lado-leg' }, h('span', { class: 'esq' }, `Lula ${fP(ld.doX)}`), h('span', { class: 'dir' }, `${fP(1 - ld.doX)} Bolsonaro`)),
      h('p', { class: 'txt' }, `Onde vota o eleitor de ${nomeCand(A.x)}, Lula faz ${fP(ld.doX)} dos votos dados aos dois (média ${escopo.de}: ${fP(ld.media)}). `, h('b', null, txt)),
      ce.gd && cd.gd ? h('p', { class: 'txt muted' }, `Estimativa: ${fP(ce.gd.est)} dos eleitores de ${nomeCand(A.x)} votaram em Lula e ${fP(cd.gd.est)} em Flávio Bolsonaro.`) : null,
      h('div', { class: 'foot' },
        h('button', { class: 'link', type: 'button', onclick: () => this.cb.onY(pl.esq.key) }, 'Comparar com Lula'),
        h('button', { class: 'link', type: 'button', onclick: () => this.cb.onY(pl.dir.key) }, 'Comparar com Bolsonaro'))));
  }

  _afinidades(body) {
    const af = D.af?.[A.x];
    if (!af) return;
    const cargos = Object.keys(af).map(Number);
    if (!this.afCargo || !cargos.includes(this.afCargo)) this.afCargo = cargos.includes(cargoOf(A.y)) ? cargoOf(A.y) : cargos.find((c) => c !== cargoOf(A.x)) || cargos[0];
    const card = h('div', { class: 'card' }, h('div', { class: 'card-t' }, `Quem mais anda junto com ${nomeCand(A.x)} `, h('em', null, `(${D.meta.uf_nome} inteiro, por local de votação)`)));
    const tabs = h('div', { class: 'tabs' });
    for (const c of cargos) tabs.append(h('button', { type: 'button', class: 'tab' + (c === this.afCargo ? ' on' : ''), onclick: () => { this.afCargo = c; this.render(...this._sel.split(':').map((x, i) => (i ? Number(x) : x))); } }, D.cargos.get(c)?.nome || c));
    card.append(tabs);
    const lista = af[String(this.afCargo)] || [];
    const pos = lista.filter((x) => x[1] > 0).slice(0, 8), neg = lista.filter((x) => x[1] < 0).slice(-3).reverse();
    const linha = ([num, rr, lift]) => {
      const key = `${this.afCargo}:${num}`, c = candOf(key);
      if (!c) return null;
      return h('button', { type: 'button', class: 'af-row' + (key === A.y ? ' on' : ''), onclick: () => this.cb.onY(key), title: `Comparar ${nomeCand(A.x)} com ${c.nome}` },
        h('span', { class: 'af-n' }, h('b', null, c.nome), h('em', null, `${c.partido} ${c.n}${c.sit ? ' · ' + c.sit.toLowerCase() : ''}`)),
        h('span', { class: 'af-b' }, h('i', { style: { width: `${Math.min(100, Math.abs(rr) * 100)}%`, background: rr >= 0 ? DIV[5] : DIV[1] } })),
        h('span', { class: 'af-v' }, fR(rr), h('em', null, fX(lift))));
    };
    if (pos.length) card.append(h('div', { class: 'sub-t' }, 'Mais associados'), ...pos.map(linha));
    if (neg.length) card.append(h('div', { class: 'sub-t' }, 'Mais distantes'), ...neg.map(linha));
    card.append(h('div', { class: 'note' }, 'Número = correlação (−1 a 1); embaixo, a afinidade. Toque para comparar.'));
    body.append(fold(card, true));
  }

  _filhos(body, level, id, r) {
    const { level: cl, items } = childrenOf(level, id);
    if (!cl || !items.length || !D.un[cl]) return;
    const vals = items.map((p) => ({ p, v: valorDe(cl, p.id) })).filter((x) => x.v && x.v.dx > 0);
    vals.sort((a, b) => b.v.x - a.v.x || b.v.y - a.v.y);
    const rl = ['municipio', 'bairro', 'zona', 'macro'].includes(cl) ? rPorUnidade(cl) : null;
    const lim = this.mais ? vals.length : 12;
    const card = h('div', { class: 'card' }, h('div', { class: 'card-t' }, `${LEVEL_INFO[cl].plural} `, h('em', null, `(${vals.length}, pelos votos de ${nomeCand(A.x)})`)));
    card.append(h('div', { class: 'ch-head' }, h('span'), h('span', null, 'Nome'), h('span', { class: 'who-x' }, nomeCand(A.x)), h('span', { class: 'who-y' }, nomeCand(A.y)), rl ? h('span', null, 'r local') : h('span')));
    for (const { p, v } of vals.slice(0, lim)) {
      const k = classeBiv(v, r.px, r.py);
      const rr = rl ? rl[D.un[cl].pos.get(p.id)] : null;
      card.append(h('button', { type: 'button', class: 'ch-row', onclick: () => this.cb.onSelect(cl, p.id) },
        h('i', { style: { background: k >= 0 ? BIV[k] : SEM_DADO }, title: textoBiv(k) }),
        h('span', { class: 'ch-n' }, cl === 'secao' ? `Seção ${p.nr}` : p.n),
        h('span', { class: 'ch-v' }, fP(v.px)), h('span', { class: 'ch-v' }, fP(v.py)),
        h('span', { class: 'ch-v r', style: rr != null && !Number.isNaN(rr) ? { color: DIV[classeR(rr)] === DIV[3] ? 'var(--ink-2)' : rr > 0 ? '#7fb2f6' : '#ff8a85' } : null }, rl ? fR(Number.isNaN(rr) ? null : rr) : '')));
    }
    if (vals.length > lim) card.append(h('button', { type: 'button', class: 'link', onclick: () => { this.mais = true; this.render(level, id); } }, `Mostrar todos (${vals.length})`));
    body.append(card);
  }
}

