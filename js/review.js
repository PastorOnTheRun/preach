// Admin review page: every preacher's sermons and recordings (RLS: admins can read all).
import { $, $$, fmtClock, fmtDate, escapeHtml, toast } from './util.js';
import { isConfigured, initAuth, auth, isAdmin, admin } from './cloud.js';
import { sanitizeHtml, wordCount } from './format.js';

let profiles = [], sermons = [], recordings = [];
let tab = 'recordings';
const byId = id => profiles.find(p => p.id === id);
const nameOf = id => { const p = byId(id); return p ? (p.display_name || p.email || 'Unknown') : 'Unknown preacher'; };

function message(icon, title, html) {
  $('#rv-main').hidden = true;
  const m = $('#rv-msg');
  m.hidden = false;
  m.innerHTML = `<svg class="ic lg" style="width:44px;height:44px;color:var(--accent)"><use href="#i-${icon}"/></svg><h2></h2><p class="muted">${html}</p>`;
  $('h2', m).textContent = title;
}

async function start() {
  if (!isConfigured()) {
    message('lock', 'Accounts aren’t set up yet', 'Add the Supabase URL and anon key to <code>config.js</code> (see SETUP.md), then reload.');
    return;
  }
  await initAuth();
  if (!auth.user) {
    message('lock', 'Please sign in', 'This page is for the teaching team admin.<br><br><a class="btn primary xl" href="./#signin">Sign in</a>');
    return;
  }
  if (!isAdmin()) {
    message('lock', 'Admins only', `You’re signed in as ${escapeHtml(auth.user.email)}, which isn’t an admin account. Ask Jake if you need access.`);
    return;
  }
  $('#rv-who').textContent = 'Signed in as ' + auth.user.email;
  $('#rv-msg').hidden = true;
  $('#rv-main').hidden = false;
  await load();
}

