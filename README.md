# Quem vota em quem · Eleições 2026

**Quem vota em X vota em Y?** Mapa interativo das eleições gerais de 2026 que cruza, seção por seção (urna por urna), a votação de dois candidatos de qualquer cargo, em qualquer estado.

Serve para checar alegações do tipo "os eleitores do deputado X votaram no candidato Y" sem afirmar mais do que os dados permitem: o voto é secreto, então o site separa sempre o que é **certo**, o que o **mapa mostra** e o que se **estima**.

Site estático (HTML/CSS/JS puro, sem build, sem backend), MapLibre GL para o mapa. Brasil inteiro (1º turno, 4/10/2026).

## O que ele mostra

- **Um candidato só** ("voo só de ida"): escolher um candidato na busca geral abre só ele, com votos, participação, posição no cargo e onde está o voto (concentração), o mapa da votação dele, a aba Em comum (em quem votaram os eleitores dele, estimativa) e sugestões para comparar. "Comparar com…" escolhe o Y; "ver só X" volta. Endereço: `#uf=ma&x=3:55` (sem `y`).
- **A pergunta no topo**: "Quem vota em [X] também vota em [Y]?". X e Y podem ser candidatos de qualquer cargo. No seletor do Y há dois atalhos, **Esquerda** (Lula) e **Direita** (Flávio Bolsonaro); fora isso, presidente só aparece se a pessoa escolher. O par padrão de um estado é governador × senador.
- **A resposta em três camadas**, para o recorte selecionado (estado, região, município, zona, bairro, local de votação ou seção):
  1. **Certo, pelas urnas**: em cada seção, quem votou nos dois não passa do menor dos dois números nem fica abaixo da soma menos o comparecimento. Somando as seções, sai a faixa certa de eleitores em comum. Sem hipótese nenhuma.
  2. **O que o mapa mostra**: correlação entre as seções, a mesma correlação dentro de cada município (separa coincidência regional) e o território de X. Sempre com o aviso de que coincidência não é causa.
  3. **O que se estima**: fração dos eleitores de X que votou em Y, como **faixa entre duas hipóteses** de inferência ecológica (vizinhança: o eleitor de X vota como os vizinhos da mesma urna; regressão de Goodman: todo o padrão entre urnas é preferência dele), ambas presas urna a urna aos limites certos. A manchete diz primeiro quanto ("estima-se que de 44% a 60%…") e só afirma "mais" ou "menos que os demais" quando as duas hipóteses concordam.
- **Como os eleitores de X votaram para o cargo de Y**: a divisão estimada entre os principais candidatos do cargo, para nenhuma comparação ser lida como maioria.
- **Em comum** (aba lateral), nos dois sentidos e por cargo: em quem votaram os eleitores de X, e os eleitores de quem votaram em Y (por **proporção**, que destaca eleitorados fiéis, ou por **volume estimado**, a proporção vezes os votos, que destaca candidatos grandes). Calculado no navegador para qualquer recorte (`js/ranking.js`).
- **Mapa**: lente padrão **Votos dos dois** (quanto mais clara a área, mais votos de Y; quanto mais azul, mais votos de X); outras lentes: acima da média, votos de X, votos de Y, correlação local.
- **6 níveis**: região → município → zona → bairro → local de votação → seção. A seção (urna) é a unidade de toda a estatística.
- Visão compartilhável pela URL: `#uf=ma&x=3:55&y=5:111&s=municipio:2111300`.

### O que o site não sabe

Em quem cada pessoa votou (o voto é secreto) e por que votou: eleitorado em comum não prova apoio, campanha conjunta nem transferência de votos. Correlação ecológica não é comportamento individual. Para dois candidatos à mesma vaga (um voto por eleitor) não há voto compartilhado: a pergunta vira "disputam o mesmo território?". Senador em 2026 tem dois votos, então dois senadores podem ter eleitores em comum.

## Rodar localmente

```bash
python3 -m http.server 4190 --directory public --bind 127.0.0.1   # ou: pnpm serve
# abrir http://127.0.0.1:4190
```

## Dados

```bash
python3 -m venv .venv && .venv/bin/pip install shapely pandas numpy scipy pillow brotli
gh workflow run coleta.yml                        # boletins de urna do Brasil em ~64 fatias paralelas (GitHub Actions, ~30 min)
gh run download <id> -D /tmp/bu                   # artefatos bu-<uf>-<k>de<n>: copie o conteúdo de cada um para .cache/<uf>/
.venv/bin/python scripts/fotos.py                 # resultado oficial de cada cargo e UF + fotos dos candidatos (.cache/)
.venv/bin/python scripts/build_data.py --uf ma    # uma UF → public/data/ma/ e public/fotos/ma/
.venv/bin/python scripts/build_br.py              # nacional: public/data/br.json, br-mun.json, cands.json, fotos de presidente
```

