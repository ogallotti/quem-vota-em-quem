// Cartões da interface: a pergunta e a resposta (esquerda), "anda junto / onde / pontos" (direita), a tela inicial do
// Brasil, a legenda, a trilha e a dica do mapa. Texto dos dados entra sempre por textContent (h()).
import { A, lado, rPorUnidade, recorte, territorio, valorDe } from './analise.js';
import { BR, D, LEVEL_INFO, candOf, cargoOf, childrenOf, entityName, getProps, parentChain } from './data.js';
import { clear, fInt, fPct, h } from './fmt.js';
import { BIV, BIV_TXT, DIV, LADO, SEM_DADO, YX } from './scales.js';
import { leitura, terco } from './stats.js';
import { ICON, avatar, cargoCurto, chipCand, curto, situacao } from './ui.js';

const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fR = (r) => (r == null || Number.isNaN(r) ? '—' : (r < 0 ? '−' : '') + nf2.format(Math.abs(r)));
const fX = (x) => (x == null ? '—' : `${nf2.format(x)}×`);
const fP = (x) => (x == null ? '—' : fPct(x * 100));
// percentual com casas só quando o número é pequeno (0,53% não pode virar "1%")
const fP0 = (x) => (x == null ? '—' : x >= 0.095 ? `${Math.round(x * 100)}%` : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: x >= 0.0095 ? 1 : 2 }).format(x * 100)}%`);
const fPP = (x) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Math.abs(x * 100))} pontos`;
const nomeCand = (key) => candOf(key)?.nome || '';
const sp = (cls, txt) => h('span', { class: cls }, txt);

/** Classe bivariada de uma unidade (proporções encolhidas) em relação às médias do recorte. */
export function classeBiv(v, px, py) {
  if (!v || !(v.dx > 0)) return -1;
  return terco(v.ex, px) + 3 * terco(v.ey, py);
}
const textoBiv = (k) => (k < 0 ? 'Sem eleitores' : BIV_TXT[k].replace('X', curto(nomeCand(A.x))).replace('Y', curto(nomeCand(A.y))));

// ------------------------------------------------------------------ dica do mapa
export class Tooltip {
  constructor(el) { this.el = el; this.last = ''; }
  _place(point) {
    this.el.hidden = false;
    const r = this.el.getBoundingClientRect(), k = window.__uiK || 1;
    let x = point.x + 16, y = point.y + 16;
    if (x * k + r.width > innerWidth - 10) x = point.x - r.width / k - 16;
    if (y * k + r.height > innerHeight - 10) y = point.y - r.height / k - 16;
    this.el.style.transform = `translate(${Math.max(6, x)}px, ${Math.max(6, y)}px)`;
  }
  linha(k, v, cls) { return h('div', { class: 'tip-r' }, h('span', { class: cls }, k), h('b', null, v)); }
  showBR(p, nivel, point) {
    const key = `br:${nivel}:${p.id}`;
    if (key !== this.last) {
      this.last = key;
      const t = p.esq + p.dir;
      clear(this.el).append(h('div', { class: 'tip-h' }, nivel === 'uf' ? 'Estado' : `Município · ${String(p.uf).toUpperCase()}`),
        h('div', { class: 'tip-n' }, p.n),
        this.linha('Lula', t ? fP(p.esq / t) : '—'), this.linha('Flávio Bolsonaro', t ? fP(p.dir / t) : '—'),
        h('div', { class: 'tip-f' }, nivel === 'uf' && !p.ok ? 'Dados do estado ainda em processamento' : 'Presidente, só entre os dois · clique para abrir'));
    }
    this._place(point);
  }
  show(level, id, point, ctx) {
    const p = getProps(level, id), v = valorDe(level, id);
    if (!p || !v) return this.hide();
    const key = `${level}:${id}:${A.ver}:${ctx.lente}`;
    if (key !== this.last) {
      this.last = key;
      const k = classeBiv(v, ctx.px, ctx.py);
      const rl = ctx.lente === 'r' ? rPorUnidade(level)[D.un[level].pos.get(id)] : null;
      clear(this.el).append(
        h('div', { class: 'tip-h' }, LEVEL_INFO[level].label),
        h('div', { class: 'tip-n' }, entityName(level, p)),
        this.linha(curto(nomeCand(A.x)), `${fP(v.px)} · ${fInt(v.x)}`, 'x'),
        this.linha(curto(nomeCand(A.y)), `${fP(v.py)} · ${fInt(v.y)}`, 'y'),
        this.linha('Compareceram', fInt(v.dx)),
        ctx.lente === 'r'
          ? h('div', { class: 'tip-f' }, `Correlação entre os locais: ${fR(Number.isNaN(rl) ? null : rl)}`)
          : h('div', { class: 'tip-f' }, h('i', { style: { background: k >= 0 ? BIV[k] : SEM_DADO } }), textoBiv(k)),
      );
    }
    this._place(point);
  }
  hide() { this.el.hidden = true; this.last = ''; }
}

