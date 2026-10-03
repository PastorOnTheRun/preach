// Renders AI sermon feedback (recordings.grade_json written by the grade-recording Edge Function).
// Shared by the preacher's "Your feedback" dialog (app.js) and Jake's review page (review.js).
// All text is inserted with textContent, never as HTML.

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clock = s => { s = Math.max(0, Math.round(s || 0)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };

export function parseGrade(g) {
  if (typeof g === 'string') { try { return JSON.parse(g); } catch { return null; } }
  return g && typeof g === 'object' ? g : null;
}

/** True when grade_json has the Phase 2 shape (criteria with notes, strengths, growth areas). */
export const isAiGrade = g => !!(g && Array.isArray(g.criteria) && (Array.isArray(g.strengths) || Array.isArray(g.growth_areas)));

export function timingLine(t) {
  if (!t) return '';
  const parts = [];
  if (t.actual_seconds != null) parts.push(`${clock(t.actual_seconds)} preached`);
  if (t.planned_minutes != null) parts.push(`${t.planned_minutes} min planned`);
  if (t.overtime_seconds > 0) parts.push(`${clock(t.overtime_seconds)} over`); else if (t.overtime_seconds === 0) parts.push('on time');
  if (t.wpm) parts.push(`${t.wpm} words/min`);
  return parts.join(' · ');
}

/**
 * Build the feedback view.
 * @param {object} g        grade_json
 * @param {object} opts     { summary, question, showSummary = true }
 */
export function renderFeedback(g, { summary = '', question = '', showSummary = true } = {}) {
  g = parseGrade(g) || {};
  const root = el('div', 'fb-view');
  const head = el('div', 'fb-head');
  const badge = el('div', 'grade-overall', g.overall ?? '–'); badge.dataset.grade = g.overall ?? '';
  head.appendChild(badge);
  const meta = el('div', 'fb-meta');
  if (g.average != null) meta.appendChild(el('div', 'fb-avg', `Average ${g.average} / 10`));
  const tl = timingLine(g.timing); if (tl) meta.appendChild(el('div', 'fb-timing', tl));
  head.appendChild(meta);
  root.appendChild(head);

  const section = (title, cls) => { const s = el('section', cls); s.appendChild(el('h4', null, title)); root.appendChild(s); return s; };
  if (showSummary && summary) section('Summary', 'fb-summary').appendChild(el('p', 'fb-text', summary));

  if (Array.isArray(g.criteria) && g.criteria.length) {
    const s = section('Grades', 'fb-grades');
    const table = el('table', 'grade-table');
    const hr = el('tr'); ['Area', 'Score', 'Notes'].forEach(h => hr.appendChild(el('th', null, h))); table.appendChild(hr);
    for (const c of g.criteria) {
      const tr = el('tr');
      tr.appendChild(el('td', 'fb-area', c.name || c.key || ''));
      tr.appendChild(el('td', 'fb-score', c.score == null ? '–' : `${c.score}/${c.max || 10}`));
      tr.appendChild(el('td', 'fb-notes', c.comment || c.notes || ''));
      table.appendChild(tr);
    }
    s.appendChild(table);
  }
  const list = (title, items, cls) => {
    if (!Array.isArray(items) || !items.length) return;
    const ul = el('ul', 'fb-list'); items.forEach(t => ul.appendChild(el('li', null, t)));
    section(title, cls).appendChild(ul);
  };
  list('Strengths', g.strengths, 'fb-strengths');
  list('Growth areas', g.growth_areas, 'fb-growth');
  if (question && g.answer_to_question) {
    const s = section('Your question', 'fb-answer');
    s.appendChild(el('p', 'fb-question', `“${question}”`));
    s.appendChild(el('p', 'fb-text', g.answer_to_question));
  }
  if (g.model) root.appendChild(el('p', 'fb-foot', `AI feedback (${g.model}) from an automatic transcript. Use it as a conversation starter, not a verdict.`));
  return root;
}

/** One-line status for lists: { label, state } where state ∈ waiting | graded | error. */
export function feedbackStatus(row) {
  if (!row) return null;
  const g = parseGrade(row.grade_json);
  if (row.status === 'graded') return { state: 'graded', label: g?.overall ? `Grade ${g.overall}` : 'Feedback ready' };
  if (row.status === 'error') return { state: 'error', label: 'Feedback failed' };
  return { state: 'waiting', label: row.status === 'processing' ? 'Feedback on its way…' : 'Waiting for feedback…' };
}
