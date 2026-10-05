# Quem vota em quem · Eleições 2026

**Quem vota em X vota em Y?** Mapa interativo das eleições gerais de 2026 que cruza, seção por seção, a votação de dois candidatos, de qualquer cargo, ou de um candidato com a esquerda (Lula) ou a direita (Bolsonaro).

Serve para checar alegações do tipo "o deputado X levou força para o candidato Y": se os votos dos dois caem nos mesmos lugares, quanto Y faz onde X é forte e, com certeza matemática, **quantos votos de Y no máximo podem ter vindo de eleitores de X**.

Site estático (HTML/CSS/JS puro, sem build), MapLibre GL para o mapa. Hoje com o **Maranhão** (1º turno, 4/10/2026); o pipeline aceita qualquer UF.

## O que ele mostra

- **A pergunta no topo**: "Quem vota em [X] vota em [Y]?". X e Y podem ser candidatos de qualquer cargo (presidente, governador, senador, deputado federal, estadual). No Y há dois atalhos: **Esquerda** (votos em Lula) e **Direita** (votos em Flávio Bolsonaro), na mesma seção.
- **A resposta em palavras** para o recorte selecionado (estado, região, município, zona, bairro, local de votação ou seção), com quatro números:
  - **Correlação**: os votos de X e de Y sobem e descem juntos de um local de votação para outro? (−1 a 1, ponderada pelos eleitores)
  - **Afinidade**: quanto Y faz nos locais onde vota o eleitor de X, dividido pela média de Y no recorte (1,00× = indiferente).
  - **Estimativa**: fração dos eleitores de X que votaram em Y (regressão ecológica de Goodman), com a faixa provável e a comparação com os demais eleitores.
  - **Teto certo**: em cada urna, quem votou nos dois não passa do menor dos dois números. A soma das urnas é o máximo de votos de Y que podem ter vindo de eleitores de X (e há também o mínimo, X + Y − comparecimento). Vale sempre, sem hipótese nenhuma.
- **Mapa bivariado** (padrão): cada área comparada com a média do recorte. Ciano = só X acima da média, magenta = só Y, azul-violeta escuro = os dois. Outras lentes: votos de X, votos de Y e **correlação local** (onde a dobradinha funciona e onde não).
- **Dispersão**: cada ponto é um local de votação (ou seção, em recortes pequenos), com a reta de tendência.
- **Para que lado pende o eleitor de X**: onde ele vota, quanto Lula e Bolsonaro fazem do voto dado aos dois, contra a média do recorte.
- **Quem mais anda junto com X**: os candidatos de cada cargo mais (e menos) associados a X no estado inteiro (pré-calculado por local de votação). Um toque troca o Y.
- **6 níveis**: região (IBGE) → município → zona → bairro (cidades grandes) → local de votação → seção. O nível muda com o zoom (Auto) e a seleção sempre mostra as subunidades dela.
- Visão compartilhável pela URL: `#uf=ma&x=7:12000&y=1:13&l=bi&s=municipio:2111300`.

### Esquerda e direita

Medidas **pelo voto**, não por uma lista de partidos: esquerda = votos em Lula (PT) e direita = votos em Flávio Bolsonaro (PL) para presidente, na mesma seção (`POLOS` em `scripts/build_data.py`). Classificações de partidos variam muito conforme a fonte (autodeclaração, survey com cientistas políticos, votações no Congresso) e misturariam alianças locais; o voto presidencial é um dado, igual para todo cargo.

### Como ler (e o que não dá para saber)

O voto é secreto. Correlação e afinidade dizem se os votos caem **nos mesmos lugares**, o que é compatível com dobradinha, mas também com dois candidatos fortes no mesmo tipo de bairro. A estimativa de Goodman supõe comportamento parecido em todo o recorte: use como ordem de grandeza. O teto é a única afirmação certa. Para dois candidatos à mesma vaga (um voto por eleitor) não existe voto compartilhado: a pergunta vira "disputam o mesmo território?". Senador em 2026 tem dois votos, então dois senadores podem, sim, ter eleitores em comum.

## Rodar localmente

```bash
python3 -m http.server 4190 --directory public --bind 127.0.0.1   # ou: pnpm serve
# abrir http://127.0.0.1:4190
```

## Dados

```bash
python3 -m venv .venv && .venv/bin/pip install shapely pandas numpy scipy
.venv/bin/python scripts/coleta_bu.py --uf ma     # boletins de urna de todas as seções (cache em .cache/ma/bu)
.venv/bin/python scripts/build_data.py --uf ma    # gera public/data/ma/
```

1. `coleta_bu.py` baixa o boletim de urna (BU) de cada seção na área de divulgação do TSE e lê os votos de **todos os cargos** direto do binário (BER/ASN.1, lido por posição porque a especificação de 2022 não decodifica o formato de 2026). Seções agregadas não têm BU próprio (404): os votos delas estão na seção principal. O TSE limita pedidos por IP (HTTP 429): para UFs grandes, rode numa máquina com boa rede e traga `.cache/<uf>/`.
2. `build_data.py` confere **cada candidato** contra a divulgação oficial do TSE (aborta se a soma dos boletins divergir), monta a geografia (malhas do IBGE, cadastro de locais de votação do TSE, áreas de Voronoi para zonas, bairros, locais e seções) e grava uma série de votos por candidato (`v/<cargo>/<número>.json`, esparsa) e as afinidades pré-calculadas.

| Fonte | Uso |
|-|-|
| Boletins de urna (TSE, divulgação) | votos de cada candidato em cada seção, comparecimento, aptos |
| Resultado oficial por cargo (TSE) | nome, partido, situação e conferência dos totais |
| Cadastro de locais de votação 2026 (TSE) | nome, endereço, bairro e coordenadas dos locais |
| Malhas e localidades (IBGE) | municípios e regiões |

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
- Correlação ecológica não é comportamento individual (falácia ecológica). O painel mostra sempre o teto certo ao lado das estimativas.

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

Mapa-base: OpenFreeMap (dados © OpenStreetMap). Paleta bivariada: Joshua Stevens.
