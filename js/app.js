// Preach — main app wiring.
import { $, $$, debounce, fmtClock, fmtDate, fmtBytes, slug, toast, downloadBlob, escapeHtml } from './util.js';
import { settings, saveSettings, state, saveState, listSermons, getSermon, saveSermon, deleteSermon, wipeAll, storageUsage, newId, setPosition, setSermonTimer, onLocalChange, removeOwnedBy } from './storage.js';
import { sanitizeHtml, textToHtml, htmlToPlain, wordCount, guessTitle, importFile } from './format.js';
import { linkifyElement, fetchPassage, prefetch, refLabel, bibleGatewayUrl, testKey, reportFums } from './bible.js';
import { Paginator } from './paginator.js';
import { CountdownTimer } from './timer.js';
import { SermonRecorder, listRecordings, getRecording, deleteRecording, recoverOrphans, wipeRecordings, extFor, recordingSupported, updateRecording } from './recorder.js';
import { sendForFeedback, setFeedbackSync } from './feedback.js';
import { isConfigured, initAuth, onAuth, auth, isAdmin, sendMagicLink, verifyCode, signInPassword, signUpPassword, signOut, updateDisplayName, canSync, supabaseRemote } from './cloud.js';
import { SyncEngine } from './sync.js';
import { SAMPLE_TITLE, SAMPLE_MD } from './sample.js';

export const VERSION = '1.1.0';
const FONT_SIZES = [18, 20, 22, 24, 26, 28, 30, 33, 36, 40, 44, 48, 54, 60, 68, 76];
const PRESETS = [20, 25, 30, 35, 40];
const WPM = 130; // typical preaching pace, for the length estimate

// Recorder is created first because the timer's render hook reads its state.
const recorder = new SermonRecorder({
  onState: (st, rec) => {
    renderRecButton();
    if (st === 'ended' && rec) { toast('The microphone stopped. Your recording was saved.', 4000); openSaved(rec); }
  }
});

// ---------------------------------------------------------------- appearance
function applyAppearance() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.font = settings.font;
  root.style.setProperty('--reading-size', settings.fontSize + 'px');
  $('#meta-theme').setAttribute('content', settings.theme === 'dark' ? '#0e1012' : '#f6f4ef');
  $('#theme-btn use').setAttribute('href', settings.theme === 'dark' ? '#i-sun' : '#i-moon');
  $$('.segmented[data-setting]').forEach(seg => {
    $$('button', seg).forEach(b => b.setAttribute('aria-pressed', String(settings[seg.dataset.setting] === b.dataset.val)));
  });
  $('#s-size').textContent = settings.fontSize;
  $('#d-size').textContent = settings.fontSize;
}
function setSetting(key, val) {
  settings[key] = val; saveSettings(); applyAppearance();
  if ((key === 'font') && paginator && currentView === 'preach') requestAnimationFrame(() => paginator.layout());
}
function changeFontSize(dir) {
  let i = FONT_SIZES.findIndex(s => s >= settings.fontSize);
  if (i < 0) i = FONT_SIZES.length - 1;
  i = Math.max(0, Math.min(FONT_SIZES.length - 1, i + dir));
  if (FONT_SIZES[i] === settings.fontSize && ((dir > 0 && i === FONT_SIZES.length - 1) || (dir < 0 && i === 0))) { toast(dir > 0 ? 'Largest size' : 'Smallest size', 1200); return; }
  settings.fontSize = FONT_SIZES[i]; saveSettings(); applyAppearance();
  if (paginator && currentView === 'preach') paginator.layout();
}
function toggleTheme() { setSetting('theme', settings.theme === 'dark' ? 'light' : 'dark'); }

// ---------------------------------------------------------------- views
let currentView = 'home';
function show(view) {
  currentView = view;
  ['home', 'edit', 'preach', 'signin'].forEach(v => { $('#' + v).hidden = v !== view; });
  document.body.dataset.view = view;
  if (view === 'home') renderHome();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- home
function estMinutes(words) { return Math.max(1, Math.round(words / WPM)); }
function renderHome() {
  const lib = listSermons();
  const cur = (state.currentId && lib.find(s => s.id === state.currentId)) || lib[0];
  const cc = $('#continue-card');
  cc.hidden = !cur;
  if (cur) {
    $('#cc-title').textContent = cur.title;
    $('#cc-meta').textContent = `${cur.words.toLocaleString()} words · about ${estMinutes(cur.words)} min · edited ${fmtDate(cur.updatedAt)}`;
    cc.dataset.id = cur.id;
  }
  const ul = $('#library');
  ul.innerHTML = '';
  $('#library-empty').hidden = lib.length > 0;
  for (const s of lib) {
    const li = document.createElement('li');
    li.className = 'item' + (cur && s.id === cur.id ? ' current' : '');
    li.innerHTML = `<div class="grow"><div class="name"></div><div class="sub"></div></div>
      <button class="icon-btn" data-act="delete" aria-label="Delete"><svg class="ic sm"><use href="#i-trash"/></svg></button>
      <button class="icon-btn" data-act="edit" aria-label="Edit"><svg class="ic sm"><use href="#i-edit"/></svg></button>
      <button class="btn primary" data-act="preach"><svg class="ic sm"><use href="#i-play"/></svg>Preach</button>`;
    $('.name', li).textContent = s.title;
    $('.sub', li).textContent = `${s.words.toLocaleString()} words · ~${estMinutes(s.words)} min · ${fmtDate(s.updatedAt)}`;
    li.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'preach') enterPreach(s.id);
      else if (act === 'edit') openEditor(s.id);
      else if (act === 'delete') {
        if (await confirmDlg(`Delete “${s.title}”? This can’t be undone.`, 'Delete')) { deleteSermon(s.id); renderHome(); toast('Sermon deleted'); }
      }
    });
    ul.appendChild(li);
  }
  renderRecordings();
  renderAccount();
  $('#app-version').textContent = 'v' + VERSION;
}

