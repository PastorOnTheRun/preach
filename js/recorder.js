// Sermon audio recording with MediaRecorder. Audio is written to IndexedDB in small
// chunks while recording, so a crash, refresh or dead battery doesn't lose the sermon.

const DB_NAME = 'preach';
let dbp;
function db() {
  dbp = dbp || new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('recordings')) d.createObjectStore('recordings', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('chunks')) {
        const s = d.createObjectStore('chunks', { keyPath: ['recId', 'seq'] });
        s.createIndex('recId', 'recId');
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbp;
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function listRecordings() {
  const d = await db();
  const all = await reqP(d.transaction('recordings').objectStore('recordings').getAll());
  return all.filter(r => r.status === 'done').sort((a, b) => b.createdAt - a.createdAt);
}
export async function getRecording(id) {
  const d = await db();
  return reqP(d.transaction('recordings').objectStore('recordings').get(id));
}
export async function updateRecording(rec) { return putRecording(rec); }
async function putRecording(rec) { const d = await db(); return reqP(d.transaction('recordings', 'readwrite').objectStore('recordings').put(rec)); }
export async function deleteRecording(id) {
  const d = await db();
  const t = d.transaction(['recordings', 'chunks'], 'readwrite');
  t.objectStore('recordings').delete(id);
  const idx = t.objectStore('chunks').index('recId');
  const keys = await reqP(idx.getAllKeys(id));
  keys.forEach(k => t.objectStore('chunks').delete(k));
  return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
}
async function chunksFor(recId) {
  const d = await db();
  const all = await reqP(d.transaction('chunks').objectStore('chunks').index('recId').getAll(recId));
  return all.sort((a, b) => a.seq - b.seq);
}
async function clearChunks(recId) {
  const d = await db();
  const t = d.transaction('chunks', 'readwrite');
  const keys = await reqP(t.objectStore('chunks').index('recId').getAllKeys(recId));
  keys.forEach(k => t.objectStore('chunks').delete(k));
  return new Promise(res => { t.oncomplete = res; t.onerror = res; });
}
export async function wipeRecordings() {
  const d = await db();
  const t = d.transaction(['recordings', 'chunks'], 'readwrite');
  t.objectStore('recordings').clear(); t.objectStore('chunks').clear();
  return new Promise(res => { t.oncomplete = res; });
}

/** Turn any half-finished recordings (app closed mid-sermon) into normal saved recordings. */
export async function recoverOrphans() {
  const d = await db();
  const all = await reqP(d.transaction('recordings').objectStore('recordings').getAll());
  let n = 0;
  for (const rec of all.filter(r => r.status === 'recording')) {
    const chunks = await chunksFor(rec.id);
    if (!chunks.length) { await deleteRecording(rec.id); continue; }
    const blob = new Blob(chunks.map(c => c.blob), { type: rec.mimeType });
    const durationSec = rec.lastChunkAt ? Math.round((rec.activeMs || 0) / 1000) || Math.round((rec.lastChunkAt - rec.createdAt) / 1000) : 0;
    await putRecording(Object.assign(rec, { status: 'done', blob, size: blob.size, durationSec, recovered: true }));
    await clearChunks(rec.id);
    n++;
  }
  return n;
}

export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const types = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const t of types) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {} }
  return '';
}
export function extFor(mime) { return /mp4|m4a|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm'; }
export const recordingSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof MediaRecorder !== 'undefined');

export class SermonRecorder {
  constructor({ onState } = {}) {
    this.onState = onState || (() => {});
    this.state = 'idle'; // idle | recording | paused
    this.rec = null; this.mr = null; this.stream = null;
    this.seq = 0; this.pending = Promise.resolve();
    this.activeMs = 0; this.segStart = 0;
  }
  elapsedMs() { return this.activeMs + (this.state === 'recording' ? Date.now() - this.segStart : 0); }

  async start(meta = {}) {
    if (this.state !== 'idle') return;
    if (!recordingSupported()) throw new Error('Recording isn’t supported in this browser.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    });
    const mimeType = pickMimeType();
    const opts = { audioBitsPerSecond: 64000 };
    if (mimeType) opts.mimeType = mimeType;
    this.mr = new MediaRecorder(this.stream, opts);
    const id = 'rec-' + Date.now().toString(36);
    this.rec = {
      id, status: 'recording', createdAt: Date.now(), mimeType: this.mr.mimeType || mimeType || 'audio/webm',
      title: meta.title || 'Sermon', sermonId: meta.sermonId || null, speaker: meta.speaker || ''
    };
    await putRecording(this.rec);
    this.seq = 0; this.activeMs = 0; this.segStart = Date.now();
    this.mr.ondataavailable = e => {
      if (!e.data || !e.data.size) return;
      const seq = this.seq++;
      const rec = this.rec;
      this.pending = this.pending.then(async () => {
        const d = await db();
        await reqP(d.transaction('chunks', 'readwrite').objectStore('chunks').put({ recId: rec.id, seq, blob: e.data }));
        rec.lastChunkAt = Date.now(); rec.activeMs = this.elapsedMs();
        await putRecording(rec);
      }).catch(err => console.warn('chunk save failed', err));
    };
    // If the mic is taken away (e.g. iOS interruption), finish cleanly.
    this.stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (this.state !== 'idle') this.stop().then(r => this.onState('ended', r)); }));
    this.mr.start(4000); // 4 s chunks
    this.state = 'recording';
    this.onState(this.state);
  }

  pause() {
    if (this.state !== 'recording') return;
    try { this.mr.pause(); } catch {}
    this.activeMs += Date.now() - this.segStart;
    this.state = 'paused'; this.onState(this.state);
  }
  resume() {
    if (this.state !== 'paused') return;
    try { this.mr.resume(); } catch {}
    this.segStart = Date.now();
    this.state = 'recording'; this.onState(this.state);
  }

  /** Stop and assemble the final recording. Resolves the saved record (with .blob). */
  async stop() {
    if (this.state === 'idle') return null;
    const durationMs = this.elapsedMs();
    const mr = this.mr;
    const stopped = new Promise(res => { mr.addEventListener('stop', res, { once: true }); });
    try { if (mr.state !== 'inactive') mr.stop(); } catch {}
    await Promise.race([stopped, new Promise(r => setTimeout(r, 3000))]);
    await new Promise(r => setTimeout(r, 50));
    await this.pending;
    this.stream.getTracks().forEach(t => t.stop());
    const chunks = await chunksFor(this.rec.id);
    const blob = new Blob(chunks.map(c => c.blob), { type: this.rec.mimeType });
    const rec = Object.assign(this.rec, { status: 'done', blob, size: blob.size, durationSec: Math.round(durationMs / 1000), stoppedAt: Date.now() });
    await putRecording(rec);
    await clearChunks(rec.id);
    this.state = 'idle'; this.mr = null; this.stream = null; this.rec = null;
    this.onState(this.state);
    return rec;
  }
}
