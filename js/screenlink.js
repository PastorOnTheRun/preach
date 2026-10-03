// Live link between the preacher's app (controller) and the projector page (screen.html),
// over a Supabase Realtime *broadcast* channel named after a short pairing code.
// Messages (all tiny, and only slide content — never manuscript text, timer or notes):
//   screen → controller: 'hello' { sid }            (on join, then every 15 s as a heartbeat)
//   controller → screen: 'show'  { seq, blank, slide } (current slide or black screen)
//                        'ping'  {}                    (asks screens to say hello)
//                        'bye'   {}                    (controller turned Screen mode off / changed code)
import { getClient, isConfigured } from './cloud.js';

export const CHANNEL_PREFIX = 'preach-screen-';
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679'; // no 0/O, 1/I/L, 2/Z, 5/S, 8/B
export const CODE_LEN = 6;

export function newCode() {
  const a = new Uint32Array(CODE_LEN); crypto.getRandomValues(a);
  return Array.from(a, n => ALPHABET[n % ALPHABET.length]).join('');
}
export const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const validCode = s => normCode(s).length === CODE_LEN;
export const screenAvailable = () => isConfigured();

export class ScreenLink {
  /** role: 'controller' | 'screen'. handlers: { onMessage(event, payload), onStatus(status) } */
  constructor(role, code, handlers = {}) {
    this.role = role; this.code = normCode(code); this.h = handlers;
    this.channel = null; this.client = null; this.status = 'idle';
    this.sid = Math.random().toString(36).slice(2, 10);
  }
  _status(s) { if (s !== this.status) { this.status = s; this.h.onStatus && this.h.onStatus(s); } }
  async start() {
    if (!validCode(this.code)) throw new Error('Enter the 6-character code.');
    this.client = await getClient();
    if (!this.client) throw new Error('Screen mode needs the team’s Supabase setup (config.js).');
    this._status('connecting');
    const ch = this.client.channel(CHANNEL_PREFIX + this.code, { config: { broadcast: { self: false, ack: false } } });
    ['hello', 'show', 'ping', 'bye'].forEach(ev => ch.on('broadcast', { event: ev }, msg => this.h.onMessage && this.h.onMessage(ev, (msg && msg.payload) || {})));
    this.channel = ch;
    ch.subscribe(st => {
      if (st === 'SUBSCRIBED') { this._status('joined'); this.h.onJoined && this.h.onJoined(); }
      else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') this._status('error');
      else if (st === 'CLOSED') this._status('closed');
    });
    return this;
  }
  send(event, payload = {}) {
    if (!this.channel) return Promise.resolve();
    return Promise.resolve(this.channel.send({ type: 'broadcast', event, payload })).catch(() => {});
  }
  async stop() {
    const ch = this.channel; this.channel = null;
    if (ch && this.client) { try { await this.client.removeChannel(ch); } catch { try { ch.unsubscribe(); } catch {} } }
    this._status('idle');
  }
}