async function renderRecordings() {
  const ul = $('#recordings');
  let recs = [];
  try { recs = await listRecordings(); } catch (e) { console.warn(e); }
  ul.innerHTML = '';
  $('#rec-empty').hidden = recs.length > 0;
  for (const r of recs) {
    const li = document.createElement('li');
    li.className = 'item';
    li.innerHTML = `<div class="grow"><div class="name"></div><div class="sub"></div></div>
      <button class="icon-btn" data-act="delete" aria-label="Delete recording"><svg class="ic sm"><use href="#i-trash"/></svg></button>
      <button class="icon-btn" data-act="download" aria-label="Download"><svg class="ic sm"><use href="#i-download"/></svg></button>
      <button class="btn" data-act="open"><svg class="ic sm"><use href="#i-play"/></svg>Open</button>`;
    $('.name', li).textContent = r.title + (r.recovered ? ' (recovered)' : '');
    $('.sub', li).textContent = `${fmtDate(r.createdAt)} · ${fmtClock(r.durationSec || 0)} · ${fmtBytes(r.size || 0)}` + (r.cloud ? ' · sent for review ✓' : '');
    li.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'open') openSaved(await getRecording(r.id));
      else if (act === 'download') downloadRec(await getRecording(r.id));
      else if (act === 'delete') {
        if (await confirmDlg('Delete this recording? This can’t be undone.', 'Delete')) { await deleteRecording(r.id); renderRecordings(); }
      }
    });
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------- editor
let editing = null;
const editor = $('#editor');
function openEditor(id, { focus = false } = {}) {
  editing = id ? getSermon(id) : { id: newId(), title: '', html: '' };
  if (!editing) return;
  $('#edit-title').value = editing.title === 'Untitled sermon' ? '' : editing.title;
  editor.innerHTML = editing.html;
  updateEditMeta('');
  show('edit');
  if (focus) setTimeout(() => editor.focus(), 50);
}
function updateEditMeta(status) {
  const w = wordCount(editor.innerHTML);
  $('#edit-status').textContent = (status ? status + ' · ' : '') + (w ? `${w.toLocaleString()} words · ~${estMinutes(w)} min` : '');
}
function saveEditing() {
  if (!editing) return false;
  const html = sanitizeHtml(editor.innerHTML);
  const title = $('#edit-title').value.trim();
  if (!html && !title) return false;
  editing.html = html;
  editing.title = title || guessTitle(html);
  editing.words = wordCount(html);
  const ok = saveSermon(editing);
  state.currentId = editing.id; saveState();
  updateEditMeta(ok ? 'Saved' : 'Not saved — storage full');
  return ok;
}
const autosave = debounce(saveEditing, 600);
editor.addEventListener('input', () => { updateEditMeta('Saving…'); autosave(); });
$('#edit-title').addEventListener('input', () => { autosave(); });
editor.addEventListener('paste', e => {
  const cd = e.clipboardData;
  if (!cd) return;
  e.preventDefault();
  const html = cd.getData('text/html');
  const text = cd.getData('text/plain');
  const clean = html ? sanitizeHtml(html) : textToHtml(text);
  if (!editor.textContent.trim()) editor.innerHTML = clean;
  else document.execCommand('insertHTML', false, clean);
  if (!$('#edit-title').value.trim()) $('#edit-title').value = guessTitle(clean, '');
  saveEditing();
});
$('#edit-back').addEventListener('click', () => { saveEditing(); show('home'); });
$('#edit-preach').addEventListener('click', () => {
  saveEditing();
  if (!editing || !editing.html) { toast('Paste your sermon first'); return; }
  enterPreach(editing.id);
});

// ---------------------------------------------------------------- loading
$('#tile-paste').addEventListener('click', () => openEditor(null, { focus: true }));
$('#file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    toast('Opening ' + file.name + '…');
    const { title, html } = await importFile(file);
    if (!html) { toast('That file looks empty.'); return; }
    const s = { id: newId(), title: title || guessTitle(html), html, words: wordCount(html) };
    saveSermon(s);
    state.currentId = s.id; saveState();
    openEditor(s.id);
    toast('Loaded “' + s.title + '”');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Couldn’t open that file.', 5000);
  }
});
$('#tile-sample').addEventListener('click', () => {
  let s = listSermons().find(x => x.title === SAMPLE_TITLE);
  if (!s) {
    const html = textToHtml(SAMPLE_MD);
    s = { id: newId(), title: SAMPLE_TITLE, html, words: wordCount(html) };
    saveSermon(s);
  }
  enterPreach(s.id);
});
$('#cc-preach').addEventListener('click', () => enterPreach($('#continue-card').dataset.id));
$('#cc-edit').addEventListener('click', () => openEditor($('#continue-card').dataset.id));

