// Estado da Estante: títulos, o que você fez com cada um (entries) e suas listas.
// Fica no IndexedDB do navegador (funciona offline) e é sincronizado com o GitHub.
import { now, norm } from './util.js';

const DB_NAME = 'estante';
const KEY = 'state';

export const emptyState = () => ({
  schema: 1,
  profile: { name: 'Lara', bio: '', avatar: '', imdb: 'p.hccoueu5wqm2e4nk2id7zarygq', filmow: 'larabaldini' },
  titles: {},
  entries: {},
  lists: {},
  deleted: { lists: {} },
  sync: { filmowAt: null, imdbAt: null },
  updatedAt: null,
});

export let state = emptyState();
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);

// ---------- IndexedDB ----------
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv').objectStore('kv').get(k);
    t.onsuccess = () => res(t.result);
    t.onerror = () => rej(t.error);
  });
}
async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// Usados pelos backups diários
export const __idbGet = idbGet;
export const __idbSet = idbSet;
export async function __idbDel(k) {
  const db = await idb();
  return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = () => res(); });
}
export async function __idbKeys() {
  const db = await idb();
  return new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export async function loadLocal() {
  try {
    const s = await idbGet(KEY);
    if (s && s.schema) { state = Object.assign(emptyState(), s); return true; }
  } catch (e) { console.warn('IndexedDB indisponível', e); }
  try {
    const s = JSON.parse(localStorage.getItem('estante-state') || 'null');
    if (s && s.schema) { state = Object.assign(emptyState(), s); return true; }
  } catch {}
  return false;
}

let saveTimer;
export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await idbSet(KEY, state); } catch { try { localStorage.setItem('estante-state', JSON.stringify(state)); } catch {} }
  }, 150);
}

// Toda alteração feita pelo usuário passa por aqui
export function commit(reason = 'edit') {
  state.updatedAt = now();
  persist();
  for (const fn of listeners) fn(reason);
}
export function replaceState(s) {
  state = Object.assign(emptyState(), s);
  persist();
  for (const fn of listeners) fn('replace');
}

// ---------- Configurações (só neste aparelho) ----------
const SETTINGS_KEY = 'estante-settings';
export function settings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
}
export function saveSettings(patch) {
  const s = Object.assign(settings(), patch);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
  return s;
}

// ---------- Títulos ----------
export function upsertTitle(t) {
  const prev = state.titles[t.key];
  if (!prev) { state.titles[t.key] = t; return t; }
  // Mantém dados antigos que a fonte nova não traz
  for (const [k, v] of Object.entries(t)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (k === 'ratings' || k === 'credits' || k === 'ids') prev[k] = Object.assign({}, prev[k], v);
    else prev[k] = v;
  }
  return prev;
}

// Procura um título já existente por id ou por nome+ano
export function findTitle({ imdbId, tmdbId, tmdbType, malId, filmowId, title, originalTitle, year }) {
  const all = Object.values(state.titles);
  if (imdbId && state.titles[imdbId]) return state.titles[imdbId];
  for (const t of all) {
    if (imdbId && t.imdbId === imdbId) return t;
    if (tmdbId && t.tmdbId === tmdbId && (!tmdbType || t.tmdbType === tmdbType)) return t;
    if (malId && t.malId === malId) return t;
    if (filmowId && t.filmowId === filmowId) return t;
  }
  const names = [title, originalTitle].filter(Boolean).map(norm);
  if (!names.length || !year) return null;
  return all.find((t) => Math.abs((t.year || 0) - year) <= 1 &&
    [t.title, t.originalTitle].filter(Boolean).map(norm).some((n) => names.includes(n))) || null;
}

// ---------- Entradas (já vi / quero ver / favorito / nota / comentário) ----------
export const entry = (key) => state.entries[key];
function ensureEntry(key) {
  return state.entries[key] || (state.entries[key] = { sources: [], updatedAt: now() });
}

export function setWatched(key, on, date) {
  const e = ensureEntry(key);
  e.watched = on;
  e.watchedAt = on ? (date || e.watchedAt || now()) : null;
  if (on) { e.watchlist = false; e.watchlistAt = null; e.approx = false; }
  e.updatedAt = now();
  commit();
}
export function setWatchlist(key, on) {
  const e = ensureEntry(key);
  e.watchlist = on;
  e.watchlistAt = on ? now() : null;
  e.approxWl = false;
  if (on) { e.watched = false; e.watchedAt = null; }
  e.updatedAt = now();
  commit();
}
export function setFavorite(key, on) {
  const e = ensureEntry(key);
  e.favorite = on;
  e.favoriteAt = on ? now() : null;
  e.approxFav = false;
  if (on && !e.watched) { e.watched = true; e.watchedAt = now(); e.watchlist = false; }
  e.updatedAt = now();
  commit();
}
export function setRating(key, rating) {
  const e = ensureEntry(key);
  e.rating = rating;
  e.ratedAt = rating == null ? null : now();
  e.approxRated = false;
  if (rating != null && !e.watched) { e.watched = true; e.watchedAt = now(); e.watchlist = false; }
  e.updatedAt = now();
  commit();
}
export function setComment(key, text) {
  const e = ensureEntry(key);
  e.comment = text || '';
  e.commentAt = text ? now() : null;
  e.updatedAt = now();
  commit();
}
export function setWatchedDate(key, iso) {
  const e = ensureEntry(key);
  if (!iso) return;
  e.watchedAt = iso; e.approx = false; e.updatedAt = now();
  commit();
}
export function setProgress(key, season, count) {
  const e = ensureEntry(key);
  e.progress = Object.assign({}, e.progress, { [season]: count });
  e.progressAt = now();
  e.updatedAt = now();
  commit();
}