// ------------------------------------------------------------------ legenda
export function renderLegend(el, { lente, classes, escopo }) {
  clear(el);
  el.hidden = false;
  if (lente === 'br') {
    el.append(h('div', { class: 'lg-t' }, h('b', null, 'Lula × Flávio Bolsonaro'), ' · presidente'),
      h('div', { class: 'lg-ramp' }, ...LADO.map((c) => h('i', { style: { background: c } }))),
      h('div', { class: 'lg-ends' }, h('span', null, 'Lula +30'), h('span', null, 'empate'), h('span', null, 'Bolsonaro +30')));
    return;
  }
  if (lente === 'yx') {
    const X = curto(nomeCand(A.x)), Y = curto(nomeCand(A.y));
    const g = h('div', { class: 'yx-g', role: 'img', 'aria-label': `Legenda: luz = ${Y}, cor = ${X}` });
    for (let fy = 4; fy >= 0; fy--) for (let fx = 0; fx < 5; fx++) g.append(h('i', { style: { background: YX[fy * 5 + fx] } }));
    el.append(h('div', { class: 'yx-wrap' },
      h('div', { class: 'yx-ax-y' }, h('span', null, `${Y} forte`), h('span', null, 'sem voto')),
      h('div', null, g, h('div', { class: 'yx-ax-x' }, h('span', null, `${X} fraco`), h('span', null, 'forte'))),
      h('div', { class: 'yx-k' },
        h('div', null, h('i', { style: { background: YX[24] } }), h('span', null, h('b', null, 'os dois fortes'))),
        h('div', null, h('i', { style: { background: YX[20] } }), h('span', null, `só ${Y}`)),
        h('div', null, h('i', { style: { background: YX[4] } }), h('span', null, `só ${X}`)),
        h('div', null, h('i', { style: { background: YX[0] } }), h('span', null, 'nenhum dos dois')))),
      h('div', { class: 'lg-ends', style: { width: 'auto', marginTop: '6px' } }, `luz = ${Y} · cor = ${X} · faixas de 20% do eleitorado ${escopo}`));
    return;
  }
  if (lente === 'bi') {
    const g = h('div', { class: 'biv-g', role: 'img', 'aria-label': 'Legenda: 3 faixas de X por 3 faixas de Y' });
    for (let iy = 2; iy >= 0; iy--) for (let ix = 0; ix < 3; ix++) g.append(h('i', { style: { background: BIV[iy * 3 + ix] }, title: textoBiv(iy * 3 + ix) }));
    el.append(h('div', { class: 'lg-t' }, 'Comparado à média ', h('b', null, escopo)),
      h('div', { class: 'biv-wrap' },
        h('div', { class: 'biv' }, h('div', { class: 'biv-y' }, `${curto(nomeCand(A.y))} →`), g, h('div', { class: 'biv-x' }, `${curto(nomeCand(A.x))} →`)),
        h('div', { class: 'biv-k' },
          h('span', null, h('i', { style: { background: BIV[8] } }), 'os dois fortes'),
          h('span', null, h('i', { style: { background: BIV[2] } }), `só ${curto(nomeCand(A.x))}`),
          h('span', null, h('i', { style: { background: BIV[6] } }), `só ${curto(nomeCand(A.y))}`),
          h('span', null, h('i', { style: { background: BIV[0] } }), 'os dois fracos'))));
    return;
  }
  if (lente === 'r') {
    el.append(h('div', { class: 'lg-t' }, h('b', null, 'Correlação'), ' entre os locais de cada área'),
      h('div', { class: 'lg-ramp' }, ...DIV.map((c) => h('i', { style: { background: c } }))),
      h('div', { class: 'lg-ends' }, h('span', null, 'ao contrário'), h('span', null, 'nenhuma'), h('span', null, 'juntos')));
    return;
  }
  const quem = lente === 'x' ? A.x : A.y;
  el.append(h('div', { class: 'lg-t' }, h('b', { style: { color: `var(--${lente})` } }, curto(nomeCand(quem))), ' · % de quem compareceu'),
    h('div', { class: 'lg-ramp' }, ...classes.map((c) => h('i', { style: { background: c.color } }))),
    h('div', { class: 'lg-ends' }, h('span', null, classes[0]?.label || ''), h('span', null, classes[classes.length - 1]?.label || '')));
}