// ---------------------------------------------------------------- preaching view
const viewport = $('#viewport');
const flow = $('#flow');
let paginator = null;
let preachId = null;
let refsInSermon = [];

function onPageChange(page, pages) {
  $('#page-text').textContent = `Page ${page + 1} of ${pages}`;
  $('#page-progress').style.width = (pages > 1 ? (page / (pages - 1)) * 100 : 100) + '%';
  $('#prev-btn').disabled = page === 0;
  $('#next-btn').disabled = page >= pages - 1;
  if (preachId && paginator) setPosition(preachId, paginator.anchor);
}

async function enterPreach(id) {
  const s = getSermon(id);
  if (!s) { toast('Sermon not found'); return; }
  preachId = id;
  state.currentId = id; saveState();
  $('#p-title').textContent = s.title;
  document.title = s.title + ' · Preach';
  flow.innerHTML = s.html + '<div class="end-mark">— END —</div>';
  linkifyElement(flow);
  refsInSermon = $$('.ref', flow).map(el => JSON.parse(el.dataset.ref));
  if (s.timer && s.timer.minutes && !timer.started) timer.setDuration(s.timer.minutes * 60);
  show('preach');
  if (!paginator) paginator = new Paginator(viewport, flow, { onChange: onPageChange });
  try { await document.fonts.ready; } catch {}
  await new Promise(r => requestAnimationFrame(r));
  paginator.setContent(state.positions[id] || 0);
  requestWakeLock();
  const key = apiKey();
  if (key) setTimeout(() => prefetch(refsInSermon, key), 1500);
}

async function exitPreach() {
  if (recorder.state !== 'idle') {
    if (!(await confirmDlg('You’re still recording. Stop and save the recording?', 'Stop & save'))) return;
    await stopRecording();
  }
  if (paginator) paginator.stop();
  releaseWakeLock();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  document.title = 'Preach';
  show('home');
}
$('#p-exit').addEventListener('click', exitPreach);

let lastTurn = 0;
function turn(dir, source) {
  if (!paginator) return;
  const now = Date.now();
  if (now - lastTurn < 120) return; // debounce bouncy pedals
  lastTurn = now;
  const moved = dir > 0 ? paginator.next() : paginator.prev();
  if (moved && source === 'tap') flashEdge(dir);
  if (!moved && dir > 0 && paginator.pages > 1) toast('End of sermon', 1200);
}
function flashEdge(dir) {
  const el = $(dir > 0 ? '.edge-flash.r' : '.edge-flash.l');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 120);
}
$('#next-btn').addEventListener('click', () => turn(1));
$('#prev-btn').addEventListener('click', () => turn(-1));

// Taps on edges, swipes, verse references.
let ptr = null;
viewport.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  ptr = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
  const ref = e.target.closest('.ref'); if (ref) ref.classList.add('pressed');
});
viewport.addEventListener('pointercancel', () => { ptr = null; $$('.ref.pressed').forEach(r => r.classList.remove('pressed')); });
viewport.addEventListener('pointerup', e => {
  $$('.ref.pressed').forEach(r => r.classList.remove('pressed'));
  if (!ptr || ptr.id !== e.pointerId) return;
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y, dt = Date.now() - ptr.t;
  ptr = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3 && dt < 1000) { turn(dx < 0 ? 1 : -1, 'swipe'); return; }
  if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
  const ref = e.target.closest('.ref');
  if (ref) { openVerse(JSON.parse(ref.dataset.ref)); return; }
  const r = viewport.getBoundingClientRect();
  const fx = (e.clientX - r.left) / r.width;
  if (fx < 0.33) turn(-1, 'tap'); else if (fx > 0.67) turn(1, 'tap');
});
let wheelLock = 0;
viewport.addEventListener('wheel', e => {
  e.preventDefault();
  const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  if (Math.abs(d) < 25 || Date.now() < wheelLock) return;
  wheelLock = Date.now() + 450;
  turn(d > 0 ? 1 : -1, 'wheel');
}, { passive: false });

// Keyboard + Bluetooth page turners (they send arrows / PageUp / PageDown / space).
const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar', 'Enter', 'MediaTrackNext']);
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'MediaTrackPrevious']);
document.addEventListener('keydown', e => {
  if (currentView !== 'preach') return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  const openDlg = $('dialog[open]');
  const isNav = NEXT_KEYS.has(e.key) || PREV_KEYS.has(e.key) || e.key === 'Home' || e.key === 'End';
  if (openDlg) {
    // A pedal press while a verse is open just closes the verse.
    if (openDlg.id === 'dlg-verse' && isNav) { e.preventDefault(); openDlg.close(); }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Home') { e.preventDefault(); paginator?.goTo(0); return; }
  if (e.key === 'End') { e.preventDefault(); paginator?.goTo(paginator.pages - 1); return; }
  if (NEXT_KEYS.has(e.key)) { e.preventDefault(); turn(e.shiftKey && e.key === ' ' ? -1 : 1, 'key'); return; }
  if (PREV_KEYS.has(e.key)) { e.preventDefault(); turn(-1, 'key'); return; }
  if (e.key === '+' || e.key === '=') { changeFontSize(1); }
  if (e.key === '-' || e.key === '_') { changeFontSize(-1); }
});
// Don't leave focus on toolbar buttons (space/enter would re-trigger them instead of turning the page).
$('#preach').addEventListener('click', e => { if (e.target.closest('.pbar button')) setTimeout(() => document.activeElement?.blur?.(), 0); });

$('#font-inc').addEventListener('click', () => changeFontSize(1));
$('#font-dec').addEventListener('click', () => changeFontSize(-1));
$('#theme-btn').addEventListener('click', toggleTheme);
$('#display-btn').addEventListener('click', () => $('#dlg-display').showModal());
$('#d-inc').addEventListener('click', () => changeFontSize(1));
$('#d-dec').addEventListener('click', () => changeFontSize(-1));

// Fullscreen
const fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
if (!fsSupported || matchMedia('(display-mode: standalone)').matches) $('#fs-btn').remove();
else $('#fs-btn').addEventListener('click', () => {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else { const el = d.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen).call(el).catch?.(() => {}); }
});

