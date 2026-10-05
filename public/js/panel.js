// Cartões da interface: a pergunta e a resposta (esquerda), "em comum / onde / pontos" (direita), a tela inicial do
// Brasil, a legenda, a trilha e a dica do mapa. Texto dos dados entra sempre por textContent (h()).
import { A, rPorUnidade, recorte, territorio, valorDe } from './analise.js';
import { BR, D, LEVEL_INFO, candOf, cargoOf, childrenOf, entityName, getProps, parentChain } from './data.js';
import { clear, fInt, fPct, h } from './fmt.js';
import { BIV, BIV_TXT, DIV, SEM_DADO, YX } from './scales.js';
import { leitura, respostaModelos, terco } from './stats.js';
import { ICON, avatar, cargoCurto, chipCand, curto, situacao } from './ui.js';

const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fR = (r) => (r == null || Number.isNaN(r) ? '—' : (r < 0 ? '−' : '') + nf2.format(Math.abs(r)));
const fX = (x) => (x == null ? '—' : `${nf2.format(x)}×`);
const fP = (x) => (x == null ? '—' : fPct(x * 100));
// percentual com casas só quando o número é pequeno (0,53% não pode virar "1%")
const fP0 = (x) => (x == null ? '—' : x >= 0.095 ? `${Math.round(x * 100)}%` : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: x >= 0.0095 ? 1 : 2 }).format(x * 100)}%`);
const fPP = (x) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Math.abs(x * 100))} pontos`;
const nomeCand = (key) => candOf(key)?.nome || '';
// estimativas em números absolutos: 2 algarismos significativos, para não parecer contagem (5.318 → "5,3 mil")
const sig2 = new Intl.NumberFormat('pt-BR', { maximumSignificantDigits: 2 });
const fEstim = (n) => (n >= 1e6 ? `${sig2.format(n / 1e6)} ${n >= 2e6 ? 'milhões' : 'milhão'}` : n >= 1e3 ? `${sig2.format(n / 1e3)} mil` : sig2.format(n));
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
      clear(this.el).append(h('div', { class: 'tip-h' }, 'Estado'), h('div', { class: 'tip-n' }, p.n),
        this.linha('Compareceram', fInt(p.cp)),
        h('div', { class: 'tip-f' }, p.ok ? 'Clique para abrir' : 'Dados em processamento'));
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
  const nx = () => sp('x', X), ny = () => sp('y', Y);
  const m = r.exclusivos ? null : respostaModelos(r);
  const frag = [];
  frag.push(h('div', { class: 'eyebrow' }, h('b', null, D.meta.uf_nome), h('span', null, '·'), h('span', null, '1º turno 2026'), level !== 'estado' ? [h('span', null, '·'), h('b', null, nome)] : null));
  frag.push(h('div', { class: 'q' },
    h('div', { class: 'q-row' }, h('p', { class: 'q-l' }, 'Quem vota em'), h('button', { class: 'q-swap', type: 'button', onclick: ctx.onSwap, title: 'Inverter (I)' }, ICON.trocar(), 'inverter')),
    chipCand('x', cx, { onClick: () => ctx.onPick('x'), rotulo: 'X' }),
    h('p', { class: 'q-l' }, 'também vota em'),
    chipCand('y', cy, { onClick: () => ctx.onPick('y'), rotulo: 'Y' })));

  // ---- manchete: cautelosa ("parecem"), e só afirma direção quando as duas hipóteses concordam
  let titulo;
  if (r.exclusivos) {
    const l = r.r == null ? { k: 'nd' } : leitura(r.r, r.lift, r.ci);
    titulo = l.k === 'pos' ? [nx(), ' e ', ny(), ' disputam votos nos mesmos lugares.'] : l.k === 'neg' ? [nx(), ' e ', ny(), ' têm territórios diferentes.'] : [nx(), ' e ', ny(), ' não disputam o mesmo território.'];
  } else if (!m) titulo = ['Sem dados suficientes neste recorte.'];
  else {
    // primeiro o quanto (absoluto), depois a comparação: "votou mais em Y que os demais" sozinho soa como maioria
    const quanto = (lo, hi) => (Math.abs(hi - lo) < 0.005 ? `~${fP0(lo)}` : `de ${fP0(lo)} a ${fP0(hi)}`);
    const comp = { sim: m.forte ? 'bem mais que' : 'um pouco mais que', nao: m.forte ? 'bem menos que' : 'um pouco menos que', igual: 'como', diverge: null }[m.k];
    titulo = ['Estima-se que ', quanto(m.modelos[0], m.modelos[1]), ' dos eleitores de ', nx(), ' votaram em ', ny(),
      comp ? `: ${comp} os demais eleitores (${quanto(m.demais[0], m.demais[1]).replace(/^de /, '')}).` : '. Não dá para afirmar se mais ou menos que os demais.'];
  }
  frag.push(h('div', { class: 'answer' }, h('h2', { class: 'verdict' }, ...titulo)));

  // ---- 1. o que é certo (matemática das urnas, sem hipótese)
  const camada = (rot, cls, ...filhos) => h('section', { class: `camada ${cls}` }, h('div', { class: 'camada-t' }, rot), ...filhos);
  if (r.exclusivos) {
    frag.push(camada('Certo, pelas urnas', 'c1', h('p', null, `${X} e ${Y} disputam a mesma vaga, e a urna aceita um voto só para ela: nenhum eleitor pode ter votado nos dois. A pergunta passa a ser se disputam os mesmos lugares.`)));
  } else if (r.lim && r.tx > 0) {
    frag.push(camada('Certo, pelas urnas', 'c1',
      h('p', null, `Pelos totais de cada urna, o número de eleitores que votaram em ${X} e também em ${Y} só pode estar `, h('b', null, `entre ${fInt(r.lim.lo)} e ${fInt(r.lim.hi)}`), ` (${fP0(r.lim.loF)} a ${fP0(r.lim.hiF)} dos ${fInt(r.tx)} votos de ${X}).`),
      h('p', { class: 'nota' }, 'É um limite matemático, não uma contagem: o voto é secreto e ninguém sabe quem são essas pessoas. Em cada urna, os eleitores dos dois não podem passar do menor dos dois números de votos',
        r.lim.lo > 0 ? ' nem ficar abaixo da soma dos dois menos o comparecimento' : ' (e o mínimo possível é zero)', '; somando as urnas, sai esta faixa.')));
  }

  // ---- 2. o que o mapa mostra (coincidência, não causa)
  const linhasMapa = [];
  if (r.r != null) {
    if (r.r >= 0.2) linhasMapa.push(`Onde ${X} foi melhor, ${Y} também foi (correlação ${fR(r.r)}).`);
    else if (r.r <= -0.2) linhasMapa.push(`Onde ${X} foi melhor, ${Y} foi pior (correlação ${fR(r.r)}).`);
    else linhasMapa.push(`Os votos dos dois quase não coincidem no mapa (correlação ${fR(r.r)})${r.px < 0.1 && m?.k === 'sim' ? `: ${X} tem poucos votos em cada urna, então mesmo uma preferência forte dos eleitores dele mexe pouco no resultado de ${Y}` : ''}.`);
    if (Math.abs(r.r) >= 0.2 && r.rw != null) linhasMapa.push(Math.abs(r.rw) < 0.1 ? `Dentro de cada um dos ${r.blocos}, porém, quase não há relação: boa parte da coincidência é regional.` : `O padrão se repete dentro dos ${r.blocos} (${fR(r.rw)}), não é só regional.`);
  }
  const tt = territorio(level, id);
  if (tt.n > 1 && tt.eleitores > 0.05) {
    const peso = tt.votosY / tt.eleitores, fx = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(peso);
    const leit = peso >= 1.2 ? `${fx}× o peso dessas seções no eleitorado` : peso >= 1.05 ? 'um pouco acima do peso dessas seções no eleitorado' : peso > 0.95 ? 'o mesmo que o peso dessas seções no eleitorado' : peso > 0.83 ? 'um pouco abaixo do peso dessas seções no eleitorado' : 'bem abaixo do peso dessas seções no eleitorado';
    linhasMapa.push(`As seções onde ${X} é mais forte reúnem ${fP0(tt.eleitores)} dos eleitores e deram ${fP0(tt.votosY)} dos votos de ${Y}: ${leit}.`);
  }
  if (linhasMapa.length) frag.push(camada('O que o mapa mostra', 'c2', ...linhasMapa.map((t) => h('p', null, t)),
    h('p', { class: 'nota' }, 'Coincidência no mapa não é causa: dois candidatos podem ser fortes nos mesmos lugares por razões próprias.')));

  // ---- 3. o que se estima (depende de hipótese: mostra as duas)
  if (m && r.lim) {
    const topo = Math.max(m.modelos[1], m.demais[1], r.lim.hiF < 0.25 ? r.lim.hiF : 0);
    const escala = topo < 0.25 ? Math.max(topo * 1.3, 0.002) : 1;
    const pct = (x) => `${Math.max(0, Math.min(100, (x / escala) * 100))}%`;
    const faixa = (lo, hi, cls, t) => h('span', { class: cls, style: { left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }, title: t });
    const barraM = (rot, val, extra) => h('div', { class: 'est-r' }, h('div', { class: 'bar-l' }, h('span', null, ...rot), h('b', { class: 'tn' }, val)), h('div', { class: 'est-bar' }, ...extra));
    const rotulo = (a, b) => (Math.abs(a - b) < 0.005 ? `~${fP0(a)}` : `${fP0(a)} a ${fP0(b)}`);
    frag.push(camada('O que se estima', 'c3',
      barraM(['Dos eleitores de ', nx()], rotulo(m.modelos[0], m.modelos[1]), [
        faixa(r.lim.loF, Math.min(r.lim.hiF, escala), 'est-certo', `limite certo: ${fP0(r.lim.loF)} a ${fP0(r.lim.hiF)}`),
        faixa(m.modelos[0], Math.max(m.modelos[1], m.modelos[0] + escala * 0.012), 'est-mod', `entre as duas hipóteses: ${fP0(m.modelos[0])} a ${fP0(m.modelos[1])}`)]),
      barraM(['Dos demais eleitores'], rotulo(m.demais[0], m.demais[1]), [faixa(m.demais[0], Math.max(m.demais[1], m.demais[0] + escala * 0.012), 'est-dem', 'demais eleitores')]),
      h('p', null, `votaram em ${Y}, estima-se. Em números absolutos, a faixa equivale a cerca de ${fEstim(m.modelos[0] * r.tx)} a ${fEstim(m.modelos[1] * r.tx)} ${m.modelos[1] * r.tx >= 1e6 ? 'de ' : ''}eleitores: é a proporção estimada vezes os votos de ${X}, uma ordem de grandeza, não uma contagem de pessoas. As duas pontas vêm de hipóteses diferentes: o eleitor de ${X} vota como os vizinhos da mesma urna, ou todo o padrão entre urnas é preferência dele. A verdade costuma ficar entre elas; a faixa clara é o limite certo.`),
      m.k === 'diverge' ? h('p', { class: 'nota warn' }, 'As duas hipóteses apontam em sentidos opostos: não dá para afirmar a direção.') : null,
      m.impreciso ? h('p', { class: 'nota warn' }, `A regressão é imprecisa aqui (faixa provável ${fP0(r.gd.lo)} a ${fP0(r.gd.hi)}): leia como ordem de grandeza.`) : null,
      escala < 1 ? h('p', { class: 'nota' }, `Barras ampliadas: o fim da barra é ${fP0(escala)}.`) : null));
  }

  if (!r.exclusivos) {
    const ds = ctx.distribuicao?.();
    const cargoNomeY = (D.cargos.get(cy.cargo)?.nome || '').toLowerCase();
    const caixa = camada(`Como os eleitores de ${X} se dividem para ${cargoNomeY} (estimativa)`, 'c3');
    if (!ds || ds.loading) caixa.append(h('div', { class: 'skel', style: { height: '120px' } }));
    else if (ds.length) {
      const fim = Math.max(...ds.map((d) => Math.max(d.modelos[1], d.demais[1])));
      const esc = fim < 0.25 ? Math.max(fim * 1.3, 0.002) : 1;
      const pc = (x) => `${Math.max(0, Math.min(100, (x / esc) * 100))}%`;
      for (const d of ds) {
        const c = candOf(d.key);
        if (!c) continue;
        const txt = Math.abs(d.modelos[1] - d.modelos[0]) < 0.005 ? `~${fP0(d.modelos[0])}` : `${fP0(d.modelos[0])}–${fP0(d.modelos[1])}`;
        caixa.append(h('button', { type: 'button', class: 'ds-r' + (d.key === A.y ? ' on' : ''), onclick: () => ctx.onY(d.key), title: `Comparar com ${c.nome}` },
          avatar(c, 26), h('span', { class: 'ds-n' }, c.nome),
          h('span', { class: 'ds-b' }, h('i', { class: 'm', style: { left: pc(d.modelos[0]), width: `calc(${pc(Math.max(d.modelos[1], d.modelos[0] + esc * 0.012))} - ${pc(d.modelos[0])})` } }),
            h('i', { class: 'd', style: { left: pc((d.demais[0] + d.demais[1]) / 2) }, title: `demais eleitores: ${fP0(d.demais[0])} a ${fP0(d.demais[1])}` })),
          h('b', { class: 'ds-v tn' }, txt)));
      }
      caixa.append(h('p', { class: 'nota' }, `Estimativa nas duas hipóteses. O traço cinza é a taxa dos demais eleitores. Os principais candidatos do cargo; o resto vai para outros candidatos, brancos e nulos.${esc < 1 ? ` Escala ampliada até ${fP0(esc)}.` : ''}`));
    }
    frag.push(caixa);
  }
  frag.push(h('p', { class: 'aviso' }, ICON.info(), h('span', null, 'O voto é secreto: este site não sabe em quem cada pessoa votou. Tudo aqui sai do total de votos de cada urna: limites matemáticos, coincidências no mapa e estimativas estatísticas. Nenhum número é contagem de pessoas, e coincidência não é causa nem transferência de votos.')));

  const ci = (k) => (r.ci?.[k] ? ` (${fR(r.ci[k][0])} a ${fR(r.ci[k][1])})` : '');
  frag.push(h('details', { class: 'more' }, h('summary', null, 'Números completos e como ler'),
    h('div', { class: 'more-b' },
      h('div', { class: 'kv' }, h('span', null, `Votos de ${X}`), h('b', { class: 'tn' }, `${fInt(r.tx)} (${fP(r.px)})`)),
      h('div', { class: 'kv' }, h('span', null, `Votos de ${Y}`), h('b', { class: 'tn' }, `${fInt(r.ty)} (${fP(r.py)})`)),
      r.lim ? h('div', { class: 'kv' }, h('span', null, 'Eleitores dos dois (limite certo)'), h('b', { class: 'tn' }, `${fInt(r.lim.lo)} a ${fInt(r.lim.hi)}`)) : null,
      r.gd ? h('div', { class: 'kv' }, h('span', null, 'Regressão (Goodman)'), h('b', { class: 'tn' }, `${fP(r.gd.est)}${r.gd.lo != null ? ` (${fP0(r.gd.lo)} a ${fP0(r.gd.hi)})` : ''}`)) : null,
      r.viz ? h('div', { class: 'kv' }, h('span', null, 'Vizinhança'), h('b', { class: 'tn' }, fP(r.viz.est))) : null,
      h('div', { class: 'kv' }, h('span', null, 'Correlação'), h('b', { class: 'tn' }, fR(r.r) + ci('r'))),
      r.rw != null ? h('div', { class: 'kv' }, h('span', null, `Dentro dos ${r.blocos}`), h('b', { class: 'tn' }, fR(r.rw) + ci('rw'))) : null,
      h('div', { class: 'kv' }, h('span', null, 'Afinidade'), h('b', { class: 'tn' }, fX(r.lift) + (r.ci?.lift ? ` (${fX(r.ci.lift[0])} a ${fX(r.ci.lift[1])})` : ''))),
      h('div', { class: 'kv' }, h('span', null, 'Seções analisadas'), h('b', { class: 'tn' }, fInt(r.n))),
      h('p', null, h('b', null, 'O que este site não sabe. '), 'Em quem cada pessoa votou: o voto é secreto. Também não sabe por que alguém votou: coincidência de votos não prova apoio, campanha conjunta nem transferência.'),
      h('p', null, h('b', null, 'Certo. '), 'Em cada seção, os eleitores dos dois não passam de min(X, Y) nem ficam abaixo de X + Y − comparecimento. Somando as seções, sai a faixa certa. Vale sempre, sem hipótese, mas é um limite, não uma contagem.'),
      h('p', null, h('b', null, 'Mapa. '), 'Correlação e afinidade medem se os votos caem nos mesmos lugares. "Dentro dos municípios" desconta a média de cada cidade e separa coincidência regional de eleitorado em comum.'),
      h('p', null, h('b', null, 'Estimativa. '), 'Inferência ecológica com duas hipóteses extremas: vizinhança (o eleitor de X vota como os vizinhos de urna) e regressão de Goodman (todo o padrão entre urnas é preferência individual), as duas presas, urna a urna, aos limites certos. A manchete só afirma uma direção quando as duas concordam. Faixa da regressão por reamostragem de municípios.'),
      h('p', { class: 'muted' }, `Fonte: ${D.meta.fonte}. Zonas, bairros, locais e seções são áreas aproximadas em volta dos locais de votação.`))));
  clear(el).append(...frag);
}