export function renderCrumbs(el, level, id, onGo) {
  clear(el);
  if (!D.meta) return;
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
  const X = curto(nomeCand(A.x)), Y = curto(nomeCand(A.y));
  const nx = () => sp('x', X), ny = () => sp('y', Y);
  const l = r.r == null && r.lift == null ? { k: 'nd' } : leitura(r.r, r.lift, r.ci);
  let titulo;
  if (r.exclusivos) {
    titulo = l.k === 'pos' ? [nx(), ' e ', ny(), ' disputam os mesmos lugares.'] : l.k === 'neg' ? [nx(), ' e ', ny(), ' têm territórios diferentes.'] : [nx(), ' e ', ny(), ' não disputam o mesmo território.'];
  } else {
    titulo = {
      pos: [null, ['Pouco. A sobreposição entre ', nx(), ' e ', ny(), ' é fraca.'], ['Em parte. Os votos de ', nx(), ' e ', ny(), ' se sobrepõem.'], ['Sim. Onde ', nx(), ' é forte, ', ny(), ' também é.']][l.nivel],
      neg: [null, ['Não muito. Há uma leve tendência ao contrário.'], ['Não. Onde ', nx(), ' é forte, ', ny(), ' tende a ser fraco.'], ['Não. ', nx(), ' e ', ny(), ' têm bases em lugares diferentes.']][l.nivel],
      zero: ['Não há relação entre os votos de ', nx(), ' e de ', ny(), '.'],
      inc: ['Inconclusivo: o sinal não se distingue do acaso.'],
      mix: ['Sinais mistos: veja os pontos.'], nd: ['Sem dados suficientes.'],
    }[l.k];
  }
  const linhas = [];
  if (r.exclusivos) linhas.push('Os dois concorrem à mesma vaga: cada eleitor vota em um só. A pergunta passa a ser se buscam voto nos mesmos lugares.');
  else if (r.yx != null) linhas.push(`Onde vota o eleitor de ${X}, ${Y} faz ${fP(r.yx)} dos votos; ${escopo.em}, ${fP(r.py)}.`);
  if (r.r != null && r.rw != null && Math.abs(r.r) >= 0.2) {
    if (Math.abs(r.rw) < 0.1) linhas.push('Dentro de cada município, porém, os dois não andam juntos: a coincidência é regional (fortes nas mesmas regiões), não necessariamente dos mesmos eleitores.');
    else if (Math.sign(r.rw) === Math.sign(r.r)) linhas.push(r.r > 0 ? 'E isso vale também dentro de cada município: sinal mais forte de eleitorado em comum.' : 'E isso vale também dentro de cada município: os eleitorados se repelem até nos mesmos bairros.');
  }
  if (r.n < 20) linhas.push(`Só ${r.n} ${r.unidade === 'local' ? 'locais' : 'seções'} no recorte: leitura frágil.`);
  return { l, titulo, linhas };
}

/** Barra 0–100% com o intervalo provável. */
function barra(v, ic, cls = '', escala = 1) {
  const pct = (x) => `${Math.max(0, Math.min(100, (x / escala) * 100))}%`;
  return h('div', { class: `bar ${cls}` }, h('i', { style: { width: pct(v) } }), ic ? h('span', { class: 'ic', style: { left: pct(ic[0]), width: `calc(${pct(ic[1])} - ${pct(ic[0])})` }, title: `faixa provável: ${fP0(ic[0])} a ${fP0(ic[1])}` }) : null);
}
const stat = (l, v, s, info) => h('div', { class: 'stat' }, h('div', { class: 'stat-l' }, l, info ? h('button', { class: 'inf', type: 'button', title: info, 'aria-label': info }, ICON.info()) : null), h('div', { class: 'stat-v tn' }, v), h('div', { class: 'stat-s' }, s));

