// Faz a Estante abrir e funcionar sem internet.
const VERSION = 'estante-v5';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/util.js', 'js/store.js', 'js/meta.js', 'js/sync.js', 'js/importers.js', 'icon.svg', 'icon-180.png', 'manifest.webmanifest', 'tools/filmow-export.js', 'tools/imdb-export.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('estante-') && k !== VERSION && k !== 'estante-img' && k !== 'estante-api').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await c.delete(k);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // GitHub API: nunca do cache
  if (url.hostname === 'api.github.com') return;

  // Pôsteres e fotos: guarda para ver offline
  if (/image\.tmdb\.org|media-amazon\.com|fstatic\.com|metahub\.space|anilist\.co/.test(url.hostname) || req.destination === 'image') {
    e.respondWith(caches.open('estante-img').then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trim('estante-img', 3000); }
        return res;
      } catch { return hit || Response.error(); }
    }));
    return;
  }

  // APIs de filmes: rede primeiro, cache se estiver offline
  if (/themoviedb\.org|strem\.io|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) caches.open('estante-api').then((c) => { c.put(req, res.clone()); trim('estante-api', 800); });
      return res;
    }).catch(() => caches.match(req).then((r) => r || Response.error())));
    return;
  }

  // Arquivos da própria Estante: rede primeiro (sempre a versão nova), cache offline
  if (url.origin === location.origin) {
    // no-cache: sempre confere com o servidor, então atualizações do site aparecem na hora
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok && !url.search) caches.open(VERSION).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: url.pathname.endsWith('library.json') }).then((r) => r || caches.match('index.html'))));
  }
});
