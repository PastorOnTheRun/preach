// Local-first persistence (localStorage): settings, sermon library, UI state.
// This is the source of truth for the UI. A sync engine (sync.js) plugs in through
// onLocalChange() + the "sync hooks" below to mirror sermons to a remote backend.
const NS = 'preach.v1.';

function read(key, fallback) {
  try { const v = localStorage.getItem(NS + key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(NS + key, JSON.stringify(value)); return true; }
  catch (e) { console.warn('Storage failed', e); return false; }
}

export const DEFAULT_SETTINGS = {
  theme: 'light',
  font: 'serif',
  fontSize: (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 520px)').matches) ? 24 : 30,
  timerMinutes: 30,
  warnEnabled: true,
  warn1: 5,
  warn2: 2,
  recordWithTimer: false,
  apiBibleKey: '',
  speakerName: ''
};

export const settings = Object.assign({}, DEFAULT_SETTINGS, read('settings', {}));
export function saveSettings() { write('settings', settings); }

export const state = Object.assign({ currentId: null, positions: {}, positionTimes: {}, timer: null }, read('state', {}));
state.positionTimes = state.positionTimes || {};
export function saveState() { write('state', state); }

// ---- ownership: which account the visible library belongs to (null = signed out / local only)
let owner = (read('auth', null) || {}).userId || null;
export function setOwner(id) { owner = id || null; }
export function currentOwner() { return owner; }
const visible = s => !s.ownerId || s.ownerId === owner;

let changeHook = () => {};
/** Register a callback fired after any local change that may need syncing. */
export function onLocalChange(fn) { changeHook = fn || (() => {}); }

export function newId() {
  return (crypto && crypto.randomUUID) ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
}

// ---- Library: index (small metadata) + one key per sermon body (html)
function lib() { return read('library', []); }
export function listSermons() {
  return lib().filter(visible).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function getSermon(id) {
  const meta = lib().find(s => s.id === id);
  if (!meta) return null;
  return Object.assign({}, meta, { html: read('sermon.' + id, '') });
}
export function saveSermon(s) {
  const all = lib();
  const i = all.findIndex(x => x.id === s.id);
  const prev = i >= 0 ? all[i] : { createdAt: Date.now(), ownerId: owner };
  const meta = Object.assign({}, prev, {
    id: s.id, title: s.title || 'Untitled sermon', updatedAt: Date.now(), words: s.words || 0,
    timer: s.timer !== undefined ? s.timer : prev.timer || null
  });
  if (i >= 0) all[i] = meta; else all.push(meta);
  const ok = write('sermon.' + s.id, s.html) && write('library', all);
  changeHook('sermon', s.id);
  return ok;
}
/** Per-sermon timer settings (minutes + warnings). Counts as a content change for sync. */
export function setSermonTimer(id, timer) {
  const all = lib(); const m = all.find(x => x.id === id);
  if (!m) return;
  m.timer = timer; m.updatedAt = Date.now();
  write('library', all); changeHook('sermon', id);
}
export function deleteSermon(id) {
  const all = lib(); const m = all.find(s => s.id === id);
  if (m && m.cloudAt) { const t = read('tombstones', []); t.push({ id, at: Date.now(), ownerId: m.ownerId }); write('tombstones', t); }
  removeLocal(id);
  changeHook('delete', id);
}
export function setPosition(id, pos) {
  if (state.positions[id] === pos) return;
  state.positions[id] = pos; state.positionTimes[id] = Date.now();
  saveState(); changeHook('position', id);
}
export function getPosition(id) { return { pos: state.positions[id] || 0, at: state.positionTimes[id] || 0 }; }

export function wipeAll() {
  Object.keys(localStorage).filter(k => k.startsWith(NS)).forEach(k => localStorage.removeItem(k));
}
export function storageUsage() {
  let n = 0;
  Object.keys(localStorage).filter(k => k.startsWith(NS)).forEach(k => { n += (localStorage.getItem(k) || '').length * 2; });
  return n;
}

// ---- Sync hooks (used by sync.js only). These never bump updatedAt.
export function allMeta() { return lib(); }
export function getMeta(id) { return lib().find(s => s.id === id) || null; }
export function removeLocal(id) {
  write('library', lib().filter(s => s.id !== id));
  localStorage.removeItem(NS + 'sermon.' + id);
  delete state.positions[id]; delete state.positionTimes[id];
  if (state.currentId === id) state.currentId = null;
  saveState();
}
/** Write a sermon that came from the server (last-write-wins already decided by the caller). */
export function applyRemote({ id, ownerId, title, html, words, timer, updatedAt, createdAt }) {
  const all = lib();
  const i = all.findIndex(x => x.id === id);
  const meta = Object.assign(i >= 0 ? all[i] : { createdAt: createdAt || updatedAt }, {
    id, ownerId, title: title || 'Untitled sermon', words, timer: timer || null, updatedAt, cloudAt: updatedAt
  });
  if (i >= 0) all[i] = meta; else all.push(meta);
  write('sermon.' + id, html || '');
  write('library', all);
}
export function applyRemotePosition(id, pos, at) {
  state.positions[id] = pos; state.positionTimes[id] = at; saveState();
  markPushed(id, { cloudPosAt: at });
}
export function markPushed(id, fields) {
  const all = lib(); const m = all.find(x => x.id === id);
  if (m) { Object.assign(m, fields); write('library', all); }
}
/** Give sermons created while signed out to the account that just signed in. */
export function claimUnowned(userId) {
  const all = lib(); let n = 0;
  all.forEach(m => { if (!m.ownerId) { m.ownerId = userId; n++; } });
  if (n) write('library', all);
  return n;
}
export function removeOwnedBy(userId) { lib().filter(m => m.ownerId === userId).forEach(m => removeLocal(m.id)); }
export function tombstones() { return read('tombstones', []); }
export function dropTombstone(id) { write('tombstones', tombstones().filter(t => t.id !== id)); }
export function syncCursor(userId) { return (read('cursor', {}) || {})[userId] || null; }
export function setSyncCursor(userId, c) { const all = read('cursor', {}) || {}; all[userId] = c; write('cursor', all); }
export function readAuthCache() { return read('auth', null); }
export function writeAuthCache(v) { if (v) write('auth', v); else localStorage.removeItem(NS + 'auth'); }
