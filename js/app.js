import { $, $$, esc, fmtDate, monthKey, relDays, fmtRuntime, starsHTML, KIND_LABEL, toast, download, sparkle, heart, debounce, now, toDateInput, fromDateInput, norm } from './util.js';
import * as S from './store.js';
import { state } from './store.js';
import * as M from './meta.js';
import { importFile } from './importers.js';
import { syncNow, onSyncStatus, syncStatus, ghConfig, canPush, testToken, pullPublic } from './sync.js';

const app = $('#app');
const hints = new Map(); // títulos vindos de busca/vitrines ainda não salvos na estante

// ---------- Ícones ----------
const I = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>',
};
const heartIcon = (on) => '<svg class="heart" viewBox="0 0 24 24" aria-hidden="true" style="' + (on ? 'fill:#fff;stroke:#fff' : 'stroke:currentColor') + '"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';

// ---------- Componentes ----------
function posterImg(t, size = 'm') {
  const u = M.posterUrl(t, size);
  return u ? '<img src="' + esc(u) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">' : '';
}

function tile(t, opts = {}) {
  if (!t) return '';
  if (!state.titles[t.key]) hints.set(t.key, t);
  const e = state.entries[t.key] || {};
  const sub = [];
  if (opts.date) sub.push(esc(opts.date));
  else if (t.year) sub.push(t.year);
  const rating = e.rating != null ? starsHTML(e.rating) : '';
  const subline = rating && opts.date ? rating + '<span>' + esc(opts.date) + '</span>' : rating || sub.join(' · ');
  return '<a class="tile" href="#/t/' + encodeURIComponent(t.key) + '">' +
    '<div class="poster"><div class="noimg">' + esc(t.title) + '</div>' + posterImg(t) +
    (opts.badge !== false && t.kind && t.kind !== 'movie' ? '<span class="badge">' + KIND_LABEL[t.kind] + '</span>' : '') +
    (e.favorite ? '<span class="badge right fav">' + heart() + '</span>' : '') +
    (opts.when ? '<span class="badge date">' + esc(opts.when) + '</span>' : '') +
    // Sua nota (ou "visto") em todo pôster de título que você já assistiu
    (e.rating != null ? '<span class="badge rate" title="Sua nota">★ ' + (e.rating / 2).toLocaleString('pt-BR') + '</span>' : e.watched ? '<span class="badge rate seen">✓ visto</span>' : '') +
    '<div class="quick">' +
      '<button type="button" data-q="watched" data-key="' + esc(t.key) + '" class="' + (e.watched ? 'on' : '') + '" title="Já vi" aria-label="Já vi">' + I.check + '</button>' +
      '<button type="button" data-q="watchlist" data-key="' + esc(t.key) + '" class="' + (e.watchlist ? 'on' : '') + '" title="Quero ver" aria-label="Quero ver">' + I.clock + '</button>' +
    '</div></div>' +
    '<div class="t">' + esc(t.title) + '</div>' +
    '<div class="s">' + subline + '</div></a>';
}

const sectionHead = (title, more) => '<div class="section-head"><div><h2 class="h-section">' + esc(title) + sparkle() + '</h2><div class="rule"></div></div>' + (more ? '<a class="more" href="' + more + '">ver tudo →</a>' : '') + '</div>';
const empty = (msg) => '<div class="empty">' + sparkle() + '<div>' + msg + '</div></div>';
const loading = () => '<div class="loading"><div class="spinner"></div></div>';
const skeletonRow = (n = 8) => '<div class="row">' + Array.from({ length: n }, () => '<div class="tile"><div class="poster skel"></div><div class="t skel" style="height:14px;border-radius:6px;margin-top:10px"></div></div>').join('') + '</div>';

async function fillShelf(el, loader, opts = {}) {
  try {
    const items = (await loader()).filter(Boolean);
    el.innerHTML = items.length ? (opts.grid ? '<div class="grid">' : '<div class="row">') + items.map((t) => tile(t, opts.tileOpts ? opts.tileOpts(t) : {})).join('') + '</div>' : empty(opts.emptyMsg || 'Nada por aqui ainda.');
  } catch (e) {
    console.warn(e);
    el.innerHTML = '<div class="notice">' + sparkle() + '<div>Não consegui carregar agora' + (navigator.onLine ? '' : ' (você está offline)') + '. <a href="javascript:location.reload()">Tentar de novo</a></div></div>';
  }
}

function tmdbNotice() {
  return M.hasTmdb() ? '' : '<div class="notice" style="margin-top:18px">' + sparkle() + '<div><b>Dica:</b> cole sua chave gratuita do TMDB em <a href="#/config">Configurações</a> para ter sinopses em português, lançamentos no Brasil e onde assistir.</div></div>';
}

// ---------- Roteador ----------
const routes = [];
const route = (re, fn) => routes.push([re, fn]);
let currentRender = null;

async function router() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      currentRender = () => fn(m.slice(1).map((v) => (v == null ? undefined : decodeURIComponent(v))), params);
      app.classList.remove('page-enter'); void app.offsetWidth; app.classList.add('page-enter');
      await currentRender();
      const nav = path.startsWith('/estante/avaliacoes') ? 'avaliacoes' : path.split('/')[1] || 'home';
      $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === (nav === 't' || nav === 'busca' || nav === 'explorar' ? '' : nav === 'lista' ? 'listas' : nav)));
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', () => { router(); window.scrollTo(0, 0); });

// Re-renderiza a página atual quando os dados mudam (ex.: sincronização chegou)
let rerenderLock = false;
const rerender = debounce(() => { if (!rerenderLock && currentRender) { const y = window.scrollY; Promise.resolve(currentRender()).then(() => window.scrollTo(0, y)); } }, 300);

// ---------- Ações rápidas ----------
async function ensureStored(key) {
  if (state.titles[key]) return key;
  const hint = hints.get(key) || {};
  let d = null;
  try { d = await M.details(key, hint); } catch {}
  d = d || hint;
  if (!d || !d.title) throw new Error('Título não encontrado');
  if (state.titles[d.key]) return d.key;
  const clean = Object.assign({}, d);
  delete clean.recommendations; delete clean.providers;
  clean.metaSource = M.hasTmdb() ? 'tmdb' : 'free';
  S.upsertTitle(clean);
  return clean.key;
}

document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-q]');
  if (!b) return;
  ev.preventDefault(); ev.stopPropagation();
  b.disabled = true;
  try {
    const key = await ensureStored(b.dataset.key);
    const e = state.entries[key] || {};
    rerenderLock = true;
    if (b.dataset.q === 'watched') { S.setWatched(key, !e.watched); toast(!e.watched ? 'Marcado como já visto ✓' : 'Removido de Já vi', 'ok'); }
    if (b.dataset.q === 'watchlist') { S.setWatchlist(key, !e.watchlist); toast(!e.watchlist ? 'Adicionado em Quero ver' : 'Removido de Quero ver', 'ok'); }
    const ne = state.entries[key] || {};
    const tileEl = b.closest('.tile');
    if (tileEl) {
      tileEl.querySelector('[data-q="watched"]').classList.toggle('on', !!ne.watched);
      tileEl.querySelector('[data-q="watchlist"]').classList.toggle('on', !!ne.watchlist);
    }
  } catch (err) { toast(err.message, 'error'); }
  finally { b.disabled = false; setTimeout(() => (rerenderLock = false), 400); }
});