// ---------- Listas personalizadas ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export function createList(name, description = '') {
  const id = uid();
  state.lists[id] = { id, name, description, createdAt: now(), updatedAt: now(), items: [] };
  commit();
  return id;
}
export function updateList(id, patch) {
  Object.assign(state.lists[id], patch, { updatedAt: now() });
  commit();
}
export function deleteList(id) {
  delete state.lists[id];
  state.deleted.lists[id] = now();
  commit();
}
export function toggleInList(id, key, on) {
  const l = state.lists[id];
  const has = l.items.some((i) => i.key === key);
  if (on && !has) l.items.push({ key, addedAt: now() });
  if (!on && has) l.items = l.items.filter((i) => i.key !== key);
  l.updatedAt = now();
  commit();
}
export const listsWith = (key) => Object.values(state.lists).filter((l) => l.items.some((i) => i.key === key));

// ---------- Mesclagem (outro aparelho / GitHub / backup) ----------
// Regra: em cada item vence quem foi alterado por último. Nada é apagado sem registro.
const later = (a, b) => ((a || '') >= (b || '') ? 'a' : 'b');

export function mergeStates(a, b) {
  if (!b) return a;
  if (!a) return b;
  const out = emptyState();
  out.profile = later(a.profileAt, b.profileAt) === 'a' ? (a.profile || b.profile) : (b.profile || a.profile);
  out.profileAt = [a.profileAt, b.profileAt].sort().pop() || null;
  out.titles = Object.assign({}, b.titles);
  for (const [k, t] of Object.entries(a.titles || {})) {
    const o = out.titles[k];
    out.titles[k] = !o ? t : later(t.metaUpdatedAt, o.metaUpdatedAt) === 'a' ? Object.assign({}, o, t) : Object.assign({}, t, o);
  }
  out.entries = Object.assign({}, b.entries);
  for (const [k, e] of Object.entries(a.entries || {})) {
    const o = out.entries[k];
    out.entries[k] = !o || later(e.updatedAt, o.updatedAt) === 'a' ? e : o;
  }
  out.deleted.lists = Object.assign({}, b.deleted && b.deleted.lists, a.deleted && a.deleted.lists);
  const lists = Object.assign({}, b.lists);
  for (const [k, l] of Object.entries(a.lists || {})) {
    const o = lists[k];
    lists[k] = !o || later(l.updatedAt, o.updatedAt) === 'a' ? l : o;
  }
  for (const [k, l] of Object.entries(lists)) {
    const del = out.deleted.lists[k];
    if (!del || del < l.updatedAt) out.lists[k] = l;
  }
  out.sync = {
    filmowAt: [a.sync && a.sync.filmowAt, b.sync && b.sync.filmowAt].sort().pop() || null,
    imdbAt: [a.sync && a.sync.imdbAt, b.sync && b.sync.imdbAt].sort().pop() || null,
  };
  out.updatedAt = [a.updatedAt, b.updatedAt].sort().pop() || null;
  return out;
}

// ---------- Consultas ----------
export const TABS = {
  'ja-vi': { label: 'Já vi', field: 'watched', date: 'watchedAt' },
  'quero-ver': { label: 'Quero ver', field: 'watchlist', date: 'watchlistAt' },
  favoritos: { label: 'Favoritos', field: 'favorite', date: 'favoriteAt' },
  avaliacoes: { label: 'Avaliações', field: 'rating', date: 'ratedAt' },
  comentarios: { label: 'Comentários', field: 'comment', date: 'commentAt' },
};

export function itemsFor(tab, kind) {
  const def = TABS[tab];
  const out = [];
  for (const [key, e] of Object.entries(state.entries)) {
    const v = e[def.field];
    if (v == null || v === false || v === '') continue;
    const t = state.titles[key];
    if (!t || (kind && kind !== 'all' && t.kind !== kind)) continue;
    out.push({ key, t, e, date: e[def.date] || e.watchedAt || e.updatedAt });
  }
  return out.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
}

export function stats() {
  const s = { watched: 0, watchlist: 0, favorite: 0, rated: 0, sum: 0, minutes: 0, byKind: { movie: 0, series: 0, anime: 0 } };
  for (const [key, e] of Object.entries(state.entries)) {
    const t = state.titles[key];
    if (!t) continue;
    if (e.watched) { s.watched++; s.byKind[t.kind] = (s.byKind[t.kind] || 0) + 1; if (t.kind === 'movie' && t.runtime) s.minutes += t.runtime; }
    if (e.watchlist) s.watchlist++;
    if (e.favorite) s.favorite++;
    if (e.rating != null) { s.rated++; s.sum += e.rating; }
  }
  s.avg = s.rated ? s.sum / s.rated / 2 : 0;
  return s;
}