// Page jump
$('#page-ind').addEventListener('click', () => {
  if (!paginator) return;
  const r = $('#pg-range');
  r.max = paginator.pages; r.value = paginator.page + 1; $('#pg-num').textContent = r.value;
  $('#dlg-page').showModal();
});
$('#pg-range').addEventListener('input', e => { $('#pg-num').textContent = e.target.value; });
$('#pg-go').addEventListener('click', () => { paginator.goTo(+$('#pg-range').value - 1); $('#dlg-page').close(); });
$('#pg-first').addEventListener('click', () => { paginator.goTo(0); $('#dlg-page').close(); });

// Screen wake lock
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) { console.info('Wake lock unavailable:', e.message); }
}
function releaseWakeLock() { try { wakeLock?.release(); } catch {} wakeLock = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentView === 'preach') requestWakeLock();
  if (document.visibilityState === 'visible') timer.onTick();
});

// ---------------------------------------------------------------- timer
const warnCfg = () => ({ enabled: settings.warnEnabled, warn1: settings.warn1, warn2: settings.warn2 });
const timer = new CountdownTimer(state.timer || { durationSec: settings.timerMinutes * 60 }, {
  onTick: renderTimer,
  onChange: () => { state.timer = timer.toJSON(); saveState(); renderTimerControls(); }
});
function renderTimer() {
  const phase = timer.phase(warnCfg());
  const pill = $('#timer-pill');
  const txt = timer.display();
  $('#timer-text').textContent = txt;
  $('#t-big').textContent = txt;
  pill.dataset.phase = phase;
  pill.dataset.paused = String(!timer.running);
  document.body.classList.toggle('overtime', phase === 'over');
  document.body.classList.toggle('running', timer.running);
  if (recorder && recorder.state !== 'idle') renderRecLabel();
}
function renderTimerControls() {
  const running = timer.running;
  $('#timer-toggle use').setAttribute('href', running ? '#i-pause' : '#i-play');
  $('#timer-toggle').setAttribute('aria-label', running ? 'Pause timer' : 'Start timer');
  $('#t-start use').setAttribute('href', running ? '#i-pause' : '#i-play');
  $('#t-start span').textContent = running ? 'Pause' : (timer.started ? 'Resume' : 'Start');
  const mins = Math.round(timer.durationSec / 60);
  $$('#t-presets .chip').forEach(c => c.setAttribute('aria-pressed', String(+c.dataset.min === mins)));
  if (document.activeElement !== $('#t-custom')) $('#t-custom').value = mins;
  $('#t-warn').checked = settings.warnEnabled;
  $('#t-warn-rows').style.opacity = settings.warnEnabled ? 1 : .4;
  $('#t-w1').textContent = settings.warn1 + ' min';
  $('#t-w2').textContent = settings.warn2 + ' min';
  $('#t-rec').checked = settings.recordWithTimer;
  renderTimer();
}
async function toggleTimer() {
  const starting = !timer.running;
  timer.toggle();
  if (settings.recordWithTimer) {
    if (starting && recorder.state === 'idle') await startRecording();
    else if (starting && recorder.state === 'paused') recorder.resume();
    else if (!starting && recorder.state === 'recording') recorder.pause();
  }
}
PRESETS.forEach(m => {
  const b = document.createElement('button');
  b.className = 'chip'; b.dataset.min = m; b.textContent = m;
  b.setAttribute('aria-label', m + ' minutes');
  b.addEventListener('click', () => setTimerMinutes(m));
  $('#t-presets').appendChild(b);
});
function setTimerMinutes(m) {
  m = Math.max(1, Math.min(180, Math.round(m) || 30));
  settings.timerMinutes = m; saveSettings();
  timer.setDuration(m * 60);
  if (currentView === 'preach' && preachId) setSermonTimer(preachId, { minutes: m, warnEnabled: settings.warnEnabled, warn1: settings.warn1, warn2: settings.warn2 });
}
$('#t-minus').addEventListener('click', () => setTimerMinutes(Math.round(timer.durationSec / 60) - 1));
$('#t-plus').addEventListener('click', () => setTimerMinutes(Math.round(timer.durationSec / 60) + 1));
$('#t-custom').addEventListener('change', e => setTimerMinutes(+e.target.value));
$('#t-start').addEventListener('click', async () => { await toggleTimer(); if (timer.running) $('#dlg-timer').close(); });
$('#t-reset').addEventListener('click', () => timer.reset());
$('#t-warn').addEventListener('change', e => { settings.warnEnabled = e.target.checked; saveSettings(); renderTimerControls(); });
$('#t-rec').addEventListener('change', e => { settings.recordWithTimer = e.target.checked; saveSettings(); $('#s-rec').checked = e.target.checked; });
$$('[data-step]').forEach(b => b.addEventListener('click', () => {
  const [k, d] = b.dataset.step.split(':');
  settings[k] = Math.max(1, Math.min(30, settings[k] + +d));
  if (settings.warn2 >= settings.warn1) { if (k === 'warn1') settings.warn2 = Math.max(1, settings.warn1 - 1); else settings.warn1 = settings.warn2 + 1; }
  saveSettings(); renderTimerControls();
}));
$('#timer-pill').addEventListener('click', () => { renderTimerControls(); $('#dlg-timer').showModal(); });
$('#timer-toggle').addEventListener('click', toggleTimer);

