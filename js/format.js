// Turning pasted / imported content into clean, safe sermon HTML.
// Allowed output: h1-h3, p, strong, em, u, ul, ol, li, blockquote, hr, br.
import { escapeHtml } from './util.js';

const BLOCK_MAP = { H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3', P: 'p', DIV: 'p', LI: 'li', UL: 'ul', OL: 'ol', BLOCKQUOTE: 'blockquote', PRE: 'p', SECTION: 'p', ARTICLE: 'p', TR: 'p' };
const INLINE_MAP = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', U: 'u', CITE: 'em', MARK: 'strong' };
const DROP = new Set(['SCRIPT', 'STYLE', 'IMG', 'SVG', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'CANVAS']);

/** Sanitize arbitrary HTML (Word / Google Docs / Pages paste, mammoth output) to our small allowlist. */
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const out = document.createElement('div');
  walk(doc.body, out);
  return tidy(out);
}

function styleFlags(el) {
  const st = (el.getAttribute && el.getAttribute('style')) || '';
  const fw = /font-weight\s*:\s*(bold|[6-9]00)/i.test(st);
  const fwNormal = /font-weight\s*:\s*(normal|[1-4]00)/i.test(st);
  const it = /font-style\s*:\s*italic/i.test(st);
  const un = /text-decoration[^;]*underline/i.test(st);
  return { fw, fwNormal, it, un };
}

function walk(src, dest) {
  for (const node of Array.from(src.childNodes)) {
    if (node.nodeType === 3) { dest.appendChild(document.createTextNode(node.nodeValue)); continue; }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName;
    if (DROP.has(tag)) continue;
    if (tag === 'BR') { dest.appendChild(document.createElement('br')); continue; }
    if (tag === 'HR') { dest.appendChild(document.createElement('hr')); continue; }
    const f = styleFlags(node);
    let target = dest;
    let el = null;
    if (BLOCK_MAP[tag]) {
      el = document.createElement(BLOCK_MAP[tag]);
    } else if (INLINE_MAP[tag]) {
      // Google Docs wraps everything in <b style="font-weight:normal">; don't bold it.
      if (!(tag === 'B' && f.fwNormal)) el = document.createElement(INLINE_MAP[tag]);
    }
    if (el) { dest.appendChild(el); target = el; }
    // Span-level styling (Google Docs / Pages use styled spans instead of <b>/<i>).
    if (!el || !INLINE_MAP[tag]) {
      if (f.fw && !closest(target, 'STRONG')) { const s = document.createElement('strong'); target.appendChild(s); target = s; }
      if (f.it && !closest(target, 'EM')) { const s = document.createElement('em'); target.appendChild(s); target = s; }
      if (f.un && !closest(target, 'U')) { const s = document.createElement('u'); target.appendChild(s); target = s; }
    }
    walk(node, target);
  }
}
function closest(el, tag) { for (let n = el; n; n = n.parentNode) if (n.tagName === tag) return true; return false; }

/** Normalise structure: no nested blocks inside p, wrap stray inline content, drop empties. */
function tidy(root) {
  // Unwrap p/blockquote nested inside p or li (common from Word paste).
  root.querySelectorAll('p p, li p, p h1, p h2, p h3, p ul, p ol, h1 p, h2 p, h3 p').forEach(inner => {
    const outer = inner.parentNode;
    if (outer.tagName === 'LI' && inner.tagName === 'P') { unwrap(inner); return; }
    if (outer.tagName === 'P') { outer.parentNode.insertBefore(inner, outer.nextSibling); }
    else unwrap(inner);
  });
  // Lists: li must be in ul/ol.
  root.querySelectorAll('li').forEach(li => {
    if (!/^(UL|OL)$/.test(li.parentNode.tagName)) {
      const ul = document.createElement('ul'); li.parentNode.insertBefore(ul, li); ul.appendChild(li);
    }
  });
  // Wrap top-level inline runs into <p>, splitting on <br><br>.
  const frag = document.createElement('div');
  let p = null;
  for (const n of Array.from(root.childNodes)) {
    const isBlock = n.nodeType === 1 && /^(H1|H2|H3|P|UL|OL|BLOCKQUOTE|HR)$/.test(n.tagName);
    if (isBlock) { p = null; frag.appendChild(n); continue; }
    if (n.nodeType === 1 && n.tagName === 'BR') { if (p && p.lastChild && p.lastChild.tagName === 'BR') { p.lastChild.remove(); p = null; } else if (p) p.appendChild(n); continue; }
    if (!p) { p = document.createElement('p'); frag.appendChild(p); }
    p.appendChild(n);
  }
  // Collapse whitespace-only blocks, trailing <br>s, and empty inline wrappers.
  frag.querySelectorAll('strong, em, u').forEach(e => { if (!e.textContent.trim() && !e.querySelector('br')) unwrap(e); });
  frag.querySelectorAll('p, h1, h2, h3, li, blockquote').forEach(b => {
    while (b.lastChild && b.lastChild.nodeName === 'BR') b.lastChild.remove();
    if (!b.textContent.trim()) b.remove();
  });
  frag.querySelectorAll('ul, ol').forEach(l => { if (!l.querySelector('li')) l.remove(); });
  let html = frag.innerHTML.replace(/\u00a0/g, ' ').replace(/[ \t]{2,}/g, ' ');
  return html.trim();
}
function unwrap(el) { const parent = el.parentNode; while (el.firstChild) parent.insertBefore(el.firstChild, el); el.remove(); }

