// Exportador do Filmow para a Estante.
// Roda dentro de uma aba do filmow.com (botão nos favoritos), lê seu perfil público
// e baixa um arquivo .json que a Estante importa em "Sincronizar".
// Os detalhes de cada título ficam guardados no próprio navegador, então da segunda vez é bem mais rápido.
async function estanteFilmowExport(user, opts = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pause = opts.fast ? () => Promise.resolve() : sleep;
  const log = opts.log || ((m) => console.log('[Estante]', m));
  const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
  const CACHE = 'estante-filmow-cache';
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE) || '{}'); } catch (e) {}

  async function get(url) {
    for (let i = 0; i < 4; i++) {
      const r = await fetch(url, { credentials: 'include' });
      if (r.ok) return r.text();
      if (r.status === 404) return null;
      await sleep(2000 * (i + 1));
    }
    throw new Error('Falha ao abrir ' + url);
  }

  const titles = {};
  const entries = [];
  const sections = [
    ['filmes/ja-vi/', 'watched', 'movie'], ['filmes/favoritos/', 'favorites', 'movie'], ['filmes/quero-ver/', 'watchlist', 'movie'],
    ['series/ja-vi/', 'watched', 'series'], ['series/favoritos/', 'favorites', 'series'], ['series/quero-ver/', 'watchlist', 'series'],
  ];

  for (const [path, list, kind] of sections) {
    let count = 0;
    for (let page = 1; page < 200; page++) {
      const html = await get('/usuario/' + user + '/' + path + (page > 1 ? '?pagina=' + page : ''));
      if (!html) break;
      const doc = parse(html);
      const items = [...doc.querySelectorAll('li.movie_list_item')];
      if (!items.length) break;
      for (const li of items) {
        const pk = li.getAttribute('data-movie-pk');
        const a = li.querySelector('a.cover') || li.querySelector('a[data-movie-pk]');
        const img = li.querySelector('img');
        const alt = (img && img.getAttribute('alt')) || '';
        const name = (a && a.getAttribute('title')) || (li.querySelector('.title') || {}).textContent || alt;
        const m = alt.match(/^(.*)\s\((.+)\)\s*$/);
        const avg = li.querySelector('.user-rating .average');
        const w = avg && (avg.getAttribute('style') || '').match(/([\d.]+)%/);
        let poster = img && (img.getAttribute('data-src') || img.getAttribute('src')) || '';
        if (poster.startsWith('data:')) poster = '';
        poster = poster.replace(/\/\d+x\d+\//, '/350x518/');
        if (!titles[pk]) titles[pk] = { url: a ? new URL(a.getAttribute('href'), location.origin).href : null, title: name.trim(), originalTitle: m ? m[2].trim() : null, poster, kind };
        entries.push({ id: pk, list, rating: w ? Math.round(parseFloat(w[1]) / 10) : null, order: count++ });
      }
      log(path + ' página ' + page + ' (' + count + ')');
      await pause(400);
    }
  }

  // Detalhes de cada título (ano, sinopse, gêneros) para unificar com o IMDb
  const ids = Object.keys(titles);
  let done = 0;
  // 3 de cada vez, para não sobrecarregar o Filmow
  let fetched = 0;
  const saveCache = () => { try { localStorage.setItem(CACHE, JSON.stringify(cache)); } catch (e) {} };
  const queue = [...ids];
  await Promise.all([0, 1, 2].map(async () => { while (queue.length) await detail(queue.shift()); }));
  saveCache();

  async function detail(pk) {
    const t = titles[pk];
    if (!cache[pk] && t.url) {
      try {
        const html = await get(t.url);
        const doc = html && parse(html);
        const ld = doc && [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent); } catch (e) { return null; } }).find((x) => x && x['@type'] && x['@type'] !== 'WebSite');
        if (ld) {
          const dur = (ld.duration || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
          cache[pk] = {
            type: ld['@type'],
            date: ld.datePublished || null,
            plot: (ld.description || '').trim(),
            genres: [].concat(ld.genre || []),
            runtime: dur ? (+dur[1] || 0) * 60 + (+dur[2] || 0) || null : null,
            directors: [].concat(ld.director || []).map((d) => d.name).filter(Boolean),
            poster: ld.image || null,
            filmowRating: ld.aggregateRating ? +ld.aggregateRating.ratingValue : null,
          };
          if (++fetched % 20 === 0) saveCache();
        }
      } catch (e) { log('Sem detalhes: ' + t.title); }
      await pause(200);
    }
    const c = cache[pk];
    if (c) {
      Object.assign(t, { year: c.date ? +c.date.slice(0, 4) : null, releaseDate: c.date, plot: c.plot, genres: c.genres, runtime: c.runtime, directors: c.directors, filmowRating: c.filmowRating });
      if (c.poster) t.poster = c.poster;
      if (/Season|Series/i.test(c.type || '')) t.kind = 'series';
    }
    // Temporadas viram a série: "The Midnight Gospel (1ª Temporada)" -> "The Midnight Gospel"
    const season = t.title.match(/^(.*?)\s*\((\d+)ª Temporada\)\s*$/);
    if (season) { t.seriesTitle = season[1]; t.season = +season[2]; t.kind = 'series'; }
    if (++done % 25 === 0) log('Detalhes ' + done + '/' + ids.length);
  }

  const data = { format: 'estante-import', version: 1, source: 'filmow', profile: user, exportedAt: new Date().toISOString(), titles, entries };
  if (opts.download !== false) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = 'filmow-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  }
  return data;
}