// ---------- Início ----------
route(/^\/$/, async () => {
  const st = S.stats();
  const p = state.profile;
  const recent = S.itemsFor('ja-vi').slice(0, 18);
  const want = S.itemsFor('quero-ver').slice(0, 18);
  const favs = S.itemsFor('favoritos').slice(0, 18);
  const soon = upcomingFromLibrary().slice(0, 18);
  const since = Object.values(state.entries).reduce((m, e) => (e.watchedAt && e.watchedAt < m ? e.watchedAt : m), now());
  app.innerHTML =
    '<section class="card hero">' +
      sparkle('deco s1') + sparkle('deco s2') +
      '<div><div class="kicker">filmes · séries · animes</div><h1 class="h-display">ESTAN<br>TE</h1>' +
        '<div class="hero-name">' + esc(p.name) + '</div><div class="hero-sub">' + esc(p.bio || 'colecionando histórias desde ' + (p.since || new Date(since).getFullYear())) + '</div><div class="rule"></div></div>' +
      '<div><div class="fan">' + favs.filter((x) => M.posterUrl(x.t)).slice(0, 3).map((x, i) => '<a href="#/t/' + encodeURIComponent(x.key) + '" class="f' + i + '"><img src="' + esc(M.posterUrl(x.t)) + '" alt="' + esc(x.t.title) + '" referrerpolicy="no-referrer"></a>').join('') + '</div>' +
      '<div class="hero-stats">' +
        '<a class="stat" href="#/estante/ja-vi"><b>' + st.watched + '</b><span>já vi</span></a>' +
        '<a class="stat" href="#/estante/quero-ver"><b>' + st.watchlist + '</b><span>quero ver</span></a>' +
        '<a class="stat" href="#/estante/favoritos"><b>' + st.favorite + '</b><span>favoritos</span></a>' +
        '<a class="stat" href="#/estante/avaliacoes"><b>' + (st.avg ? st.avg.toFixed(1).replace('.', ',') : '–') + '</b><span>nota média</span></a>' +
      '</div></div>' +
    '</section>' +
    tmdbNotice() +
    '<section class="section">' + sectionHead('Vistos recentemente', '#/estante/ja-vi') + (recent.length ? '<div class="row">' + recent.map((x) => tile(x.t, { date: x.e.approx ? 'Filmow' : fmtDate(x.date) })).join('') + '</div>' : empty('Marque o que você assistiu e ele aparece aqui.')) + '</section>' +
    (soon.length ? '<section class="section">' + sectionHead('Chegando na sua estante', '#/lancamentos') + '<div class="row">' + soon.map((x) => tile(x.t, { when: relDays(x.date), date: x.label })).join('') + '</div></section>' : '') +
    '<section class="section">' + sectionHead('Quero ver', '#/estante/quero-ver') + (want.length ? '<div class="row">' + want.map((x) => tile(x.t)).join('') + '</div>' : empty('Sua lista de quero ver está vazia.')) + '</section>' +
    '<section class="section">' + sectionHead('Favoritos', '#/estante/favoritos') + (favs.length ? '<div class="row">' + favs.map((x) => tile(x.t)).join('') + '</div>' : empty('Nenhum favorito ainda.')) + '</section>' +
    '<section class="section">' + sectionHead('Em cartaz', '#/lancamentos') + '<div id="home-now">' + skeletonRow() + '</div></section>';
  fillShelf($('#home-now'), () => (M.hasTmdb() ? M.shelf('movie-now') : M.shelf('anime-airing')));
});

function upcomingFromLibrary() {
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const [key, e] of Object.entries(state.entries)) {
    const t = state.titles[key];
    if (!t || !(e.watchlist || e.watched || e.favorite)) continue;
    if (t.releaseDate && t.releaseDate > today) out.push({ t, date: t.releaseDate, label: 'estreia' });
    else if (t.nextEpisode && t.nextEpisode.date >= today) out.push({ t, date: t.nextEpisode.date, label: 'T' + t.nextEpisode.season + 'E' + t.nextEpisode.episode });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- Explorar (Filmes / Séries / Animes) ----------
const EXPLORE = {
  filmes: { kind: 'movie', title: 'Filmes', shelves: [['movie-popular', 'Populares'], ['movie-now', 'Em cartaz'], ['movie-upcoming', 'Em breve'], ['movie-top', 'Mais bem avaliados']] },
  series: { kind: 'series', title: 'Séries', shelves: [['series-popular', 'Populares'], ['series-airing', 'No ar'], ['series-upcoming', 'Estreias em breve'], ['series-top', 'Mais bem avaliadas']] },
  animes: { kind: 'anime', title: 'Animes', shelves: [['anime-airing', 'Da temporada'], ['anime-popular', 'Populares'], ['anime-upcoming', 'Próximas temporadas'], ['anime-movies', 'Filmes de anime'], ['anime-top', 'Mais bem avaliados']] },
};
const SHELF_NAMES = Object.fromEntries(Object.values(EXPLORE).flatMap((x) => x.shelves.map(([id, n]) => [id, x.title + ' · ' + n])));

for (const [slug, cfg] of Object.entries(EXPLORE)) {
  route(new RegExp('^/' + slug + '$'), async () => {
    const mine = Object.values(state.titles).filter((t) => t.kind === cfg.kind).length;
    const shelves = cfg.shelves.filter(([id]) => M.hasTmdb() || !/movie-now|movie-upcoming|series-airing|series-upcoming/.test(id));
    app.innerHTML =
      '<div class="kicker">explorar</div><h1 class="h-section" style="font-size:40px;margin-top:4px">' + cfg.title + sparkle() + '</h1><div class="rule"></div>' +
      '<div class="toolbar"><div class="chips">' + M.GENRE_FILTERS.filter(([g]) => !(cfg.kind === 'anime' && g === 16)).map(([g, n]) => '<a class="chip" href="#/explorar/' + shelves[0][0].split('-')[0] + '-popular?g=' + g + '">' + n + '</a>').join('') + '</div></div>' +
      '<p class="muted small">Você tem ' + mine + ' ' + cfg.title.toLowerCase() + ' na sua estante. <a href="#/estante/ja-vi?k=' + cfg.kind + '">Ver os meus →</a></p>' +
      tmdbNotice() +
      shelves.map(([id, name]) => '<section class="section">' + sectionHead(name, '#/explorar/' + id) + '<div data-shelf="' + id + '">' + skeletonRow() + '</div></section>').join('');
    for (const el of $$('[data-shelf]')) fillShelf(el, () => M.shelf(el.dataset.shelf));
  });
}

route(/^\/explorar\/([\w-]+)$/, async ([id], params) => {
  const g = params.get('g');
  const gName = g && (M.GENRE_FILTERS.find(([x]) => String(x) === g) || [])[1];
  let page = 1;
  app.innerHTML = '<div class="crumbs"><a href="#/' + ({ movie: 'filmes', series: 'series', anime: 'animes' }[id.split('-')[0]] || '') + '">Explorar</a> › ' + esc(SHELF_NAMES[id] || id) + '</div>' +
    '<h1 class="h-section">' + esc((SHELF_NAMES[id] || id).split(' · ').pop()) + (gName ? ' · ' + esc(gName) : '') + sparkle() + '</h1><div class="rule"></div>' +
    '<div id="ex-grid">' + loading() + '</div><div class="load-more"><button class="btn" id="ex-more">Carregar mais</button></div>';
  const grid = $('#ex-grid');
  const seen = new Set();
  async function load() {
    const items = (await M.shelf(id, page, { genre: g })).filter((t) => t && !seen.has(t.key));
    items.forEach((t) => seen.add(t.key));
    if (page === 1) grid.innerHTML = '<div class="grid"></div>';
    $('.grid', grid).insertAdjacentHTML('beforeend', items.map((t) => tile(t)).join(''));
    if (!items.length) $('#ex-more').remove();
  }
  try { await load(); } catch { grid.innerHTML = empty('Não consegui carregar agora.'); }
  const more = $('#ex-more');
  if (more) more.onclick = async () => { more.disabled = true; page++; await load().catch(() => {}); more.disabled = false; };
});

// ---------- Busca ----------
$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (q) location.hash = '#/busca/' + encodeURIComponent(q);
});
route(/^\/busca\/?$/, async () => {
  app.innerHTML = '<div class="kicker">busca</div><h1 class="h-section">O que você quer encontrar?' + sparkle() + '</h1><div class="rule"></div>' +
    empty('Digite o nome de um filme, série ou anime na busca lá em cima — em português ou no título original.');
  $('#search').q.focus();
});
route(/^\/busca\/(.+)$/, async ([q], params) => {
  $('#search').q.value = q;
  const k = params.get('k') || 'all';
  const local = Object.values(state.titles).filter((t) => [t.title, t.originalTitle].some((n) => norm(n).includes(norm(q))));
  app.innerHTML = '<div class="kicker">busca</div><h1 class="h-section">“' + esc(q) + '”' + sparkle() + '</h1><div class="rule"></div>' +
    '<div class="toolbar"><div class="chips">' + [['all', 'Tudo'], ['movie', 'Filmes'], ['series', 'Séries'], ['anime', 'Animes']].map(([v, n]) => '<a class="chip ' + (k === v ? 'on' : '') + '" href="#/busca/' + encodeURIComponent(q) + (v === 'all' ? '' : '?k=' + v) + '">' + n + '</a>').join('') + '</div></div>' +
    (local.length ? '<section>' + sectionHead('Na sua estante') + '<div class="grid">' + local.filter((t) => k === 'all' || t.kind === k).slice(0, 24).map((t) => tile(t)).join('') + '</div></section>' : '') +
    '<section class="section">' + sectionHead('Resultados') + '<div id="res">' + loading() + '</div></section>';
  try {
    const res = (await M.search(q)).filter((t) => k === 'all' || t.kind === k);
    $('#res').innerHTML = res.length ? '<div class="grid">' + res.map((t) => tile(state.titles[t.key] || t)).join('') + '</div>' : empty('Nada encontrado para “' + esc(q) + '”.');
  } catch { $('#res').innerHTML = empty(navigator.onLine ? 'A busca falhou. Tente de novo.' : 'Você está offline — mostrando só o que já está na sua estante.'); }
});