// ------------------------------------------------------------------ cartão principal (UF)
export function renderMain(el, level, id, ctx) {
  const p = getProps(level, id);
  if (!p || !A.X) return;
  const r = recorte(level, id);
  const nome = level === 'estado' ? D.meta.uf_nome : entityName(level, p);
  const escopo = level === 'estado' ? { em: 'no estado', de: 'do estado' } : { em: `em ${nome}`, de: `de ${nome}` };
  const cx = candOf(A.x), cy = candOf(A.y);
  const X = curto(cx.nome), Y = curto(cy.nome);
  const v = veredito(r, escopo);
  const frag = [];
  frag.push(h('div', { class: 'eyebrow' }, h('b', null, D.meta.uf_nome), h('span', null, '·'), h('span', null, '1º turno 2026'), level !== 'estado' ? [h('span', null, '·'), h('b', null, nome)] : null));
  const polo = D.meta.polos?.esq === cy.key ? 'esquerda' : D.meta.polos?.dir === cy.key ? 'direita' : '';
  frag.push(h('div', { class: 'q' },
    h('div', { class: 'q-row' }, h('p', { class: 'q-l' }, 'Quem vota em'), h('button', { class: 'q-swap', type: 'button', onclick: ctx.onSwap, title: 'Inverter (I)' }, ICON.trocar(), 'inverter')),
    chipCand('x', cx, { onClick: () => ctx.onPick('x'), rotulo: 'X' }),
    h('p', { class: 'q-l' }, polo ? `também vota na ${polo}?` : 'também vota em'),
    chipCand('y', cy, { onClick: () => ctx.onPick('y'), rotulo: 'Y' })));
  frag.push(h('div', { class: 'answer' }, h('h2', { class: 'verdict' }, ...v.titulo), ...v.linhas.map((t) => h('p', { class: 'verdict-s' }, t))));

  if (!r.exclusivos && r.gd) {
    // candidatos pequenos: a barra de 0 a 100% esconderia a diferença; amplia a escala e avisa
    const topo = Math.max(r.gd.hi ?? r.gd.est, r.gd.est, r.gd.demais);
    const escala = topo < 0.25 ? Math.max(topo * 1.35, 0.002) : 1;
    // "x vezes mais" só quando até o piso da faixa provável fica acima dos demais
    const vezes = r.gd.demais > 0 && (r.gd.lo ?? r.gd.est) > r.gd.demais ? r.gd.est / r.gd.demais : null;
    frag.push(h('div', { class: 'bars' },
      h('div', null, h('div', { class: 'bar-l' }, h('span', null, 'Dos eleitores de ', sp('x', X)), h('b', { class: 'tn' }, `~${fP0(r.gd.est)}`)), barra(r.gd.est, r.gd.lo != null ? [r.gd.lo, r.gd.hi] : null, '', escala)),
      h('div', null, h('div', { class: 'bar-l' }, h('span', null, 'Dos demais eleitores'), h('b', { class: 'tn' }, `~${fP0(r.gd.demais)}`)), barra(r.gd.demais, null, 'demais', escala)),
      h('div', { class: 'small muted' }, `votaram em ${Y} (estimativa${r.gd.lo != null ? `, faixa provável ${fP0(r.gd.lo)} a ${fP0(r.gd.hi)}` : ''})${vezes && vezes >= 1.5 ? `: ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(vezes)} vezes mais que os demais` : ''}.${escala < 1 ? ` Barras ampliadas: o fim da barra é ${fP0(escala)}.` : ''}`)));
  }
  const tt = territorio(level, id);
  if (tt.n > 1 && tt.eleitores > 0.05) {
    const peso = tt.votosY / tt.eleitores;
    frag.push(h('p', { class: 'terr' }, `As áreas onde ${X} é mais forte (${fInt(tt.n)} ${r.unidade === 'local' || true ? 'locais' : ''}, `, h('b', null, fP0(tt.eleitores)), ' dos eleitores) deram ',
      h('b', { class: 'x' }, fP0(tt.votosX)), ` dos votos de ${X} e `, h('b', { class: 'y' }, fP0(tt.votosY)), ` dos de ${Y}`,
      peso >= 1.2 ? `: ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(peso)}× o esperado se não houvesse relação.` : peso <= 0.83 ? `: menos que o esperado (${fP0(tt.eleitores)}); ${Y} vai melhor fora delas.` : ': o esperado se não houvesse relação.'));
  }
  const cR = (x) => (x == null ? '—' : sp(x > 0.1 ? 'pos' : x < -0.1 ? 'neg' : '', fR(x)));
  frag.push(h('div', { class: 'stats' },
    stat('Correlação', cR(r.r), r.rw != null ? h('span', null, `nos ${r.blocos}: `, fR(r.rw)) : `${fInt(r.n)} seções`,
      'De −1 a 1: os votos dos dois sobem e descem juntos de um local de votação para outro? "Nos municípios" desconta a média de cada cidade: separa coincidência regional de eleitorado comum.'),
    stat('Afinidade', fX(r.lift), `${Y} onde ${X} vota ÷ média`, 'Quanto Y faz no lugar médio onde vota o eleitor de X, dividido pela média de Y no recorte. 1,00× = indiferente; 2× = o dobro; 0,5× = a metade.'),
    r.lim ? stat('Teto certo', fInt(r.lim.hi), `votos de ${Y} podem ter vindo de quem votou em ${X}`, 'Em cada urna, quem votou nos dois não passa do menor dos dois números. Somando as urnas, este é o máximo possível. Não é estimativa: é certo.')
      : stat('Nos municípios', cR(r.rw), 'correlação descontada a média de cada cidade', 'Correlação depois de tirar a média de cada município.')));

  // esquerda × direita
  const pl = ctx.polos;
  if (pl?.esq && pl?.dir && A.x !== pl.esq.key && A.x !== pl.dir.key) {
    const ld = lado(level, id, pl.esq.serie, pl.dir.serie);
    if (ld.doX != null) {
      const pos = (x) => `${Math.max(0, Math.min(100, x * 100))}%`;
      const dif = ld.dif;
      frag.push(h('div', { class: 'lado' },
        h('div', { class: 'sec-t' }, h('b', null, `Para que lado pende o eleitor de ${X}?`)),
        h('div', { class: 'lado-bar' }, h('i', { class: 'e', style: { width: pos(ld.doX) } }), h('i', { class: 'd' }),
          h('b', { class: 'mk m', style: { left: pos(ld.media) }, title: `Média ${escopo.de}` }), h('b', { class: 'mk x', style: { left: pos(ld.doX) }, title: `Onde vota o eleitor de ${X}` })),
        h('div', { class: 'lado-leg tn' }, h('span', { class: 'e' }, `Lula ${fP0(ld.doX)}`), h('span', { class: 'd' }, `${fP0(1 - ld.doX)} Bolsonaro`)),
        h('p', null, Math.abs(dif) < 0.02 ? `Igual ao eleitorado ${escopo.de}.` : `${fPP(dif)} mais ${dif > 0 ? 'à esquerda' : 'à direita'} que o eleitorado ${escopo.de} (o risco cinza é a média).`,
          ' ', h('button', { class: 'q-swap', type: 'button', onclick: () => ctx.onY(dif > 0 ? pl.esq.key : pl.dir.key) }, `comparar com ${dif > 0 ? 'Lula' : 'Bolsonaro'} →`))));
    }
  }

  const ci = (k) => (r.ci?.[k] ? ` (${fR(r.ci[k][0])} a ${fR(r.ci[k][1])})` : '');
  frag.push(h('details', { class: 'more' }, h('summary', null, 'Números completos e como ler'),
    h('div', { class: 'more-b' },
      h('div', { class: 'kv' }, h('span', null, `Votos de ${X}`), h('b', { class: 'tn' }, `${fInt(r.tx)} (${fP(r.px)})`)),
      h('div', { class: 'kv' }, h('span', null, `Votos de ${Y}`), h('b', { class: 'tn' }, `${fInt(r.ty)} (${fP(r.py)})`)),
      h('div', { class: 'kv' }, h('span', null, 'Correlação'), h('b', { class: 'tn' }, fR(r.r) + ci('r'))),
      r.rw != null ? h('div', { class: 'kv' }, h('span', null, `Dentro dos ${r.blocos}`), h('b', { class: 'tn' }, fR(r.rw) + ci('rw'))) : null,
      h('div', { class: 'kv' }, h('span', null, 'Afinidade'), h('b', { class: 'tn' }, fX(r.lift) + (r.ci?.lift ? ` (${fX(r.ci.lift[0])} a ${fX(r.ci.lift[1])})` : ''))),
      r.lim ? h('div', { class: 'kv' }, h('span', null, 'Votos em comum (certo)'), h('b', { class: 'tn' }, `${fInt(r.lim.lo)} a ${fInt(r.lim.hi)}`)) : null,
      h('div', { class: 'kv' }, h('span', null, 'Unidades de análise'), h('b', { class: 'tn' }, `${fInt(r.n)} ${r.unidade === 'local' ? 'locais' : 'seções'}`)),
      h('p', null, 'O voto é secreto: ninguém sabe em quem cada eleitor votou. O que existe é o resultado de cada urna. Daí saem três leituras, da mais segura para a menos segura:'),
      h('p', null, h('b', null, 'Teto certo. '), 'Em cada seção, quem votou nos dois não passa de min(X, Y) nem fica abaixo de X + Y − comparecimento. Vale sempre.'),
      h('p', null, h('b', null, 'Correlação e afinidade. '), 'Medem se os votos caem nos mesmos lugares, por local de votação. A correlação "nos municípios" desconta a média de cada cidade e separa coincidência regional de eleitorado comum.'),
      h('p', null, h('b', null, 'Estimativa. '), 'Regressão ecológica de Goodman presa, local a local, aos limites certos. Faixas por reamostragem de municípios (200 vezes).'),
      h('p', null, 'Esquerda e direita: votos em Lula (PT) e em Flávio Bolsonaro (PL) para presidente na mesma seção.'),
      h('p', { class: 'muted' }, `Fonte: ${D.meta.fonte}. Zonas, bairros, locais e seções são áreas aproximadas em volta dos locais de votação.`))));
  clear(el).append(...frag);
}

