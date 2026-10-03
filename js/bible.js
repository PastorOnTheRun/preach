// Bible reference detection + CSB passage lookup (API.Bible) with BibleGateway (CSB) fallback.
// We NEVER show any translation other than CSB, and never ship or fabricate verse text.

export const CSB_BIBLE_ID = 'a556c5305ee15c3f-01'; // Christian Standard Bible on API.Bible
const API_BASE = 'https://rest.api.bible/v1';

// [USFM code, display name, chapter count, aliases (| separated), number prefix or 0]
const BOOKS = [
  ['GEN', 'Genesis', 50, 'Genesis|Gen|Gn|Ge'], ['EXO', 'Exodus', 40, 'Exodus|Exod|Exo|Ex'],
  ['LEV', 'Leviticus', 27, 'Leviticus|Lev|Lv'], ['NUM', 'Numbers', 36, 'Numbers|Numb|Num|Nm'],
  ['DEU', 'Deuteronomy', 34, 'Deuteronomy|Deut|Deu|Dt'], ['JOS', 'Joshua', 24, 'Joshua|Josh|Jos'],
  ['JDG', 'Judges', 21, 'Judges|Judg|Jdg'], ['RUT', 'Ruth', 4, 'Ruth|Rth'],
  ['1SA', '1 Samuel', 31, 'Samuel|Sam|Sm', 1], ['2SA', '2 Samuel', 24, 'Samuel|Sam|Sm', 2],
  ['1KI', '1 Kings', 22, 'Kings|Kgs|Kin|Ki', 1], ['2KI', '2 Kings', 25, 'Kings|Kgs|Kin|Ki', 2],
  ['1CH', '1 Chronicles', 29, 'Chronicles|Chron|Chr', 1], ['2CH', '2 Chronicles', 36, 'Chronicles|Chron|Chr', 2],
  ['EZR', 'Ezra', 10, 'Ezra|Ezr'], ['NEH', 'Nehemiah', 13, 'Nehemiah|Neh'], ['EST', 'Esther', 10, 'Esther|Esth|Est'],
  ['JOB', 'Job', 42, 'Job'], ['PSA', 'Psalms', 150, 'Psalms|Psalm|Pslm|Psa|Pss|Ps'],
  ['PRO', 'Proverbs', 31, 'Proverbs|Prov|Prv|Pro|Pr'], ['ECC', 'Ecclesiastes', 12, 'Ecclesiastes|Eccles|Eccl|Ecc|Qoh'],
  ['SNG', 'Song of Songs', 8, 'Song of Songs|Song of Solomon|Song|SOS|Canticles'],
  ['ISA', 'Isaiah', 66, 'Isaiah|Isa|Is'], ['JER', 'Jeremiah', 52, 'Jeremiah|Jer'], ['LAM', 'Lamentations', 5, 'Lamentations|Lam'],
  ['EZK', 'Ezekiel', 48, 'Ezekiel|Ezek|Eze|Ezk'], ['DAN', 'Daniel', 12, 'Daniel|Dan|Dn'], ['HOS', 'Hosea', 14, 'Hosea|Hos'],
  ['JOL', 'Joel', 3, 'Joel'], ['AMO', 'Amos', 9, 'Amos|Am'], ['OBA', 'Obadiah', 1, 'Obadiah|Obad|Ob'],
  ['JON', 'Jonah', 4, 'Jonah|Jon|Jnh'], ['MIC', 'Micah', 7, 'Micah|Mic'], ['NAM', 'Nahum', 3, 'Nahum|Nah'],
  ['HAB', 'Habakkuk', 3, 'Habakkuk|Hab'], ['ZEP', 'Zephaniah', 3, 'Zephaniah|Zeph|Zep'], ['HAG', 'Haggai', 2, 'Haggai|Hag'],
  ['ZEC', 'Zechariah', 14, 'Zechariah|Zech|Zec'], ['MAL', 'Malachi', 4, 'Malachi|Mal'],
  ['MAT', 'Matthew', 28, 'Matthew|Matt|Mat|Mt'], ['MRK', 'Mark', 16, 'Mark|Mrk|Mk'], ['LUK', 'Luke', 24, 'Luke|Luk|Lk'],
  ['JHN', 'John', 21, 'John|Jhn|Jn'], ['ACT', 'Acts', 28, 'Acts|Act'], ['ROM', 'Romans', 16, 'Romans|Rom|Rm'],
  ['1CO', '1 Corinthians', 16, 'Corinthians|Cor|Co', 1], ['2CO', '2 Corinthians', 13, 'Corinthians|Cor|Co', 2],
  ['GAL', 'Galatians', 6, 'Galatians|Gal'], ['EPH', 'Ephesians', 6, 'Ephesians|Ephes|Eph'],
  ['PHP', 'Philippians', 4, 'Philippians|Phil|Php'], ['COL', 'Colossians', 4, 'Colossians|Col'],
  ['1TH', '1 Thessalonians', 5, 'Thessalonians|Thess|Thes|Th', 1], ['2TH', '2 Thessalonians', 3, 'Thessalonians|Thess|Thes|Th', 2],
  ['1TI', '1 Timothy', 6, 'Timothy|Tim|Tm', 1], ['2TI', '2 Timothy', 4, 'Timothy|Tim|Tm', 2],
  ['TIT', 'Titus', 3, 'Titus|Tit'], ['PHM', 'Philemon', 1, 'Philemon|Philem|Phlm|Phm'], ['HEB', 'Hebrews', 13, 'Hebrews|Heb'],
  ['JAS', 'James', 5, 'James|Jas'], ['1PE', '1 Peter', 5, 'Peter|Pet|Pt', 1], ['2PE', '2 Peter', 3, 'Peter|Pet|Pt', 2],
  ['1JN', '1 John', 5, 'John|Jhn|Jn', 1], ['2JN', '2 John', 1, 'John|Jhn|Jn', 2], ['3JN', '3 John', 1, 'John|Jhn|Jn', 3],
  ['JUD', 'Jude', 1, 'Jude'], ['REV', 'Revelation', 22, 'Revelation|Revelations|Rev|Rv']
];