// ---------- Página do título ----------
route(/^\/t\/(.+)$/, async ([key]) => {
  let t = state.titles[key] || hints.get(key);
  app.innerHTML = t ? titleHTML(t, true) : loading();
  if (t) bindTitle(t);
  let d = null;
  try { d = await M.details(key, t || {}); } catch (e) { console.warn(e); }
  if (!d && !t) { app.innerHTML = empty('Não encontrei esse título' + (navigator.onLine ? '.' : ' (offline).')); return; }
  if (d) {
    // Se agora sabemos o id do IMDb e esse título já está na estante, vai para ele
    if (d.key !== key && state.titles[d.key]) { location.replace('#/t/' + encodeURIComponent(d.key)); return; }
    if (state.titles[key]) {
      const keep = Object.assign({}, d, { key });
      if (state.titles[key].source === 'imdb' && state.titles[key].title) keep.title = state.titles[key].title;
      if (state.titles[key].plotLang !== 'en' && keep.plotLang === 'en' && state.titles[key].plot) { keep.plot = state.titles[key].plot; keep.plotLang = state.titles[key].plotLang; }
      const extra = { recommendations: keep.recommendations, providers: keep.providers };
      delete keep.recommendations; delete keep.providers;
      keep.metaSource = M.hasTmdb() ? 'tmdb' : 'free';
      S.upsertTitle(keep);
      S.persist();
      t = Object.assign({}, state.titles[key], extra);
    } else {
      t = d;
      hints.set(key, d);
      if (d.key !== key) hints.set(d.key, d);
    }
    if (location.hash.slice(3) !== encodeURIComponent(key) && decodeURIComponent(location.hash.slice(4)) !== key) return;
    app.innerHTML = titleHTML(t, false);
    bindTitle(t);
  }
});

