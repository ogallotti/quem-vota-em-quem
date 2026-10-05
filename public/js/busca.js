// Busca única (paleta): escolher X ou Y, ou buscar candidato e lugar de qualquer ponto do site.
//   sem texto: atalhos esquerda/direita (no Y), sugestões de quem anda junto com X e os mais votados do estado por cargo
//   com texto: candidatos do estado atual, do Brasil inteiro (outros estados trocam de UF) e lugares do estado
// Teclado: ↑ ↓ para andar, Enter escolhe, Esc fecha.
import { A } from './analise.js';
import { BR, D, LEVEL_INFO, candOf, loadCands, searchCands, searchPlaces } from './data.js';
import { clear, fInt, h } from './fmt.js';
import { ICON, avatar, cargoCurto, curto, situacao } from './ui.js';

let aberto = null;
export const buscaAberta = () => !!aberto;
export function fecharBusca() {
  if (!aberto) return;
  aberto.el.remove();
  aberto.foco?.focus?.();
  aberto = null;
}

/**
 * @param {object} o
 *   modo     'x' | 'y' | 'livre'
 *   onCand   (c) → escolheu um candidato (c.uf diz o estado; presidente tem uf 'br')
 *   onLugar  (level, id) → escolheu um lugar
 *   polos    { esq, dir } chaves dos polos (no Y)
 */
