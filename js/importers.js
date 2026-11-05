// Importa dados do IMDb e do Filmow para a Estante, unificando títulos repetidos.
import { state, upsertTitle, findTitle, commit, mergeStates, replaceState, createList } from './store.js';
import { now, norm, sleep } from './util.js';
import { search, searchCatalog, searchAnime, hasTmdb } from './meta.js';

const earlier = (a, b) => (!a ? b : !b ? a : a < b ? a : b);

function kindFromImdb(t) {
  const interests = t.interests || [];
  if (interests.includes('Anime') || ((t.genres || []).includes('Animação') && (t.countries || []).includes('JP'))) return 'anime';
  if (['tvSeries', 'tvMiniSeries'].includes(t.imdbType)) return 'series';
  return 'movie';
}

function applyEntry(key, x, source) {
  const e = state.entries[key] || (state.entries[key] = { sources: [], updatedAt: now() });
  const before = JSON.stringify(e);
  if (!e.sources.includes(source)) e.sources.push(source);
  const when = x.addedAt || null;
  const ap = !!x.approx;
  // Data real (IMDb) sempre ganha de data aproximada (Filmow); entre reais, vale a mais antiga
  const better = (cur, curApprox) => when && (!cur || (curApprox && !ap) || (curApprox === ap && when < cur));
  if (x.list === 'watched' || x.list === 'favorites' || x.rating != null) {
    if (!e.watched) { e.watched = true; e.watchedAt = when; e.approx = ap; }
    else if (better(e.watchedAt, !!e.approx)) { e.watchedAt = when; e.approx = ap; }
    if (e.watchlist) { e.watchlist = false; e.watchlistAt = null; }
  }
  if (x.list === 'favorites') {
    if (!e.favorite) { e.favorite = true; e.favoriteAt = when; e.approxFav = ap; }
    else if (better(e.favoriteAt, !!e.approxFav)) { e.favoriteAt = when; e.approxFav = ap; }
  }
  if (x.rating != null && (e.rating == null || (!ap && (e.approxRated || (x.ratedAt && (!e.ratedAt || x.ratedAt > e.ratedAt)))))) { e.rating = x.rating; e.ratedAt = x.ratedAt || when; e.approxRated = ap; }
  if (x.list === 'watchlist' && !e.watched) {
    if (!e.watchlist) { e.watchlist = true; e.watchlistAt = when; e.approxWl = ap; }
    else if (better(e.watchlistAt, !!e.approxWl)) { e.watchlistAt = when; e.approxWl = ap; }
  }
  if (x.comment && !e.comment) { e.comment = x.comment; e.commentAt = when; }
  if (x.list && x.list.startsWith('list:')) {
    const name = x.list.slice(5);
    let l = Object.values(state.lists).find((l) => norm(l.name) === norm(name));
    if (!l) { const id = createList(name, 'Importada do ' + (source === 'imdb' ? 'IMDb' : 'Filmow')); l = state.lists[id]; }
    if (!l.items.some((i) => i.key === key)) { l.items.push({ key, addedAt: when || now() }); l.updatedAt = now(); }
  }
  if (JSON.stringify(e) !== before) e.updatedAt = now();
}

// ---------- IMDb (arquivo gerado pelo botão "Exportar do IMDb") ----------
export function importImdb(data) {
  const before = Object.keys(state.entries).length;
  for (const t of Object.values(data.titles)) {
    const existing = findTitle({ imdbId: t.imdbId, title: t.title, originalTitle: t.originalTitle, year: t.year });
    const key = existing ? existing.key : t.imdbId;
    upsertTitle({
      key, imdbId: t.imdbId, imdbType: t.imdbType, kind: existing && existing.kind === 'anime' ? 'anime' : kindFromImdb(t), source: existing ? existing.source : 'imdb',
      title: t.title, originalTitle: t.originalTitle, year: t.year, endYear: t.endYear, poster: t.poster, plot: t.plot, plotLang: 'pt',
      genres: t.genres, runtime: t.runtime, releaseDate: t.releaseDate, status: t.status, episodes: t.episodes, countries: t.countries,
      credits: { directors: t.credits['Direção'] || t.credits['Criação'] || t.credits['Director'] || t.credits['Creator'] || [], cast: (t.credits['Estrelas'] || t.credits['Stars'] || []).map((name) => ({ name })) },
      ratings: { imdb: t.imdbRating, imdbVotes: t.votes },
    });
  }
  // As mais antigas primeiro, para as datas "mais cedo" prevalecerem corretamente
  const entries = [...data.entries].sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''));
  for (const x of entries) {
    const t = findTitle({ imdbId: x.id });
    if (t) applyEntry(t.key, x, 'imdb');
  }
  state.sync.imdbAt = data.exportedAt || now();
  commit('import');
  return { titles: Object.keys(data.titles).length, entries: data.entries.length, novos: Object.keys(state.entries).length - before };
}

