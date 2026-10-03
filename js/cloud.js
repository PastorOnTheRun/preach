// Supabase integration: client, auth (magic link / 6-digit code / password), profile,
// the sermon "remote" used by sync.js, recording uploads, and admin queries.
// Everything is optional: with no supabaseUrl/supabaseAnonKey in config.js the app is local-only.
import { readAuthCache, writeAuthCache, setOwner } from './storage.js';

const cfg = () => window.PREACH_CONFIG || {};
export const isConfigured = () => !!(cfg().supabaseUrl && cfg().supabaseAnonKey);
export const BUCKET = 'recordings';

function loadScript(src) {
  if (window.supabase && window.supabase.createClient) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the sign-in library.'));
    document.head.appendChild(s);
  });
}

let clientP = null;
export function getClient() {
  if (!isConfigured()) return Promise.resolve(null);
  clientP = clientP || loadScript('vendor/supabase.js').then(() => window.supabase.createClient(cfg().supabaseUrl, cfg().supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'preach-auth' }
  })).catch(e => { clientP = null; throw e; });
  return clientP;
}

// ------------------------------------------------------------------ auth state
// `auth.user` is the signed-in user ({ id, email }) or null. `auth.profile` has role/display_name.
// We cache the last user locally so the app keeps showing that preacher's sermons offline.
export const auth = { user: null, profile: null, ready: false, offlineCached: false };
const listeners = new Set();
export function onAuth(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(event) { listeners.forEach(fn => { try { fn(event, auth); } catch (e) { console.error(e); } }); }
export const isAdmin = () => !!(auth.profile && auth.profile.role === 'admin');

function setUser(user, profile) {
  auth.user = user ? { id: user.id, email: user.email } : null;
  auth.profile = profile || (user ? auth.profile : null);
  setOwner(auth.user && auth.user.id);
  writeAuthCache(auth.user ? { userId: auth.user.id, email: auth.user.email, role: auth.profile?.role || 'preacher', displayName: auth.profile?.display_name || '' } : null);
}

async function loadProfile(client, userId) {
  const { data, error } = await client.from('profiles').select('id, email, display_name, role').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function handleSession(client, session, event) {
  if (session && session.user) {
    const changedUser = !auth.user || auth.user.id !== session.user.id;
    auth.offlineCached = false;
    setUser(session.user, changedUser ? null : auth.profile);
    try { const p = await loadProfile(client, session.user.id); if (p) setUser(session.user, p); }
    catch (e) { const c = readAuthCache(); if (c && c.userId === session.user.id) auth.profile = { role: c.role, display_name: c.displayName }; }
    emit(changedUser ? 'signed-in' : 'refreshed');
  } else if (event === 'SIGNED_OUT' || (event === 'INITIAL' && navigator.onLine)) {
    const had = !!auth.user;
    setUser(null);
    if (had || event === 'SIGNED_OUT') emit('signed-out');
  }
}

let initP = null;
/** Start auth. Safe to call many times. Resolves once the initial session is known. */
export function initAuth() {
  initP = initP || (async () => {
    // Offline-first: show the cached account immediately.
    const cached = readAuthCache();
    if (cached) { auth.user = { id: cached.userId, email: cached.email }; auth.profile = { role: cached.role, display_name: cached.displayName }; auth.offlineCached = true; setOwner(cached.userId); }
    if (!isConfigured()) { auth.ready = true; return auth; }
    let client;
    try { client = await getClient(); } catch (e) { auth.ready = true; emit('error'); return auth; }
    try {
      const { data } = await client.auth.getSession();
      await handleSession(client, data && data.session, 'INITIAL');
    } catch (e) { console.warn('getSession failed', e); }
    client.auth.onAuthStateChange((event, session) => {
      // Never await Supabase calls inside this callback (supabase-js deadlock); defer instead.
      if (event === 'INITIAL_SESSION') return;
      setTimeout(() => handleSession(client, session, event), 0);
    });
    auth.ready = true;
    emit('ready');
    return auth;
  })();
  return initP;
}

function redirectUrl() {
  const u = new URL(location.href);
  u.hash = ''; u.search = '';
  return u.toString();
}
function friendly(error) {
  const m = (error && (error.message || error.error_description)) || String(error);
  if (/rate limit|only request this after|security purposes/i.test(m)) return 'Please wait a minute before asking for another email.';
  if (/invalid login credentials/i.test(m)) return 'That email and password don’t match. Try again, or use an email link instead.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox for the confirmation link.';
  if (/token has expired|invalid|otp/i.test(m)) return 'That code didn’t work. It may have expired. Ask for a new email and try again.';
  if (/already registered/i.test(m)) return 'There’s already an account with that email. Sign in instead.';
  if (/password should be|weak/i.test(m)) return 'Please choose a longer password (at least 8 characters).';
  if (/fetch|network|failed to/i.test(m)) return 'Couldn’t reach the server. Check the internet connection.';
  return m;
}
async function call(fn) {
  const client = await getClient();
  if (!client) throw new Error('Accounts aren’t set up yet.');
  const { data, error } = await fn(client);
  if (error) throw new Error(friendly(error));
  return data;
}
export const sendMagicLink = email => call(c => c.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl(), shouldCreateUser: true } }));
export const verifyCode = (email, token) => call(c => c.auth.verifyOtp({ email, token: String(token).replace(/\D/g, ''), type: 'email' }));
export const signInPassword = (email, password) => call(c => c.auth.signInWithPassword({ email, password }));
export const signUpPassword = (email, password) => call(c => c.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl() } }));
export async function signOut() {
  const client = await getClient().catch(() => null);
  if (client) { try { await client.auth.signOut({ scope: 'local' }); } catch {} }
  setUser(null); auth.offlineCached = false;
  emit('signed-out');
}
export async function updateDisplayName(name) {
  if (!auth.user) return;
  await call(c => c.from('profiles').update({ display_name: name }).eq('id', auth.user.id));
  auth.profile = Object.assign({}, auth.profile, { display_name: name });
  setUser(auth.user, auth.profile);
}
/** True when we have a live (not just cached) session and network. */
export const canSync = () => isConfigured() && !!auth.user && !auth.offlineCached && navigator.onLine;