1. `coleta_bu.py` baixa o boletim de urna (BU) de cada seção na área de divulgação do TSE e lê os votos de **todos os cargos** direto do binário (BER/ASN.1, lido por posição porque a especificação de 2022 não decodifica o formato de 2026). Seção sem BU de urna usa o boletim do Sistema de Apuração (`busa`, mesmo formato). Seções agregadas não têm BU próprio (404): os votos delas estão na seção principal. O TSE limita pedidos por IP (HTTP 429), por isso a coleta nacional roda no GitHub Actions (`.github/workflows/coleta.yml`): cada fatia numa máquina com IP próprio, decodificando em memória e guardando só o resumo (~1,2 KB por seção em vez de ~14 KB do BU bruto).
2. `build_data.py` confere **cada candidato** contra a divulgação oficial do TSE (aborta se a soma dos boletins divergir), monta a geografia (malhas do IBGE, cadastro de locais de votação do TSE, áreas de Voronoi para zonas, bairros, locais e seções) e grava o formato leve descrito abaixo. Seções que o TSE totalizou mas cujo boletim não foi publicado (1.025 no estado de São Paulo, quase todas na capital; 56 em MG; 15 em Lauro de Freitas, BA; 1 em Porto Alegre) são **reconstruídas** pelo resíduo entre o resultado oficial da zona e a soma dos boletins da zona, repartido na proporção dos eleitores; ficam marcadas em `sec.est`.

### Formato (v2, para servir milhões de acessos de graça em hospedagem estática)

Geometria quantizada (`qgeom`): lista de polígonos → anéis → inteiros `[x0, y0, dx1, dy1, ...]` na escala `q` (o primeiro par absoluto, os demais diferenças). O Cloudflare comprime JSON com brotli.

| Arquivo | Quando | Conteúdo |
|-|-|-|
| `data/br.json` | abertura | UFs (geometria leve, comparecimento) e os polos |
| `data/br-mun.json` | (não usado pela interface hoje) | todos os municípios |
| `data/cands.json` | busca nacional | todos os candidatos (presidente uma vez, uf `br`) |
| `data/<uf>/base.json` | ao abrir a UF | candidatos por cargo, municípios e regiões, locais e seções em colunas (os totais por área são somados no navegador) |
| `data/<uf>/zb.json` | sob demanda | zonas e bairros |
| `data/<uf>/nomes.json` | sob demanda | nome, endereço e bairro de cada local |
| `data/<uf>/m/<ibge>.json` | ao aproximar | polígonos de locais e seções do município |
| `data/<uf>/v/<cargo>-<k>.json` | ao escolher candidato | votos por seção, esparsos, em pacotes de ~120 KB |
| `fotos/<uf>/<cargo>-<k>.webp` | listas | sprites 8×8 de fotos 64×64, por votos (presidente em `fotos/br/`) |

| Fonte | Uso |
|-|-|
| Boletins de urna (TSE, divulgação) | votos de cada candidato em cada seção, comparecimento, aptos |
| Resultado oficial por cargo, UF e zona (TSE) | nome, nome completo, partido, situação, foto; conferência dos totais; seções sem boletim |
| Cadastro de locais de votação 2026 (TSE) | nome, endereço, bairro e coordenadas dos locais |
| Malhas e localidades (IBGE) | estados, municípios e regiões |

## Teste

```bash
pnpm install && pnpm serve &
pnpm test          # núcleo estatístico com dados sintéticos de verdade conhecida (node --test)
pnpm smoke         # desktop, Chromium real: totais = divulgação oficial, lentes, recortes, seletor, URL
pnpm test:mobile   # toque em retrato, retrato pequeno, paisagem e página larga numa tela de 412 px
```

## Publicar

`.github/workflows/deploy.yml` publica `public/` no Cloudflare Pages (projeto `quem-vota-em-quem`) a cada push na `main`. Precisa dos secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` no GitHub. Não há deploy manual.

## Limitações

- **Zonas, bairros, locais e seções são áreas aproximadas**: o TSE informa só o ponto do local de votação. As áreas são Voronoi dos locais (local limitado a ~4 km; seção = fatia do local proporcional aos eleitores). Os totais são exatos; os contornos, não.
- Presidente inclui o voto em trânsito (eleitores de fora votando só para presidente): o denominador de cada candidato é o comparecimento da eleição dele.
- Correlação ecológica não é comportamento individual (falácia ecológica). O painel mostra sempre os limites certos ao lado das estimativas, e as estimativas como faixa entre duas hipóteses.

## Estrutura

```
public/            site estático (publicado como está)
  index.html, css/app.css
  js/              main (controle) · map (MapLibre) · data · analise (par X/Y por nível e recorte) · stats (estatística pura)
                   · panel (resposta, dispersão, legenda) · picker (escolha de candidato) · scales (lentes e paletas) · fmt
  data/<uf>/       gerado por scripts/build_data.py
  vendor/          MapLibre GL 4.7.1 (BSD-3)
scripts/           coleta_bu.py, build_data.py
tests/             stats.test.mjs, smoke.mjs, mobile.mjs
```

Sem mapa-base de terceiros: só as malhas do IBGE e as áreas geradas a partir dos locais do TSE.
