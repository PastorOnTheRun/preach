// Local-first sync engine. The UI only ever talks to storage.js; this mirrors sermons
// to a pluggable "remote" (supabaseRemote in cloud.js) whenever we're signed in and online.
//
// Conflict rule: last-write-wins, per field group:
//   - content (title, html, timer settings, deleted) → compares updated_at
//   - reading position                               → compares position_updated_at
// so turning pages on the iPad never overwrites a newer edit made on the laptop.
// Incremental pulls use the server-assigned synced_at (immune to device clock skew).
import * as store from './storage.js';
import { wordCount } from './format.js';

const iso = ms => new Date(ms).toISOString();
const ms = s => (s ? Date.parse(s) : 0);

export class SyncEngine {
  constructor({ remote, getUser, canSync }) {
    this.remote = remote; this.getUser = getUser; this.canSync = canSync;
    this.status = 'idle'; this.error = ''; this.lastSyncedAt = 0;
    this.listeners = new Set(); this.running = null; this.again = false; this._t = null;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _set(status, error = '', changed = false) {
    this.status = status; this.error = error;
    this.listeners.forEach(fn => { try { fn(this, changed); } catch (e) { console.error(e); } });
  }
  pending() {
    const u = this.getUser(); if (!u) return 0;
    const dirty = store.allMeta().filter(m => m.ownerId === u.id && (!m.cloudAt || m.updatedAt > m.cloudAt || store.getPosition(m.id).at > (m.cloudPosAt || 0))).length;
    return dirty + store.tombstones().filter(t => t.ownerId === u.id).length;
  }
  /** Debounced sync after local edits. */
  schedule(delay = 2500) { clearTimeout(this._t); this._t = setTimeout(() => this.syncNow(), delay); }

  syncNow() {
    if (this.running) { this.again = true; return this.running; }
    this.running = this._run().finally(() => {
      this.running = null;
      if (this.again) { this.again = false; this.schedule(500); }
    });
    return this.running;
  }

  async _run() {
    const user = this.getUser();
    if (!user) { this._set('signed-out'); return; }
    if (!this.canSync()) { this._set(navigator.onLine ? 'waiting' : 'offline'); return; }
    this._set('syncing');
    let changed = false;
    try {
      changed = store.claimUnowned(user.id) > 0;
      // 1. Pull everything changed on the server since our cursor.
      let cursor = store.syncCursor(user.id);
      const rows = (await this.remote.pullSermons(user.id, cursor)) || [];
      for (const row of rows) {
        if (this._applyRow(row)) changed = true;
        if (row.synced_at && (!cursor || row.synced_at > cursor)) cursor = row.synced_at;
      }
      // 2. Push deletions.
      for (const t of store.tombstones().filter(t => t.ownerId === user.id)) {
        await this.remote.markDeleted(t.id, user.id, iso(t.at));
        store.dropTombstone(t.id);
      }
      // 3. Push local changes.
      for (const m of store.allMeta().filter(m => m.ownerId === user.id)) {
        const pos = store.getPosition(m.id);
        const contentDirty = !m.cloudAt || m.updatedAt > m.cloudAt;
        const posDirty = pos.at > (m.cloudPosAt || 0);
        if (contentDirty) {
          const s = store.getSermon(m.id);
          await this.remote.upsertSermon({
            id: m.id, user_id: user.id, title: s.title, content_html: s.html || '', timer_settings: s.timer || null,
            last_position: pos.pos, position_updated_at: pos.at ? iso(pos.at) : null,
            updated_at: iso(m.updatedAt), created_at: iso(m.createdAt || m.updatedAt), deleted: false
          });
          store.markPushed(m.id, { cloudAt: m.updatedAt, cloudPosAt: pos.at });
        } else if (posDirty) {
          await this.remote.patchPosition(m.id, pos.pos, iso(pos.at));
          store.markPushed(m.id, { cloudPosAt: pos.at });
        }
      }
      if (cursor) store.setSyncCursor(user.id, cursor);
      this.lastSyncedAt = Date.now();
      this._set('synced', '', changed);
    } catch (e) {
      console.warn('Sync failed', e);
      this._set(navigator.onLine ? 'error' : 'offline', e.message || String(e), changed);
    }
  }

  /** Apply one server row locally if it wins last-write-wins. Returns true if local data changed. */
  _applyRow(row) {
    const local = store.getMeta(row.id);
    const remoteAt = ms(row.updated_at);
    let changed = false;
    if (row.deleted) {
      if (local && remoteAt >= local.updatedAt) { store.removeLocal(row.id); return true; }
      if (!local) return false;
    } else if (!local || remoteAt > local.updatedAt) {
      store.applyRemote({
        id: row.id, ownerId: row.user_id, title: row.title, html: row.content_html,
        words: wordCount(row.content_html || ''), timer: row.timer_settings, updatedAt: remoteAt, createdAt: ms(row.created_at)
      });
      changed = true;
    } else if (remoteAt === local.updatedAt && local.cloudAt !== remoteAt) {
      store.markPushed(row.id, { cloudAt: remoteAt });
    }
    const rp = ms(row.position_updated_at);
    if (rp && rp > store.getPosition(row.id).at) { store.applyRemotePosition(row.id, row.last_position || 0, rp); changed = true; }
    return changed;
  }
}