function titleHTML(t, partial) {
  const e = state.entries[t.key] || {};
  const r = t.ratings || {};
  const year = t.year ? t.year + (t.endYear && t.endYear !== t.year ? '–' + t.endYear : t.kind !== 'movie' && t.status && /Returning|Ongoing|Airing/i.test(t.status) ? '–' : '') : '';
  const episodic = t.tmdbType === 'tv' || /tvSeries|tvMiniSeries/.test(t.imdbType || '') || (t.seasons && t.seasons.length) || (t.kind === 'series' && !t.tmdbType && !t.imdbType);
  const facts = [KIND_LABEL[t.kind] || '', year, fmtRuntime(t.runtime) + (episodic && t.runtime ? ' por ep.' : ''), t.seasons && t.seasons.length ? t.seasons.length + ' temporada' + (t.seasons.length > 1 ? 's' : '') : '', t.episodes ? t.episodes + ' episódios' : ''].filter(Boolean);
  const dirLabel = t.kind === 'movie' ? 'Direção' : 'Criação';
  const lists = S.listsWith(t.key);
  const links = [
    t.imdbId && ['IMDb', 'https://www.imdb.com/pt/title/' + t.imdbId + '/'],
    t.tmdbId && ['TMDB', 'https://www.themoviedb.org/' + t.tmdbType + '/' + t.tmdbId],
    t.filmowUrl && ['Filmow', t.filmowUrl],
    t.anilistId && ['AniList', 'https://anilist.co/anime/' + t.anilistId],
    t.malId && ['MyAnimeList', 'https://myanimelist.net/anime/' + t.malId],
  ].filter(Boolean);
  return '<div class="crumbs"><a href="#/">Início</a> › <a href="#/' + ({ movie: 'filmes', series: 'series', anime: 'animes' }[t.kind] || 'filmes') + '">' + (KIND_LABEL[t.kind] || 'Título') + 's</a> › ' + esc(t.title) + '</div>' +
    '<section class="title-hero">' + (t.backdrop ? '<div class="backdrop" style="background-image:url(\'' + esc(t.backdrop) + '\')"></div>' : '') +
    '<div class="title-grid"><div class="poster">' + posterImg(t, 'l') + '</div><div class="title-info">' +
      '<div class="kicker">' + esc(KIND_LABEL[t.kind] || '') + (t.genres && t.genres.length ? ' · ' + esc(t.genres.slice(0, 3).join(', ')) : '') + '</div>' +
      '<h1>' + esc(t.title) + '</h1>' + (t.originalTitle && t.originalTitle !== t.title ? '<div class="orig">' + esc(t.originalTitle) + '</div>' : '') +
      '<div class="facts">' + facts.map((f) => '<span>' + esc(f) + '</span>').join('') + '</div>' +
      (t.nextEpisode && t.nextEpisode.date ? '<div class="next-ep">' + sparkle() + 'Próximo episódio: T' + t.nextEpisode.season + 'E' + t.nextEpisode.episode + ' · ' + relDays(t.nextEpisode.date) + '</div>' : '') +
      (t.releaseDate && t.releaseDate > new Date().toISOString().slice(0, 10) ? '<div class="next-ep">' + sparkle() + 'Estreia ' + relDays(t.releaseDate) + '</div>' : '') +
      '<div class="scores">' +
        (r.imdb ? '<div class="score imdb"><b>' + r.imdb.toFixed(1).replace('.', ',') + '</b><span>IMDb</span></div>' : '') +
        (r.tmdb ? '<div class="score imdb"><b>' + Number(r.tmdb).toFixed(1).replace('.', ',') + '</b><span>TMDB</span></div>' : '') +
        (r.anilist ? '<div class="score imdb"><b>' + Number(r.anilist).toFixed(1).replace('.', ',') + '</b><span>AniList</span></div>' : '') +
        (e.rating != null ? '<div class="score"><b>' + starsHTML(e.rating, 'lg') + '</b><span>sua nota</span></div>' : '') +
      '</div>' +
      (t.tagline ? '<p class="muted" style="font-style:italic;margin:0 0 8px">' + esc(t.tagline) + '</p>' : '') +
      '<div class="plot">' + (t.plot ? esc(t.plot) + (t.plotLang === 'en' ? '<span class="lang">(em inglês)</span>' : '') : '<span class="muted">' + (partial ? 'Carregando sinopse…' : 'Sem sinopse disponível.') + '</span>') + '</div>' +
      '<div class="actions">' +
        '<button class="btn ' + (e.watched ? 'on' : '') + '" data-act="watched">' + I.check + (e.watched ? 'Já vi' : 'Marcar como visto') + '</button>' +
        '<button class="btn ' + (e.watchlist ? 'on' : '') + '" data-act="watchlist">' + I.clock + 'Quero ver</button>' +
        '<button class="btn ' + (e.favorite ? 'on' : '') + '" data-act="favorite">' + heartIcon(e.favorite) + 'Favorito</button>' +
        '<button class="btn" data-act="lists">' + I.plus + 'Listas' + (lists.length ? ' (' + lists.length + ')' : '') + '</button>' +
        (t.trailer ? '<a class="btn ghost" href="https://www.youtube.com/watch?v=' + esc(t.trailer) + '" target="_blank" rel="noopener">' + I.play + 'Trailer</a>' : '') +
      '</div>' +
      '<div class="my">' +
        '<div class="field"><label>Sua avaliação</label>' + rateWidget(e.rating) + '</div>' +
        '<div class="field"><label for="wdate">Assisti em</label><input class="input" type="date" id="wdate" value="' + (e.watched && !e.approx ? toDateInput(e.watchedAt) : '') + '"' + (e.watched ? '' : ' disabled') + ' max="' + new Date().toISOString().slice(0, 10) + '">' +
          (e.approx ? '<div class="hint">Veio do Filmow sem data exata — escolha a data se lembrar.</div>' : e.sources && e.sources.length ? '<div class="hint">Sincronizado de: ' + e.sources.map((s) => (s === 'imdb' ? 'IMDb' : 'Filmow')).join(' + ') + '</div>' : '') + '</div>' +
      '</div>' +
      '<div class="field" style="margin-top:18px"><label for="cmt">Seu comentário</label><textarea class="input" id="cmt" placeholder="O que você achou?">' + esc(e.comment || '') + '</textarea>' +
        '<div style="display:flex;gap:10px;align-items:center;margin-top:8px"><button class="btn sm primary" data-act="comment">Salvar comentário</button>' + (e.commentAt ? '<span class="hint" style="margin:0">salvo em ' + fmtDate(e.commentAt) + '</span>' : '') + '</div></div>' +
    '</div></div></section>' +
    (t.seasons && t.seasons.length ? '<section class="section">' + sectionHead('Temporadas') + '<div class="seasons">' + t.seasons.map((s) => seasonHTML(t, e, s)).join('') + '</div></section>' : '') +
    (t.providers && (t.providers.stream.length || t.providers.rent.length) ? '<section class="section">' + sectionHead('Onde assistir') + '<div class="card pad"><div class="providers">' + t.providers.stream.map((p) => '<img src="' + esc(p.logo) + '" alt="' + esc(p.name) + '" title="' + esc(p.name) + ' (assinatura)">').join('') + (t.providers.rent.length ? '<span class="muted small" style="margin:0 6px">alugar/comprar:</span>' + t.providers.rent.slice(0, 6).map((p) => '<img src="' + esc(p.logo) + '" alt="' + esc(p.name) + '" title="' + esc(p.name) + '">').join('') : '') + '</div><div class="hint">Dados de streaming: JustWatch via TMDB · <a href="' + esc(t.providers.link) + '" target="_blank" rel="noopener">ver ofertas</a></div></div></section>' : '') +
    ((t.credits && (t.credits.directors || []).length) || (t.credits && (t.credits.cast || []).length) ? '<section class="section">' + sectionHead('Elenco e equipe') + '<div class="card pad">' +
      ((t.credits.directors || []).length ? '<p style="margin:0 0 14px"><span class="muted">' + dirLabel + ':</span> ' + esc(t.credits.directors.join(', ')) + '</p>' : '') +
      '<div class="people">' + (t.credits.cast || []).map((c) => '<div class="person"><div class="ph" style="' + (c.photo ? 'background-image:url(\'' + esc(c.photo) + '\')' : '') + '"></div><div>' + esc(c.name) + (c.character ? '<small>' + esc(c.character) + '</small>' : '') + '</div></div>').join('') + '</div></div></section>' : '') +
    (lists.length ? '<section class="section">' + sectionHead('Nas suas listas') + '<div class="chips">' + lists.map((l) => '<a class="chip" href="#/lista/' + l.id + '">' + esc(l.name) + '</a>').join('') + '</div></section>' : '') +
    (t.recommendations && t.recommendations.length ? '<section class="section">' + sectionHead('Você também pode gostar') + '<div class="row">' + t.recommendations.map((x) => tile(state.titles[x.key] || x)).join('') + '</div></section>' : '') +
    (links.length ? '<p class="small muted" style="margin-top:34px">Ver em: ' + links.map(([n, u]) => '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + n + '</a>').join(' · ') + '</p>' : '');
}

function rateWidget(rating) {
  const v = rating == null ? 0 : rating / 2;
  let h = '<div class="rate" id="rate">';
  for (let i = 1; i <= 5; i++) h += '<button type="button" data-star="' + i + '" class="' + (v >= i ? 'on' : v >= i - 0.5 ? 'half' : '') + '" aria-label="' + i + ' estrela' + (i > 1 ? 's' : '') + '"><i></i></button>';
  return h + '<span class="rate-label">' + (rating != null ? (rating / 2).toLocaleString('pt-BR') + ' de 5' : 'sem nota') + '</span>' + (rating != null ? '<button type="button" class="clear" data-star="0">limpar</button>' : '') + '</div><div class="hint">Clique na metade esquerda da estrela para meia estrela.</div>';
}

function seasonHTML(t, e, s) {
  const done = (e.progress && e.progress[s.n]) || 0;
  const pct = s.episodes ? Math.round((done / s.episodes) * 100) : 0;
  return '<div class="season"><div class="sp" style="' + (s.poster ? 'background-image:url(\'' + esc(s.poster) + '\')' : '') + '"></div><div class="info"><b>' + esc(s.name || 'Temporada ' + s.n) + '</b>' +
    '<span class="muted">' + done + '/' + (s.episodes || '?') + ' episódios' + (s.airDate ? ' · ' + s.airDate.slice(0, 4) : '') + '</span><div class="progress"><i style="width:' + pct + '%"></i></div></div>' +
    '<div class="stepper"><button type="button" data-ep="' + s.n + '" data-d="-1" aria-label="Menos um episódio">−</button><button type="button" data-ep="' + s.n + '" data-d="1" aria-label="Mais um episódio">+</button><button type="button" data-ep="' + s.n + '" data-d="all" title="Marcar temporada inteira" aria-label="Temporada inteira">✓</button></div></div>';
}

function bindTitle(t) {
  const key = t.key;
  const refresh = () => { rerenderLock = true; const y = window.scrollY; app.innerHTML = titleHTML(Object.assign({}, t, state.titles[key] || {}, { recommendations: t.recommendations, providers: t.providers }), false); bindTitle(t); window.scrollTo(0, y); setTimeout(() => (rerenderLock = false), 400); };
  const store = async () => { const k = await ensureStored(key); if (k !== key) { location.replace('#/t/' + encodeURIComponent(k)); return null; } return k; };
  $$('[data-act]', app).forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    const k = await store().catch((er) => { toast(er.message, 'error'); return null; });
    if (!k) return;
    const e = state.entries[k] || {};
    if (act === 'watched') S.setWatched(k, !e.watched);
    if (act === 'watchlist') S.setWatchlist(k, !e.watchlist);
    if (act === 'favorite') S.setFavorite(k, !e.favorite);
    if (act === 'comment') { S.setComment(k, $('#cmt').value.trim()); toast('Comentário salvo', 'ok'); }
    if (act === 'lists') { listsModal(k, refresh); return; }
    refresh();
  }));
  const rate = $('#rate');
  if (rate) rate.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-star]');
    if (!b) return;
    const k = await store();
    if (!k) return;
    const star = +b.dataset.star;
    if (!star) { S.setRating(k, null); refresh(); return; }
    const half = ev.offsetX < b.clientWidth / 2;
    S.setRating(k, star * 2 - (half ? 1 : 0));
    refresh();
  });
  const wd = $('#wdate');
  if (wd) wd.addEventListener('change', () => { if (wd.value) { S.setWatchedDate(key, fromDateInput(wd.value)); toast('Data salva', 'ok'); } });
  $$('[data-ep]', app).forEach((b) => b.addEventListener('click', async () => {
    const k = await store();
    if (!k) return;
    const s = (t.seasons || []).find((x) => x.n === +b.dataset.ep);
    const cur = ((state.entries[k] || {}).progress || {})[s.n] || 0;
    const next = b.dataset.d === 'all' ? s.episodes || cur : Math.max(0, Math.min(s.episodes || 999, cur + +b.dataset.d));
    S.setProgress(k, s.n, next);
    const e = state.entries[k];
    const allDone = (t.seasons || []).every((x) => ((e.progress || {})[x.n] || 0) >= (x.episodes || 1));
    if (allDone && !e.watched) { S.setWatched(k, true); toast('Série completa! Marcada como vista ✓', 'ok'); }
    refresh();
  }));
}

function listsModal(key, done) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  const draw = () => {
    const lists = Object.values(state.lists).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    bg.innerHTML = '<div class="modal card" role="dialog" aria-modal="true"><h3>Adicionar às listas</h3>' +
      (lists.length ? lists.map((l) => '<label class="check"><input type="checkbox" data-l="' + l.id + '"' + (l.items.some((i) => i.key === key) ? ' checked' : '') + '>' + esc(l.name) + '<span class="muted small" style="margin-left:auto">' + l.items.length + '</span></label>').join('') : '<p class="muted">Você ainda não tem listas.</p>') +
      '<div style="display:flex;gap:8px;margin-top:16px"><input class="input" id="newlist" placeholder="Nova lista…"><button class="btn primary sm" id="mk">Criar</button></div>' +
      '<div style="text-align:right;margin-top:16px"><button class="btn sm" id="close">Pronto</button></div></div>';
    $$('[data-l]', bg).forEach((c) => c.addEventListener('change', () => S.toggleInList(c.dataset.l, key, c.checked)));
    $('#mk', bg).onclick = () => { const n = $('#newlist', bg).value.trim(); if (!n) return; const id = S.createList(n); S.toggleInList(id, key, true); draw(); };
    $('#newlist', bg).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#mk', bg).click(); });
    $('#close', bg).onclick = close;
  };
  const close = () => { bg.remove(); done(); };
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', function esc_(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc_); } });
  draw();
  document.body.appendChild(bg);
}