// ---------------------------------------------------------------- recording
let recTimerIv = null;
function renderRecLabel() {
  const t = fmtClock(recorder.elapsedMs() / 1000);
  $('#rec-label').textContent = recorder.state === 'paused' ? 'Paused ' + t : t;
  $('#rec-big').textContent = t;
}
function renderRecButton() {
  const b = $('#rec-btn');
  const st = recorder.state;
  b.classList.toggle('on', st !== 'idle');
  b.classList.toggle('paused', st === 'paused');
  b.setAttribute('aria-label', st === 'idle' ? 'Start recording' : 'Recording options');
  $('#rec-pause use').setAttribute('href', st === 'paused' ? '#i-mic' : '#i-pause');
  $('#rec-pause span').textContent = st === 'paused' ? 'Resume' : 'Pause';
  $('#rec-state').textContent = st === 'paused' ? 'Paused. Tap Resume to keep going.' : 'Recording is saved on this device as you go.';
  clearInterval(recTimerIv);
  if (st === 'idle') { $('#rec-label').textContent = 'Record'; return; }
  renderRecLabel();
  recTimerIv = setInterval(renderRecLabel, 500);
}
async function startRecording() {
  if (!recordingSupported()) { toast('Recording isn’t supported in this browser.', 4000); return; }
  try {
    const s = preachId && getSermon(preachId);
    await recorder.start({ title: s ? s.title : 'Sermon', sermonId: preachId, speaker: settings.speakerName });
    toast('Recording started');
  } catch (e) {
    console.warn(e);
    const msg = e.name === 'NotAllowedError'
      ? 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.'
      : e.name === 'NotFoundError' ? 'No microphone was found.' : 'Couldn’t start recording: ' + e.message;
    toast(msg, 6000);
  }
}
async function stopRecording() {
  const overtimeSec = timer.started ? Math.max(0, Math.round(-timer.remainingSec())) : 0;
  const rec = await recorder.stop();
  if (!rec) return;
  rec.timerMinutes = Math.round(timer.durationSec / 60);
  rec.overtimeSec = overtimeSec;
  openSaved(rec);
}
$('#rec-btn').addEventListener('click', () => {
  if (recorder.state === 'idle') startRecording();
  else { renderRecButton(); $('#dlg-rec').showModal(); }
});
$('#rec-pause').addEventListener('click', () => { recorder.state === 'paused' ? recorder.resume() : recorder.pause(); });
$('#rec-stop').addEventListener('click', async () => { $('#dlg-rec').close(); await stopRecording(); });
window.addEventListener('beforeunload', e => { if (recorder.state !== 'idle') { e.preventDefault(); e.returnValue = ''; } });

