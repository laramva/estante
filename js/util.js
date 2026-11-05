export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"']/g, (c) => ESC[c]));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => new Date().toISOString();

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Normaliza títulos para comparar ("O Ódio" == "o odio")
export function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'e').replace(/[^a-z0-9]+/g, ' ').trim();
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function fmtDate(iso, opts = {}) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  if (isNaN(d)) return '';
  if (opts.month) return MONTHS[d.getMonth()] + ' de ' + d.getFullYear();
  return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
}
export const monthKey = (iso) => (iso ? iso.slice(0, 7) : '0000-00');

export function relDays(iso) {
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  const diff = Math.round((d - new Date()) / 86400000);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff > 1 && diff < 31) return 'em ' + diff + ' dias';
  return fmtDate(iso);
}

export const toDateInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
export const fromDateInput = (v) => (v ? new Date(v + 'T12:00:00').toISOString() : null);

export function fmtRuntime(min) {
  if (!min) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? h + 'h' + (m ? ' ' + m + 'min' : '') : m + 'min';
}

// Estrelas estilo Filmow: nota 0–10 -> 0–5 estrelas com meia estrela
export function starsHTML(rating, cls = '') {
  if (rating == null) return '';
  const v = rating / 2;
  let h = '<span class="stars ' + cls + '" aria-label="' + v.toLocaleString('pt-BR') + ' de 5 estrelas">';
  for (let i = 1; i <= 5; i++) h += '<i class="' + (v >= i ? 'on' : v >= i - 0.5 ? 'half' : '') + '"></i>';
  return h + '</span>';
}

export const KIND_LABEL = { movie: 'Filme', series: 'Série', anime: 'Anime' };
export const KIND_PLURAL = { movie: 'Filmes', series: 'Séries', anime: 'Animes' };

export function toast(msg, type = '') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3700);
}

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const sparkle = (cls = '') => '<svg class="sparkle ' + cls + '" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0c.6 6.4 5.6 11.4 12 12-6.4.6-11.4 5.6-12 12-.6-6.4-5.6-11.4-12-12C6.4 11.4 11.4 6.4 12 0z"/></svg>';
export const heart = (cls = '') => '<svg class="heart ' + cls + '" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
