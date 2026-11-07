// Sincronização com o GitHub: o arquivo data/library.json do repositório é a cópia oficial.
// Cada aparelho guarda tudo offline e, quando tem internet, mescla com o GitHub.
import { state, settings, saveSettings, mergeStates, replaceState, canon } from './store.js';
import { now, sleep } from './util.js';
import { initCloud, cloudUser, getMeta, pullBlob, pushCloud, watchCloud, checkIn } from './cloud.js';

const PATH = 'data/library.json';
let status = { state: 'idle', at: null, error: null };
const listeners = new Set();
export const onSyncStatus = (fn) => listeners.add(fn);
export const syncStatus = () => status;
function setStatus(s) { status = Object.assign({}, status, s); for (const fn of listeners) fn(status); }

// Aparece no histórico do GitHub, para saber de onde veio cada alteração
export function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'PC';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'outro aparelho';
}

export function ghConfig() {
  const s = settings();
  let repo = s.ghRepo;
  if (!repo && /\.github\.io$/.test(location.hostname)) {
    const owner = location.hostname.split('.')[0];
    const name = location.pathname.split('/')[1];
    repo = owner + '/' + (name || owner + '.github.io');
  }
  return { token: s.ghToken, repo, branch: s.ghBranch || 'main' };
}
export const canPush = () => { const c = ghConfig(); return !!(c.token && c.repo); };

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function gh(path, opts = {}) {
  const { token, repo } = ghConfig();
  const r = await fetch('https://api.github.com/repos/' + repo + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, Accept: opts.accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
    cache: 'no-store',
  });
  return r;
}