/** Inline Markdown: **bold**, __bold__, *italic*, _italic_. Input already HTML-escaped. */
function inlineMd(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[\s(“"'])\*(\S(?:[^*]*?\S)?)\*(?=[\s).,;:!?”"']|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(“"'])_(\S(?:[^_]*?\S)?)_(?=[\s).,;:!?”"']|$)/g, '$1<em>$2</em>');
}

/**
 * Plain text / Markdown to HTML. Every non-empty line becomes its own block,
 * because sermon notes rely on line breaks. Supports #/##/### headings, - * • lists,
 * 1. lists, > quotes, --- rules, and short ALL-CAPS lines as headings.
 */
export function textToHtml(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { closeList(); continue; }
    let m;
    if ((m = line.match(/^\s*(#{1,6})\s+(.*)$/))) {
      closeList(); const lvl = Math.min(3, m[1].length);
      out.push(`<h${lvl}>${inlineMd(escapeHtml(m[2]))}</h${lvl}>`); continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    if ((m = line.match(/^\s*[-*•●◦▪–]\s+(.*)$/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inlineMd(escapeHtml(m[1]))}</li>`); continue;
    }
    if ((m = line.match(/^\s*(\d{1,3})[.)]\s+(.*)$/))) {
      if (list !== 'ol') { closeList(); out.push(m[1] === '1' ? '<ol>' : `<ol start="${m[1]}">`); list = 'ol'; }
      out.push(`<li>${inlineMd(escapeHtml(m[2]))}</li>`); continue;
    }
    closeList();
    if ((m = line.match(/^\s*>\s?(.*)$/))) { out.push(`<blockquote>${inlineMd(escapeHtml(m[1]))}</blockquote>`); continue; }
    const t = line.trim();
    if (t.length <= 60 && /[A-Z]{3}/.test(t) && t === t.toUpperCase() && !/[.!?,;]$/.test(t) && /^[^a-z]*$/.test(t)) {
      out.push(`<h2>${escapeHtml(t)}</h2>`); continue;
    }
    out.push(`<p>${inlineMd(escapeHtml(t))}</p>`);
  }
  closeList();
  return out.join('\n');
}

export function htmlToPlain(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  d.querySelectorAll('p, h1, h2, h3, li, blockquote, br').forEach(e => e.insertAdjacentText('afterend', '\n'));
  return d.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

export function wordCount(html) {
  const t = htmlToPlain(html);
  const m = t.match(/[\p{L}\p{N}’']+/gu);
  return m ? m.length : 0;
}

/** Guess a title from the first heading / first line. */
export function guessTitle(html, fallback = 'Untitled sermon') {
  const d = document.createElement('div'); d.innerHTML = html;
  const h = d.querySelector('h1, h2, h3');
  const first = (h || d.querySelector('p, li'));
  const t = first ? first.textContent.trim() : '';
  return t ? t.slice(0, 80) : fallback;
}

/** Load mammoth.js lazily (bundled in /vendor, cached by the service worker). */
let mammothPromise;
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  mammothPromise = mammothPromise || new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/mammoth.browser.min.js';
    s.onload = () => res(window.mammoth);
    s.onerror = () => { mammothPromise = null; rej(new Error('Could not load the Word reader.')); };
    document.head.appendChild(s);
  });
  return mammothPromise;
}

/** Read a File (.docx/.txt/.md) into { title, html }. */
export async function importFile(file) {
  const name = file.name || 'sermon';
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  if (ext === 'docx' || /wordprocessingml/.test(file.type)) {
    const mammoth = await loadMammoth();
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer }, {
      styleMap: ['p[style-name=\'Title\'] => h1:fresh', 'p[style-name=\'Subtitle\'] => h2:fresh', 'u => u'],
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' }))
    });
    return { title: base, html: sanitizeHtml(result.value) };
  }
  if (ext === 'doc') throw new Error('Old .doc files aren’t supported. In Word, choose File › Save As › .docx, then open that.');
  if (ext === 'pages') throw new Error('Pages files aren’t supported. In Pages, choose File › Export To › Word (.docx), then open that.');
  const text = await file.text();
  return { title: base, html: textToHtml(text) };
}