// Abbreviations too ambiguous to link without a verse (e.g. "Is 5", "Sam 2", "Song 3").
const NEEDS_VERSE = new Set(['is', 'am', 'ex', 'pr', 'pro', 'act', 'jon', 'sam', 'sm', 'song', 'sos', 'mal', 'mat', 'col', 'gal', 'dan', 'co', 'th', 'ki', 'kin', 'pt', 'tm', 'mk', 'rm', 'jn', 'lk', 'mt', 'ob', 'dt', 'nm', 'lv', 'gn', 'ge', 'dn']);

const aliasMap = new Map();
const aliasSet = new Set();
for (const [code, name, chapters, aliases, num = 0] of BOOKS) {
  for (const a of aliases.split('|')) {
    aliasMap.set(`${num}|${a.toLowerCase()}`, { code, name, chapters });
    aliasSet.add(a);
    if (a.length >= 3) aliasSet.add(a.toUpperCase());
  }
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
const ALIAS_RE = [...aliasSet].sort((a, b) => b.length - a.length).map(esc).join('|');
const DASH = '\\s*[-–—]\\s*';
// Groups: 1 lead, 2 num, 3 roman, 4 ordinal word, 5 book, 6 ch, 7 v1, 8 v2|ch2, 9 v2(after ch2), 10 chapter-range end
const REF_RE = new RegExp(
  '(^|[^\\w])' +
  '(?:([123])(?:st|nd|rd)?\\s*|(III|II|I)\\s+|(First|Second|Third|FIRST|SECOND|THIRD)\\s+)?' +
  '(' + ALIAS_RE + ')(?:\\.\\s*|\\s+)' +
  '(\\d{1,3})' +
  '(?:\\s*:\\s*(\\d{1,3})[abc]?(?:' + DASH + '(\\d{1,3})[abc]?(?:\\s*:\\s*(\\d{1,3})[abc]?)?)?' +
  '|(?:' + DASH + '(\\d{1,3})(?![\\d:]))?)' +
  '(?!\\w|:\\d)', 'g');

const ORD = { I: 1, II: 2, III: 3, first: 1, second: 2, third: 3 };

function buildRef(book, alias, ch, v1, a, b, chRange) {
  ch = +ch; v1 = v1 ? +v1 : 0;
  let ch2 = 0, v2 = 0;
  if (v1) { if (b) { ch2 = +a; v2 = +b; } else if (a) { v2 = +a; } }
  else if (chRange) ch2 = +chRange;
  if (book.chapters === 1 && !v1) {
    // "Jude 24" / "Philemon 4-7" mean verses in the only chapter. "Jude 1" means the whole book.
    if (ch !== 1 || ch2) { v1 = ch; v2 = ch2; ch2 = 0; ch = 1; }
  }
  if (!v1 && book.chapters > 1 && NEEDS_VERSE.has(alias.toLowerCase())) return null;
  if (ch < 1 || ch > book.chapters) return null;
  if (v1 && (v1 < 1 || v1 > 176)) return null;
  if (ch2 && (ch2 <= ch || ch2 > book.chapters)) { if (!v1) return null; if (ch2 < ch) return null; }
  if (v2 && !ch2 && v2 <= v1) v2 = 0;
  if (ch2 === ch) ch2 = 0;
  return { code: book.code, name: book.name, chapters: book.chapters, ch, v1, ch2, v2 };
}

/** Find references in a string. Returns [{ index, length, ref }] */
export function findRefs(text) {
  const found = [];
  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(text))) {
    const lead = m[1] || '';
    const num = m[2] ? +m[2] : m[3] ? ORD[m[3]] : m[4] ? ORD[m[4].toLowerCase()] : 0;
    const alias = m[5].replace(/\s+/g, ' ');
    let start = m.index + lead.length;
    let ref = null;
    let book = aliasMap.get(`${num}|${alias.toLowerCase()}`);
    if (book) ref = buildRef(book, alias, m[6], m[7], m[8], m[9], m[10]);
    if (!ref && num) {
      // e.g. "about 3 John 3:16" → just link "John 3:16"
      book = aliasMap.get(`0|${alias.toLowerCase()}`);
      if (book) { ref = buildRef(book, alias, m[6], m[7], m[8], m[9], m[10]); start = m.index + m[0].indexOf(m[5], lead.length); }
    }
    if (ref) found.push({ index: start, length: m.index + m[0].length - start, ref });
    if (REF_RE.lastIndex === m.index) REF_RE.lastIndex++;
  }
  return found;
}