// ---------- Minha estante (perfil estilo Filmow) ----------
route(/^\/estante(?:\/([\w-]+))?$/, async ([tab], params) => {
  tab = tab || 'ja-vi';
  const p = state.profile;
  const st = S.stats();
  const kind = params.get('k') || 'all';
  const sort = params.get('o') || 'recentes';
  const q = params.get('q') || '';
  const rf = params.get('r') || '';
  const counts = Object.fromEntries(Object.keys(S.TABS).map((k) => [k, S.itemsFor(k).length]));
  const nLists = Object.keys(state.lists).length;
  const link = (patch) => { const u = new URLSearchParams({ k: kind, o: sort, q, r: rf, ...patch }); for (const [a, b] of [...u]) if (!b || (a === 'k' && b === 'all') || (a === 'o' && b === 'recentes')) u.delete(a); const s = u.toString(); return '#/estante/' + tab + (s ? '?' + s : ''); };
  app.innerHTML =
    '<section class="card profile">' + sparkle('deco') .replace('class="sparkle deco"', 'class="sparkle deco" style="top:22px;right:30px;width:18px;height:18px"') +
      '<div class="photo" style="' + (p.avatar ? 'background-image:url(\'' + esc(p.avatar) + '\')' : '') + '">' + (p.avatar ? '' : esc((p.name || 'L')[0])) + '</div>' +
      '<div><div class="kicker">minha estante</div><h1>' + esc(p.name) + '</h1>' +
        '<div class="handle"><span>filmow: @' + esc(p.filmow) + '</span><span>imdb: laramvalves</span></div>' +
        (p.bio ? '<p class="bio">' + esc(p.bio) + '</p>' : '') +
        '<div class="counts">' +
          '<a href="#/estante/ja-vi"><b>' + counts['ja-vi'] + '</b>já vi</a><a href="#/estante/quero-ver"><b>' + counts['quero-ver'] + '</b>quero ver</a>' +
          '<a href="#/estante/favoritos"><b>' + counts.favoritos + '</b>favoritos</a><a href="#/estante/avaliacoes"><b>' + counts.avaliacoes + '</b>avaliações</a>' +
          '<a href="#/listas"><b>' + nLists + '</b>listas</a>' +
          (st.minutes ? '<a href="#/estante/ja-vi?k=movie"><b>' + Math.round(st.minutes / 60) + 'h</b>de filmes</a>' : '') +
        '</div></div>' +
    '</section>' +
    '<nav class="tabs">' + Object.entries(S.TABS).map(([k, d]) => '<a href="#/estante/' + k + '" class="' + (k === tab ? 'active' : '') + '">' + d.label + '<span>' + counts[k] + '</span></a>').join('') + '<a href="#/listas">Listas<span>' + nLists + '</span></a></nav>' +
    (tab === 'avaliacoes' ? ratingSummary(kind, rf, link) : '') +
    '<div class="toolbar"><div class="chips">' + [['all', 'Tudo'], ['movie', 'Filmes'], ['series', 'Séries'], ['anime', 'Animes']].map(([v, n]) => '<a class="chip ' + (kind === v ? 'on' : '') + '" href="' + link({ k: v }) + '">' + n + '</a>').join('') + '</div><span class="spacer"></span>' +
      '<input class="filter-input" id="flt" type="search" placeholder="Filtrar…" value="' + esc(q) + '">' +
      '<select class="chip" id="ord" aria-label="Ordenar">' + [['recentes', 'Mais recentes'], ['antigos', 'Mais antigos'], ['nota', 'Minha nota'], ['titulo', 'Título A–Z'], ['ano', 'Ano de lançamento']].map(([v, n]) => '<option value="' + v + '"' + (sort === v ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></div>' +
    '<div id="shelf"></div>';
  $('#ord').onchange = (e) => (location.hash = link({ o: e.target.value }));
  $('#flt').addEventListener('input', debounce((e) => history.replaceState(null, '', link({ q: e.target.value })) || drawShelf(e.target.value), 250));
  const drawShelf = (filter) => renderShelf($('#shelf'), tab, kind, sort, filter, rf);
  drawShelf(q);
});

// Resumo das avaliações: quantas de cada nota (clique para filtrar)
function ratingSummary(kind, rf, link) {
  const items = S.itemsFor('avaliacoes', kind);
  if (!items.length) return '';
  const by = {};
  for (const x of items) by[x.e.rating] = (by[x.e.rating] || 0) + 1;
  const max = Math.max(...Object.values(by));
  const avg = items.reduce((s, x) => s + x.e.rating, 0) / items.length / 2;
  const fromImdb = items.filter((x) => (x.e.sources || []).includes('imdb')).length;
  const fromFilmow = items.filter((x) => (x.e.sources || []).includes('filmow')).length;
  let bars = '';
  for (let r = 10; r >= 1; r--) {
    const n = by[r] || 0;
    bars += '<a class="rbar' + (String(r) === rf ? ' on' : '') + '" href="' + link({ r: String(r) === rf ? '' : String(r) }) + '" title="' + (r / 2).toLocaleString('pt-BR') + ' estrelas: ' + n + '">' +
      '<span class="rlab">' + starsHTML(r) + '</span><span class="rtrack"><i style="width:' + (n ? Math.max(3, (n / max) * 100) : 0) + '%"></i></span><span class="rnum">' + n + '</span></a>';
  }
  return '<section class="card pad rsum"><div class="rsum-head"><div><b>' + avg.toFixed(1).replace('.', ',') + '</b>' + starsHTML(Math.round(avg * 2), 'lg') +
    '<div class="muted small">média de ' + items.length + ' avaliações · ' + fromFilmow + ' do Filmow, ' + fromImdb + ' do IMDb</div>' +
    (rf ? '<a class="chip on" style="margin-top:10px;display:inline-block" href="' + link({ r: '' }) + '">só ' + (rf / 2).toLocaleString('pt-BR') + ' estrelas ✕</a>' : '<div class="hint">Clique numa barra para ver só aquela nota.</div>') +
    '</div><div class="rbars">' + bars + '</div></div></section>';
}

function renderShelf(el, tab, kind, sort, filter, rf) {
  let items = S.itemsFor(tab, kind);
  if (rf) items = items.filter((x) => String(x.e.rating) === rf);
  if (filter) { const f = norm(filter); items = items.filter((x) => norm(x.t.title + ' ' + (x.t.originalTitle || '') + ' ' + ((x.t.credits && x.t.credits.directors) || []).join(' ')).includes(f)); }
  if (sort === 'antigos') items.reverse();
  if (sort === 'nota') items.sort((a, b) => (b.e.rating ?? -1) - (a.e.rating ?? -1));
  if (sort === 'titulo') items.sort((a, b) => a.t.title.localeCompare(b.t.title, 'pt-BR'));
  if (sort === 'ano') items.sort((a, b) => (b.t.year || 0) - (a.t.year || 0));
  if (!items.length) { el.innerHTML = empty(filter ? 'Nada encontrado com esse filtro.' : 'Nada aqui ainda. <a href="#/busca/">Busque</a> algo para adicionar.'); return; }
  if (tab === 'comentarios') {
    el.innerHTML = '<div class="card">' + items.map((x) => '<a class="comment" href="#/t/' + encodeURIComponent(x.key) + '" style="color:inherit">' + (M.posterUrl(x.t, 's') ? '<img src="' + esc(M.posterUrl(x.t, 's')) + '" alt="" loading="lazy">' : '<div class="noimg"></div>') + '<div><h4>' + esc(x.t.title) + ' <span class="muted small">' + (x.t.year || '') + '</span></h4>' + (x.e.rating != null ? starsHTML(x.e.rating) : '') + '<p>' + esc(x.e.comment) + '</p><div class="hint">' + fmtDate(x.e.commentAt) + '</div></div></a>').join('') + '</div>';
    return;
  }
  const PAGE = 96;
  let shown = 0;
  const chrono = sort === 'recentes' || sort === 'antigos';
  const flag = { 'ja-vi': 'approx', 'quero-ver': 'approxWl', favoritos: 'approxFav', avaliacoes: 'approxRated' }[tab];
  const groupOf = (y) => (sort === 'nota' ? 'r' + (y.e.rating ?? '-') : !chrono ? 'all' : flag && y.e[flag] ? 'approx' : monthKey(y.date));
  const sizes = {};
  for (const y of items) { const g = groupOf(y); sizes[g] = (sizes[g] || 0) + 1; }
  el.innerHTML = '';
  let lastGroup = null, grid = null;
  const more = () => {
    const slice = items.slice(shown, shown + PAGE);
    for (const x of slice) {
      const group = groupOf(x);
      if (group !== lastGroup) {
        lastGroup = group;
        const n = sizes[group];
        const label = sort === 'nota' ? (group === 'r-' ? 'Sem nota' : starsHTML(+group.slice(1)) + ' ' + (group.slice(1) / 2).toLocaleString('pt-BR') + ' estrelas') : !chrono ? '' : group === 'approx' ? 'Histórico do Filmow <small>· na ordem em que você marcou, sem data exata</small>' : group === '0000-00' ? 'Sem data' : fmtDate(group + '-15', { month: true });
        el.insertAdjacentHTML('beforeend', '<div class="month">' + (label ? '<div class="month-h">' + label + ' <small>' + n + '</small></div>' : '') + '<div class="grid"></div></div>');
        grid = el.lastElementChild.querySelector('.grid');
      }
      grid.insertAdjacentHTML('beforeend', tile(x.t, { date: chrono && group !== 'approx' ? fmtDate(x.date) : null }));
    }
    shown += slice.length;
    $('#shelf-more') && $('#shelf-more').remove();
    if (shown < items.length) {
      el.insertAdjacentHTML('beforeend', '<div class="load-more" id="shelf-more"><button class="btn">Mostrar mais (' + (items.length - shown) + ')</button></div>');
      $('#shelf-more button').onclick = more;
    }
  };
  more();
}

// ---------- Listas ----------
route(/^\/listas$/, async () => {
  const lists = Object.values(state.lists).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  app.innerHTML = '<div class="section-head"><div><div class="kicker">organize do seu jeito</div><h1 class="h-section" style="font-size:36px">Minhas listas' + sparkle() + '</h1><div class="rule"></div></div><button class="btn primary" id="newl">' + I.plus + 'Nova lista</button></div>' +
    (lists.length ? '<div class="lists">' + lists.map((l) => {
      const items = [...l.items].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 4).map((i) => state.titles[i.key]).filter(Boolean);
      return '<a class="card list-card" href="#/lista/' + l.id + '"><div class="mosaic">' + [0, 1, 2, 3].map((i) => '<div style="' + (items[i] && M.posterUrl(items[i], 's') ? 'background-image:url(\'' + esc(M.posterUrl(items[i], 's')) + '\')' : '') + '"></div>').join('') + '</div><h3>' + esc(l.name) + '</h3><p>' + l.items.length + ' títulos · atualizada ' + fmtDate(l.updatedAt) + '</p></a>';
    }).join('') + '</div>' : empty('Crie listas como “Ghibli”, “Para ver com amigas” ou “Top 10 da vida”.'));
  $('#newl').onclick = () => editListModal(null);
});

function editListModal(id) {
  const l = id ? state.lists[id] : { name: '', description: '' };
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = '<div class="modal card" role="dialog" aria-modal="true"><h3>' + (id ? 'Editar lista' : 'Nova lista') + '</h3>' +
    '<div class="field"><label>Nome</label><input class="input" id="ln" value="' + esc(l.name) + '"></div>' +
    '<div class="field" style="margin-top:12px"><label>Descrição</label><textarea class="input" id="ld" style="min-height:80px">' + esc(l.description) + '</textarea></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">' + (id ? '<button class="btn sm danger" id="del">Excluir</button><span style="flex:1"></span>' : '') + '<button class="btn sm" id="cancel">Cancelar</button><button class="btn sm primary" id="save">Salvar</button></div></div>';
  document.body.appendChild(bg);
  $('#ln', bg).focus();
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  $('#cancel', bg).onclick = close;
  $('#save', bg).onclick = () => {
    const name = $('#ln', bg).value.trim();
    if (!name) return $('#ln', bg).focus();
    if (id) S.updateList(id, { name, description: $('#ld', bg).value.trim() });
    else { const nid = S.createList(name, $('#ld', bg).value.trim()); location.hash = '#/lista/' + nid; }
    close(); router();
  };
  if (id) $('#del', bg).onclick = () => { if (confirm('Excluir a lista “' + l.name + '”? Os títulos continuam na sua estante.')) { S.deleteList(id); close(); location.hash = '#/listas'; } };
}

route(/^\/lista\/([\w]+)$/, async ([id]) => {
  const l = state.lists[id];
  if (!l) { app.innerHTML = empty('Lista não encontrada. <a href="#/listas">Ver listas</a>'); return; }
  const items = [...l.items].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).map((i) => ({ i, t: state.titles[i.key] })).filter((x) => x.t);
  app.innerHTML = '<div class="crumbs"><a href="#/listas">Listas</a> › ' + esc(l.name) + '</div>' +
    '<div class="section-head"><div><h1 class="h-section" style="font-size:34px">' + esc(l.name) + sparkle() + '</h1><div class="rule"></div></div><button class="btn sm" id="edl">Editar</button></div>' +
    (l.description ? '<p class="muted" style="margin-top:-6px">' + esc(l.description) + '</p>' : '') +
    '<p class="small muted">' + items.length + ' títulos · do mais recente para o mais antigo · para adicionar, abra um título e toque em “Listas”.</p>' +
    (items.length ? '<div class="grid" style="margin-top:18px">' + items.map((x) => tile(x.t, { date: 'adicionado ' + fmtDate(x.i.addedAt) })).join('') + '</div>' : empty('Lista vazia. <a href="#/busca/">Busque um título</a> para adicionar.'));
  $('#edl').onclick = () => editListModal(id);
});