// ------------------------------------------------------------------ cartão lateral (UF)
export function renderSide(el, level, id, ctx) {
  const tab = ctx.tab || 'trouxe';
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  for (const [k, t] of [['trouxe', 'Quem trouxe'], ['junto', 'Anda junto'], ['onde', 'Onde'], ['pontos', 'Pontos']]) tabs.append(h('button', { type: 'button', role: 'tab', class: 'tab' + (k === tab ? ' on' : ''), 'aria-selected': String(k === tab), onclick: () => ctx.onTab(k) }, t));
  const b = h('div', { class: 'side-b' });
  if (tab === 'trouxe') trouxe(b, ctx);
  else if (tab === 'junto') junto(b, ctx);
  else if (tab === 'onde') onde(b, level, id, ctx);
  else pontos(b, level, id, ctx);
  clear(el).append(tabs, b);
}

/** Ranking: para Y, os candidatos de um cargo cujos eleitores mais votaram em Y (fração estimada e votos). */
function trouxe(b, ctx) {
  const cy = candOf(A.y), Y = curto(cy.nome);
  const cargos = [...D.cargos.keys()].filter((c) => c !== cy.cargo || c === 5);
  b.append(h('div', { class: 'sec-t' }, h('b', null, `Quem trouxe votos para ${Y}`)));
  const chips = h('div', { class: 'chips' });
  for (const c of cargos) chips.append(h('button', { type: 'button', class: 'chip' + (c === ctx.trouxeCargo ? ' on' : ''), onclick: () => ctx.onTrouxeCargo(c) }, cargoCurto(c)));
  const ord = h('div', { class: 'chips' });
  for (const [k, t] of [['est', '% dos eleitores'], ['votos', 'votos levados']]) ord.append(h('button', { type: 'button', class: 'chip' + (k === ctx.trouxeOrd ? ' on' : ''), onclick: () => ctx.onTrouxeOrd(k) }, t));
  b.append(chips, ord);
  const res = ctx.trouxe();
  if (!res || res.loading) { b.append(h('div', { class: 'side-note' }, 'Calculando todos os candidatos…'), h('div', { class: 'skel', style: { height: '260px' } })); return; }
  const lista = res.lista.slice().sort((p, q) => (ctx.trouxeOrd === 'votos' ? q.comum - p.comum : q.est - p.est)).slice(0, 25);
  if (!lista.length) { b.append(h('div', { class: 'side-note' }, 'Nenhum candidato com votos suficientes neste recorte.')); return; }
  const max = Math.max(...lista.map((l) => (ctx.trouxeOrd === 'votos' ? l.comum : l.est)));
  lista.forEach((l, i) => {
    const c = candOf(l.key);
    if (!c) return;
    const val = ctx.trouxeOrd === 'votos' ? l.comum : l.est;
    b.append(h('button', { type: 'button', class: 'row rk' + (l.key === A.x ? ' on' : ''), onclick: () => ctx.onX(l.key), title: `Ver ${c.nome} × ${cy.nome}` },
      h('span', { class: 'rk-i tn' }, String(i + 1)), avatar(c, 34),
      h('span', { class: 'row-n' }, h('b', null, c.nome), h('span', null, `${c.partido} ${c.n} · ${fInt(l.tx)} votos`)),
      h('span', { class: 'row-v tn' }, h('b', null, ctx.trouxeOrd === 'votos' ? `~${fInt(l.comum)}` : `${fP0(l.est)}`),
        h('span', { class: 'meter' }, h('i', { style: { width: `${Math.max(2, (val / max) * 100)}%`, background: 'var(--x)' } })),
        h('span', null, ctx.trouxeOrd === 'votos' ? `${fP0(l.est)} deles` : `~${fInt(l.comum)} votos`))));
  });
  b.append(h('div', { class: 'side-note' }, `% estimada dos eleitores de cada candidato que também votou em ${Y}, por seção, presa aos limites certos de cada urna. Candidatos com menos de ${fInt(res.minimo)} votos no recorte ficam de fora (a conta vira ruído). Toque para comparar.`));
}