export function passageId(r) {
  if (!r.v1) return r.ch2 ? `${r.code}.${r.ch}-${r.code}.${r.ch2}` : `${r.code}.${r.ch}`;
  const start = `${r.code}.${r.ch}.${r.v1}`;
  if (!r.v2) return start;
  return `${start}-${r.code}.${r.ch2 || r.ch}.${r.v2}`;
}

export function refLabel(r) {
  if (r.code === 'PSA' && !r.ch2) r = Object.assign({}, r, { name: 'Psalm' });
  if (r.chapters === 1 && r.v1) return `${r.name} ${r.v1}${r.v2 ? '–' + r.v2 : ''}`;
  if (!r.v1) return `${r.name} ${r.ch}${r.ch2 ? '–' + r.ch2 : ''}`;
  let s = `${r.name} ${r.ch}:${r.v1}`;
  if (r.v2) s += '–' + (r.ch2 ? `${r.ch2}:` : '') + r.v2;
  return s;
}

/** Search string BibleGateway understands, always pinned to CSB. */
export function bibleGatewayUrl(r) {
  let q = `${r.name} ${r.ch}`;
  if (r.v1) q += `:${r.v1}` + (r.v2 ? '-' + (r.ch2 ? `${r.ch2}:` : '') + r.v2 : '');
  else if (r.ch2) q += `-${r.ch2}`;
  return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(q)}&version=CSB`;
}

/** Wrap detected references inside an element in tappable spans. */
export function linkifyElement(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentNode.closest('.ref') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let count = 0;
  for (const node of nodes) {
    const text = node.nodeValue;
    const refs = findRefs(text);
    if (!refs.length) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const { index, length, ref } of refs) {
      if (index > pos) frag.appendChild(document.createTextNode(text.slice(pos, index)));
      const span = document.createElement('span');
      span.className = 'ref';
      span.setAttribute('role', 'button');
      span.dataset.ref = JSON.stringify(ref);
      span.textContent = text.slice(index, index + length);
      frag.appendChild(span);
      pos = index + length;
      count++;
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    node.parentNode.replaceChild(frag, node);
  }
  return count;
}

// ---------- API.Bible (CSB) ----------
const cache = new Map(); // in-memory only, for this session (licensing-friendly)

export class BibleError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

async function apiGet(path, key) {
  let res;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), 12000);
  try {
    res = await fetch(API_BASE + path, { headers: { 'api-key': key, accept: 'application/json' }, signal: ctl && ctl.signal });
  } catch (e) {
    throw new BibleError('offline', e.name === 'AbortError'
      ? 'The Bible service is taking too long to answer. Check the Wi-Fi connection.'
      : 'Couldn’t reach the Bible service. Check the Wi-Fi connection.');
  } finally { clearTimeout(timer); }
  if (res.status === 401 || res.status === 403) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch {}
    throw new BibleError('auth', /invalid api key/i.test(detail)
      ? 'That API.Bible key isn’t valid.'
      : 'This API.Bible key doesn’t have the CSB enabled. In your API.Bible dashboard, add the Christian Standard Bible to your app.');
  }
  if (res.status === 404) throw new BibleError('notfound', 'That passage wasn’t found in the CSB.');
  if (res.status === 429) throw new BibleError('limit', 'The monthly verse lookup limit has been reached.');
  if (!res.ok) throw new BibleError('error', `The Bible service returned an error (${res.status}).`);
  return res.json();
}

function cleanPassageHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = document.createElement('div');
  const copy = (src, dest) => {
    for (const n of Array.from(src.childNodes)) {
      if (n.nodeType === 3) { dest.appendChild(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      const cls = n.getAttribute('class') || '';
      if (/\b(f|x|note|fn|xref)\b/.test(cls) || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') continue; // notes
      if (n.tagName === 'SPAN' && /\bv\b/.test(cls)) {
        const sup = document.createElement('sup'); sup.textContent = n.textContent.trim(); dest.appendChild(sup); continue;
      }
      if (n.tagName === 'P' || n.tagName === 'DIV') { const p = document.createElement('p'); dest.appendChild(p); copy(n, p); continue; }
      if (n.tagName === 'SPAN' && /\bwj\b/.test(cls)) { const s = document.createElement('span'); s.className = 'wj'; dest.appendChild(s); copy(n, s); continue; }
      if (n.tagName === 'EM' || n.tagName === 'I' || (n.tagName === 'SPAN' && /\b(add|it|tl)\b/.test(cls))) { const e = document.createElement('em'); dest.appendChild(e); copy(n, e); continue; }
      copy(n, dest);
    }
  };
  copy(doc.body, out);
  out.querySelectorAll('p').forEach(p => { if (!p.textContent.trim()) p.remove(); });
  return out.innerHTML;
}

/** Fetch a passage in the CSB. Resolves { html, reference, copyright, fumsToken }. */
export async function fetchPassage(ref, key) {
  if (!key) throw new BibleError('nokey', 'No API.Bible key set.');
  const id = passageId(ref);
  if (cache.has(id)) return cache.get(id);
  const params = new URLSearchParams({
    'content-type': 'html', 'include-notes': 'false', 'include-titles': 'false',
    'include-chapter-numbers': 'false', 'include-verse-numbers': 'true', 'include-verse-spans': 'false',
    'fums-version': '3'
  });
  const json = await apiGet(`/bibles/${CSB_BIBLE_ID}/passages/${encodeURIComponent(id)}?${params}`, key);
  const d = json.data || {};
  if (d.bibleId && d.bibleId !== CSB_BIBLE_ID) throw new BibleError('error', 'Unexpected translation returned.');
  const result = {
    html: cleanPassageHtml(d.content || ''),
    reference: d.reference || refLabel(ref),
    copyright: d.copyright || '',
    fumsToken: (json.meta && json.meta.fumsToken) || null
  };
  cache.set(id, result);
  return result;
}

/** Quietly warm the session cache for all refs in a sermon (helps with flaky church Wi-Fi). */
export async function prefetch(refs, key) {
  if (!key || !navigator.onLine) return;
  const seen = new Set();
  for (const r of refs) {
    const id = passageId(r);
    if (seen.has(id) || cache.has(id)) continue;
    seen.add(id);
    if (seen.size > 40) break;
    try { await fetchPassage(r, key); } catch (e) { if (e.kind === 'auth' || e.kind === 'limit' || e.kind === 'offline') return; }
  }
}

/** Check that a key works and has CSB access. */
export async function testKey(key) {
  const json = await apiGet(`/bibles/${CSB_BIBLE_ID}`, key);
  const d = json.data || {};
  return `${d.name || 'Christian Standard Bible'} (${d.abbreviationLocal || d.abbreviation || 'CSB'})`;
}

// FUMS (Fair Use Management System) — required by API.Bible for web apps displaying their Scripture.
let fumsLoaded = false;
export function reportFums(token) {
  if (!token) return;
  window.fumsData = window.fumsData || [];
  window.fums = window.fums || function () { window.fumsData.push(arguments); };
  if (!fumsLoaded) {
    fumsLoaded = true;
    const s = document.createElement('script');
    s.src = 'https://pkg.api.bible/fumsV3.min.js'; s.async = true;
    document.head.appendChild(s);
  }
  try { window.fums('trackView', token); } catch {}
}