// ---------- Lançamentos ----------
route(/^\/lancamentos$/, async (_, params) => {
  const tab = params.get('v') || 'minha';
  const tabs = [['minha', 'Da minha estante'], ['cinema', 'Cinema'], ['series', 'Séries'], ['animes', 'Animes']];
  app.innerHTML = '<div class="kicker">o que vem por aí</div><h1 class="h-section" style="font-size:36px">Lançamentos' + sparkle() + '</h1><div class="rule"></div>' +
    '<nav class="tabs" style="margin-top:6px">' + tabs.map(([v, n]) => '<a href="#/lancamentos' + (v === 'minha' ? '' : '?v=' + v) + '" class="' + (tab === v ? 'active' : '') + '">' + n + '</a>').join('') + '</nav>' + tmdbNotice() + '<div id="rel"></div>';
  const el = $('#rel');
  if (tab === 'minha') {
    const soon = upcomingFromLibrary();
    el.innerHTML = '<p class="small muted">Estreias e próximos episódios de títulos que estão no seu Quero ver ou que você acompanha. Atualiza sozinho quando você abre a Estante.</p>' +
      (soon.length ? '<div class="cal">' + soon.map((x) => calItem(x.t, x.date, x.label)).join('') + '</div>' : empty('Nada com data marcada na sua estante por enquanto.'));
    return;
  }
  const blocks = {
    cinema: [['movie-now', 'Em cartaz no Brasil', 'grid'], ['movie-upcoming', 'Em breve nos cinemas', 'cal']],
    series: [['series-airing', 'No ar esta semana', 'grid'], ['series-upcoming', 'Estreias em breve', 'cal']],
    animes: [['anime-airing', 'Temporada atual', 'grid'], ['anime-upcoming', 'Próximas estreias', 'cal']],
  }[tab];
  el.innerHTML = blocks.map(([id, name]) => '<section class="section">' + sectionHead(name, '#/explorar/' + id) + '<div data-b="' + id + '">' + loading() + '</div></section>').join('');
  for (const [id, , mode] of blocks) {
    const box = $('[data-b="' + id + '"]');
    if (!M.hasTmdb() && !id.startsWith('anime')) { box.innerHTML = empty('Disponível com a chave do TMDB.'); continue; }
    try {
      let items = (await M.shelf(id)).filter(Boolean);
      if (mode === 'cal') {
        items = items.filter((t) => t.releaseDate).sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
        box.innerHTML = items.length ? '<div class="cal">' + items.map((t) => calItem(t, t.releaseDate, 'estreia')).join('') + '</div>' : empty('Sem datas por enquanto.');
      } else box.innerHTML = '<div class="grid">' + items.map((t) => tile(state.titles[t.key] || t)).join('') + '</div>';
    } catch { box.innerHTML = empty('Não consegui carregar agora.'); }
  }
});