function junto(b, ctx) {
  const cx = candOf(A.x);
  if (!D.af) { b.append(h('div', { class: 'skel', style: { height: '220px' } })); return; }
  const af = D.af[A.x];
  b.append(h('div', { class: 'sec-t' }, h('b', null, `Quem mais anda junto com ${curto(cx.nome)}`)));
  if (!af) { b.append(h('div', { class: 'side-note' }, 'Sem dados de afinidade para este candidato.')); return; }
  const cargos = Object.keys(af).filter((k) => k !== 'n').map(Number);
  if (!ctx.afCargo || !cargos.includes(ctx.afCargo)) ctx.afCargo = cargos.includes(cargoOf(A.y)) && cargoOf(A.y) !== cargoOf(A.x) ? cargoOf(A.y) : cargos.find((c) => c !== cargoOf(A.x) && c !== 1) || cargos[0];
  const chips = h('div', { class: 'chips' });
  for (const c of cargos) chips.append(h('button', { type: 'button', class: 'chip' + (c === ctx.afCargo ? ' on' : ''), onclick: () => ctx.onAfCargo(c) }, cargoCurto(c)));
  b.append(chips);
  const lista = af[String(ctx.afCargo)] || [];
  const pos = lista.filter((x) => x[1] > 0).slice(0, 8), neg = lista.filter((x) => x[1] < 0).slice(-3).reverse();
  const linha = ([num, rr, lift]) => {
    const key = `${ctx.afCargo}:${num}`, c = candOf(key);
    if (!c) return null;
    return h('button', { type: 'button', class: 'row' + (key === A.y ? ' on' : ''), onclick: () => ctx.onY(key), title: `Comparar com ${c.nome}` },
      avatar(c, 34), h('span', { class: 'row-n' }, h('b', null, c.nome), h('span', null, `${c.partido} ${c.n}${situacao(c.sit) ? ' · ' + situacao(c.sit) : ''}`)),
      h('span', { class: 'row-v tn' }, h('b', null, fR(rr)), h('span', { class: 'meter' }, h('i', { style: { width: `${Math.min(100, Math.abs(rr) * 100)}%`, background: rr >= 0 ? 'var(--up)' : 'var(--down)' } })), h('span', null, fX(lift))));
  };
  b.append(...pos.map(linha));
  if (neg.length) b.append(h('div', { class: 'sec-t', style: { marginTop: '12px' } }, h('b', null, 'Mais distantes')), ...neg.map(linha));
  b.append(h('div', { class: 'side-note' }, `Correlação no estado inteiro, por local de votação; embaixo, a afinidade.${af.n != null && af.n < 300 ? ' Poucos votos: leitura frágil.' : ''} Toque para comparar.`));
}

