# Estante

Minha plataforma pessoal de filmes, séries e animes — no estilo do Filmow, com tudo do Filmow e do IMDb unificado.

## Como funciona

- **Site estático** (HTML + CSS + JavaScript, sem build), publicado pelo GitHub Pages.
- **Seus dados** ficam em `data/library.json` neste repositório. Cada alteração feita no site vira um commit, então o histórico do Git é um backup de todas as versões.
- **Offline**: o site guarda tudo no navegador (IndexedDB) e funciona sem internet. As mudanças sobem para o GitHub quando a conexão volta.
- **Backup**: além do Git, o site guarda uma cópia por dia no aparelho (últimos 10 dias) e permite baixar um backup completo (JSON) ou uma planilha (CSV) em Configurações.

## Fontes de dados (todas gratuitas)

| Fonte | Para quê | Precisa de chave? |
| --- | --- | --- |
| [TMDB](https://www.themoviedb.org) | busca, sinopses em português, lançamentos no Brasil, onde assistir, temporadas | sim, gratuita (fica só no seu navegador) |
| Cinemeta | dados e nota geral do IMDb | não |
| [AniList](https://anilist.co) | animes, temporada atual, próximos episódios | não |

This product uses the TMDB API but is not endorsed or certified by TMDB.

## Sincronizar com o Filmow e o IMDb

Filmow e IMDb não têm API pública e bloqueiam leitura automática, então a importação roda **no seu navegador**:

1. Em **Configurações**, arraste os botões “Exportar do Filmow” e “Exportar do IMDb” para a barra de favoritos.
2. Abra o seu perfil no site e clique no botão. Um arquivo `.json` é baixado.
3. Solte o arquivo em **Configurações → Trazer novidades**. Títulos repetidos são unificados e o que você mudou na Estante tem prioridade.

Também aceita os CSV oficiais de exportação do IMDb.

## Sincronização entre aparelhos

Em **Configurações → Sincronização**, cole um *fine-grained token* do GitHub com permissão **Contents: Read and write** só neste repositório. O token fica apenas no navegador daquele aparelho. Sem token, o site mostra a versão publicada (somente leitura).

## Estrutura

```
index.html            página única
css/app.css           visual
js/app.js             telas e navegação
js/store.js           dados, mesclagem e armazenamento offline
js/meta.js            TMDB, Cinemeta e AniList
js/sync.js            sincronização com o GitHub
js/importers.js       importação do Filmow, IMDb e backups
tools/*-export.js     exportadores que rodam no Filmow/IMDb
sw.js                 modo offline
data/library.json     seus dados
```
