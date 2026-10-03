/*
 * In-browser mock of the subset of supabase-js v2 that Preach uses. Served by the
 * Playwright tests in place of vendor/supabase.js. Simulates:
 *   - auth: magic link (code 123456), password sign-in/up, sessions, onAuthStateChange
 *   - PostgREST: select/eq/gt/order/limit/single/maybeSingle, insert/upsert/update
 *   - the RLS rules from supabase/schema.sql (own rows; admins read all; role not self-editable)
 *   - server-set synced_at (monotonic), the profile-on-signup trigger
 *   - Storage: private bucket with user_id/ path prefix rule + signed URLs
 * State lives in localStorage (__mockdb) so it survives reloads and is shared by
 * index.html and review.html. Tests seed it via window.__MOCK_SEED (addInitScript).
 */
(function () {
  const DBK = '__mockdb', SK = '__mocksession';
  const uuid = () => crypto.randomUUID();
  const blobs = {}; // path -> Blob (this page only)
  function load() {
    let db = JSON.parse(localStorage.getItem(DBK) || 'null');
    if (!db) {
      const seed = window.__MOCK_SEED || {};
      db = { users: seed.users || [], profiles: seed.profiles || [], sermons: seed.sermons || [], recordings: seed.recordings || [], objects: seed.objects || {}, otps: {}, log: [], clock: 0 };
      save(db);
    }
    return db;
  }
  function save(db) { localStorage.setItem(DBK, JSON.stringify(db)); }
  function now(db) { db.clock = Math.max(Date.now(), (db.clock || 0) + 1); return new Date(db.clock).toISOString(); }
  const session = () => JSON.parse(localStorage.getItem(SK) || 'null');
  const uidNow = () => (session() || {}).user?.id || null;
  const roleOf = (db, uid) => (db.profiles.find(p => p.id === uid) || {}).role;
  const err = (message, code) => ({ data: null, error: { message, code } });
  // Tiny silent WAV so <audio> has something to load.
  function wavDataUrl() {
    const n = 8000, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    w(36, 'data'); v.setUint32(40, n, true); for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  // ---------------- RLS
  function canRead(db, table, row, uid) {
    if (!uid) return false;
    if (table === 'profiles') return row.id === uid || roleOf(db, uid) === 'admin';
    return row.user_id === uid || roleOf(db, uid) === 'admin';
  }
  function canWrite(db, table, row, uid) {
    if (!uid) return false;
    if (table === 'profiles') return row.id === uid;
    return row.user_id === uid;
  }

  class Query {
    constructor(table) { this.table = table; this.filters = []; this.op = 'select'; this._order = null; this._limit = null; this._single = null; this._returning = false; }
    select() { if (this.op !== 'select') this._returning = true; return this; }
    eq(c, v) { this.filters.push(r => r[c] === v); return this; }
    gt(c, v) { this.filters.push(r => r[c] > v); return this; }
    order(c, o = {}) { this._order = [c, o.ascending !== false]; return this; }
    limit(n) { this._limit = n; return this; }
    single() { this._single = 'single'; return this; }
    maybeSingle() { this._single = 'maybe'; return this; }
    insert(rows) { this.op = 'insert'; this.rows = [].concat(rows); return this; }
    upsert(rows, opts = {}) { this.op = 'upsert'; this.rows = [].concat(rows); this.conflict = opts.onConflict || 'id'; return this; }
    update(vals) { this.op = 'update'; this.vals = vals; return this; }
    then(res, rej) { return Promise.resolve().then(() => this._exec()).then(res, rej); }
    _exec() {
      const db = load(); const uid = uidNow(); const t = db[this.table];
      if (!t) return err(`relation "${this.table}" does not exist`);
      let out = [];
      const stamp = row => { if (this.table === 'sermons') row.synced_at = now(db); return row; };
      if (this.op === 'select') {
        out = t.filter(r => canRead(db, this.table, r, uid)).filter(r => this.filters.every(f => f(r)));
      } else if (this.op === 'insert' || this.op === 'upsert') {
        for (const r of this.rows) {
          const row = Object.assign({}, r);
          if ('user_id' in row || this.table !== 'profiles') row.user_id = row.user_id || uid;
          if (!canWrite(db, this.table, row, uid)) return err('new row violates row-level security policy for table "' + this.table + '"', '42501');
          const key = this.conflict || 'id';
          const i = this.op === 'upsert' ? t.findIndex(x => x[key] === row[key] && row[key] != null) : -1;
          if (i >= 0) {
            if (!canWrite(db, this.table, t[i], uid)) return err('new row violates row-level security policy (USING expression) for table "' + this.table + '"', '42501');
            t[i] = stamp(Object.assign(t[i], row)); out.push(t[i]);
          } else {
            row.id = row.id || uuid(); row.created_at = row.created_at || now(db);
            if (this.table === 'recordings') { if ('status' in r || 'transcript' in r || 'grade_json' in r || 'summary' in r) return err('permission denied for column status', '42501'); row.status = 'uploaded'; }
            t.push(stamp(row)); out.push(row);
          }
        }
        db.log.push({ type: this.op, table: this.table, n: this.rows.length });
        save(db);
      } else if (this.op === 'update') {
        const vals = Object.assign({}, this.vals);
        if (this.table === 'profiles' && 'role' in vals) return err('permission denied for column role', '42501');
        for (const r of t) {
          if (!this.filters.every(f => f(r)) || !canRead(db, this.table, r, uid) || !canWrite(db, this.table, r, uid)) continue;
          Object.assign(r, vals); stamp(r); out.push(r);
        }
        save(db);
        if (!this._returning) return { data: null, error: null };
      }
      if (this._order) { const [c, asc] = this._order; out = out.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
      if (this._limit) out = out.slice(0, this._limit);
      out = JSON.parse(JSON.stringify(out));
      if (this._single === 'single') return out.length === 1 ? { data: out[0], error: null } : err('JSON object requested, multiple (or no) rows returned', 'PGRST116');
      if (this._single === 'maybe') return { data: out[0] || null, error: null };
      return { data: out, error: null };
    }
  }

  function createClient(url, key) {
    const listeners = new Set();
    const fire = (ev, s) => listeners.forEach(cb => setTimeout(() => cb(ev, s), 0));
    function findOrCreateUser(db, email, password) {
      let u = db.users.find(x => x.email === email.toLowerCase());
      if (!u) {
        u = { id: uuid(), email: email.toLowerCase(), password: password || null };
        db.users.push(u);
        db.profiles.push({ id: u.id, email: u.email, display_name: null, role: 'preacher', created_at: now(db) }); // handle_new_user trigger
      }
      return u;
    }
    function startSession(u) {
      const s = { access_token: 'mock-' + u.id, user: { id: u.id, email: u.email } };
      localStorage.setItem(SK, JSON.stringify(s)); fire('SIGNED_IN', s); return s;
    }
    const auth = {
      async getSession() { return { data: { session: session() }, error: null }; },
      onAuthStateChange(cb) { listeners.add(cb); setTimeout(() => cb('INITIAL_SESSION', session()), 0); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
      async signInWithOtp({ email, options }) {
        if (!navigator.onLine) return err('Failed to fetch');
        const db = load(); db.otps[email.toLowerCase()] = '123456'; db.log.push({ type: 'otp', email, redirect: options && options.emailRedirectTo }); save(db);
        return { data: {}, error: null };
      },
      async verifyOtp({ email, token }) {
        const db = load();
        if (db.otps[email.toLowerCase()] !== token) return err('Token has expired or is invalid');
        const u = findOrCreateUser(db, email); delete db.otps[email.toLowerCase()]; save(db);
        return { data: { session: startSession(u), user: u }, error: null };
      },
      async signInWithPassword({ email, password }) {
        const db = load(); const u = db.users.find(x => x.email === email.toLowerCase());
        if (!u || u.password !== password) return err('Invalid login credentials');
        return { data: { session: startSession(u), user: u }, error: null };
      },
      async signUp({ email, password }) {
        const db = load();
        if (db.users.find(x => x.email === email.toLowerCase())) return err('User already registered');
        const u = findOrCreateUser(db, email, password); save(db);
        return { data: { user: u, session: null }, error: null }; // email confirmation required
      },
      async signOut() { localStorage.removeItem(SK); fire('SIGNED_OUT', null); return { error: null }; }
    };
    const storage = {
      from(bucket) {
        return {
          async upload(path, blob, opts = {}) {
            const db = load(); const uid = uidNow();
            if (bucket !== 'recordings' || !uid || path.split('/')[0] !== uid) return err('new row violates row-level security policy', '403');
            if (db.objects[path] && !opts.upsert) return err('The resource already exists', '409');
            db.objects[path] = { size: blob.size, contentType: opts.contentType, owner: uid }; save(db); blobs[path] = blob;
            return { data: { path }, error: null };
          },
          async createSignedUrl(path, expires) {
            const db = load(); const uid = uidNow(); const o = db.objects[path];
            if (!o || !(path.split('/')[0] === uid || roleOf(db, uid) === 'admin')) return err('Object not found', '404');
            return { data: { signedUrl: blobs[path] ? URL.createObjectURL(blobs[path]) : wavDataUrl() }, error: null };
          }
        };
      }
    };
    window.__mockClient = { url, key };
    return { auth, storage, from: t => new Query(t), functions: { invoke: async () => ({ data: null, error: null }) } };
  }
  window.supabase = { createClient };
})();