function onde(b, level, id, ctx) {
  const { level: cl, items } = childrenOf(level, id);
  if (!cl || !items.length || !D.un[cl]) { b.append(h('div', { class: 'side-note' }, 'Sem subdivisões neste recorte.')); return; }
  const r = recorte(level, id);
  const vals = items.map((p) => ({ p, v: valorDe(cl, p.id) })).filter((x) => x.v && x.v.dx > 0);
  const ord = ctx.ondeOrd || 'x';
  vals.sort((a, c) => (ord === 'x' ? c.v.x - a.v.x : ord === 'y' ? c.v.y - a.v.y : c.v.dx - a.v.dx));
  const chips = h('div', { class: 'chips' });
  for (const [k, t] of [['x', `por ${curto(nomeCand(A.x))}`], ['y', `por ${curto(nomeCand(A.y))}`], ['ap', 'por eleitores']]) chips.append(h('button', { type: 'button', class: 'chip' + (k === ord ? ' on' : ''), onclick: () => ctx.onOndeOrd(k) }, t));
  b.append(h('div', { class: 'sec-t' }, h('b', null, `${LEVEL_INFO[cl].plural} (${vals.length})`)), chips);
  const lim = ctx.mais ? vals.length : 25;
  for (const { p, v } of vals.slice(0, lim)) {
    const k = classeBiv(v, r.px, r.py);
    b.append(h('button', { type: 'button', class: 'row', onclick: () => ctx.onSelect(cl, p.id) },
      h('span', { class: 'sw', style: { background: k >= 0 ? BIV[k] : SEM_DADO }, title: textoBiv(k) }),
      h('span', { class: 'row-n' }, h('b', null, cl === 'secao' ? `Seção ${p.nr}` : p.n), h('span', null, `${fInt(v.dx)} compareceram`)),
      h('span', { class: 'row-v tn' }, h('b', { style: { color: 'var(--x)' } }, fP(v.px)), h('span', { style: { color: 'var(--y)' } }, fP(v.py)))));
  }
  if (vals.length > lim) b.append(h('button', { type: 'button', class: 'more-btn', onclick: ctx.onMais }, `Mostrar todos (${vals.length})`));
}

function pontos(b, level, id, ctx) {
  const r = recorte(level, id);
  if (r.n < 3) { b.append(h('div', { class: 'side-note' }, 'Poucas unidades para desenhar.')); return; }
  b.append(h('div', { class: 'sec-t' }, h('b', null, `Cada ponto é ${r.unidade === 'local' ? 'um local de votação' : 'uma seção'}`)), scatter(r, ctx.onSelect),
    h('div', { class: 'side-note' }, 'Tamanho = eleitores; cor = a mesma do mapa; reta = tendência; tracejado = média do recorte. Pontos em L, encostados nos eixos, indicam territórios separados.'));
}

function scatter(r, onPick) {
  const W = 330, H = 300, P = { l: 46, r: 8, t: 8, b: 30 };
  const wrap = h('div', { class: 'sc' });
  const cv = h('canvas', { width: W * 2, height: H * 2, role: 'img', 'aria-label': `Dispersão: ${nomeCand(A.x)} na horizontal, ${nomeCand(A.y)} na vertical, ${r.n} unidades` });
  const tip = h('div', { class: 'sc-tip', hidden: true });
  wrap.append(cv, tip);
  const q = (arr, f) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))] || 0; };
  const mx = Math.max(q(r.xs, 0.995), r.px * 2, 1e-4) * 1.05, my = Math.max(q(r.ys, 0.995), r.py * 2, 1e-4) * 1.05;
  const X = (v) => P.l + (Math.min(v, mx) / mx) * (W - P.l - P.r), Y = (v) => H - P.b - (Math.min(v, my) / my) * (H - P.t - P.b);
  const wmax = Math.max(...r.ws);
  const pts = r.xs.map((x, i) => ({ i, x: X(x), y: Y(r.ys[i]), rad: 1.4 + 4.6 * Math.sqrt(r.ws[i] / wmax), k: terco(x, r.px) + 3 * terco(r.ys[i], r.py) }));
  const c = cv.getContext('2d');
  c.scale(2, 2);
  c.font = '10.5px Geist, system-ui, sans-serif';
  c.strokeStyle = 'rgba(250,250,249,0.07)'; c.fillStyle = '#827c72'; c.lineWidth = 1;
  for (let t = 0; t <= 4; t++) {
    const vx = (mx * t) / 4, vy = (my * t) / 4;
    c.beginPath(); c.moveTo(X(vx), P.t); c.lineTo(X(vx), H - P.b); c.stroke();
    c.beginPath(); c.moveTo(P.l, Y(vy)); c.lineTo(W - P.r, Y(vy)); c.stroke();
    c.textAlign = 'center'; c.fillText(fPct(vx * 100), X(vx), H - P.b + 13);
    c.textAlign = 'right'; c.fillText(fPct(vy * 100), P.l - 5, Y(vy) + 3.5);
  }
  c.setLineDash([3, 3]); c.strokeStyle = 'rgba(250,250,249,0.25)';
  c.beginPath(); c.moveTo(X(r.px), P.t); c.lineTo(X(r.px), H - P.b); c.stroke();
  c.beginPath(); c.moveTo(P.l, Y(r.py)); c.lineTo(W - P.r, Y(r.py)); c.stroke();
  c.setLineDash([]);
  for (const p of pts.slice().sort((a, b) => b.rad - a.rad)) {
    c.beginPath(); c.arc(p.x, p.y, p.rad, 0, Math.PI * 2);
    c.fillStyle = BIV[p.k]; c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
    c.lineWidth = 0.8; c.strokeStyle = '#161513'; c.stroke();
  }
  if (r.gd && r.gd.b != null) {
    c.strokeStyle = '#fafaf9'; c.lineWidth = 1.6;
    const yAt = (x) => r.gd.a + r.gd.b * x;
    c.beginPath(); c.moveTo(X(0), Y(Math.max(0, Math.min(my, yAt(0))))); c.lineTo(X(mx), Y(Math.max(0, Math.min(my, yAt(mx))))); c.stroke();
  }
  c.fillStyle = '#6aa8f5'; c.textAlign = 'right'; c.fillText(`${curto(nomeCand(A.x))} →`, W - P.r, H - 4);
  c.save(); c.translate(10, P.t); c.rotate(-Math.PI / 2); c.fillStyle = '#f4f1ea'; c.textAlign = 'right'; c.fillText(`${curto(nomeCand(A.y))} →`, 0, 0); c.restore();
  const near = (ev) => {
    const bb = cv.getBoundingClientRect(), s = W / bb.width;
    const x = (ev.clientX - bb.left) * s, y = (ev.clientY - bb.top) * s;
    let best = null, bd = 144;
    for (const p of pts) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
    return best && { p: best, s };
  };
  cv.addEventListener('pointermove', (ev) => {
    const n = near(ev);
    if (!n) { tip.hidden = true; cv.style.cursor = ''; return; }
    const id = r.ids[n.p.i], pr = getProps(r.unidade, id);
    clear(tip).append(h('b', null, pr ? entityName(r.unidade, pr) : ''), h('span', null, `${curto(nomeCand(A.x))} ${fP(r.xs[n.p.i])} · ${curto(nomeCand(A.y))} ${fP(r.ys[n.p.i])}`));
    tip.hidden = false;
    tip.style.left = `${Math.min(n.p.x / n.s, W / n.s - 210)}px`; tip.style.top = `${n.p.y / n.s + 12}px`;
    cv.style.cursor = 'pointer';
  });
  cv.addEventListener('pointerleave', () => { tip.hidden = true; });
  cv.addEventListener('click', (ev) => { const n = near(ev); if (n) onPick(r.unidade, r.ids[n.p.i]); });
  return wrap;
}