function calItem(t, date, label) {
  if (!state.titles[t.key]) hints.set(t.key, t);
  const d = new Date(date + 'T12:00:00');
  const e = state.entries[t.key] || {};
  return '<a class="card cal-item" href="#/t/' + encodeURIComponent(t.key) + '"><div class="when"><b>' + d.getDate() + '</b>' + fmtDate(date).split(' ').slice(1).join(' ') + '</div>' +
    (M.posterUrl(t, 's') ? '<img src="' + esc(M.posterUrl(t, 's')) + '" alt="" loading="lazy">' : '<div class="noimg"></div>') +
    '<div><b>' + esc(t.title) + '</b><div class="small muted">' + esc(KIND_LABEL[t.kind] || '') + ' · ' + esc(label) + ' ' + relDays(date) + '</div></div>' +
    '<div class="small muted">' + (e.rating != null ? starsHTML(e.rating) + ' ' : '') + (e.watchlist ? 'no seu Quero ver' : e.watched ? 'você acompanha' : '') + '</div></a>';
}

// ---------- Configurações, sincronização e backup ----------
route(/^\/config$/, async () => {
  const s = S.settings();
  const gc = ghConfig();
  const st = syncStatus();
  const backups = await listBackups();
  const nTitles = Object.keys(state.titles).length;
  app.innerHTML = '<div class="kicker">sincronizar e configurar</div><h1 class="h-section" style="font-size:36px">Configurações' + sparkle() + '</h1><div class="rule"></div>' +
    '<div class="settings">' +
    // GitHub
    '<section class="card pad full"><h3>' + sparkle() + 'Sincronização (GitHub)</h3>' +
      '<p>Sua estante fica salva neste aparelho (funciona offline) e é copiada para <code>data/library.json</code> no seu repositório do GitHub sempre que algo muda. Assim ela aparece igual em qualquer aparelho, com histórico de todas as versões.</p>' +
      '<div class="status-line" id="sync-line"></div>' +
      '<dl class="kv" style="margin:14px 0"><dt>Repositório</dt><dd>' + esc(gc.repo || '—') + '</dd><dt>Última sincronização</dt><dd>' + (s.lastSync ? fmtDate(s.lastSync) + ' ' + new Date(s.lastSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'nunca') + '</dd><dt>Títulos</dt><dd>' + nTitles + '</dd></dl>' +
      '<details' + (canPush() ? '' : ' open') + '><summary style="cursor:pointer;font-weight:600;color:var(--blue-600)">' + (canPush() ? 'Trocar token' : 'Ativar sincronização neste aparelho') + '</summary>' +
        '<ol class="steps"><li>Abra <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a>.</li><li>Nome: <b>Estante</b> · Expiração: <b>No expiration</b> (ou 1 ano).</li><li>Repository access: <b>Only select repositories</b> → escolha <b>' + esc(gc.repo || 'o repositório da Estante') + '</b>.</li><li>Permissions → Repository → <b>Contents: Read and write</b>.</li><li>Gere o token, copie e cole abaixo. Ele fica só neste aparelho.</li></ol>' +
        '<div class="my" style="margin-top:0"><div class="field"><label>Repositório (usuário/nome)</label><input class="input" id="ghrepo" value="' + esc(gc.repo || '') + '" placeholder="seu-usuario/estante"></div>' +
        '<div class="field"><label>Token do GitHub</label><input class="input" id="ghtoken" type="password" autocomplete="off" placeholder="github_pat_…" value="' + (s.ghToken ? '••••••••••' : '') + '"></div></div>' +
        '<div style="display:flex;gap:10px;margin-top:12px"><button class="btn primary sm" id="ghsave">Testar e salvar</button>' + (s.ghToken ? '<button class="btn sm danger" id="ghforget">Esquecer token</button>' : '') + '</div></details>' +
      '<div style="margin-top:16px"><button class="btn sm" id="syncnow">Sincronizar agora</button></div>' +
    '</section>' +
    // TMDB
    '<section class="card pad"><h3>' + sparkle() + 'Dados dos filmes (TMDB)</h3>' +
      '<p>Com a chave gratuita do TMDB você ganha sinopses em português, lançamentos no Brasil, onde assistir e temporadas. Sem ela, a Estante usa Cinemeta (IMDb) e AniList.</p>' +
      '<ol class="steps"><li>Entre em <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org/settings/api</a>.</li><li>Copie o campo <b>“Chave da API”</b> (32 letras e números).</li><li>Cole aqui e salve.</li></ol>' +
      '<div class="field"><label>Chave da API do TMDB</label><input class="input" id="tmdbkey" type="password" autocomplete="off" value="' + (s.tmdbKey ? '••••••••••' : '') + '" placeholder="cole aqui"></div>' +
      '<div style="display:flex;gap:10px;margin-top:12px;align-items:center"><button class="btn primary sm" id="tmdbsave">Salvar</button><span class="hint" style="margin:0">' + (s.tmdbKey ? 'Chave ativa ✓' : 'Sem chave') + '</span></div>' +
      '<div style="margin-top:16px"><button class="btn sm" id="refresh">Atualizar dados de todos os títulos</button><div class="hint" id="refresh-msg">A Estante já atualiza aos poucos sozinha (notas, sinopses, próximos episódios).</div></div>' +
    '</section>' +
    // Perfil
    '<section class="card pad"><h3>' + sparkle() + 'Perfil</h3>' +
      '<div class="field"><label>Nome</label><input class="input" id="pname" value="' + esc(state.profile.name) + '"></div>' +
      '<div class="field" style="margin-top:12px"><label>Sobre você</label><textarea class="input" id="pbio" style="min-height:70px">' + esc(state.profile.bio || '') + '</textarea></div>' +
      '<div class="field" style="margin-top:12px"><label>Foto</label><input class="input" id="pavatar" type="file" accept="image/*"></div>' +
      '<div style="margin-top:12px"><button class="btn primary sm" id="psave">Salvar perfil</button></div>' +
    '</section>' +
    // Importar
    '<section class="card pad full"><h3>' + sparkle() + 'Trazer novidades do Filmow e do IMDb</h3>' +
      '<p>O Filmow e o IMDb não deixam outros sites lerem seus dados direto, então a importação roda no seu navegador: arraste os botões abaixo para a barra de favoritos, abra o site e clique. Um arquivo é baixado — solte ele aqui. Nada se perde: títulos repetidos são unificados, e o que você mudou aqui tem prioridade.</p>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;margin:6px 0 10px"><a class="bookmarklet" id="bm-filmow" href="#">' + sparkle() + 'Exportar do Filmow</a><a class="bookmarklet" id="bm-imdb" href="#">' + sparkle() + 'Exportar do IMDb</a></div>' +
      '<ol class="steps"><li>Mostre a barra de favoritos (Ctrl+Shift+B) e arraste os dois botões azuis para ela.</li><li>Abra <a href="https://filmow.com/usuario/' + esc(state.profile.filmow) + '/" target="_blank" rel="noopener">seu Filmow</a> e clique em “Exportar do Filmow”. Aguarde o aviso de pronto.</li><li>Abra <a href="https://www.imdb.com/pt/user/' + esc(state.profile.imdb) + '/" target="_blank" rel="noopener">seu IMDb</a> e clique em “Exportar do IMDb”.</li><li>Solte os arquivos baixados aqui embaixo. Também aceita os CSV oficiais do IMDb (Avaliações / Lista para assistir).</li></ol>' +
      '<div class="drop" id="drop">Solte aqui os arquivos (.json ou .csv) ou clique para escolher<input type="file" id="file" accept=".json,.csv" multiple hidden></div>' +
      '<div class="hint">Último Filmow: ' + (state.sync.filmowAt ? fmtDate(state.sync.filmowAt) : 'nunca') + ' · Último IMDb: ' + (state.sync.imdbAt ? fmtDate(state.sync.imdbAt) : 'nunca') + '</div>' +
    '</section>' +
    // Backup
    '<section class="card pad full"><h3>' + sparkle() + 'Backup</h3>' +
      '<p>Além do GitHub, a Estante guarda sozinha uma cópia por dia neste aparelho (últimos 10 dias). Você também pode baixar um arquivo completo e guardar onde quiser — ele pode ser restaurado aqui a qualquer momento (é só soltar na área acima).</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary sm" id="bk">Baixar backup completo</button><button class="btn sm" id="bkcsv">Baixar planilha (CSV)</button></div>' +
      (backups.length ? '<div style="margin-top:14px" class="chips">' + backups.map((b) => '<button class="chip" data-restore="' + b + '">restaurar ' + fmtDate(b.slice(7)) + '</button>').join('') + '</div>' : '') +
    '</section>' +
    '</div>';

  const line = $('#sync-line');
  const showStatus = (st) => {
    const msg = { ok: 'Tudo sincronizado ✓', syncing: 'Sincronizando…', error: 'Erro: ' + (st.error || ''), offline: 'Offline — as mudanças ficam salvas aqui e sobem quando a internet voltar', readonly: 'Somente leitura neste aparelho (sem token): você vê a versão publicada; mudanças ficam só aqui', idle: 'Aguardando' }[st.state];
    line.innerHTML = '<span class="sync-dot ' + st.state + '"></span>' + esc(msg);
  };
  showStatus(st);
  onSyncStatus((x) => { if (document.body.contains(line)) showStatus(x); });
  $('#syncnow').onclick = () => syncNow();
  $('#ghsave').onclick = async () => {
    const tok = $('#ghtoken').value.trim();
    const repo = $('#ghrepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    const prev = S.settings();
    S.saveSettings({ ghRepo: repo, ghToken: tok && !tok.startsWith('•') ? tok : prev.ghToken });
    try { const name = await testToken(); toast('Conectado a ' + name + ' ✓', 'ok'); await syncNow(); router(); }
    catch (e) { S.saveSettings({ ghToken: prev.ghToken, ghRepo: prev.ghRepo }); toast(e.message, 'error'); }
  };
  if ($('#ghforget')) $('#ghforget').onclick = () => { S.saveSettings({ ghToken: '' }); router(); };
  $('#tmdbsave').onclick = async () => {
    const k = $('#tmdbkey').value.trim();
    if (k.startsWith('•')) return;
    if (!k) { S.saveSettings({ tmdbKey: '' }); router(); return; }
    try {
      const r = await fetch('https://api.themoviedb.org/3/configuration?api_key=' + encodeURIComponent(k));
      if (!r.ok) throw new Error();
      S.saveSettings({ tmdbKey: k });
      toast('Chave do TMDB ativa ✓', 'ok');
      router();
      backgroundRefresh(true);
    } catch { toast('O TMDB recusou essa chave. Confira se copiou a “Chave da API”.', 'error'); }
  };
  $('#refresh').onclick = async (ev) => {
    ev.target.disabled = true;
    const msg = $('#refresh-msg');
    const n = await M.refreshStale((d) => { S.upsertTitle(d); msg.textContent = 'Atualizando: ' + d.title; }, { maxAgeDays: 0, limit: 5000 });
    S.commit('meta');
    msg.textContent = n + ' títulos atualizados ✓';
    ev.target.disabled = false;
  };
  $('#psave').onclick = async () => {
    const f = $('#pavatar').files[0];
    const avatar = f ? await resizeImage(f, 320) : state.profile.avatar;
    state.profile = Object.assign({}, state.profile, { name: $('#pname').value.trim() || 'Lara', bio: $('#pbio').value.trim(), avatar });
    state.profileAt = now();
    S.commit();
    paintChrome();
    toast('Perfil salvo', 'ok');
  };
  setupBookmarklets();
  const drop = $('#drop'), file = $('#file');
  drop.onclick = () => file.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); };
  file.onchange = () => handleFiles(file.files);
  $('#bk').onclick = () => download('estante-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(state));
  $('#bkcsv').onclick = () => download('estante-' + new Date().toISOString().slice(0, 10) + '.csv', toCSV(), 'text/csv');
  $$('[data-restore]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Mesclar o backup de ' + fmtDate(b.dataset.restore.slice(7)) + ' com a estante atual?')) return;
    const data = await S.__idbGet(b.dataset.restore);
    replaceAndSync(S.mergeStates(state, data));
  }));
});