let savedRec = null, savedUrl = null;
function openSaved(rec) {
  if (!rec) return;
  savedRec = rec;
  if (savedUrl) URL.revokeObjectURL(savedUrl);
  savedUrl = URL.createObjectURL(rec.blob);
  $('#saved-audio').src = savedUrl;
  $('#saved-meta').textContent = `${rec.title} · ${fmtClock(rec.durationSec || 0)} · ${fmtBytes(rec.size || 0)} · ${fmtDate(rec.createdAt)}`;
  $('#fb-name').value = rec.speaker || settings.speakerName || '';
  $('#fb-notes').value = '';
  $('#fb-status').textContent = ''; $('#fb-status').className = 'status-line';
  $('#fb-send').disabled = false;
  const file = recFile(rec);
  $('#saved-share').hidden = !(navigator.canShare && file && navigator.canShare({ files: [file] }));
  const d = $('#dlg-saved');
  if (!d.open) d.showModal();
  if (currentView === 'home') renderRecordings();
}
$('#dlg-saved').addEventListener('close', () => { $('#saved-audio').pause(); if (currentView === 'home') renderRecordings(); });
function recFilename(rec) {
  const d = new Date(rec.createdAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${slug(rec.title)}-${stamp}.${extFor(rec.mimeType)}`;
}
function recFile(rec) { try { return new File([rec.blob], recFilename(rec), { type: rec.mimeType }); } catch { return null; } }
function downloadRec(rec) { if (rec) downloadBlob(rec.blob, recFilename(rec)); }
$('#saved-download').addEventListener('click', () => downloadRec(savedRec));
$('#saved-share').addEventListener('click', async () => {
  try { await navigator.share({ files: [recFile(savedRec)], title: savedRec.title }); } catch (e) { if (e.name !== 'AbortError') toast('Sharing didn’t work. Try Download instead.'); }
});
$('#fb-send').addEventListener('click', async () => {
  if (!savedRec) return;
  const name = $('#fb-name').value.trim();
  if (name && name !== settings.speakerName) { settings.speakerName = name; saveSettings(); }
  const sermon = savedRec.sermonId && getSermon(savedRec.sermonId);
  const metadata = {
    recordingId: savedRec.id,
    sermonId: savedRec.sermonId || null,
    sermonTitle: savedRec.title,
    speaker: name,
    notes: $('#fb-notes').value.trim(),
    recordedAt: new Date(savedRec.createdAt).toISOString(),
    durationSec: savedRec.durationSec,
    mimeType: savedRec.mimeType,
    timerMinutes: savedRec.timerMinutes ?? null,
    overtimeSec: savedRec.overtimeSec ?? null,
    manuscript: sermon ? htmlToPlain(sermon.html) : ''
  };
  const st = $('#fb-status');
  $('#fb-send').disabled = true;
  st.className = 'status-line'; st.textContent = 'Sending…';
  try {
    const res = await sendForFeedback(savedRec.blob, metadata);
    st.className = 'status-line ' + (res.ok ? 'ok' : res.stub ? 'muted' : 'err');
    st.textContent = res.message;
    if (res.ok) { savedRec.cloud = { rowId: res.recordingRowId, path: res.storagePath, at: Date.now() }; updateRecording(savedRec).then(() => { if (currentView === 'home') renderRecordings(); }).catch(() => {}); }
    if (res.needsSignIn) {
      const b = document.createElement('button'); b.className = 'btn primary'; b.style.marginLeft = '10px'; b.textContent = 'Sign in';
      b.addEventListener('click', () => { $('#dlg-saved').close(); openSignIn(); });
      st.appendChild(b);
    }
  } catch (e) {
    st.className = 'status-line err'; st.textContent = 'Couldn’t send: ' + e.message;
  } finally { $('#fb-send').disabled = false; }
});

// ---------------------------------------------------------------- verse popup
function apiKey() { return (settings.apiBibleKey || (window.PREACH_CONFIG && window.PREACH_CONFIG.apiBibleKey) || '').trim(); }
let verseReq = 0;
async function openVerse(ref) {
  const label = refLabel(ref);
  $('#verse-ref').textContent = label;
  $('#verse-bg').href = bibleGatewayUrl(ref);
  const body = $('#verse-body');
  const dlg = $('#dlg-verse');
  if (!dlg.open) dlg.showModal();
  const key = apiKey();
  if (!key) {
    body.innerHTML = `<p class="verse-msg">Tap <b>Open on BibleGateway</b> to read ${escapeHtml(label)} in the CSB.</p>
      <p class="muted" style="font-size:15px">Tip: add a free API.Bible key in Settings to show CSB verses right here, without leaving the app.</p>`;
    return;
  }
  const my = ++verseReq;
  body.innerHTML = '<div class="spinner" aria-label="Loading"></div>';
  try {
    const p = await fetchPassage(ref, key);
    if (my !== verseReq) return;
    body.innerHTML = `<div class="verse-text">${p.html}</div><div class="verse-copy"></div>`;
    $('.verse-copy', body).textContent = p.copyright;
    reportFums(p.fumsToken);
  } catch (e) {
    if (my !== verseReq) return;
    body.innerHTML = `<p class="verse-msg"></p><p class="muted" style="font-size:15px">You can still open ${escapeHtml(label)} in the CSB on BibleGateway.</p>`;
    $('.verse-msg', body).textContent = e.message;
  }
}

// ---------------------------------------------------------------- settings
function openSettings() {
  $('#s-name').value = settings.speakerName;
  $('#s-key').value = settings.apiBibleKey;
  $('#s-key').type = 'password'; $('#s-key-show').textContent = 'Show';
  $('#s-key-status').textContent = settings.apiBibleKey ? '' : ((window.PREACH_CONFIG || {}).apiBibleKey ? 'Using the team key from config.js.' : 'No key: verse taps open BibleGateway (CSB).');
  $('#s-key-status').className = 'status-line';
  $('#s-rec').checked = settings.recordWithTimer;
  $('#s-storage').textContent = `Sermons use about ${fmtBytes(storageUsage())} on this device.`;
  applyAppearance();
  $('#dlg-settings').showModal();
}
$('#btn-settings').addEventListener('click', openSettings);
$('#s-name').addEventListener('change', e => { settings.speakerName = e.target.value.trim(); saveSettings(); });
$('#s-key').addEventListener('change', e => { settings.apiBibleKey = e.target.value.trim(); saveSettings(); });
$('#s-key-show').addEventListener('click', () => {
  const i = $('#s-key'); i.type = i.type === 'password' ? 'text' : 'password';
  $('#s-key-show').textContent = i.type === 'password' ? 'Show' : 'Hide';
});
$('#s-key-test').addEventListener('click', async () => {
  settings.apiBibleKey = $('#s-key').value.trim(); saveSettings();
  const st = $('#s-key-status');
  const key = apiKey();
  if (!key) { st.className = 'status-line err'; st.textContent = 'Paste a key first.'; return; }
  st.className = 'status-line'; st.textContent = 'Checking…';
  try { const name = await testKey(key); st.className = 'status-line ok'; st.textContent = '✓ Connected: ' + name; }
  catch (e) { st.className = 'status-line err'; st.textContent = e.message; }
});
$('#s-rec').addEventListener('change', e => { settings.recordWithTimer = e.target.checked; saveSettings(); });
$('#s-inc').addEventListener('click', () => changeFontSize(1));
$('#s-dec').addEventListener('click', () => changeFontSize(-1));
$$('.segmented[data-setting]').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button[data-val]'); if (b) setSetting(seg.dataset.setting, b.dataset.val);
}));
$('#s-wipe').addEventListener('click', async () => {
  if (!(await confirmDlg('Delete ALL sermons, recordings and settings on this device? This can’t be undone.', 'Delete everything'))) return;
  wipeAll(); await wipeRecordings();
  location.reload();
});

// ---------------------------------------------------------------- dialogs
$$('dialog').forEach(d => {
  d.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { d.close(); return; }
    if (e.target === d) { // backdrop
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    }
  });
});
function confirmDlg(message, okLabel = 'OK') {
  return new Promise(resolve => {
    const d = $('#dlg-confirm');
    $('#confirm-msg').textContent = message;
    $('#confirm-yes').textContent = okLabel;
    const done = v => { d.close(); cleanup(); resolve(v); };
    const yes = () => done(true), no = () => done(false), cancel = () => { cleanup(); resolve(false); };
    function cleanup() { $('#confirm-yes').removeEventListener('click', yes); $('#confirm-no').removeEventListener('click', no); d.removeEventListener('cancel', cancel); }
    $('#confirm-yes').addEventListener('click', yes);
    $('#confirm-no').addEventListener('click', no);
    d.addEventListener('cancel', cancel);
    d.showModal();
  });
}

// ---------------------------------------------------------------- accounts + sync
const sync = new SyncEngine({ remote: supabaseRemote, getUser: () => auth.user, canSync });
setFeedbackSync(sync);
onLocalChange(() => { if (isConfigured() && auth.user) sync.schedule(); });
sync.on((eng, changed) => {
  renderAccount();
  if (changed && currentView === 'home') renderHome();
});
function initials(a) {
  const n = (a.profile && a.profile.display_name) || (a.user && a.user.email) || '?';
  return n.trim().charAt(0).toUpperCase();
}
function syncText() {
  const n = sync.pending();
  switch (sync.status) {
    case 'syncing': return 'Syncing…';
    case 'synced': return 'All sermons synced' + (sync.lastSyncedAt ? ' at ' + new Date(sync.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '') + '.';
    case 'offline': return `Offline. ${n ? n + ' change' + (n > 1 ? 's' : '') + ' will sync' : 'Will sync'} when you’re back online.`;
    case 'error': return 'Couldn’t sync: ' + sync.error;
    case 'waiting': return auth.offlineCached ? 'Reconnecting to your account…' : 'Waiting to sync.';
    default: return n ? `${n} change${n > 1 ? 's' : ''} waiting to sync.` : 'Ready.';
  }
}
function renderAccount() {
  const configured = isConfigured();
  $('#btn-account').hidden = !configured;
  $('#btn-review').hidden = !isAdmin();
  $('#acct-review').hidden = !isAdmin();
  $('#signin-banner').hidden = !configured || !!auth.user || !!settings.signinBannerDismissed || currentView !== 'home';
  if (!configured) return;
  const av = $('#acct-avatar');
  if (auth.user) {
    av.textContent = initials(auth);
    $('#acct-label').textContent = (auth.profile && auth.profile.display_name) || auth.user.email.split('@')[0];
    $('#sync-dot').dataset.s = sync.status;
    $('#btn-account').title = syncText();
  } else {
    av.innerHTML = '<svg class="ic sm"><use href="#i-user"/></svg>';
    $('#acct-label').textContent = 'Sign in';
    $('#sync-dot').dataset.s = '';
  }
  if ($('#dlg-account').open) $('#acct-sync').textContent = syncText();
}

// Sign-in screen
let siEmail = '';
let returnView = 'home';
function siStep(step) {
  ['si-email-form', 'si-pw-form', 'si-sent'].forEach(id => { $('#' + id).hidden = id !== step; });
  $('#si-title').textContent = step === 'si-sent' ? 'Check your email' : 'Sign in';
  $('#si-sub').hidden = step === 'si-sent';
  siStatus('');
}
function siStatus(msg, kind = '') { const el = $('#si-status'); el.textContent = msg; el.className = 'status-line si-status ' + kind; }
function openSignIn() {
  if (!isConfigured()) { toast('Accounts aren’t set up yet.'); return; }
  returnView = currentView === 'signin' ? 'home' : currentView;
  siStep('si-email-form');
  if (siEmail) $('#si-email').value = siEmail;
  show('signin');
  setTimeout(() => $('#si-email').focus(), 60);
}
async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { siStatus(e.message, 'err'); } finally { btn.disabled = false; }
}
$('#si-email-form').addEventListener('submit', e => {
  e.preventDefault();
  const email = $('#si-email').value.trim();
  if (!email) return;
  busy($('#si-send'), async () => {
    siStatus('Sending…');
    await sendMagicLink(email);
    siEmail = email; $('#si-sent-email').textContent = email; $('#si-code').value = '';
    siStep('si-sent');
  });
});
$('#si-sent').addEventListener('submit', e => {
  e.preventDefault();
  const code = $('#si-code').value.trim();
  if (code.replace(/\D/g, '').length < 6) { siStatus('Type the 6-digit code from the email.', 'err'); return; }
  busy($('#si-verify'), async () => { siStatus('Signing in…'); await verifyCode(siEmail, code); });
});
$('#si-resend').addEventListener('click', e => busy(e.currentTarget, async () => { await sendMagicLink(siEmail); siStatus('Sent again. Check your inbox (and spam folder).', 'ok'); }));
$('#si-other').addEventListener('click', () => siStep('si-email-form'));
$('#si-use-pw').addEventListener('click', () => { siStep('si-pw-form'); $('#si-pw-email').value = $('#si-email').value; setTimeout(() => $(($('#si-pw-email').value ? '#si-pw' : '#si-pw-email')).focus(), 50); });
$('#si-use-link').addEventListener('click', () => { siStep('si-email-form'); $('#si-email').value = $('#si-pw-email').value; });
$('#si-pw-form').addEventListener('submit', e => {
  e.preventDefault();
  busy($('#si-pw-signin'), async () => { siStatus('Signing in…'); await signInPassword($('#si-pw-email').value.trim(), $('#si-pw').value); });
});
$('#si-pw-create').addEventListener('click', e => {
  const email = $('#si-pw-email').value.trim(), pw = $('#si-pw').value;
  if (!email || pw.length < 8) { siStatus('Enter your email and a password of at least 8 characters.', 'err'); return; }
  busy(e.currentTarget, async () => {
    const data = await signUpPassword(email, pw);
    if (!data || !data.session) { siEmail = email; siStatus('Almost done! Check your email to confirm your account, then sign in.', 'ok'); }
  });
});
$('#si-back').addEventListener('click', () => show(returnView === 'signin' ? 'home' : returnView));
$('#si-skip').addEventListener('click', () => { settings.signinBannerDismissed = true; saveSettings(); show('home'); });
$('#banner-signin').addEventListener('click', openSignIn);
$('#banner-later').addEventListener('click', () => { settings.signinBannerDismissed = true; saveSettings(); renderAccount(); });

// Account dialog
$('#btn-account').addEventListener('click', () => {
  if (!auth.user) { openSignIn(); return; }
  $('#acct-big-avatar').textContent = initials(auth);
  $('#acct-email').textContent = auth.user.email;
  const role = (auth.profile && auth.profile.role) || 'preacher';
  $('#acct-role').textContent = role === 'admin' ? 'Admin' : 'Preacher';
  $('#acct-role').className = 'badge' + (role === 'admin' ? ' admin' : '');
  $('#acct-name').value = (auth.profile && auth.profile.display_name) || '';
  $('#acct-wipe').checked = false;
  $('#acct-sync').textContent = syncText();
  $('#dlg-account').showModal();
});
$('#acct-name').addEventListener('change', async e => {
  const name = e.target.value.trim();
  try { await updateDisplayName(name); if (!settings.speakerName) { settings.speakerName = name; saveSettings(); } renderAccount(); toast('Name saved'); }
  catch (err) { toast(err.message, 4000); }
});
$('#acct-sync-now').addEventListener('click', async () => { $('#acct-sync').textContent = 'Syncing…'; await sync.syncNow(); $('#acct-sync').textContent = syncText(); });
$('#acct-signout').addEventListener('click', async () => {
  const uid = auth.user && auth.user.id;
  if (sync.pending() && navigator.onLine) await sync.syncNow();
  if (sync.pending() && !(await confirmDlg('Some changes haven’t synced yet. Sign out anyway? They stay on this device.', 'Sign out'))) return;
  const wipe = $('#acct-wipe').checked;
  $('#dlg-account').close();
  await signOut();
  if (wipe && uid) removeOwnedBy(uid);
  renderHome();
  toast('Signed out');
});

onAuth(event => {
  if (event === 'signed-in') {
    toast('Signed in as ' + auth.user.email);
    if (!settings.speakerName && auth.profile && auth.profile.display_name) { settings.speakerName = auth.profile.display_name; saveSettings(); }
    if (currentView === 'signin') show(returnView === 'signin' ? 'home' : returnView);
    sync.syncNow();
  } else if (event === 'signed-out') {
    sync.status = 'signed-out';
  } else if ((event === 'ready' || event === 'refreshed') && auth.user) {
    sync.syncNow();
  }
  if (currentView === 'home') renderHome(); else renderAccount();
});
window.addEventListener('online', () => { if (auth.user) sync.syncNow(); });
window.addEventListener('offline', () => { if (auth.user) { sync.status = 'offline'; renderAccount(); } });
setInterval(() => { if (auth.user && document.visibilityState === 'visible' && currentView !== 'edit') sync.syncNow(); }, 60_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && auth.user) sync.schedule(800); });

// ---------------------------------------------------------------- init
applyAppearance();
renderTimerControls();
renderRecButton();
recoverOrphans().then(n => { if (n) { toast(`Recovered ${n} unfinished recording${n > 1 ? 's' : ''}.`, 4000); if (currentView === 'home') renderRecordings(); } }).catch(() => {});
show('home');
if (isConfigured()) {
  initAuth();
  if (location.hash === '#signin') { history.replaceState(null, '', location.pathname); openSignIn(); }
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW failed', e)));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// Expose a tiny hook for automated tests / debugging.
window.__preach = { get paginator() { return paginator; }, timer, recorder, settings, state, enterPreach, sync, auth, VERSION };