async function load() {
  $('#rv-list').innerHTML = '<div class="spinner"></div>';
  try {
    [profiles, sermons, recordings] = await Promise.all([admin.profiles(), admin.sermons(), admin.recordings()]);
  } catch (e) {
    $('#rv-list').innerHTML = '';
    toast('Couldn’t load: ' + e.message, 5000);
    return;
  }
  profiles = profiles || []; sermons = sermons || []; recordings = recordings || [];
  const sel = $('#rv-preacher');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All preachers</option>' + profiles
    .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.display_name || p.email || p.id)}${p.role === 'admin' ? ' (admin)' : ''}</option>`).join('');
  sel.value = cur;
  render();
}

function render() {
  const who = $('#rv-preacher').value;
  const recs = recordings.filter(r => !who || r.user_id === who);
  const sers = sermons.filter(s => !who || s.user_id === who);
  $('#rv-nrec').textContent = `(${recs.length})`;
  $('#rv-nser').textContent = `(${sers.length})`;
  $$('#rv-tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  const ul = $('#rv-list');
  ul.innerHTML = '';
  const items = tab === 'recordings' ? recs : sers;
  $('#rv-empty').hidden = items.length > 0;
  $('#rv-empty').textContent = tab === 'recordings' ? 'No recordings have been sent yet.' : 'No sermons yet.';
  items.forEach(it => ul.appendChild(tab === 'recordings' ? recordingItem(it) : sermonItem(it)));
}

function sermonItem(s) {
  const li = document.createElement('li');
  li.className = 'rv-item';
  li.innerHTML = `<button class="rv-row"><div class="grow"><div class="rv-title"></div><div class="rv-sub"></div></div><svg class="ic"><use href="#i-right"/></svg></button>`;
  $('.rv-title', li).textContent = s.title || 'Untitled sermon';
  const mins = s.timer_settings && s.timer_settings.minutes;
  $('.rv-sub', li).textContent = `${nameOf(s.user_id)} · updated ${fmtDate(s.updated_at)}` + (mins ? ` · ${mins}-min timer` : '');
  $('.rv-row', li).addEventListener('click', () => openSermon(s.id));
  return li;
}

async function openSermon(id) {
  const d = $('#dlg-sermon');
  $('#sv-title').textContent = 'Loading…'; $('#sv-meta').textContent = ''; $('#sv-body').innerHTML = '<div class="spinner"></div>';
  d.showModal();
  try {
    const s = await admin.sermon(id);
    const html = sanitizeHtml(s.content_html || '');
    $('#sv-title').textContent = s.title || 'Untitled sermon';
    const w = wordCount(html);
    $('#sv-meta').textContent = `${nameOf(s.user_id)} · ${w.toLocaleString()} words (~${Math.max(1, Math.round(w / 130))} min) · updated ${fmtDate(s.updated_at)} · read-only`;
    $('#sv-body').innerHTML = html || '<p class="rv-empty">This sermon is empty.</p>';
  } catch (e) {
    $('#sv-title').textContent = 'Couldn’t open sermon'; $('#sv-body').textContent = e.message;
  }
}

function recordingItem(r) {
  const li = document.createElement('li');
  li.className = 'rv-item';
  li.innerHTML = `<button class="rv-row" aria-expanded="false"><div class="grow"><div class="rv-title"></div><div class="rv-sub"></div></div><span class="status-badge"></span></button>`;
  $('.rv-title', li).textContent = r.sermon_title || 'Sermon recording';
  const over = r.overtime_seconds > 0 ? ` · <span class="rv-over">+${fmtClock(r.overtime_seconds)} over</span>` : '';
  $('.rv-sub', li).innerHTML = `${escapeHtml(nameOf(r.user_id))} · ${escapeHtml(fmtDate(r.created_at))} · ${fmtClock(r.duration || 0)}${r.timer_minutes ? ` of ${r.timer_minutes} min` : ''}${over}`;
  const badge = $('.status-badge', li); badge.textContent = r.status || 'uploaded'; badge.dataset.s = r.status || 'uploaded';
  const row = $('.rv-row', li);
  row.addEventListener('click', () => {
    const open = row.getAttribute('aria-expanded') === 'true';
    row.setAttribute('aria-expanded', String(!open));
    const existing = $('.rv-detail', li);
    if (open) { existing && existing.remove(); return; }
    li.appendChild(recordingDetail(r));
  });
  return li;
}

function textBlock(title, text, emptyMsg) {
  const sec = document.createElement('section');
  sec.innerHTML = `<h4></h4>`;
  $('h4', sec).textContent = title;
  const body = document.createElement('div');
  if (text) { body.className = 'rv-text'; body.textContent = text; } else { body.className = 'rv-empty'; body.textContent = emptyMsg; }
  sec.appendChild(body);
  return sec;
}

/** Render grade_json flexibly: { overall|grade|score, criteria: [{name, score, max, comment}] | {k: v}, ... } */
function gradeBlock(g) {
  const sec = document.createElement('section');
  sec.innerHTML = '<h4>Grade</h4>';
  if (!g || (typeof g === 'object' && !Object.keys(g).length)) {
    sec.insertAdjacentHTML('beforeend', '<div class="rv-empty">Not graded yet (Phase 2).</div>'); return sec;
  }
  if (typeof g === 'string') { try { g = JSON.parse(g); } catch { sec.appendChild(textBlock('', g, '')); return sec; } }
  const overall = g.overall ?? g.grade ?? g.score ?? g.overall_grade;
  if (overall != null) { const o = document.createElement('div'); o.className = 'grade-overall'; o.textContent = String(overall) + (g.max ? ` / ${g.max}` : ''); sec.appendChild(o); }
  const crit = g.criteria || g.rubric || g.scores;
  const table = document.createElement('table'); table.className = 'grade-table';
  const rows = [];
  if (Array.isArray(crit)) crit.forEach(c => rows.push([c.name || c.criterion || '', c.score != null ? `${c.score}${c.max ? ' / ' + c.max : ''}` : '', c.comment || c.notes || '']));
  else if (crit && typeof crit === 'object') Object.entries(crit).forEach(([k, v]) => rows.push([k, typeof v === 'object' ? (v.score ?? JSON.stringify(v)) : v, typeof v === 'object' ? (v.comment || '') : '']));
  Object.entries(g).forEach(([k, v]) => {
    if (['overall', 'grade', 'score', 'overall_grade', 'max', 'criteria', 'rubric', 'scores'].includes(k)) return;
    rows.push([k.replace(/_/g, ' '), typeof v === 'object' ? JSON.stringify(v) : String(v), '']);
  });
  if (rows.length) {
    table.innerHTML = '<tr><th>Area</th><th>Score</th><th>Notes</th></tr>';
    rows.forEach(r => { const tr = document.createElement('tr'); r.forEach(c => { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); }); table.appendChild(tr); });
    sec.appendChild(table);
  }
  return sec;
}

function recordingDetail(r) {
  const d = document.createElement('div');
  d.className = 'rv-detail';
  const player = document.createElement('section');
  player.innerHTML = '<h4>Recording</h4><div class="muted">Loading audio…</div>';
  d.appendChild(player);
  admin.signedUrl(r.storage_path).then(url => {
    player.innerHTML = '<h4>Recording</h4>';
    const a = document.createElement('audio'); a.controls = true; a.preload = 'metadata'; a.src = url; a.style.width = '100%';
    player.appendChild(a);
  }).catch(e => { player.innerHTML = '<h4>Recording</h4>'; player.insertAdjacentText('beforeend', 'Couldn’t load audio: ' + e.message); });
  if (r.notes) d.appendChild(textBlock('Preacher’s question', r.notes, ''));
  d.appendChild(textBlock('Summary', r.summary, 'No summary yet (Phase 2).'));
  d.appendChild(gradeBlock(r.grade_json));
  d.appendChild(textBlock('Transcript', r.transcript, 'No transcript yet (Phase 2).'));
  if (r.sermon_id && sermons.some(s => s.id === r.sermon_id)) {
    const b = document.createElement('button'); b.className = 'btn'; b.innerHTML = '<svg class="ic sm"><use href="#i-book"/></svg>Open sermon manuscript';
    b.addEventListener('click', () => openSermon(r.sermon_id));
    d.appendChild(b);
  }
  return d;
}

$('#rv-preacher').addEventListener('change', render);
$('#rv-tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; render(); } });
$('#rv-refresh').addEventListener('click', load);
$$('dialog').forEach(d => d.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) d.close();
  else if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); }
}));
start();
window.__review = { load, get data() { return { profiles, sermons, recordings }; } };