// ---------- IMDb: CSV oficial (Avaliações / Lista para assistir / listas) ----------
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]])));
}

export function importImdbCsv(text, fileName = '') {
  const rows = parseCSV(text.replace(/^﻿/, ''));
  const isRatings = rows.length && 'Your Rating' in rows[0];
  const listKind = /watchlist/i.test(fileName) ? 'watchlist' : isRatings ? 'watched' : /favorit/i.test(fileName) ? 'favorites' : /watched|assistid/i.test(fileName) ? 'watched' : 'watchlist';
  const data = { titles: {}, entries: [], exportedAt: now() };
  for (const r of rows) {
    const id = r.Const;
    if (!/^tt\d+$/.test(id)) continue;
    const type = (r['Title Type'] || '').replace(/\s/g, '').toLowerCase();
    data.titles[id] = {
      imdbId: id, title: r.Title, originalTitle: r['Original Title'] || r.Title, year: +r.Year || null,
      imdbType: type.includes('miniseries') ? 'tvMiniSeries' : type.includes('series') ? 'tvSeries' : 'movie',
      genres: (r.Genres || '').split(',').map((s) => s.trim()).filter(Boolean), imdbRating: +r['IMDb Rating'] || null,
      runtime: +r['Runtime (mins)'] || null, releaseDate: r['Release Date'] || null, votes: +r['Num Votes'] || null,
      credits: { Director: (r.Directors || '').split(',').map((s) => s.trim()).filter(Boolean) },
    };
    const date = r['Date Rated'] || r.Created || r['Date Added'];
    const iso = date ? new Date(date + 'T12:00:00').toISOString() : null;
    data.entries.push(isRatings
      ? { id, list: 'watched', addedAt: iso, rating: +r['Your Rating'], ratedAt: iso }
      : { id, list: listKind, addedAt: iso });
  }
  return importImdb(data);
}

// ---------- Filmow (arquivo gerado pelo botão "Exportar do Filmow") ----------
// O Filmow não mostra a data em que você marcou cada título, só a ordem (mais recente primeiro).
// Por isso, títulos que só existem no Filmow ganham datas aproximadas que respeitam essa ordem.
export async function importFilmow(data, onProgress = () => {}) {
  const firstSync = !state.sync.filmowAt;
  const anchor = firstSync ? earliestKnownDate() : now();
  const groups = {};
  for (const x of data.entries) (groups[x.list] = groups[x.list] || []).push(x);
  let done = 0, matched = 0;
  const total = Object.keys(data.titles).length;
  const keyOf = {};
  // Temporadas do Filmow viram uma série só
  for (const t of Object.values(data.titles)) if (t.seriesTitle) { t.title = t.seriesTitle; if (t.originalTitle) t.originalTitle = t.originalTitle.replace(/\s*\(?(Season|Temporada)\s*\d+\)?$/i, '').replace(/\s*\(\d+ª Temporada\)$/, ''); }
  // Procura online (4 de cada vez) quem ainda não está na estante
  const online = {};
  const pending = Object.entries(data.titles).filter(([fid, t]) => !findTitle({ filmowId: fid, title: t.title, originalTitle: t.originalTitle, year: t.season > 1 ? null : t.year }));
  const seen = {};
  await Promise.all([0, 1, 2, 3].map(async () => {
    while (pending.length) {
      const [fid, t] = pending.shift();
      const sk = t.seriesTitle ? 'S:' + norm(t.title) : null;
      online[fid] = sk && seen[sk] ? await seen[sk] : await (sk ? (seen[sk] = matchOnline(t)) : matchOnline(t));
      onProgress(++done, total);
    }
  }));
  done = 0;
  for (const [fid, t] of Object.entries(data.titles)) {
    let found = findTitle({ filmowId: fid, title: t.title, originalTitle: t.originalTitle, year: t.season > 1 ? null : t.year }) || online[fid] || null;
    if (found && !state.titles[found.key]) found = findTitle({ imdbId: found.imdbId, tmdbId: found.tmdbId, tmdbType: found.tmdbType }) || found;
    if (found) matched++;
    const key = found ? found.key : 'filmow-' + fid;
    const filmowData = { title: t.title, originalTitle: t.originalTitle, year: t.year, poster: t.poster, plot: t.plot, plotLang: 'pt', genres: t.genres, runtime: t.runtime, releaseDate: t.releaseDate, credits: { directors: t.directors || [], cast: [] } };
    if (state.titles[key]) {
      // Já existe (veio do IMDb): só completa o que falta, mantendo o português
      const cur = state.titles[key];
      if (!cur.filmowId) cur.filmowId = fid;
      if (!cur.filmowUrl) cur.filmowUrl = t.url;
      if (!cur.plot || cur.plotLang === 'en') { cur.plot = t.plot || cur.plot; cur.plotLang = t.plot ? 'pt' : cur.plotLang; }
      if (cur.source !== 'imdb' && t.title) cur.title = t.title;
      if (t.filmowRating) cur.ratings = Object.assign({}, cur.ratings, { filmow: t.filmowRating });
    } else {
      // Novo: dados do Filmow em português + ids encontrados online
      upsertTitle(Object.assign({}, found || {}, filmowData, {
        key, filmowId: fid, filmowUrl: t.url, source: 'filmow',
        kind: found && found.kind === 'anime' ? 'anime' : found && found.kind ? found.kind : t.kind,
        poster: (found && found.poster) || t.poster,
        ratings: Object.assign({}, found && found.ratings, t.filmowRating ? { filmow: t.filmowRating } : {}),
        metaUpdatedAt: null,
      }));
    }
    keyOf[fid] = key;
  }
  for (const [list, xs] of Object.entries(groups)) {
    // xs vem do mais recente para o mais antigo
    xs.forEach((x, i) => {
      const key = keyOf[x.id];
      if (!key) return;
      const known = state.entries[key];
      const fresh = !known || !known.sources.includes('filmow');
      const approxDate = new Date(new Date(anchor).getTime() - (firstSync ? (i + 1) * 60000 : 0)).toISOString();
      // Num sync posterior, títulos novos no Filmow ganham a data de hoje (foram marcados desde o último sync)
      applyEntry(key, Object.assign({}, x, { addedAt: x.addedAt || (fresh ? approxDate : null), approx: !x.addedAt && firstSync, ratedAt: x.addedAt || (fresh ? approxDate : null) }), 'filmow');
    });
  }
  state.sync.filmowAt = data.exportedAt || now();
  commit('import');
  await rematchUnlinked();
  await detectAnime(Object.values(keyOf).map((k) => state.titles[k] || null));
  commit('import');
  return { titles: total, matched, entries: data.entries.length };
}