// ------------------------------------------------------------------ Brasil (tela inicial)
export function renderMainBR(el, { onSearch, onCand, sugestoes }) {
  const frag = [
    h('div', { class: 'eyebrow' }, h('b', null, 'Eleições 2026'), h('span', null, '·'), h('span', null, '1º turno, 4 de outubro')),
    h('h1', { class: 'hero' }, 'Quem vota em ', h('em', null, 'quem'), '?'),
    h('p', { class: 'lede' }, 'Escolha um candidato e descubra, urna por urna, em quem mais votaram os eleitores dele: para governador, senador, deputado ou presidente. Ou compare com a esquerda (Lula) e a direita (Bolsonaro).'),
    h('button', { type: 'button', class: 'hero-search', onclick: onSearch }, ICON.busca(), 'Busque um candidato: nome, partido ou número'),
  ];
  const sug = h('div', { class: 'sug' }, h('div', { class: 'sec-t' }, h('b', null, 'Mais votados')));
  if (!sugestoes) sug.append(h('div', { class: 'skel', style: { height: '180px' } }));
  else for (const c of sugestoes) {
    sug.append(h('button', { type: 'button', class: 'row', onclick: () => onCand(c) }, avatar(c, 34),
      h('span', { class: 'row-n' }, h('b', null, c.nome), h('span', null, `${cargoCurto(c.cargo)} · ${c.partido} · ${c.uf === 'br' ? 'Brasil' : c.uf.toUpperCase()}`)),
      h('span', { class: 'row-v tn' }, h('b', null, fInt(c.votos)), h('span', null, situacao(c.sit)))));
  }
  frag.push(sug, h('p', { class: 'small muted', style: { marginTop: '18px' } }, 'Dados: boletins de urna de cada seção e divulgação oficial do TSE. Nada de pesquisa: só o que saiu das urnas.'));
  clear(el).append(...frag);
}

export function renderSideBR(el, onUF) {
  const ufs = [...BR.ufs.values()].sort((a, b) => a.n.localeCompare(b.n, 'pt-BR'));
  const b = h('div', { class: 'side-b' }, h('div', { class: 'sec-t' }, h('b', null, 'Estados'), 'Lula × Bolsonaro'));
  for (const u of ufs) {
    const t = u.esq + u.dir;
    b.append(h('button', { type: 'button', class: 'row uf-row', disabled: !u.ok || null, onclick: () => onUF(u.uf), title: u.ok ? `Abrir ${u.n}` : 'Dados ainda não processados' },
      h('span', { class: 'av', style: { width: '30px', height: '30px', '--pc': 'transparent' } }, h('b', { style: { fontSize: '11px', color: 'var(--ink-2)' } }, u.uf.toUpperCase())),
      h('span', { class: 'row-n' }, h('b', null, u.n), h('span', null, u.ok ? `${fInt(u.cp)} votaram` : 'em processamento')),
      t ? h('span', { class: 'row-v tn' }, h('span', null, `${fP0(u.esq / t)} · ${fP0(u.dir / t)}`), h('span', { class: 'split' }, h('i', { style: { width: `${(u.esq / t) * 70}px` } }), h('i'))) : h('span')));
  }
  clear(el).append(b);
}