async function ghJSON(path, opts = {}) {
  const r = await gh(path, opts.body ? { ...opts, body: JSON.stringify(opts.body), headers: { 'Content-Type': 'application/json' } } : opts);
  if (!r.ok) {
    const err = new Error('GitHub respondeu ' + r.status + (r.status === 401 ? ' (token inválido ou expirado)' : r.status === 403 || r.status === 404 ? ' (o token precisa de permissão "Contents: Read and write" neste repositório)' : ''));
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// Lê o arquivo na ponta do branch (a API "raw" aceita arquivos de até 100 MB)
async function pullRemote() {
  const { branch } = ghConfig();
  const ref = await ghJSON('/git/ref/heads/' + branch);
  const head = ref.object.sha;
  const raw = await gh('/contents/' + PATH + '?ref=' + head, { accept: 'application/vnd.github.raw+json' });
  if (raw.status === 404) return { data: null, head };
  if (!raw.ok) throw new Error('Não consegui ler ' + PATH + ' (' + raw.status + ')');
  return { data: await raw.json(), head };
}

// Grava via Git Data API: blob -> tree -> commit -> avança o branch (falha se alguém gravou antes)
async function pushRemote(text, head) {
  const { branch } = ghConfig();
  const commit = await ghJSON('/git/commits/' + head);
  const blob = await ghJSON('/git/blobs', { method: 'POST', body: { content: b64encode(text), encoding: 'base64' } });
  const tree = await ghJSON('/git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree: [{ path: PATH, mode: '100644', type: 'blob', sha: blob.sha }] } });
  const next = await ghJSON('/git/commits', { method: 'POST', body: { message: 'Estante (' + deviceName() + '): atualização ' + new Date().toLocaleString('pt-BR'), tree: tree.sha, parents: [head] } });
  await ghJSON('/git/refs/heads/' + branch, { method: 'PATCH', body: { sha: next.sha, force: false } });
}

// Para quem abre o site sem token (ex.: celular): lê a versão publicada
export async function pullPublic() {
  try {
    const r = await fetch('data/library.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

let running = null;
let again = false;
export function syncNow(force) {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do { again = false; await doSync(force); } while (again);
    } finally { running = null; }
  })();
  return running;
}

// Sincronização principal: a conta (Firebase). O GitHub vira só backup extra no aparelho que tiver token.
let lastGithub = 0;
async function doSync(force) {
  if (!navigator.onLine) { setStatus({ state: 'offline' }); return; }
  await initCloud().catch(() => null);
  const user = cloudUser();
  if (!user && !canPush()) {
    const pub = await pullPublic();
    if (pub && pub.updatedAt !== state.updatedAt) replaceState(mergeStates(state, pub));
    setStatus({ state: 'readonly', at: now(), error: null });
    return;
  }
  setStatus({ state: 'syncing', error: null });
  if (user) {
    try { await cloudSync(user); }
    catch (e) { setStatus({ state: 'error', error: e.message }); return; }
    checkIn(deviceName(), settings().cloudRev).catch(() => {});
  }
  // Backup no GitHub: no máximo a cada 10 minutos quando a conta já está sincronizando
  if (canPush() && (!user || force || Date.now() - lastGithub > 10 * 60e3)) {
    lastGithub = Date.now();
    await githubSync(!!user);
  } else setStatus({ state: 'ok', at: now(), error: null });
}

// Assinatura curta do conteúdo, para saber se algo mudou desde a última sincronização
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
}

// Trava de segurança: se por algum motivo um aparelho começar a regravar sem parar, ele pausa
const pushTimes = [];
async function cloudSync(user) {
  let s = settings();
  let knownRev = s.cloudUid === user.uid ? s.cloudRev || 0 : -1;
  for (let attempt = 0; attempt < 5; attempt++) {
    const meta = await getMeta();
    // Compara pelo conteúdo (chaves em ordem), não pela ordem em que os dados foram montados
    const localCanon = canon(state);
    // Nada mudou nem aqui nem na nuvem: não baixa nada (economiza internet e o limite gratuito)
    if (meta.rev === knownRev && hash(localCanon) === s.cloudHash) { saveSettings({ lastSync: now() }); return; }
    if (meta.rev !== knownRev && meta.rev > 0) {
      const data = await pullBlob(meta);
      if (data) {
        const merged = mergeStates(state, data);
        const mergedCanon = canon(merged);
        if (mergedCanon !== localCanon) replaceState(merged);
        if (canon(data) === mergedCanon) { s = saveSettings({ cloudUid: user.uid, cloudRev: meta.rev, cloudHash: hash(mergedCanon), lastSync: now() }); return; }
      }
    }
    const t = Date.now();
    while (pushTimes.length && t - pushTimes[0] > 120e3) pushTimes.shift();
    if (pushTimes.length >= 8) throw new Error('Muitas gravações seguidas — pausando 2 minutos por segurança.');
    pushTimes.push(t);
    try {
      const rev = await pushCloud(state, meta.rev, deviceName());
      s = saveSettings({ cloudUid: user.uid, cloudRev: rev, cloudHash: hash(canon(state)), lastSync: now() });
      return;
    } catch (e) {
      if (!e.conflict) throw e;
      knownRev = -1; // outro aparelho gravou no meio: baixa de novo e mescla
      await sleep(400 * (attempt + 1));
    }
  }
  throw new Error('Não consegui salvar na conta (muitas alterações ao mesmo tempo). Tente de novo.');
}

// Avisa este aparelho na hora em que outro gravar na conta
export function startCloudWatch() {
  if (!cloudUser()) return;
  watchCloud((meta) => { if (meta.rev !== settings().cloudRev) syncNow(); });
}

async function githubSync(isBackup) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { data, head } = await pullRemote();
      const merged = data ? mergeStates(state, data) : state;
      if (data && canon(merged) !== canon(state)) replaceState(merged);
      if (!data || canon(data) !== canon(state)) await pushRemote(JSON.stringify(state), head);
      saveSettings({ lastSync: now() });
      setStatus({ state: 'ok', at: now(), error: null });
      return;
    } catch (e) {
      // 422 = o branch andou (outro aparelho gravou): busca de novo, mescla e tenta outra vez
      const retry = e.status === 422 || e.status === 409 || /fetch|network/i.test(e.message);
      if (attempt === 3 || !retry) {
        // Com a conta funcionando, falha no backup do GitHub não é erro para você
        if (isBackup) { console.warn('backup GitHub', e); setStatus({ state: 'ok', at: now(), error: null }); }
        else setStatus({ state: 'error', error: e.message });
        return;
      }
      await sleep(1000 * (attempt + 1));
    }
  }
  setStatus({ state: isBackup ? 'ok' : 'error', error: isBackup ? null : 'Conflito persistente ao salvar. Tente de novo.' });
}

export async function testToken() {
  const { repo } = ghConfig();
  const r = await gh('');
  if (!r.ok) throw new Error(r.status === 404 ? 'Repositório ' + repo + ' não encontrado para este token' : 'Token recusado (' + r.status + ')');
  const j = await r.json();
  if (!j.permissions || !j.permissions.push) throw new Error('O token não tem permissão de escrita');
  return j.full_name;
}