// Segunda tentativa para títulos do Filmow que ficaram sem par no IMDb/TMDB
export async function rematchUnlinked(onProgress = () => {}) {
  const month = new Date(Date.now() - 30 * 864e5).toISOString();
  const list = Object.values(state.titles).filter((t) => t.key.startsWith('filmow-') && (!t.matchTriedAt || t.matchTriedAt < month));
  let fixed = 0, i = 0;
  const queue = [...list];
  await Promise.all([0, 1, 2].map(async () => {
    while (queue.length) {
      const t = queue.shift();
      const hit = await matchOnline(t);
      t.matchTriedAt = now();
      if (hit && hit.key && !hit.key.startsWith('filmow-')) { rekey(t.key, hit); fixed++; }
      onProgress(++i, list.length);
    }
  }));
  if (fixed) commit('import');
  return { tried: list.length, fixed };
}

// Move um título (e o que você fez com ele) para a chave certa, juntando com o que já existir
function rekey(oldKey, found) {
  const old = state.titles[oldKey];
  const newKey = found.key;
  if (state.titles[newKey]) {
    const cur = state.titles[newKey];
    for (const k of ['filmowId', 'filmowUrl']) if (!cur[k]) cur[k] = old[k];
    if (!cur.plot || cur.plotLang === 'en') { cur.plot = old.plot; cur.plotLang = 'pt'; }
  } else {
    state.titles[newKey] = Object.assign({}, found, {
      key: newKey, title: old.title, originalTitle: old.originalTitle || found.originalTitle, plot: old.plot || found.plot, plotLang: old.plot ? 'pt' : found.plotLang,
      genres: old.genres && old.genres.length ? old.genres : found.genres, filmowId: old.filmowId, filmowUrl: old.filmowUrl, source: 'filmow',
      poster: found.poster || old.poster, year: found.year || old.year, kind: found.kind === 'anime' || old.kind === 'anime' ? 'anime' : old.kind === 'series' ? 'series' : found.kind,
      ratings: Object.assign({}, old.ratings, found.ratings), metaUpdatedAt: null,
    });
  }
  const a = state.entries[oldKey];
  if (a) {
    const b = state.entries[newKey];
    if (!b) state.entries[newKey] = a;
    else {
      // junta: vale o "sim" de qualquer lado e a data real mais antiga
      for (const [flag, date, ap] of [['watched', 'watchedAt', 'approx'], ['watchlist', 'watchlistAt', 'approxWl'], ['favorite', 'favoriteAt', 'approxFav']]) {
        if (a[flag] && (!b[flag] || (b[ap] && !a[ap]) || (!!b[ap] === !!a[ap] && a[date] && a[date] < b[date]))) { b[flag] = true; b[date] = a[date]; b[ap] = a[ap]; }
      }
      if (b.watched) { b.watchlist = false; b.watchlistAt = null; }
      if (b.rating == null && a.rating != null) { b.rating = a.rating; b.ratedAt = a.ratedAt; b.approxRated = a.approxRated; }
      if (!b.comment && a.comment) { b.comment = a.comment; b.commentAt = a.commentAt; }
      b.sources = [...new Set([...(b.sources || []), ...(a.sources || [])])];
      b.updatedAt = now();
    }
    delete state.entries[oldKey];
  }
  for (const l of Object.values(state.lists)) {
    if (!l.items.some((x) => x.key === oldKey)) continue;
    l.items = l.items.filter((x) => x.key !== oldKey || !l.items.some((y) => y.key === newKey)).map((x) => (x.key === oldKey ? Object.assign({}, x, { key: newKey }) : x));
    l.updatedAt = now();
  }
  delete state.titles[oldKey];
}

