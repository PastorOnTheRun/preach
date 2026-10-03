// Big-screen slides, generated automatically from a sermon.
// Each heading, each highlighted passage and each blockquote becomes one slide:
//   - headings: <h1>/<h2>/<h3>
//   - highlights: <mark> (from .docx highlights via mammoth, our ==marked== syntax, or the editor),
//     pasted Word / Google Docs highlight spans (background-color / mso-highlight) and raw ==text==
//   - quotes: <blockquote> (except stage notes: "Note: …", "Pause …", "[…]")
// The sermon title is the first slide. Verse slides (CSB text) are created on demand from the verse popup.
// Only these short pieces ever go to the projector: never the manuscript body, notes or timer.

const WS = /\s+/g;
const clean = s => String(s || '').replace(WS, ' ').trim();
const BLOCKS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'DIV', 'TD', 'UL', 'OL', 'SECTION', 'ARTICLE']);
const MARKED = /==([^=\n][^\n]*?)==/g;

/** True for a real highlight colour (not white / transparent / inherit). */
export function isHighlightColor(v) {
  v = String(v || '').trim().toLowerCase();
  if (!v || /^(transparent|none|inherit|initial|unset|white|auto|window|#fff|#ffffff|#fefefe)$/.test(v)) return false;
  let m = v.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    if (a === 0) return false;
    if (+m[1] > 245 && +m[2] > 245 && +m[3] > 245) return false;
  }
  return true;
}

/** Highlight colour from an inline style ("background-color", "background", "mso-highlight"), or null. */
export function highlightFromStyle(style) {
  const st = String(style || '');
  const pick = re => { const m = st.match(re); return m ? m[1].trim() : null; };
  const mso = pick(/mso-highlight\s*:\s*([^;]+)/i);
  if (mso && isHighlightColor(mso)) return mso;
  const bg = pick(/background-color\s*:\s*([^;]+)/i) || pick(/(?:^|;)\s*background\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)(?=\s|;|$)/i);
  return bg && isHighlightColor(bg) ? bg : null;
}

/** Is this element (inline) a highlight? */
export function isHighlightEl(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.tagName === 'MARK') return true;
  if (BLOCKS.has(el.tagName)) return false;              // page/cell shading is not a highlight
  return !!highlightFromStyle(el.getAttribute('style'));
}

function blockOf(node, root) {
  for (let n = node.nodeType === 1 ? node : node.parentNode; n && n !== root; n = n.parentNode) if (BLOCKS.has(n.tagName) && n.tagName !== 'UL' && n.tagName !== 'OL') return n;
  return root;
}
function inside(node, tagRe, root) {
  for (let n = node.nodeType === 1 ? node : node.parentNode; n && n !== root; n = n.parentNode) if (tagRe.test(n.tagName)) return n;
  return null;
}
function firstText(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => /\S/.test(n.nodeValue) ? 1 : 3 });
  return w.nextNode();
}

/**
 * Extract slides from a DOM subtree (the rendered preach flow, or a detached div).
 * Returns [{ id, kind: 'title'|'heading'|'quote'|'highlight', text, node, offset }], in reading order.
 * `node`/`offset` locate the slide's first character so callers can map it to a page.
 */
export function extractSlides(root, { title = '' } = {}) {
  const slides = [];
  const push = (kind, text, node, offset = 0) => {
    text = clean(text);
    if (!text) return;
    const prev = slides[slides.length - 1];
    if (prev && prev.kind === kind && prev.text === text) return;
    slides.push({ kind, text, node, offset });
  };
  if (clean(title)) slides.push({ kind: 'title', text: clean(title), node: null, offset: 0 });

  // Walk elements + text in document order.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let hl = null; // current highlight run { block, parts: [], node }
  const flush = () => { if (hl) { push('highlight', hl.parts.join(''), hl.node, hl.offset); hl = null; } };
  const done = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 1) {
      if (/^H[1-6]$/.test(n.tagName)) { flush(); push('heading', n.textContent, firstText(n)); done.add(n); continue; }
      if (n.tagName === 'BLOCKQUOTE' && !inside(n.parentNode, /^BLOCKQUOTE$/, root)) {
        flush();
        const t = clean(n.textContent.replace(MARKED, '$1'));
        if (!isNote(t)) push('quote', t, firstText(n));
        done.add(n); continue;
      }
      if (n.classList && n.classList.contains('end-mark')) { flush(); break; }
      continue;
    }
    // Text node
    const val = n.nodeValue;
    if (!/\S/.test(val) && !hl) continue;
    if (inside(n, /^(H[1-6]|BLOCKQUOTE)$/, root)) continue; // already a heading/quote slide
    let hlEl = null;
    for (let p = n.parentNode; p && p !== root && !BLOCKS.has(p.tagName); p = p.parentNode) if (isHighlightEl(p)) { hlEl = p; break; }
    const block = blockOf(n, root);
    if (hlEl) {
      if (hl && hl.block !== block) flush();
      if (!hl) hl = { block, parts: [], node: n, offset: 0 };
      hl.parts.push(val);
      continue;
    }
    // Not highlighted: whitespace between two highlight runs in the same block keeps the run going.
    if (hl && hl.block === block && !/\S/.test(val)) { hl.parts.push(val); continue; }
    flush();
    // ==marked== text typed directly.
    MARKED.lastIndex = 0; let m;
    while ((m = MARKED.exec(val))) push('highlight', m[1], n, m.index + 2);
  }
  flush();
  return slides.map((s, i) => ({ ...s, id: `${s.kind[0]}${i}-${hash(s.text)}` }));
}

/** Blockquotes some preachers use for stage notes ("Note: …", "[pause]") never go to the screen. */
export function isNote(t) { return /^\s*(\[|\(|notes?\b|reminder\b|pause\b|stage\b|tip\b|todo\b)/i.test(t); }

/** Convenience for tests / non-DOM callers: slides from an HTML string. */
export function slidesFromHtml(html, opts) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return extractSlides(div, opts).map(({ node, offset, ...s }) => s);
}

/** Only the fields that may be sent to the projector. */
export function publicSlide(s) {
  if (!s) return null;
  const out = { id: s.id, kind: s.kind, text: s.text };
  if (s.cite) out.cite = s.cite;
  if (s.copyright) out.copyright = s.copyright;
  return out;
}

export const CSB_NOTICE = 'Scripture quotations marked CSB have been taken from the Christian Standard Bible®, Copyright © 2017 by Holman Bible Publishers. Used by permission. Christian Standard Bible® and CSB® are federally registered trademarks of Holman Bible Publishers.';

/** A verse slide from a fetched CSB passage ({ html, reference, copyright }). */
export function verseSlide(passage) {
  const div = document.createElement('div');
  div.innerHTML = passage.html || '';
  const sups = div.querySelectorAll('sup');
  if (sups.length === 1) sups[0].remove();                       // single verse: no verse number
  else sups.forEach(s => { s.textContent = s.textContent.trim() + '\u2009'; });
  const text = clean(div.textContent);
  const cite = clean(passage.reference) + ' CSB';
  return { id: 'v-' + hash(cite + text), kind: 'verse', text, cite, copyright: clean(passage.copyright) || CSB_NOTICE };
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
