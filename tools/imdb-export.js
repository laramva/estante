// Exportador do IMDb para a Estante.
// Roda dentro de uma aba do imdb.com (favorito/bookmarklet), lê seu perfil público
// e baixa um arquivo .json que a Estante importa em "Sincronizar".
async function estanteImdbExport(profilePath, opts = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = opts.log || ((m) => console.log('[Estante]', m));

  async function nextData(url) {
    const html = await (await fetch(url, { credentials: 'include' })).text();
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) throw new Error('Página sem dados: ' + url);
    return { html, props: JSON.parse(m[1]).props.pageProps };
  }

  const titles = {};
  const entries = [];

  function addTitle(t) {
    if (!t || !t.id || titles[t.id]) return;
    const credits = {};
    for (const g of t.principalCreditsV2 || []) {
      credits[g.grouping.text] = (g.credits || []).map((c) => c.name.nameText.text);
    }
    const rd = t.releaseDate;
    titles[t.id] = {
      imdbId: t.id,
      title: t.titleText && t.titleText.text,
      originalTitle: t.originalTitleText && t.originalTitleText.text,
      imdbType: t.titleType && t.titleType.id,
      year: t.releaseYear && t.releaseYear.year,
      endYear: t.releaseYear && t.releaseYear.endYear,
      poster: t.primaryImage && t.primaryImage.url,
      plot: t.plot && t.plot.plotText && t.plot.plotText.plainText,
      genres: ((t.titleGenres && t.titleGenres.genres) || []).map((g) => g.genre.text),
      imdbRating: t.ratingsSummary && t.ratingsSummary.aggregateRating,
      votes: t.ratingsSummary && t.ratingsSummary.voteCount,
      runtime: t.runtime ? Math.round(t.runtime.seconds / 60) : null,
      releaseDate: rd && rd.year ? [rd.year, String(rd.month || 1).padStart(2, '0'), String(rd.day || 1).padStart(2, '0')].join('-') : null,
      status: t.productionStatus && t.productionStatus.currentProductionStage && t.productionStatus.currentProductionStage.id,
      episodes: t.episodes && t.episodes.episodes && t.episodes.episodes.total,
      credits,
    };
  }

  function listKind(name) {
    const n = (name || '').toLowerCase();
    if (/^(watched|assistidos?|j[áa] vi|vistos?)$/.test(n)) return 'watched';
    if (/^(favorites|favoritos?)$/.test(n)) return 'favorites';
    if (/^(assistir|quero ver|to watch|watchlist)$/.test(n)) return 'watchlist';
    return 'list:' + name;
  }

  async function readList(url, kind) {
    for (let page = 1; page < 40; page++) {
      const { props } = await nextData(url + (page > 1 ? '?page=' + page : ''));
      const list = props.mainColumnData.list || props.mainColumnData.predefinedList;
      const name = list.name ? list.name.originalText : 'Watchlist';
      const k = kind || listKind(name);
      const s = list.titleListItemSearch;
      for (const e of s.edges) {
        addTitle(e.listItem);
        entries.push({ id: e.listItem.id, list: k, addedAt: e.node.createdDate, source: 'imdb', note: e.node.description || undefined });
      }
      log(name + ': ' + entries.filter((x) => x.list === k).length + '/' + s.total);
      if (!s.pageInfo.hasNextPage) break;
      await sleep(800);
    }
  }

  const base = '/pt/user/' + profilePath + '/';

  // Avaliações (nota + data)
  const ratedIds = [];
  for (let page = 1; page < 40; page++) {
    const { props } = await nextData(base + 'ratings/' + (page > 1 ? '?page=' + page : ''));
    const s = props.mainColumnData.advancedTitleSearch;
    for (const e of s.edges) { addTitle(e.node.title); ratedIds.push(e.node.title.id); }
    if (!s.pageInfo.hasNextPage) break;
    await sleep(800);
  }
  const urId = await (async () => {
    const { html } = await nextData(base + 'ratings/');
    const m = html.match(/"(ur\d{5,})"/);
    return m && m[1];
  })();
  for (let i = 0; i < ratedIds.length; i += 50) {
    const vars = { fetchOtherUserRating: true, idArray: ratedIds.slice(i, i + 50), includeUserData: false, includeWatchedData: false, locale: 'pt-BR', otherUserId: urId };
    const ext = { persistedQuery: { sha256Hash: '7c4e0771d67f21fc27fd44fc46d49cc589225a9c5e63e51cc0b8d42f39ee99cc', version: 1 } };
    const url = 'https://api.graphql.imdb.com/?operationName=PersonalizedUserData&variables=' + encodeURIComponent(JSON.stringify(vars)) + '&extensions=' + encodeURIComponent(JSON.stringify(ext));
    const j = await (await fetch(url, { headers: { 'content-type': 'application/json' } })).json();
    for (const t of (j.data && j.data.titles) || []) {
      if (t.otherUserRating) entries.push({ id: t.id, list: 'watched', addedAt: t.otherUserRating.date, rating: t.otherUserRating.value, ratedAt: t.otherUserRating.date, source: 'imdb' });
    }
  }
  log('Avaliações: ' + ratedIds.length);

  // Watchlist oficial
  await readList(base + 'watchlist/', 'watchlist');

  // Listas públicas
  const { html: listsHtml } = await nextData(base + 'lists/');
  const listIds = [...new Set([...listsHtml.matchAll(/\/list\/(ls\d+)/g)].map((m) => m[1]))];
  for (const id of listIds) { await sleep(800); await readList('/pt/list/' + id + '/'); }

  // Origem e interesses (para separar animes)
  const ids = Object.keys(titles);
  for (let i = 0; i < ids.length; i += 40) {
    const q = 'query($ids:[ID!]!){ titles(ids:$ids){ id countriesOfOrigin{ countries{ id } } interests(first:12){ edges{ node{ primaryText{ text } } } } } }';
    const r = await fetch('https://api.graphql.imdb.com/', { method: 'POST', headers: { 'content-type': 'application/json', 'x-imdb-user-language': 'pt-BR' }, body: JSON.stringify({ query: q, variables: { ids: ids.slice(i, i + 40) } }) });
    const j = await r.json();
    for (const t of (j.data && j.data.titles) || []) {
      titles[t.id].countries = ((t.countriesOfOrigin && t.countriesOfOrigin.countries) || []).map((c) => c.id);
      titles[t.id].interests = ((t.interests && t.interests.edges) || []).map((e) => e.node.primaryText.text);
    }
    await sleep(500);
  }

  const data = { format: 'estante-import', version: 1, source: 'imdb', profile: profilePath, exportedAt: new Date().toISOString(), titles, entries };
  if (opts.download !== false) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = 'imdb-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  }
  return data;
}