export function abrirBusca({ modo = 'livre', onCand, onLugar, polos = null, texto = '' }) {
  fecharBusca();
  const foco = document.activeElement;
  let cargo = modo === 'y' && A.x ? sugereCargo() : null;
  let sel = 0, itens = [];
  const input = h('input', { class: 'pal-q', type: 'search', placeholder: modo === 'livre' ? 'Candidato, partido, número, cidade, bairro…' : 'Nome, partido ou número', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Buscar', value: texto });
  const lista = h('div', { class: 'pal-list', role: 'listbox' });
  const tabs = h('div', { class: 'pal-tabs' });
  const ctxTxt = modo === 'x' ? ['Quem vota em ', h('span', { class: 'x' }, '…'), A.y ? [' também vota em ', h('span', { class: 'y' }, curto(candOf(A.y)?.nome))] : ''] : modo === 'y' && A.x ? ['Quem vota em ', h('span', { class: 'x' }, curto(candOf(A.x)?.nome)), ' também vota em ', h('span', { class: 'y' }, '…'), '?'] : null;
  const pal = h('div', { class: 'pal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Buscar' },
    h('div', { class: 'pal-h' }, ICON.busca(), input, h('button', { class: 'pal-x', type: 'button', onclick: fecharBusca, 'aria-label': 'Fechar' }, ICON.fechar())),
    ctxTxt ? h('div', { class: 'pal-ctx' }, ...ctxTxt) : null,
    tabs, lista,
    h('div', { class: 'pal-foot' }, h('span', null, h('kbd', null, '↑↓'), 'andar'), h('span', null, h('kbd', null, 'Enter'), 'escolher'), h('span', null, h('kbd', null, 'Esc'), 'fechar')));
  const el = h('div', { class: 'pal-bg', onclick: (e) => { if (e.target === el) fecharBusca(); } }, pal);
  document.getElementById('app').append(el);
  aberto = { el, foco };

  function sugereCargo() {
    const c = candOf(A.x)?.cargo;
    return c === 7 || c === 8 ? 6 : c === 6 ? 7 : c === 3 ? 1 : 3;
  }

  const escolher = (it) => {
    if (!it || it.disabled) return;
    fecharBusca();
    if (it.t === 'lugar') onLugar?.(it.level, it.id);
    else onCand?.(it.c);
  };

  const linhaCand = (c, i) => {
    const igual = (modo === 'y' && c.key === A.x && c.uf === D.uf) || (modo === 'x' && c.key === A.y && c.uf === D.uf);
    const fora = D.uf && c.uf !== D.uf && c.uf !== 'br';
    return { t: 'cand', c, disabled: igual, el: h('button', { type: 'button', role: 'option', class: 'row', disabled: igual || null, 'aria-selected': String(i === sel), onclick: () => escolher(itens[i]), onmousemove: () => mover(i) },
      avatar(c, 36), h('span', { class: 'row-n' }, h('b', null, c.nome), h('span', null, `${cargoCurto(c.cargo)} · ${c.partido} ${c.n}${c.uf && c.uf !== D.uf ? ` · ${c.uf === 'br' ? 'Brasil' : c.uf.toUpperCase()}` : ''}${fora ? ' (troca de estado)' : ''}`)),
      h('span', { class: 'row-v tn' }, h('b', null, fInt(c.votos)), h('span', null, situacao(c.sit) || (c.valido ? '' : 'votos anulados')))) };
  };
  const linhaLugar = (p, i) => ({ t: 'lugar', level: p.level, id: p.id, el: h('button', { type: 'button', role: 'option', class: 'row', 'aria-selected': String(i === sel), onclick: () => escolher(itens[i]), onmousemove: () => mover(i) },
    h('span', { class: 'sw', style: { background: 'var(--s3)', width: '36px', height: '36px', borderRadius: '10px' } }),
    h('span', { class: 'row-n' }, h('b', null, p.name), h('span', null, `${LEVEL_INFO[p.level].label}${p.sub ? ' · ' + p.sub : ''}`)), h('span')) });

  function mover(i) {
    if (i === sel || !itens[i]) return;
    itens[sel]?.el.setAttribute('aria-selected', 'false');
    sel = i;
    itens[sel].el.setAttribute('aria-selected', 'true');
  }

  function draw() {
    const q = input.value.trim();
    clear(lista); clear(tabs);
    itens = []; sel = 0;
    const grupo = (t) => lista.append(h('div', { class: 'pal-g' }, t));
    const add = (lst, mk) => { for (const x of lst) { const it = mk(x, itens.length); itens.push(it); lista.append(it.el); } };
    if (!q) {
      if (!D.uf) { // tela do Brasil: mais votados do país
        grupo('Mais votados do Brasil');
        add((BR.cands || []).slice().sort((a, b) => b.votos - a.votos).slice(0, 30), linhaCand);
        if (!BR.cands) lista.append(h('div', { class: 'pal-vazio' }, 'Carregando candidatos…'));
      } else {
        if (modo === 'y' && polos?.esq && polos?.dir) {
          lista.append(h('div', { class: 'pal-g' }, 'Esquerda ou direita (voto para presidente na mesma seção)'));
          const e = candOf(polos.esq), d = candOf(polos.dir);
          lista.append(h('div', { class: 'polos' },
            h('button', { type: 'button', class: 'polo e', onclick: () => escolher({ t: 'cand', c: e }) }, avatar(e, 34), h('span', null, h('b', null, 'Esquerda'), h('span', null, `${e.nome} (${e.partido})`))),
            h('button', { type: 'button', class: 'polo d', onclick: () => escolher({ t: 'cand', c: d }) }, avatar(d, 34), h('span', null, h('b', null, 'Direita'), h('span', null, `${d.nome} (${d.partido})`)))));
        }
        if (modo === 'y' && D.af?.[A.x]) {
          const af = D.af[A.x], cg = cargo || sugereCargo();
          const sug = (af[String(cg)] || []).filter((x) => x[1] > 0).slice(0, 5).map(([n]) => candOf(`${cg}:${n}`)).filter(Boolean);
          if (sug.length) { grupo(`Andam junto com ${curto(candOf(A.x).nome)} · ${cargoCurto(cg).toLowerCase()}`); add(sug, linhaCand); }
        }
        for (const c of D.cargos.values()) tabs.append(h('button', { type: 'button', class: 'chip' + (c.cd === (cargo || 0) ? ' on' : ''), onclick: () => { cargo = c.cd; draw(); input.focus(); } }, cargoCurto(c.cd)));
        const cg = cargo || [...D.cargos.keys()].find((k) => k === 3) || [...D.cargos.keys()][0];
        if (!cargo) tabs.firstChild && [...tabs.children].forEach((b, i) => b.classList.toggle('on', [...D.cargos.keys()][i] === cg));
        grupo(`${D.cargos.get(cg).nome} · mais votados em ${D.meta.uf_nome}`);
        add(D.cargos.get(cg).cands.slice(0, 60), linhaCand);
      }
    } else {
      if (D.uf) {
        const locais = searchCands(q, { uf: D.uf, limit: 12 });
        if (locais.length) { grupo(`Em ${D.meta.uf_nome}`); add(locais, linhaCand); }
      }
      if (BR.cands) {
        const outros = searchCands(q, { limit: 14 }).filter((c) => c.uf !== D.uf && !(c.uf === 'br' && D.uf));
        if (outros.length) { grupo(D.uf ? 'Outros estados' : 'Candidatos'); add(outros, linhaCand); }
      }
      if (modo === 'livre' && D.uf) {
        const lugares = searchPlaces(q, 6);
        if (lugares.length) { grupo(`Lugares em ${D.meta.uf_nome}`); add(lugares, linhaLugar); }
      }
      if (!itens.length) lista.append(h('div', { class: 'pal-vazio' }, BR.cands ? 'Nada encontrado. Tente o nome de urna, o nome completo, o partido ou o número.' : 'Carregando…'));
    }
    if (itens[0]) itens[0].el.setAttribute('aria-selected', 'true');
  }

  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!itens.length) return;
      let i = sel;
      do { i = (i + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length; } while (itens[i].disabled && i !== sel);
      mover(i);
      itens[i].el.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); escolher(itens[sel]); }
    else if (e.key === 'Escape') fecharBusca();
  });
  draw();
  if (!BR.cands) loadCands().then(() => { if (aberto?.el === el) draw(); }).catch(() => {});
  requestAnimationFrame(() => input.focus());
}