// O Filmow não separa animes: animações são conferidas no AniList (nome + ano)
export async function detectAnime(list) {
  const cands = [...new Set(list)].filter((t) => t && t.kind !== 'anime' && !t.animeChecked && (t.genres || []).some((g) => /anima/i.test(g)));
  for (const t of cands) {
    for (const q of [...new Set([t.originalTitle, t.title].filter(Boolean))]) {
      const res = await searchAnime(q).catch(() => []);
      await sleep(700);
      const names = [t.title, t.originalTitle].filter(Boolean).map(norm);
      const hit = res.find((r) => r.year && t.year && t.year - r.year >= -1 && t.year - r.year <= 10 && [r.title, r.originalTitle, r.nativeTitle].filter(Boolean).map(norm).some((n) => names.includes(n) || names.some((m) => m.length > 4 && (n.startsWith(m) || m.startsWith(n)))));
      if (hit) { t.kind = 'anime'; t.anilistId = hit.anilistId; t.malId = t.malId || hit.malId; break; }
    }
    t.animeChecked = true;
  }
}

function earliestKnownDate() {
  let min = null;
  for (const e of Object.values(state.entries)) for (const k of ['watchedAt', 'watchlistAt', 'favoriteAt', 'ratedAt']) if (e[k] && !e.approx && (!min || e[k] < min)) min = e[k];
  return min || now();
}

// Descobre o título no TMDB (se tiver chave) ou no catálogo do IMDb (Cinemeta), pelo nome original + ano
// O "ano" do Filmow é a estreia no Brasil, que pode vir anos depois da original
async function matchOnline(t) {
  const names = [t.title, t.originalTitle].filter(Boolean).map(norm);
  const pick = (res) => {
    const close = (r) => r.year && t.year && t.year - r.year >= -1 && t.year - r.year <= (t.season > 1 ? 30 : 10);
    return res.find((r) => close(r) && [r.title, r.originalTitle].filter(Boolean).map(norm).some((n) => names.includes(n)))
      || (t.year && !t.season ? res.slice(0, 3).find((r) => r.year === t.year) : null)
      || (t.season ? res.find((r) => [r.title, r.originalTitle].filter(Boolean).map(norm).some((n) => names.includes(n))) : null);
  };
  try {
    for (const q of [...new Set([t.originalTitle, t.title].filter(Boolean))]) {
      const res = hasTmdb() ? await search(q) : await searchCatalog(q, t.kind === 'series' ? 'series' : 'movie');
      const hit = pick(res.filter((r) => t.kind !== 'series' || r.kind !== 'movie'));
      if (hit) return state.titles[hit.key] || findTitle({ imdbId: hit.imdbId, tmdbId: hit.tmdbId, tmdbType: hit.tmdbType }) || hit;
    }
  } catch {}
  return null;
}

// ---------- Backup completo da Estante ----------
export function importBackup(data) {
  const merged = mergeStates(state, data);
  replaceState(merged);
  return { titles: Object.keys(merged.titles).length };
}

export async function importFile(file, onProgress) {
  const text = await file.text();
  if (/\.csv$/i.test(file.name)) return { kind: 'IMDb (CSV)', ...importImdbCsv(text, file.name) };
  const data = JSON.parse(text);
  if (data.format === 'estante-import' && data.source === 'imdb') return { kind: 'IMDb', ...importImdb(data) };
  if (data.format === 'estante-import' && data.source === 'filmow') return { kind: 'Filmow', ...(await importFilmow(data, onProgress)) };
  if (data.schema && data.titles) return { kind: 'Backup', ...importBackup(data) };
  throw new Error('Arquivo não reconhecido');
}