// ------------------------------------------------------------------ sermon remote (for sync.js)
const SERMON_COLS = 'id, user_id, title, content_html, timer_settings, last_position, position_updated_at, updated_at, deleted, synced_at, created_at';
export const supabaseRemote = {
  async pullSermons(userId, cursor) {
    return call(c => {
      let q = c.from('sermons').select(SERMON_COLS).eq('user_id', userId);
      if (cursor) q = q.gt('synced_at', cursor);
      return q.order('synced_at', { ascending: true }).limit(1000);
    });
  },
  async upsertSermon(row) { return call(c => c.from('sermons').upsert(row, { onConflict: 'id' }).select('id, synced_at').single()); },
  async patchPosition(id, last_position, position_updated_at) {
    return call(c => c.from('sermons').update({ last_position, position_updated_at }).eq('id', id));
  },
  async markDeleted(id, user_id, at) {
    return call(c => c.from('sermons').update({ deleted: true, updated_at: at }).eq('id', id).eq('user_id', user_id));
  }
};

// ------------------------------------------------------------------ recordings
export function baseMime(m) { return String(m || 'audio/webm').split(';')[0].trim(); }
/** Upload audio to Storage (recordings/<user_id>/<sermon_id>/<timestamp>.<ext>) and insert/refresh its row. */
export async function uploadRecording(blob, meta) {
  const client = await getClient();
  const uid = auth.user.id;
  const ext = /mp4|m4a|aac/.test(meta.mimeType || '') ? 'm4a' : /ogg/.test(meta.mimeType || '') ? 'ogg' : 'webm';
  const stamp = new Date(meta.recordedAt || Date.now()).toISOString().replace(/[:.]/g, '-');
  const path = `${uid}/${meta.sermonId || 'no-sermon'}/${stamp}.${ext}`;
  const up = await client.storage.from(BUCKET).upload(path, blob, { contentType: baseMime(meta.mimeType), upsert: true, cacheControl: '3600' });
  if (up.error) throw new Error('Upload failed: ' + friendly(up.error));
  const row = {
    local_id: meta.recordingId, user_id: uid, sermon_id: meta.sermonId || null, sermon_title: meta.sermonTitle || null,
    speaker: meta.speaker || null, notes: meta.notes || null, storage_path: path, mime_type: baseMime(meta.mimeType),
    duration: meta.durationSec ?? null, overtime_seconds: meta.overtimeSec ?? null,
    timer_minutes: meta.timerMinutes ?? null, created_at: meta.recordedAt || new Date().toISOString()
    // status defaults to 'uploaded' server-side; preachers can't set status/transcript/summary/grade_json.
  };
  let res = await client.from('recordings').upsert(row, { onConflict: 'local_id' }).select('id').single();
  if (res.error && /foreign key|23503/i.test(res.error.message + (res.error.code || ''))) {
    res = await client.from('recordings').upsert(Object.assign(row, { sermon_id: null }), { onConflict: 'local_id' }).select('id').single();
  }
  if (res.error) throw new Error('Saving the recording failed: ' + friendly(res.error));
  return { id: res.data.id, path };
}

// ------------------------------------------------------------------ Phase 2: AI feedback
/**
 * Ask the `grade-recording` Edge Function to transcribe + grade a recording (it replies 202 at once and
 * works in the background). Never throws: grading can also be started by the database trigger or retried.
 * @returns {Promise<{ok: boolean, status?: string, message?: string, error?: string}>}
 */
export async function requestGrading(recordingRowId, { force = false } = {}) {
  try {
    const client = await getClient();
    if (!client || !auth.user) return { ok: false, error: 'not signed in' };
    const body = { recording_id: recordingRowId };
    if (force) body.force = true;
    const { data, error } = await client.functions.invoke('grade-recording', { body });
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true, status: data?.status, message: data?.message };
  } catch (e) { return { ok: false, error: e.message }; }
}

/** The signed-in preacher's own recording rows (RLS: own rows only, admins see all). */
export const myFeedback = ids => ids.length
  ? call(c => c.from('recordings').select('id, local_id, status, status_detail, summary, grade_json, notes, graded_at').in('id', ids))
  : Promise.resolve([]);

// ------------------------------------------------------------------ admin (RLS enforces access server-side)
export const admin = {
  profiles: () => call(c => c.from('profiles').select('id, email, display_name, role, created_at').order('display_name', { ascending: true })),
  sermons: () => call(c => c.from('sermons').select('id, user_id, title, timer_settings, updated_at, created_at').eq('deleted', false).order('updated_at', { ascending: false }).limit(500)),
  sermon: id => call(c => c.from('sermons').select('id, user_id, title, content_html, timer_settings, updated_at').eq('id', id).single()),
  recordings: () => call(c => c.from('recordings').select('id, user_id, sermon_id, sermon_title, speaker, notes, storage_path, mime_type, duration, overtime_seconds, timer_minutes, created_at, status, status_detail, graded_at, transcript, summary, grade_json').order('created_at', { ascending: false }).limit(500)),
  signedUrl: async path => (await call(c => c.storage.from(BUCKET).createSignedUrl(path, 60 * 60))).signedUrl
};
