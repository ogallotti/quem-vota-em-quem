// Escolha de candidato (X ou Y): abas por cargo, busca por nome, partido ou número; no Y, atalhos Esquerda e Direita.
import { D, candOf, cargoOf, searchCands } from './data.js';
import { clear, fInt, h } from './fmt.js';

let aberto = null;

export function closePicker() {
  if (!aberto) return;
  aberto.remove();
  aberto = null;
  document.body.classList.remove('picking');
}

/**
 * @param {object} o  lado 'x' | 'y', atual (chave), outro (chave do outro lado), polos {esq, dir} (chaves), onPick(chave)
 */
export function openPicker({ lado, atual, outro, polos, onPick }) {
  closePicker();
  let cargo = cargoOf(atual) || 7;
  const tabs = h('div', { class: 'tabs pk-tabs', role: 'tablist' });
  const input = h('input', { type: 'search', class: 'pk-q', placeholder: 'Nome, partido ou número', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Buscar candidato' });
  const lista = h('div', { class: 'pk-list', role: 'listbox' });
  const escolher = (key) => { closePicker(); onPick(key); };
  const titulo = lado === 'x' ? 'Quem vota em…' : '…também vota em';

  const draw = () => {
    clear(tabs);
    for (const c of D.cargos.values()) {
      tabs.append(h('button', { type: 'button', role: 'tab', class: 'tab' + (c.cd === cargo ? ' on' : ''), 'aria-selected': String(c.cd === cargo), onclick: () => { cargo = c.cd; draw(); input.focus(); } }, c.nome));
    }
    clear(lista);
    const q = input.value.trim();
    // com busca, procura em todos os cargos (o cargo da aba vem primeiro)
    let itens = searchCands(q, q ? null : cargo, q ? 80 : 400);
    if (q) itens.sort((a, b) => (b.cargo === cargo) - (a.cargo === cargo) || b.votos - a.votos);
    if (lado === 'y' && !q && polos?.esq && polos?.dir) {
      lista.append(h('div', { class: 'pk-sub' }, 'Esquerda ou direita (voto para presidente na mesma seção)'),
        h('div', { class: 'pk-polos' },
          h('button', { type: 'button', class: 'pk-polo esq', onclick: () => escolher(polos.esq) }, h('b', null, 'Esquerda'), h('span', null, `${candOf(polos.esq).nome} (${candOf(polos.esq).partido})`)),
          h('button', { type: 'button', class: 'pk-polo dir', onclick: () => escolher(polos.dir) }, h('b', null, 'Direita'), h('span', null, `${candOf(polos.dir).nome} (${candOf(polos.dir).partido})`))),
        h('div', { class: 'pk-sub' }, `Candidatos a ${D.cargos.get(cargo).nome.toLowerCase()}`));
    }
    if (!itens.length) lista.append(h('div', { class: 'muted pk-vazio' }, 'Nenhum candidato encontrado.'));
    const max = itens[0]?.votos || 1;
    for (const c of itens) {
      const igual = c.key === outro;
      lista.append(h('button', {
        type: 'button', role: 'option', class: 'pk-row' + (c.key === atual ? ' on' : ''), disabled: igual || null, 'aria-selected': String(c.key === atual),
        onclick: () => escolher(c.key), title: igual ? 'Já escolhido do outro lado' : null,
      },
      h('span', { class: 'pk-n' }, h('b', null, c.nome), h('em', null, `${c.partido} · ${c.n}${q && c.cargo !== cargo ? ' · ' + D.cargos.get(c.cargo).nome : ''}${c.valido ? '' : ' · votos anulados'}`)),
      h('span', { class: 'pk-b' }, h('i', { style: { width: `${Math.max(1, (c.votos / max) * 100)}%` } })),
      h('span', { class: 'pk-v' }, fInt(c.votos), h('em', null, c.sit ? c.sit.toLowerCase() : ''))));
    }
  };

  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const b = lista.querySelector('.pk-row:not([disabled])'); if (b) b.click(); }
    if (e.key === 'Escape') closePicker();
  });
  const card = h('div', { class: `modal-card pk pk-${lado}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
    h('div', { class: 'modal-head' }, h('h3', null, h('span', { class: `who-${lado}` }, lado === 'x' ? 'X' : 'Y'), ' ', titulo),
      h('button', { class: 'ghost close', type: 'button', onclick: closePicker, 'aria-label': 'Fechar' }, '✕')),
    h('div', { class: 'pk-body' }, input, tabs, lista));
  aberto = h('div', { class: 'modal', onclick: (e) => { if (e.target === aberto) closePicker(); } }, card);
  document.getElementById('app').append(aberto);
  document.body.classList.add('picking');
  draw();
  if (!matchMedia('(pointer: coarse)').matches) input.focus();
}

export const pickerAberto = () => !!aberto;
