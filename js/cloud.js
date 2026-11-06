// Conta da Estante (Firebase, gratuito): entre com email e senha em qualquer aparelho e tudo sincroniza.
// Os dados ficam em users/{uid} no Realtime Database, comprimidos (gzip). A regra do banco só deixa
// cada conta ler e gravar os próprios dados.
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
let fb = null; // { auth, db, a: módulo auth, d: módulo database }
let current = null;
let ready = null;
const userListeners = new Set();

export const cloudConfigured = () => !!(firebaseConfig && firebaseConfig.apiKey);
export const cloudUser = () => current;
export const onUser = (fn) => { userListeners.add(fn); };

export function initCloud() {
  if (!cloudConfigured()) return Promise.resolve(null);
  if (ready) return ready;
  ready = (async () => {
    const [{ initializeApp }, a, d] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-database.js'),
    ]);
    const app = initializeApp(firebaseConfig);
    const auth = a.getAuth(app);
    await a.setPersistence(auth, a.browserLocalPersistence);
    fb = { auth, db: d.getDatabase(app), a, d };
    await new Promise((res) => {
      let first = true;
      a.onAuthStateChanged(auth, (u) => {
        current = u ? { uid: u.uid, email: u.email } : null;
        if (!current) stopWatching();
        for (const fn of userListeners) fn(current);
        if (first) { first = false; res(); }
      });
    });
    return fb;
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

// ---------- Conta ----------
const MSG = {
  'auth/email-already-in-use': 'Já existe uma conta com esse email. Use “Entrar”.',
  'auth/invalid-email': 'Email inválido.',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'auth/invalid-credential': 'Email ou senha incorretos.',
  'auth/invalid-login-credentials': 'Email ou senha incorretos.',
  'auth/wrong-password': 'Email ou senha incorretos.',
  'auth/user-not-found': 'Não existe conta com esse email. Use “Criar conta”.',
  'auth/missing-password': 'Digite a senha.',
  'auth/too-many-requests': 'Muitas tentativas. Espere alguns minutos e tente de novo.',
  'auth/network-request-failed': 'Sem internet no momento.',
};
const friendly = (e) => new Error(MSG[e.code] || e.message);

export async function signUp(email, password) {
  const { auth, a } = await initCloud();
  try { await a.createUserWithEmailAndPassword(auth, email.trim(), password); } catch (e) { throw friendly(e); }
}
export async function signIn(email, password) {
  const { auth, a } = await initCloud();
  try { await a.signInWithEmailAndPassword(auth, email.trim(), password); } catch (e) { throw friendly(e); }
}
export async function signOut() {
  const { auth, a } = await initCloud();
  stopWatching();
  await a.signOut(auth);
}
export async function resetPassword(email) {
  const { auth, a } = await initCloud();
  try { await a.sendPasswordResetEmail(auth, email.trim()); } catch (e) { throw friendly(e); }
}

// ---------- Dados ----------
async function gzipB64(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gunzipB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

const path = (p) => fb.d.ref(fb.db, 'users/' + current.uid + (p ? '/' + p : ''));

// Só o "cabeçalho" (poucos bytes): qual é a versão atual na nuvem
export async function getMeta() {
  const m = (await fb.d.get(path('meta'))).val();
  return m && m.rev ? m : { rev: 0 };
}
// Baixa a biblioteca daquela versão
export async function pullBlob(meta) {
  if (!meta || !meta.rev || !meta.blob) return null;
  const blob = (await fb.d.get(path('blobs/' + meta.blob))).val();
  return blob ? JSON.parse(await gunzipB64(blob)) : null;
}

// Grava uma nova versão só se ninguém gravou depois de `baseRev`; se gravou, lança erro de conflito
// (aí a sincronização baixa de novo, mescla e tenta outra vez)
export async function pushCloud(state, baseRev, device) {
  const { d } = fb;
  const blob = await gzipB64(JSON.stringify(state));
  const rev = baseRev + 1 + Math.floor(Math.random() * 1000) / 1000; // evita que dois aparelhos usem o mesmo nome de arquivo
  const key = String(rev).replace('.', '_');
  await d.set(path('blobs/' + key), blob);
  const res = await d.runTransaction(path('meta'), (meta) => {
    // O Firebase chama primeiro com o valor em cache (pode vir vazio); devolvendo algo, ele confere com o servidor e chama de novo
    if (meta === null && baseRev !== 0) return { rev: -1 };
    const cur = (meta && meta.rev) || 0;
    if (cur !== baseRev) return; // aborta: outro aparelho gravou antes
    return { rev: Math.floor(rev), blob: key, size: blob.length, updatedAt: new Date().toISOString(), device };
  });
  if (!res.committed) {
    await d.remove(path('blobs/' + key)).catch(() => {});
    throw Object.assign(new Error('conflito'), { conflict: true });
  }
  // Limpa versões antigas
  const all = (await d.get(path('blobs'))).val() || {};
  await Promise.all(Object.keys(all).filter((k) => k !== key).map((k) => d.remove(path('blobs/' + k)).catch(() => {})));
  return Math.floor(rev);
}

// Preferências da conta que valem em todo aparelho (ex.: chave do TMDB). Só a própria conta lê.
export async function getPrivate() {
  await initCloud();
  if (!current) return {};
  return (await fb.d.get(path('private'))).val() || {};
}
export async function setPrivate(patch) {
  await initCloud();
  if (!current) return;
  await fb.d.update(path('private'), patch);
}

// Avisa na hora quando outro aparelho grava
let unwatch = null;
export function watchCloud(onMeta) {
  stopWatching();
  if (!current) return;
  unwatch = fb.d.onValue(path('meta'), (snap) => { const m = snap.val(); if (m) onMeta(m); }, () => {});
}
function stopWatching() { if (unwatch) { unwatch(); unwatch = null; } }