function replaceAndSync(s) { S.replaceState(s); toast('Backup restaurado', 'ok'); syncNow(); }

async function handleFiles(files) {
  const drop = $('#drop');
  for (const f of files) {
    try {
      drop.textContent = 'Importando ' + f.name + '…';
      const r = await importFile(f, (i, n) => (drop.textContent = 'Unificando títulos do ' + f.name + ': ' + i + '/' + n));
      toast(r.kind + ': ' + (r.titles || 0) + ' títulos importados ✓', 'ok');
    } catch (e) { console.error(e); toast(f.name + ': ' + e.message, 'error'); }
  }
  syncNow();
  router();
}

async function setupBookmarklets() {
  const make = async (id, file, fn, host, arg) => {
    try {
      const code = await (await fetch(file)).text();
      const wrapped = '(async()=>{' + code + '\nif(!location.hostname.endsWith("' + host + '")){alert("Abra o ' + host + ' primeiro e clique de novo.");return;}' +
        'const box=document.createElement("div");box.style.cssText="position:fixed;z-index:2147483647;right:20px;bottom:20px;background:#5682c4;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:14px 18px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);max-width:320px";box.textContent="Estante: exportando…";document.body.appendChild(box);' +
        'try{await ' + fn + '("' + arg + '",{log:m=>box.textContent="Estante: "+m});box.textContent="Pronto! O arquivo foi baixado. Solte ele na Estante → Configurações.";}catch(e){box.style.background="#d9677a";box.textContent="Erro: "+e.message;}setTimeout(()=>box.remove(),15000);})()';
      $(id).href = 'javascript:' + encodeURIComponent(wrapped);
      $(id).onclick = (e) => { e.preventDefault(); toast('Arraste este botão para a barra de favoritos', ''); };
    } catch { $(id).classList.add('hidden'); }
  };
  make('#bm-filmow', 'tools/filmow-export.js', 'estanteFilmowExport', 'filmow.com', state.profile.filmow);
  make('#bm-imdb', 'tools/imdb-export.js', 'estanteImdbExport', 'imdb.com', state.profile.imdb);
}

function toCSV() {
  const rows = [['Título', 'Título original', 'Tipo', 'Ano', 'Já vi', 'Data', 'Quero ver', 'Favorito', 'Nota (0-5)', 'Comentário', 'IMDb']];
  for (const [key, e] of Object.entries(state.entries)) {
    const t = state.titles[key];
    if (!t) continue;
    rows.push([t.title, t.originalTitle || '', KIND_LABEL[t.kind] || '', t.year || '', e.watched ? 'sim' : '', e.watched && !e.approx ? (e.watchedAt || '').slice(0, 10) : '', e.watchlist ? 'sim' : '', e.favorite ? 'sim' : '', e.rating != null ? e.rating / 2 : '', e.comment || '', t.imdbId || '']);
  }
  return '﻿' + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
}

function resizeImage(file, max) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = img.width * s; c.height = img.height * s;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Backups diários automáticos ----------
async function dailyBackup() {
  const key = 'backup-' + new Date().toISOString().slice(0, 10);
  try {
    if (!Object.keys(state.entries).length) return;
    if (await S.__idbGet(key)) return;
    await S.__idbSet(key, JSON.parse(JSON.stringify(state)));
    const all = await listBackups();
    for (const k of all.slice(10)) await S.__idbDel(k);
  } catch (e) { console.warn('backup', e); }
}
async function listBackups() {
  try { return (await S.__idbKeys()).filter((k) => String(k).startsWith('backup-')).sort().reverse(); } catch { return []; }
}

// ---------- Atualização automática dos dados dos títulos ----------
let refreshing = false;
async function backgroundRefresh(force) {
  if (refreshing || !navigator.onLine) return;
  const last = S.settings().lastRefresh;
  if (!force && last && Date.now() - new Date(last) < 3 * 3600e3) return;
  refreshing = true;
  try {
    const n = await M.refreshStale((d) => S.upsertTitle(d), { limit: force ? 200 : 120 });
    if (n) S.commit('meta');
    S.saveSettings({ lastRefresh: now() });
  } finally { refreshing = false; }
}

// ---------- Cabeçalho ----------
function paintChrome() {
  const p = state.profile;
  const av = $('#avatar');
  av.style.backgroundImage = p.avatar ? 'url("' + p.avatar + '")' : '';
  av.textContent = p.avatar ? '' : (p.name || 'L')[0];
  $('#foot-name').textContent = p.name;
  $('#foot-year').textContent = new Date().getFullYear();
  document.title = 'Estante · ' + p.name;
}
onSyncStatus((st) => { $('#sync-dot').className = 'sync-dot ' + st.state; $('#sync-dot').parentElement.title = { ok: 'Sincronizado', syncing: 'Sincronizando…', error: 'Erro na sincronização', offline: 'Offline', readonly: 'Somente leitura (sem token)' }[st.state] || ''; });

// ---------- Início do app ----------
const scheduleSync = debounce(() => syncNow(), 8000);
S.onChange((reason) => { if (reason !== 'replace') scheduleSync(); rerender(); paintChrome(); });
window.addEventListener('online', () => syncNow());
window.addEventListener('offline', () => $('#sync-dot').className = 'sync-dot offline');
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });

(async function start() {
  const had = await S.loadLocal();
  if (!had) {
    const seed = await pullPublic();
    if (seed) S.replaceState(seed);
  }
  paintChrome();
  await router();
  dailyBackup();
  syncNow().then(() => backgroundRefresh());
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
