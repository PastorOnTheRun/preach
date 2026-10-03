// Countdown timer that keeps counting up into overtime. State is timestamp-based,
// so it stays accurate if the tab sleeps, and survives a page refresh.

export class CountdownTimer {
  constructor(saved, { onTick, onChange } = {}) {
    const s = saved || {};
    this.durationSec = s.durationSec || 30 * 60;
    this.running = !!s.running;
    this.startedAt = s.startedAt || 0;
    this.accumulatedMs = s.accumulatedMs || 0;
    this.onTick = onTick || (() => {});
    this.onChange = onChange || (() => {});
    this._iv = null;
    if (this.running) this._loop();
  }
  toJSON() {
    return { durationSec: this.durationSec, running: this.running, startedAt: this.startedAt, accumulatedMs: this.accumulatedMs };
  }
  elapsedMs() { return this.accumulatedMs + (this.running ? Date.now() - this.startedAt : 0); }
  remainingSec() { return this.durationSec - this.elapsedMs() / 1000; }
  get started() { return this.running || this.accumulatedMs > 0; }

  phase(warn) {
    if (!this.started) return 'idle';
    const r = this.remainingSec();
    if (r < 0) return 'over';
    if (warn && warn.enabled) {
      if (r <= warn.warn2 * 60) return 'warn2';
      if (r <= warn.warn1 * 60) return 'warn1';
    }
    return 'ok';
  }

  /** "29:59" counting down, "+1:23" in overtime. */
  display() {
    const r = this.remainingSec();
    const fmt = s => {
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
      return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
    };
    if (r >= 0) return fmt(Math.ceil(r - 1e-9) || 0);
    return '+' + fmt(Math.floor(-r));
  }

  start() {
    if (this.running) return;
    this.running = true; this.startedAt = Date.now();
    this._loop(); this.onChange();
  }
  pause() {
    if (!this.running) return;
    this.accumulatedMs += Date.now() - this.startedAt;
    this.running = false; clearInterval(this._iv); this._iv = null;
    this.onChange(); this.onTick();
  }
  toggle() { this.running ? this.pause() : this.start(); }
  reset() {
    this.running = false; this.accumulatedMs = 0; this.startedAt = 0;
    clearInterval(this._iv); this._iv = null;
    this.onChange(); this.onTick();
  }
  setDuration(sec) { this.durationSec = Math.max(60, Math.round(sec)); this.onChange(); this.onTick(); }
  _loop() { clearInterval(this._iv); this._iv = setInterval(() => this.onTick(), 250); this.onTick(); }
}
