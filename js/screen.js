// Projector page logic. Pairs with the preacher's app via a 6-character code, then shows
// only what the controller sends: a slide, or a black screen. See screenlink.js.
import { ScreenLink, normCode, validCode, screenAvailable } from './screenlink.js';

const $ = s => document.querySelector(s);
const KEY = 'preach.screen.code';
const HEARTBEAT_MS = 15000;
let link = null, paired = false, beat = null, noAnswer = null, lastSlide = null;

function status(msg) { $('#wait-status').textContent = msg || ''; }

function showWaiting(msg) {
  paired = false;
  document.body.classList.remove('paired');
  $('#stage').hidden = true; $('#blank').hidden = true; $('#slide').innerHTML = '';
  $('#wait').hidden = false;
  $('#pair-code').value = '';
  if (screenAvailable()) { $('#pair-form').hidden = false; }
  status(msg);
}

function becomePaired() {
  if (paired) return;
  paired = true;
  clearTimeout(noAnswer);
  $('#pair-code').value = '';          // never leave the code on screen
  $('#pair-code').blur();
  $('#wait').hidden = true;
  $('#stage').hidden = false;
  document.body.classList.add('paired');
}

function fit(box, el, min, max) {
  let lo = min, hi = max, best = min;
  const W = box.clientWidth, H = box.clientHeight;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = mid + 'px';
    if (box.scrollHeight <= H + 1 && el.scrollWidth <= W + 1) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  el.style.fontSize = best + 'px';
}

function render(slide) {
  lastSlide = slide;
  const box = $('#slide');
  box.className = 'slide';
  box.innerHTML = '';
  if (!slide || !slide.text) return;
  box.classList.add('k-' + (slide.kind || 'quote'));
  const p = document.createElement('p'); p.className = 'txt'; p.textContent = slide.text; box.appendChild(p);
  if (slide.cite) { const c = document.createElement('div'); c.className = 'cite'; c.textContent = slide.cite; box.appendChild(c); }
  if (slide.copyright) { const c = document.createElement('div'); c.className = 'copy'; c.textContent = slide.copyright; box.appendChild(c); }
  const vh = innerHeight;
  const max = { title: 0.13, heading: 0.105, highlight: 0.09, quote: 0.085, verse: 0.075 }[slide.kind] || 0.085;
  fit(box, p, 18, Math.round(vh * max));
  requestAnimationFrame(() => box.classList.add('in'));
}

function onMessage(ev, data) {
  if (ev === 'show') {
    becomePaired();
    $('#blank').hidden = !data.blank;
    render(data.blank ? null : data.slide);
  } else if (ev === 'ping') {
    link && link.send('hello', { sid: link.sid });
  } else if (ev === 'bye') {
    disconnect('The preacher ended Screen mode.');
  }
}

async function connect(code) {
  code = normCode(code);
  if (!validCode(code)) { status('Enter the 6-character code.'); return; }
  await stopLink();
  status('Connecting…');
  link = new ScreenLink('screen', code, {
    onMessage,
    onJoined: () => {
      link.send('hello', { sid: link.sid });
      clearInterval(beat); beat = setInterval(() => link && link.send('hello', { sid: link.sid }), HEARTBEAT_MS);
      clearTimeout(noAnswer);
      noAnswer = setTimeout(() => { if (!paired) status('Still waiting for the preacher’s app. Check the code and that Screen mode is on.'); }, 8000);
      if (!paired) status('Waiting for the preacher’s app…');
    },
    onStatus: s => { if (s === 'error' && !paired) status('Can’t reach the server. Check the internet connection.'); }
  });
  try { await link.start(); localStorage.setItem(KEY, code); }
  catch (e) { status(e.message); }
}

async function stopLink() { clearInterval(beat); clearTimeout(noAnswer); if (link) { const l = link; link = null; await l.stop(); } }

async function disconnect(msg) {
  localStorage.removeItem(KEY);
  await stopLink();
  showWaiting(msg || '');
}

$('#pair-form').addEventListener('submit', e => {
  e.preventDefault();
  const code = $('#pair-code').value;
  $('#pair-code').value = '';
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  connect(code);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && paired) disconnect(''); });
let rz = null;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (paired && lastSlide) render(lastSlide); }, 150); });

// Boot
if (!screenAvailable()) {
  $('#wait-title').textContent = 'Screen mode isn’t set up yet';
  status('Ask your admin to finish the Supabase setup (config.js).');
} else {
  showWaiting('');
  const saved = localStorage.getItem(KEY);
  if (saved) connect(saved); else setTimeout(() => $('#pair-code').focus(), 50);
}
window.__screen = { get paired() { return paired; }, get status() { return link && link.status; } };
