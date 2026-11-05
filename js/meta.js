// Fontes de dados gratuitas:
//  - TMDB (com chave gratuita): busca, sinopse em português, lançamentos, onde assistir
//  - Cinemeta (sem chave): dados do IMDb, inclusive a nota geral do IMDb
//  - Jikan / MyAnimeList (sem chave): animes
import { settings, state } from './store.js';
import { now, sleep } from './util.js';

const TMDB = 'https://api.themoviedb.org/3';
const CINEMETA = 'https://v3-cinemeta.strem.io';
export const TMDB_IMG = 'https://image.tmdb.org/t/p/';

const mem = new Map();
// fetch com limite de tempo, para uma fonte fora do ar não travar a página
function fetchT(url, opts = {}, ms = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, Object.assign({}, opts, { signal: ctl.signal })).finally(() => clearTimeout(timer));
}
async function getJSON(url, { ttl = 3600e3, retries = 2 } = {}) {
  const hit = mem.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  for (let i = 0; ; i++) {
    try {
      const r = await fetchT(url);
      if (r.status === 429 && i < retries) { await sleep(1200 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      mem.set(url, { at: Date.now(), data });
      return data;
    } catch (e) {
      if (i >= retries) throw e;
      await sleep(600 * (i + 1));
    }
  }
}

export const hasTmdb = () => !!settings().tmdbKey;
function tmdb(path, params = {}) {
  const q = new URLSearchParams({ api_key: settings().tmdbKey, language: 'pt-BR', ...params });
  return getJSON(TMDB + path + (path.includes('?') ? '&' : '?') + q);
}
export const tmdbImg = (p, size = 'w342') => (p ? TMDB_IMG + size + p : '');

// Pôsteres do IMDb (Amazon) aceitam redimensionamento pela URL
export function posterUrl(t, size = 'm') {
  const p = t && t.poster;
  if (!p) return '';
  if (p.includes('m.media-amazon.com') && p.includes('._V1_')) {
    const w = size === 's' ? 185 : size === 'l' ? 600 : 342;
    return p.replace(/\._V1_.*\.jpg$/, '._V1_QL75_UX' + w + '_.jpg');
  }
  if (p.startsWith(TMDB_IMG)) return p.replace(/\/t\/p\/w\d+\//, '/t/p/' + (size === 's' ? 'w185' : size === 'l' ? 'w500' : 'w342') + '/');
  return p;
}

const TMDB_GENRES = {
  28: 'Ação', 12: 'Aventura', 16: 'Animação', 35: 'Comédia', 80: 'Crime', 99: 'Documentário', 18: 'Drama', 10751: 'Família',
  14: 'Fantasia', 36: 'História', 27: 'Terror', 10402: 'Música', 9648: 'Mistério', 10749: 'Romance', 878: 'Ficção científica',
  10770: 'Filme para TV', 53: 'Thriller', 10752: 'Guerra', 37: 'Faroeste', 10759: 'Ação e Aventura', 10762: 'Infantil',
  10763: 'Notícias', 10764: 'Reality', 10765: 'Ficção científica e Fantasia', 10766: 'Novela', 10767: 'Talk show', 10768: 'Guerra e Política',
};
export const GENRE_FILTERS = [
  [28, 'Ação'], [12, 'Aventura'], [16, 'Animação'], [35, 'Comédia'], [80, 'Crime'], [99, 'Documentário'], [18, 'Drama'],
  [14, 'Fantasia'], [27, 'Terror'], [9648, 'Mistério'], [10749, 'Romance'], [878, 'Ficção científica'], [53, 'Thriller'],
];

const isAnimeTmdb = (r) => (r.genre_ids || (r.genres || []).map((g) => g.id)).includes(16) &&
  (r.original_language === 'ja' || (r.origin_country || []).includes('JP') || (r.production_countries || []).some((c) => c.iso_3166_1 === 'JP'));

// Resultado de lista do TMDB -> título "leve"
export function fromTmdbItem(r, type) {
  type = type || r.media_type;
  if (type !== 'movie' && type !== 'tv') return null;
  const date = type === 'movie' ? r.release_date : r.first_air_date;
  const existing = Object.values(state.titles).find((t) => t.tmdbId === r.id && t.tmdbType === type);
  return {
    key: existing ? existing.key : 'tmdb-' + type + '-' + r.id,
    tmdbId: r.id,
    tmdbType: type,
    kind: isAnimeTmdb(r) ? 'anime' : type === 'movie' ? 'movie' : 'series',
    title: r.title || r.name,
    originalTitle: r.original_title || r.original_name,
    year: date ? +date.slice(0, 4) : null,
    releaseDate: date || null,
    poster: r.poster_path ? tmdbImg(r.poster_path) : '',
    backdrop: r.backdrop_path ? tmdbImg(r.backdrop_path, 'w1280') : '',
    plot: r.overview || '',
    genres: (r.genre_ids || []).map((g) => TMDB_GENRES[g]).filter(Boolean),
    ratings: { tmdb: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null },
  };
}

function fromCinemetaItem(m) {
  const g = m.genres || m.genre || [];
  const anime = g.includes('Animation') && /Japan/.test(m.country || '');
  const y = parseInt(m.releaseInfo || m.year, 10);
  return {
    key: m.imdb_id || m.id,
    imdbId: m.imdb_id || m.id,
    kind: anime ? 'anime' : m.type === 'series' ? 'series' : 'movie',
    title: m.name,
    year: isNaN(y) ? null : y,
    poster: m.poster ? m.poster.replace('/poster/small/', '/poster/medium/') : '',
    backdrop: m.background || '',
    plot: m.description || '',
    plotLang: 'en',
    genres: g,
    ratings: { imdb: m.imdbRating ? +m.imdbRating : null },
  };
}

// AniList (sem chave): animes, temporadas e próximos episódios
const ANILIST_FIELDS = 'id idMal title{romaji english native} coverImage{extraLarge large} bannerImage startDate{year month day} endDate{year} averageScore episodes duration format status genres description(asHtml:false) nextAiringEpisode{airingAt episode} studios(isMain:true){nodes{name}}';
async function anilist(query, variables = {}) {
  const key = 'anilist:' + query + JSON.stringify(variables);
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < 3600e3) return hit.data;
  let r;
  for (let i = 0; i < 4; i++) {
    r = await fetchT('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
    if (r.status !== 429) break;
    await sleep(((+r.headers.get('Retry-After') || 20) + 1) * 1000); // limite de pedidos por minuto do AniList
  }
  if (!r.ok) throw new Error('AniList ' + r.status);
  const j = await r.json();
  mem.set(key, { at: Date.now(), data: j.data });
  return j.data;
}
const ymd = (d) => (d && d.year ? [d.year, String(d.month || 1).padStart(2, '0'), String(d.day || 1).padStart(2, '0')].join('-') : null);
function fromAniList(a) {
  const date = ymd(a.startDate);
  return {
    key: 'anilist-' + a.id,
    anilistId: a.id,
    malId: a.idMal || null,
    kind: 'anime',
    animeFormat: a.format,
    title: a.title.english || a.title.romaji,
    originalTitle: a.title.romaji !== (a.title.english || a.title.romaji) ? a.title.romaji : a.title.native,
    nativeTitle: a.title.native,
    year: a.startDate && a.startDate.year,
    endYear: a.endDate && a.endDate.year,
    releaseDate: date,
    poster: (a.coverImage && (a.coverImage.extraLarge || a.coverImage.large)) || '',
    backdrop: a.bannerImage || '',
    plot: (a.description || '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').trim(),
    plotLang: 'en',
    genres: a.genres || [],
    episodes: a.episodes,
    runtime: a.duration,
    status: a.status,
    credits: { directors: ((a.studios && a.studios.nodes) || []).map((s) => s.name), cast: [] },
    nextEpisode: a.nextAiringEpisode ? { date: new Date(a.nextAiringEpisode.airingAt * 1000).toISOString().slice(0, 10), season: 1, episode: a.nextAiringEpisode.episode } : null,
    ratings: { anilist: a.averageScore ? a.averageScore / 10 : null },
  };
}
function anilistPage(f, page = 1, perPage = 20) {
  const args = Object.entries(f).filter(([, v]) => v);
  const sig = args.map(([k]) => '$' + k + ':' + ({ search: 'String', sort: '[MediaSort]', status: 'MediaStatus', format: 'MediaFormat', genre: 'String' }[k])).join(',');
  const use = args.map(([k]) => k + ':$' + k).join(',');
  const q = 'query($page:Int,$perPage:Int' + (sig ? ',' + sig : '') + '){Page(page:$page,perPage:$perPage){media(type:ANIME,isAdult:false' + (use ? ',' + use : '') + '){' + ANILIST_FIELDS + '}}}';
  return anilist(q, Object.assign({ page, perPage }, Object.fromEntries(args))).then((d) => d.Page.media.map(fromAniList));
}

// ---------- Busca ----------
export async function search(q) {
  if (hasTmdb()) {
    const [p1, p2] = await Promise.all([tmdb('/search/multi', { query: q, page: 1, include_adult: false }), tmdb('/search/multi', { query: q, page: 2, include_adult: false }).catch(() => ({ results: [] }))]);
    return [...p1.results, ...p2.results].map((r) => fromTmdbItem(r)).filter(Boolean);
  }
  const enc = encodeURIComponent(q);
  const [mv, sr, an] = await Promise.all([
    getJSON(CINEMETA + '/catalog/movie/top/search=' + enc + '.json').catch(() => ({ metas: [] })),
    getJSON(CINEMETA + '/catalog/series/top/search=' + enc + '.json').catch(() => ({ metas: [] })),
    anilistPage({ search: q, sort: 'SEARCH_MATCH' }, 1, 12).catch(() => []),
  ]);
  return [...mv.metas.map(fromCinemetaItem), ...sr.metas.map(fromCinemetaItem), ...an];
}

// Busca só no catálogo do IMDb (usada para unificar títulos do Filmow)
export async function searchCatalog(q, type = 'movie') {
  const r = await getJSON(CINEMETA + '/catalog/' + type + '/top/search=' + encodeURIComponent(q) + '.json', { ttl: 864e5 });
  return (r.metas || []).map(fromCinemetaItem);
}

export const searchAnime = (q) => anilistPage({ search: q, sort: 'SEARCH_MATCH' }, 1, 6);

// ---------- Detalhes completos ----------
async function tmdbDetails(type, id) {
  const d = await tmdb('/' + type + '/' + id, { append_to_response: 'credits,external_ids,watch/providers,recommendations,videos', include_video_language: 'pt,en,null' });
  const t = fromTmdbItem(d, type);
  if (!d.overview) {
    const en = await tmdb('/' + type + '/' + id, { language: 'en-US' }).catch(() => null);
    if (en && en.overview) { t.plot = en.overview; t.plotLang = 'en'; }
  }
  t.imdbId = (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || null;
  if (t.imdbId) t.key = t.imdbId;
  t.genres = (d.genres || []).map((g) => g.name);
  t.runtime = d.runtime || (d.episode_run_time && d.episode_run_time[0]) || null;
  t.status = d.status;
  t.countries = d.origin_country || (d.production_countries || []).map((c) => c.iso_3166_1);
  t.tagline = d.tagline || '';
  const crew = (d.credits && d.credits.crew) || [];
  t.credits = {
    directors: type === 'movie' ? crew.filter((c) => c.job === 'Director').map((c) => c.name) : (d.created_by || []).map((c) => c.name),
    cast: ((d.credits && d.credits.cast) || []).slice(0, 12).map((c) => ({ name: c.name, character: c.character, photo: c.profile_path ? tmdbImg(c.profile_path, 'w185') : '' })),
  };
  if (type === 'tv') {
    t.endYear = d.last_air_date && d.status === 'Ended' ? +d.last_air_date.slice(0, 4) : null;
    t.seasons = (d.seasons || []).filter((s) => s.season_number > 0).map((s) => ({ n: s.season_number, name: s.name, episodes: s.episode_count, airDate: s.air_date, poster: s.poster_path ? tmdbImg(s.poster_path, 'w185') : '' }));
    t.episodes = d.number_of_episodes;
    t.nextEpisode = d.next_episode_to_air ? { date: d.next_episode_to_air.air_date, season: d.next_episode_to_air.season_number, episode: d.next_episode_to_air.episode_number, name: d.next_episode_to_air.name } : null;
  }
  const br = d['watch/providers'] && d['watch/providers'].results && d['watch/providers'].results.BR;
  t.providers = br ? {
    link: br.link,
    stream: (br.flatrate || []).map((p) => ({ name: p.provider_name, logo: tmdbImg(p.logo_path, 'w92') })),
    rent: (br.rent || br.buy || []).map((p) => ({ name: p.provider_name, logo: tmdbImg(p.logo_path, 'w92') })),
  } : null;
  const vids = (d.videos && d.videos.results) || [];
  const tr = vids.find((v) => v.site === 'YouTube' && v.type === 'Trailer') || vids.find((v) => v.site === 'YouTube');
  t.trailer = tr ? tr.key : null;
  t.recommendations = ((d.recommendations && d.recommendations.results) || []).slice(0, 12).map((r) => fromTmdbItem(r, type)).filter(Boolean);
  t.metaUpdatedAt = now();
  return t;
}

async function cinemetaDetails(imdbId, kindHint) {
  const types = kindHint === 'movie' ? ['movie', 'series'] : ['series', 'movie'];
  for (const type of types) {
    const j = await getJSON(CINEMETA + '/meta/' + type + '/' + imdbId + '.json').catch(() => null);
    if (j && j.meta && j.meta.name) {
      const m = j.meta;
      const t = fromCinemetaItem(Object.assign({ imdb_id: imdbId }, m));
      t.runtime = parseInt(m.runtime, 10) || null;
      t.releaseDate = m.released ? m.released.slice(0, 10) : null;
      t.credits = { directors: m.director || m.writer || [], cast: (m.cast || []).map((name) => ({ name })) };
      if (type === 'series' && m.videos) {
        const seasons = {};
        for (const v of m.videos) if (v.season > 0) seasons[v.season] = (seasons[v.season] || 0) + 1;
        t.seasons = Object.entries(seasons).map(([n, c]) => ({ n: +n, name: 'Temporada ' + n, episodes: c }));
        const next = m.videos.filter((v) => v.released && v.released > now()).sort((a, b) => a.released.localeCompare(b.released))[0];
        t.nextEpisode = next ? { date: next.released.slice(0, 10), season: next.season, episode: next.episode, name: next.name } : null;
      }
      t.trailer = m.trailers && m.trailers[0] ? m.trailers[0].source : null;
      t.metaUpdatedAt = now();
      return t;
    }
  }
  return null;
}

// Nota geral do IMDb (Cinemeta não precisa de chave)
export async function imdbRating(imdbId, kind) {
  const type = kind === 'movie' ? 'movie' : 'series';
  const j = await getJSON(CINEMETA + '/meta/' + type + '/' + imdbId + '.json', { ttl: 864e5 }).catch(() => null);
  const r = j && j.meta && j.meta.imdbRating;
  return r ? +r : null;
}

export async function details(key, hint = {}) {
  const local = state.titles[key] || {};
  const base = Object.assign({}, hint, local);
  let t = null;
  try {
    if (hasTmdb()) {
      if (base.tmdbId && base.tmdbType) t = await tmdbDetails(base.tmdbType, base.tmdbId);
      else if (/^tmdb-(movie|tv)-\d+$/.test(key)) { const [, ty, id] = key.split('-'); t = await tmdbDetails(ty, +id); }
      else if (base.imdbId || /^tt\d+$/.test(key)) {
        const f = await tmdb('/find/' + (base.imdbId || key), { external_source: 'imdb_id' });
        const r = (f.movie_results || [])[0] ? ['movie', f.movie_results[0]] : (f.tv_results || [])[0] ? ['tv', f.tv_results[0]] : null;
        if (r) t = await tmdbDetails(r[0], r[1].id);
      }
    }
  } catch (e) { console.warn('TMDB', e); }
  if (!t && (base.imdbId || /^tt\d+$/.test(key))) t = await cinemetaDetails(base.imdbId || key, base.kind).catch(() => null);
  if (!t && (base.anilistId || /^anilist-\d+$/.test(key))) {
    const id = base.anilistId || +key.slice(8);
    const d = await anilist('query($id:Int){Media(id:$id,type:ANIME){' + ANILIST_FIELDS + '}}', { id }).catch(() => null);
    if (d && d.Media) { t = fromAniList(d.Media); t.metaUpdatedAt = now(); }
  }
  if (!t) return Object.keys(base).length ? Object.assign({ key }, base) : null;
  // Preserva o que já sabíamos (ex.: tipo "anime" vindo do IMDb, título em português)
  if (local.kind === 'anime') t.kind = 'anime';
  if (local.imdbId && !t.imdbId) t.imdbId = local.imdbId;
  if (local.key && local.key !== t.key && state.titles[local.key]) t.key = local.key;
  // Fontes sem português (Cinemeta/Jikan) não substituem nome, gêneros e sinopse em português
  if (t.plotLang === 'en' && local.title) {
    t.title = local.title;
    if (local.genres && local.genres.length) t.genres = local.genres;
    if (local.plot && local.plotLang !== 'en') { t.plot = local.plot; t.plotLang = local.plotLang; }
    if (local.originalTitle) t.originalTitle = local.originalTitle;
  }
  t.ratings = Object.assign({}, local.ratings, t.ratings);
  if (t.imdbId && t.ratings.imdb == null) t.ratings.imdb = await imdbRating(t.imdbId, t.kind);
  return Object.assign({}, local, t);
}

// ---------- Vitrines (explorar e lançamentos) ----------
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export async function shelf(id, page = 1, extra = {}) {
  const g = extra.genre ? { with_genres: extra.genre } : {};
  if (hasTmdb()) {
    const T = {
      'movie-popular': () => tmdb('/discover/movie', { sort_by: 'popularity.desc', page, ...g }).then((r) => r.results.map((x) => fromTmdbItem(x, 'movie'))),
      'movie-top': () => tmdb('/discover/movie', { sort_by: 'vote_average.desc', 'vote_count.gte': 3000, page, ...g }).then((r) => r.results.map((x) => fromTmdbItem(x, 'movie'))),
      'movie-now': () => tmdb('/movie/now_playing', { region: 'BR', page }).then((r) => r.results.map((x) => fromTmdbItem(x, 'movie'))),
      // Estreias nos cinemas do Brasil (tipos 2 e 3 = cinema), com a data brasileira
      'movie-upcoming': () => tmdb('/discover/movie', { region: 'BR', 'release_date.gte': plusDays(1), 'release_date.lte': plusDays(180), 'primary_release_date.gte': plusDays(-365), with_release_type: '2|3', sort_by: 'popularity.desc', page }).then((r) => r.results.map((x) => fromTmdbItem(x, 'movie'))),
      'series-popular': () => tmdb('/discover/tv', { sort_by: 'popularity.desc', without_genres: extra.genre ? '' : '10767,10763,10764', page, ...g }).then((r) => r.results.map((x) => fromTmdbItem(x, 'tv'))),
      'series-top': () => tmdb('/discover/tv', { sort_by: 'vote_average.desc', 'vote_count.gte': 1500, page, ...g }).then((r) => r.results.map((x) => fromTmdbItem(x, 'tv'))),
      'series-airing': () => tmdb('/tv/on_the_air', { page }).then((r) => r.results.map((x) => fromTmdbItem(x, 'tv'))),
      'series-upcoming': () => tmdb('/discover/tv', { 'first_air_date.gte': plusDays(1), 'first_air_date.lte': plusDays(180), sort_by: 'popularity.desc', without_genres: '10767,10763,10764', page }).then((r) => r.results.map((x) => fromTmdbItem(x, 'tv'))),
      'anime-popular': () => tmdb('/discover/tv', { with_genres: '16' + (extra.genre ? ',' + extra.genre : ''), with_original_language: 'ja', sort_by: 'popularity.desc', page }).then((r) => r.results.map((x) => fromTmdbItem(x, 'tv'))),
      'anime-top': () => tmdb('/discover/tv', { with_genres: '16', with_original_language: 'ja', sort_by: 'vote_average.desc', 'vote_count.gte': 300, page }).then((r) => r.results.map((x) => fromTmdbItem(x, 'tv'))),
      'anime-movies': () => tmdb('/discover/movie', { with_genres: '16', with_original_language: 'ja', sort_by: 'popularity.desc', page }).then((r) => r.results.map((x) => fromTmdbItem(x, 'movie'))),
      'anime-airing': () => tmdb('/discover/tv', { with_genres: '16', with_original_language: 'ja', 'air_date.gte': today(), 'air_date.lte': plusDays(7), sort_by: 'popularity.desc', page }).then((r) => r.results.map((x) => fromTmdbItem(x, 'tv'))),
      'anime-upcoming': () => tmdb('/discover/tv', { with_genres: '16', with_original_language: 'ja', 'first_air_date.gte': plusDays(1), 'first_air_date.lte': plusDays(240), sort_by: 'popularity.desc', page }).then((r) => r.results.map((x) => fromTmdbItem(x, 'tv'))),
    };
    if (T[id]) return T[id]();
  }
  // Sem chave do TMDB: Cinemeta + Jikan
  const genreName = extra.genre && (GENRE_EN[extra.genre] || '');
  const C = {
    'movie-popular': () => getJSON(CINEMETA + '/catalog/movie/top' + (genreName ? '/genre=' + genreName : '') + '.json').then((r) => r.metas.map(fromCinemetaItem)),
    'movie-top': () => getJSON(CINEMETA + '/catalog/movie/imdbRating' + (genreName ? '/genre=' + genreName : '') + '.json').then((r) => r.metas.map(fromCinemetaItem)),
    'series-popular': () => getJSON(CINEMETA + '/catalog/series/top' + (genreName ? '/genre=' + genreName : '') + '.json').then((r) => r.metas.map(fromCinemetaItem)),
    'series-top': () => getJSON(CINEMETA + '/catalog/series/imdbRating' + (genreName ? '/genre=' + genreName : '') + '.json').then((r) => r.metas.map(fromCinemetaItem)),
    'anime-popular': () => anilistPage({ sort: 'TRENDING_DESC', genre: GENRE_EN[extra.genre] }, page),
    'anime-top': () => anilistPage({ sort: 'SCORE_DESC' }, page),
    'anime-movies': () => anilistPage({ sort: 'POPULARITY_DESC', format: 'MOVIE' }, page),
    'anime-airing': () => anilistPage({ sort: 'POPULARITY_DESC', status: 'RELEASING' }, page),
    'anime-upcoming': () => anilistPage({ sort: 'POPULARITY_DESC', status: 'NOT_YET_RELEASED' }, page),
  };
  if (C[id]) return C[id]();
  return [];
}
const GENRE_EN = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 14: 'Fantasy', 27: 'Horror', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 53: 'Thriller' };

// Atualiza aos poucos os dados dos títulos da sua estante (nota, sinopse, próximos episódios)
export async function refreshStale(onEach, { maxAgeDays = 10, limit = 25 } = {}) {
  const cutoff = new Date(Date.now() - maxAgeDays * 864e5).toISOString();
  const stale = Object.values(state.titles)
    .filter((t) => !t.metaUpdatedAt || t.metaUpdatedAt < cutoff || (!t.metaSource && hasTmdb()))
    .sort((a, b) => (a.metaUpdatedAt || '').localeCompare(b.metaUpdatedAt || ''))
    .slice(0, limit);
  let n = 0;
  for (const t of stale) {
    try {
      const d = await details(t.key, t);
      if (d) {
        d.key = t.key;
        d.metaSource = hasTmdb() ? 'tmdb' : 'free';
        d.metaUpdatedAt = now();
        delete d.recommendations; delete d.providers;
        if (t.title && t.plotLang !== 'en' && d.plotLang === 'en') { d.plot = t.plot; d.plotLang = t.plotLang; }
        if (t.title && t.source === 'imdb') d.title = t.title;
        if (t.poster && !(d.poster || '').startsWith(TMDB_IMG)) d.poster = t.poster;
        onEach(d);
        n++;
      }
    } catch (e) { console.warn('refresh', t.key, e); }
    await sleep(250);
  }
  return n;
}