// ------------------------------------------------------------------ cartão lateral (UF)
export function renderSide(el, level, id, ctx) {
  const tab = ctx.tab || 'comum';
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  for (const [k, t] of [['comum', 'Em comum'], ['onde', 'Onde'], ['pontos', 'Pontos']]) tabs.append(h('button', { type: 'button', role: 'tab', class: 'tab' + (k === tab ? ' on' : ''), 'aria-selected': String(k === tab), onclick: () => ctx.onTab(k) }, t));
  const b = h('div', { class: 'side-b' });
  if (tab === 'comum') emComum(b, ctx);
  else if (tab === 'onde') onde(b, level, id, ctx);
  else pontos(b, level, id, ctx);
  clear(el).append(tabs, b);
}

/**
 * "Em comum", nos dois sentidos: em quem votaram os eleitores de X (por cargo) e os eleitores de quem votaram em Y.
 * Faixa entre as duas hipóteses; o traço cinza é a taxa dos demais eleitores.
 */
function emComum(b, ctx) {
  const cx = candOf(A.x), cy = candOf(A.y), X = curto(cx.nome), Y = curto(cy.nome);
  const de = ctx.sentido === 'de';
  const seg = h('div', { class: 'seg seg-full' });
  for (const [k, t] of [['de', ['Eleitores de ', sp('x', X)]], ['para', ['Eleitores de ', sp('y', Y)]]])
    seg.append(h('button', { type: 'button', class: k === ctx.sentido ? 'on' : '', onclick: () => ctx.onSentido(k) }, ...t));
  b.append(seg);
  b.append(h('div', { class: 'sec-t' }, h('b', null, de ? `Os eleitores de ${X} votaram em quem?` : `Que eleitorados mais coincidem com o de ${Y}?`), 'estimativa'));
  const cargoFixo = de ? cx.cargo : cy.cargo;
  const chips = h('div', { class: 'chips' });
  for (const c of D.cargos.keys()) if (c !== cargoFixo || c === 5) chips.append(h('button', { type: 'button', class: 'chip' + (c === ctx.comumCargo ? ' on' : ''), onclick: () => ctx.onComumCargo(c) }, cargoCurto(c)));
  b.append(chips);
  // ordem só existe no sentido "eleitores de Y": lá a proporção e o número de eleitores contam histórias diferentes
  const porN = !de && ctx.ordem === 'n';
  if (!de) {
    const ord = h('div', { class: 'seg' });
    for (const [k, t] of [['pct', 'Proporção'], ['n', 'Volume estimado']]) ord.append(h('button', { type: 'button', class: k === ctx.ordem ? 'on' : '', onclick: () => ctx.onOrdem(k) }, t));
    b.append(ord, h('p', { class: 'side-note ord-nota' }, porN
      ? `A proporção estimada vezes os votos de cada candidato: dá a escala, em eleitores, não uma contagem de quem votou nos dois (o voto é secreto). Favorece candidatos com muitos votos.`
      : `Que parte dos eleitores de cada candidato, estima-se, também votou em ${Y}. Favorece eleitorados fiéis, mesmo pequenos.`));
  }
  const res = ctx.comum();
  if (!res || res.loading) { b.append(h('div', { class: 'side-note' }, 'Calculando todos os candidatos…'), h('div', { class: 'skel', style: { height: '260px' } })); return; }
  // normaliza os dois sentidos: base = eleitores de quem a % se refere; demais = taxa dos outros eleitores
  const linhas = res.lista.map((l) => (de
    ? { key: l.key, lo: Math.min(l.est, l.viz), hi: Math.max(l.est, l.viz), base: res.tx, votos: l.ty, dem: l.demais }
    : { key: l.key, lo: Math.min(l.est, l.viz), hi: Math.max(l.est, l.viz), base: l.tx, votos: l.tx, dem: l.demais != null ? [l.demais, l.demais] : null }));
  const meio = (l) => (l.lo + l.hi) / 2;
  const chave = (l) => (porN ? meio(l) * l.base : de ? meio(l) : l.lo);
  const lista = linhas.filter((l) => l.hi >= 0.0005).sort((p, q) => chave(q) - chave(p)).slice(0, 25);
  if (!lista.length) { b.append(h('div', { class: 'side-note' }, 'Nenhum candidato com votos suficientes neste recorte.')); return; }
  const max = Math.max(...lista.map((l) => (porN ? l.hi * l.base : Math.max(l.hi, l.dem ? Math.max(...l.dem) : 0)))) || 1;
  const faixaTxt = (l) => (l.hi - l.lo < 0.01 ? `~${fP0(meio(l))}` : `${fP0(l.lo)}–${fP0(l.hi)}`);
  const pessoas = (l) => `≈ ${fEstim(meio(l) * l.base)} (estim.)`;
  lista.forEach((l, i) => {
    const c = candOf(l.key);
    if (!c) return;
    const esc = porN ? l.base : 1, pc = (v) => `${Math.min(100, ((v * esc) / max) * 100)}%`;
    const alvo = de ? A.y : A.x;
    b.append(h('button', { type: 'button', class: 'row rk' + (l.key === alvo ? ' on' : ''), onclick: () => (de ? ctx.onY(l.key) : ctx.onX(l.key)), title: de ? `Comparar ${cx.nome} com ${c.nome}` : `Ver ${c.nome} × ${cy.nome}` },
      h('span', { class: 'rk-i tn' }, String(i + 1)), avatar(c, 34),
      h('span', { class: 'row-n' }, h('b', null, c.nome), h('span', null, `${c.partido} ${c.n} · ${fInt(l.votos)} votos`)),
      h('span', { class: 'row-v tn' }, h('b', { class: !porN && l.hi - l.lo > 0.35 ? 'larga' : null, title: l.hi - l.lo > 0.35 ? 'Faixa larga: os dados não separam bem as duas hipóteses' : null }, porN ? pessoas(l) : faixaTxt(l)),
        h('span', { class: 'meter rng' }, h('i', { style: { marginLeft: pc(l.lo), width: `max(3px, calc(${pc(l.hi)} - ${pc(l.lo)}))`, background: 'var(--x)' } }),
          !porN && l.dem ? h('b', { class: 'tick', style: { left: pc((l.dem[0] + l.dem[1]) / 2) } }) : null),
        h('span', { title: porN ? null : 'Proporção estimada vezes os votos: escala, não contagem de pessoas' }, porN ? faixaTxt(l) : pessoas(l)))));
  });
  const fragil = de && res.tx < res.minimo ? ` ${X} tem poucos votos neste recorte (${fInt(res.tx)}): leitura frágil.` : '';
  b.append(h('div', { class: 'side-note' }, de
    ? `Estimativa: que parte dos eleitores de ${X} votou em cada candidato, entre as duas hipóteses (vizinhança e regressão), presa urna a urna aos limites certos. O traço cinza é a taxa entre os demais eleitores. Faixa larga = pouca informação. Eleitorado em comum estimado: não é contagem de pessoas, transferência nem apoio.${fragil}`
    : `Estimativa: que parte dos eleitores de cada candidato também votou em ${Y}, entre as duas hipóteses (vizinhança e regressão), presa urna a urna aos limites certos.${porN ? '' : ' Ordenados pelo piso da faixa; o traço cinza é a taxa entre os demais eleitores.'} Faixa larga = pouca informação. Eleitorado em comum estimado: não é contagem de pessoas, transferência nem apoio. Ficam de fora candidatos com menos de ${fInt(res.minimo)} votos no recorte.`));
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
    h('p', { class: 'lede' }, 'Escolha dois candidatos e veja, urna por urna, o que se pode afirmar sobre os eleitores deles: o que é certo, o que o mapa mostra e o que se estima. Governador, senador, deputados ou presidente, em qualquer estado.'),
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
  const b = h('div', { class: 'side-b' }, h('div', { class: 'sec-t' }, h('b', null, 'Estados'), 'eleitores que votaram'));
  for (const u of ufs) {
    b.append(h('button', { type: 'button', class: 'row uf-row', disabled: !u.ok || null, onclick: () => onUF(u.uf), title: u.ok ? `Abrir ${u.n}` : 'Dados ainda não processados' },
      h('span', { class: 'av', style: { width: '30px', height: '30px', '--pc': 'transparent' } }, h('b', { style: { fontSize: '11px', color: 'var(--ink-2)' } }, u.uf.toUpperCase())),
      h('span', { class: 'row-n' }, h('b', null, u.n)),
      h('span', { class: 'row-v tn' }, h('b', null, u.ok ? fInt(u.cp) : '—'))));
  }
  clear(el).append(b);
}
