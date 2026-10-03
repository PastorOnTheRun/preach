"""
Big-screen (projector) mode: slide extraction + pairing/control flow with a MOCKED Supabase Realtime.
  python tests/screen_e2e.py [base_url]
vendor/supabase.js -> tests/mock-supabase.js (BroadcastChannel-based broadcast), config.js -> fake credentials.
"""
import sys, json, pathlib, re
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8765/'
ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'screenshots'; SHOTS.mkdir(exist_ok=True)
MOCK = (ROOT / 'tests' / 'mock-supabase.js').read_text()
CONFIG = "window.PREACH_CONFIG = { supabaseUrl: 'https://mockproject.supabase.co', supabaseAnonKey: 'mock-anon-key', apiBibleKey: '' };"
LOCAL = "window.PREACH_CONFIG = { supabaseUrl: '', supabaseAnonKey: '', apiBibleKey: '' };"
results = []
def check(name, cond, detail=''):
    results.append((bool(cond), name)); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

PASSAGE = {'data': {'id': 'HEB.6.19', 'bibleId': 'a556c5305ee15c3f-01', 'reference': 'Hebrews 6:19',
    'content': '<p class="p"><span data-number="19" class="v">19</span>[Test passage text for Hebrews 6:19 — placeholder, not Scripture.]</p>',
    'copyright': 'Christian Standard Bible® Copyright © 2017 by Holman Bible Publishers. (test copyright line)'}, 'meta': {'fumsToken': 'tok'}}

EXTRACT_JS = r"""async () => {
  const S = await import('./js/slides.js'); const F = await import('./js/format.js');
  const kinds = a => a.map(s => s.kind + ':' + s.text);
  const r = {};
  r.basic = kinds(S.slidesFromHtml('<h1>Big Title</h1><p>Body text that is not a slide.</p><h2>Point one</h2><p>More <mark>this is highlighted</mark> body.</p><blockquote>A quoted line.</blockquote>', { title: 'Sermon' }));
  r.gdocs_raw = kinds(S.slidesFromHtml('<b style="font-weight:normal" id="docs-internal-guid-1"><p dir="ltr"><span style="font-size:11pt;background-color:#ffff00;font-weight:400">Docs highlighted sentence.</span><span style="background-color:transparent"> plain</span></p></b>'));
  const gclean = F.sanitizeHtml('<b style="font-weight:normal" id="docs-internal-guid-1"><p dir="ltr"><span style="font-size:11pt;background-color:#ffff00;font-weight:400">Docs highlighted sentence.</span><span style="background-color:transparent"> plain</span></p></b>');
  r.gdocs_clean = gclean; r.gdocs_clean_slides = kinds(S.slidesFromHtml(gclean));
  const wclean = F.sanitizeHtml("<p class=MsoNormal>Word text <span style='background:yellow;mso-highlight:yellow'>Word highlight here</span> after.</p>");
  r.word_clean = wclean; r.word_slides = kinds(S.slidesFromHtml(wclean));
  r.white = kinds(S.slidesFromHtml('<p><span style="background-color:#ffffff">white bg</span> <span style="background:rgba(0,0,0,0)">clear</span></p><p style="background:#eeeeee">shaded paragraph</p>'));
  r.marked_raw = kinds(S.slidesFromHtml('<p>Before ==a marked phrase== after and ==second one==.</p>'));
  r.marked_md = F.textToHtml('Plain ==marked in markdown== text\n> Quote from md');
  r.marked_md_slides = kinds(S.slidesFromHtml(r.marked_md));
  r.merge = kinds(S.slidesFromHtml('<p>x <mark>Jesus is </mark><mark><strong>the anchor</strong></mark> y <mark>other</mark></p><p><mark>next block</mark></p>'));
  r.quote_mark = kinds(S.slidesFromHtml('<blockquote>Outer <mark>inner</mark> text</blockquote>'));
  r.notes = kinds(S.slidesFromHtml('<blockquote>Note: pause here</blockquote><blockquote>[Tell the tubing story]</blockquote><blockquote>Real quote</blockquote>'));
  const v = S.verseSlide({ html: '<p><sup>16</sup>Placeholder text.</p>', reference: 'John 3:16', copyright: '' });
  r.verse = v;
  r.pub = S.publicSlide({ id: 'x', kind: 'quote', text: 't', node: {}, offset: 3, anchor: 9 });
  r.titledup = kinds(S.slidesFromHtml('<h1>Anchored</h1>', { title: 'Anchored' }));
  // .docx highlights via mammoth
  const blob = await (await fetch('tests/fixtures/highlight-sermon.docx')).blob();
  const doc = await F.importFile(new File([blob], 'highlight-sermon.docx'));
  r.docx_html = doc.html; r.docx = kinds(S.slidesFromHtml(doc.html, { title: doc.title }));
  return r;
}"""

def visible_text(pg):
    return pg.evaluate("() => { const out = []; for (const id of ['wait', 'stage']) { const el = document.getElementById(id); if (el && !el.hidden) out.push(el.innerText); } return out.join('\\n'); }")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1180, 'height': 820}, device_scale_factor=1, service_workers='block')
    ctx.add_init_script("window.__MOCK_SEED = { users: [], profiles: [] };")
    ctx.route('**/vendor/supabase.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=MOCK))
    ctx.route('**/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=CONFIG))
    ctx.route('https://rest.api.bible/**', lambda r: r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps(PASSAGE)))
    ctx.route('https://fums.api.bible/**', lambda r: r.fulfill(status=200, body=''))
    ctl = ctx.new_page(); errors = []
    ctl.on('pageerror', lambda e: errors.append('ctl: ' + str(e)))

    # ---------------- Slide extraction
    ctl.goto(BASE); ctl.wait_for_selector('#home:not([hidden])')
    r = ctl.evaluate(EXTRACT_JS)
    check('extract: title, headings, <mark>, blockquote in order (body text excluded)',
          r['basic'] == ['title:Sermon', 'heading:Big Title', 'heading:Point one', 'highlight:this is highlighted', 'quote:A quoted line.'], r['basic'])
    check('extract: Google Docs highlight span (raw paste HTML)', r['gdocs_raw'] == ['highlight:Docs highlighted sentence.'], r['gdocs_raw'])
    check('paste: Google Docs highlight kept as <mark>', '<mark>Docs highlighted sentence.</mark>' in r['gdocs_clean'] and r['gdocs_clean_slides'] == ['highlight:Docs highlighted sentence.'], r['gdocs_clean'])
    check('paste: Word mso-highlight kept as <mark>', '<mark>Word highlight here</mark>' in r['word_clean'] and r['word_slides'] == ['highlight:Word highlight here'], r['word_clean'])
    check('extract: white/transparent/paragraph shading are not highlights', r['white'] == [], r['white'])
    check('extract: ==marked== text', r['marked_raw'] == ['highlight:a marked phrase', 'highlight:second one'], r['marked_raw'])
    check('markdown: ==marked== -> <mark>, > -> quote', '<mark>marked in markdown</mark>' in r['marked_md'] and r['marked_md_slides'] == ['highlight:marked in markdown', 'quote:Quote from md'], r['marked_md_slides'])
    check('extract: adjacent highlight runs merge; separate runs/blocks split', r['merge'] == ['highlight:Jesus is the anchor', 'highlight:other', 'highlight:next block'], r['merge'])
    check('extract: highlight inside a quote is not duplicated', r['quote_mark'] == ['quote:Outer inner text'], r['quote_mark'])
    check('extract: stage-note blockquotes never become slides', r['notes'] == ['quote:Real quote'], r['notes'])
    check('verse slide: CSB cite + copyright fallback', r['verse']['kind'] == 'verse' and r['verse']['cite'] == 'John 3:16 CSB' and 'Christian Standard Bible' in r['verse']['copyright'] and 'Placeholder text.' in r['verse']['text'], r['verse'])
    check('publicSlide strips DOM/anchor fields', r['pub'] == {'id': 'x', 'kind': 'quote', 'text': 't'}, r['pub'])
    check('.docx: Word highlights survive import as <mark>', '<mark>Hope is only as strong as what it is anchored to.</mark>' in r['docx_html'], r['docx_html'][:200])
    check('.docx: slides = headings + highlights (split runs merged)',
          r['docx'] == ['title:highlight sermon', 'heading:Anchored', 'highlight:Hope is only as strong as what it is anchored to.', 'highlight:Jesus is the anchor', 'heading:Point 2: Hold on'], r['docx'])

    # ---------------- Screen page: waiting state
    scr = ctx.new_page(); scr.set_viewport_size({'width': 1280, 'height': 720})
    scr.on('pageerror', lambda e: errors.append('scr: ' + str(e)))
    scr.goto(BASE + 'screen.html'); scr.wait_for_selector('#pair-form:not([hidden])')
    check('screen: neutral "Waiting to connect" with code entry', 'Waiting to connect' in scr.inner_text('#wait') and scr.is_visible('#pair-code'))
    check('screen: code entry is masked', scr.get_attribute('#pair-code', 'type') == 'password')
    scr.screenshot(path=str(SHOTS / 'screen-waiting.png'))

    # ---------------- Controller: enable Big screen, code hidden behind "Show code"
    check('controller: no screen button until enabled', not ctl.is_visible('#screen-btn'))
    ctl.click('#btn-settings'); ctl.wait_for_selector('#dlg-settings[open]')
    check('settings: Big screen section shown (Supabase configured)', ctl.is_visible('#s-screen-section'))
    ctl.locator('#s-screen-section .switch').click(); ctl.wait_for_selector('#s-screen-on:not([hidden])')
    code = ctl.evaluate("window.__preach.settings.screenCode")
    check('settings: 6-character code generated', re.fullmatch(r'[A-Z0-9]{6}', code or '') is not None, code)
    check('settings: code hidden by default', code not in ctl.inner_text('#dlg-settings') and ctl.inner_text('#s-screen-code') == '••••••')
    ctl.locator('#s-screen-section').scroll_into_view_if_needed()
    ctl.screenshot(path=str(SHOTS / 'screen-settings-code-hidden.png'))
    ctl.click('#s-screen-show')
    check('settings: "Show code" reveals it', ctl.inner_text('#s-screen-code') == code)
    ctl.click('#s-screen-show')
    check('settings: "Hide code" hides it again', ctl.inner_text('#s-screen-code') == '••••••')
    ctl.click('#dlg-settings [data-close]')

    # ---------------- Pair
    scr.fill('#pair-code', code.lower()); scr.click('#pair-go')
    scr.wait_for_function("window.__screen.paired", timeout=8000)
    check('screen: pairs with the code', scr.evaluate("window.__screen.paired"))
    check('screen: waiting UI gone, input cleared', not scr.is_visible('#wait') and scr.input_value('#pair-code') == '')
    check('screen: never shows the code after pairing', code not in visible_text(scr) and code not in scr.content().replace('value=""', ''))

    # ---------------- Preach: auto slides follow pages
    ctl.click('#tile-sample'); ctl.wait_for_selector('#preach:not([hidden])'); ctl.wait_for_timeout(900)
    ctl.wait_for_function("document.getElementById('strip-status').dataset.s === 'on'", timeout=8000)
    check('controller: strip shows "Big screen connected"', 'connected' in ctl.inner_text('#strip-status').lower(), ctl.inner_text('#strip-status'))
    sl = ctl.evaluate("window.__preach.screen.slides.map(s => s.kind + ':' + s.text)")
    check('controller: sample yields slides (title, headings, highlights, quote)', sl[0].startswith('title:') and any(s.startswith('highlight:') for s in sl) and any(s.startswith('quote:') for s in sl) and sum(s.startswith('heading:') for s in sl) >= 5, sl[:6])
    check('controller: stage note in sample is not a slide', not any('Pause here' in s for s in sl))
    scr.wait_for_function("document.querySelector('#slide .txt') && document.querySelector('#slide .txt').textContent.length > 0")
    first = scr.text_content('#slide .txt')
    live = ctl.evaluate("(() => { const s = window.__preach.screen; return s.slides[s.liveIdx].text; })()")
    check('screen: shows the controller’s live slide', first == live, first)
    scr.wait_for_timeout(500); scr.screenshot(path=str(SHOTS / 'screen-slide-title.png'))
    before = ctl.evaluate("window.__preach.screen.liveIdx")
    for _ in range(2): ctl.click('#next-btn'); ctl.wait_for_timeout(450)
    after = ctl.evaluate("window.__preach.screen.liveIdx")
    live = ctl.evaluate("(() => { const s = window.__preach.screen; return s.slides[s.liveIdx].text; })()")
    scr.wait_for_function("t => document.querySelector('#slide .txt') && document.querySelector('#slide .txt').textContent === t", arg=live, timeout=5000)
    check('page turns move the screen to the next slide', after > before and scr.text_content('#slide .txt') == live, f'{before}->{after} {live[:40]}')

    # ---------------- Tap a slide in the strip
    qi = ctl.evaluate("window.__preach.screen.slides.findIndex(s => s.kind === 'quote')")
    ctl.click(f'#strip-list .strip-item[data-i="{qi}"]')
    qt = ctl.evaluate(f"window.__preach.screen.slides[{qi}].text")
    scr.wait_for_function("t => document.querySelector('#slide .txt')?.textContent === t", arg=qt, timeout=5000)
    check('tap in slide strip shows that slide', scr.text_content('#slide .txt') == qt and 'k-quote' in scr.get_attribute('#slide', 'class'), qt)
    scr.wait_for_timeout(450); scr.screenshot(path=str(SHOTS / 'screen-slide-quote.png'))
    ctl.screenshot(path=str(SHOTS / 'screen-controller-strip.png'))
    hi = ctl.evaluate("window.__preach.screen.slides.findIndex(s => s.kind === 'highlight')")
    ctl.click(f'#strip-list .strip-item[data-i="{hi}"]'); scr.wait_for_timeout(600)
    check('highlight slide renders', 'k-highlight' in scr.get_attribute('#slide', 'class'))
    scr.screenshot(path=str(SHOTS / 'screen-slide-highlight.png'))
    hd = ctl.evaluate("window.__preach.screen.slides.findIndex((s, i) => s.kind === 'heading' && i > 1)")
    ctl.click(f'#strip-list .strip-item[data-i="{hd}"]'); scr.wait_for_timeout(600)
    scr.screenshot(path=str(SHOTS / 'screen-slide-heading.png'))

    # ---------------- Timer running: never on screen
    ctl.click('#timer-toggle'); ctl.wait_for_timeout(1200)
    tt = ctl.inner_text('#timer-text')
    check('timer is never sent to the screen', tt not in visible_text(scr) and not scr.query_selector('#stage .timer'), tt)

    # ---------------- Black screen
    ctl.click('#screen-blank'); scr.wait_for_selector('#blank:not([hidden])', timeout=5000)
    vis = scr.evaluate("(() => { const b = document.getElementById('blank'); const r = b.getBoundingClientRect(); return getComputedStyle(b).backgroundColor + ' ' + r.width + 'x' + r.height + ' z' + getComputedStyle(b).zIndex; })()")
    check('black screen toggle: projector goes black (covers everything)', vis.startswith('rgb(0, 0, 0) 1280x720'), vis)
    check('black screen: controller shows state', ctl.get_attribute('#screen-blank', 'aria-pressed') == 'true')
    scr.screenshot(path=str(SHOTS / 'screen-blank.png'))
    ctl.screenshot(path=str(SHOTS / 'screen-controller-blank.png'))
    ctl.keyboard.press('b'); scr.wait_for_selector('#blank', state='hidden', timeout=5000)
    check('"B" key brings the screen back', not scr.is_visible('#blank'))

    # ---------------- Verse (CSB) as an optional slide
    ctl.evaluate("window.__preach.settings.apiBibleKey = 'test-key'")
    pt = ctl.evaluate("""(() => { const v = document.getElementById('viewport').getBoundingClientRect();
      for (const r of document.querySelectorAll('#flow .ref')) { const b = r.getBoundingClientRect(); if (b.left >= v.left && b.right <= v.right && b.width) return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } return null; })()""")
    if not pt:
        ctl.evaluate("window.__preach.paginator.goTo(0)"); ctl.wait_for_timeout(400)
        pt = ctl.evaluate("""(() => { const b = document.querySelector('#flow .ref').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()""")
    ctl.mouse.click(pt['x'], pt['y']); ctl.wait_for_selector('#dlg-verse[open]')
    ctl.wait_for_selector('#verse-screen:not([hidden])', timeout=8000)
    ctl.click('#verse-screen'); scr.wait_for_selector('#slide.k-verse', timeout=5000)
    check('verse slide: text + "Hebrews 6:19 CSB" + copyright line', 'placeholder' in scr.inner_text('#slide .txt') and scr.inner_text('#slide .cite') == 'HEBREWS 6:19 CSB' and 'Holman' in scr.inner_text('#slide .copy'), scr.inner_text('#slide .cite'))
    scr.wait_for_timeout(450); scr.screenshot(path=str(SHOTS / 'screen-slide-verse.png'))
    ctl.click('#dlg-verse .dlg-foot [data-close]')

    # ---------------- Privacy audit of everything sent
    log = ctl.evaluate("JSON.parse(localStorage.getItem('__rtlog') || '[]')")
    shows = [m for m in log if m['event'] == 'show']
    body_bits = ["While you're turning there", 'Every one of us is tied', 'Pause here', 'Tell the story about the first time']
    allowed = {'id', 'kind', 'text', 'cite', 'copyright'}
    dump = json.dumps([m['payload'] for m in log])  # the code is only the channel name, never in a message
    check('realtime: only show/hello/ping/bye events', {m['event'] for m in log} <= {'show', 'hello', 'ping', 'bye'}, sorted({m['event'] for m in log}))
    check('realtime: show payloads carry only slide fields', all(set(m['payload']) <= {'seq', 'blank', 'slide'} and (m['payload']['slide'] is None or set(m['payload']['slide']) <= allowed) for m in shows), len(shows))
    check('realtime: never sends the code, manuscript body, notes or timer', code not in dump and not any(b in dump for b in body_bits) and tt not in dump)
    check('screen: never displayed manuscript body text', not any(b in visible_text(scr) for b in body_bits))

    # ---------------- Projector reload: reconnects silently
    scr.reload(); scr.wait_for_function("window.__screen && window.__screen.paired", timeout=8000)
    check('screen reload: reconnects without showing the code', scr.evaluate("window.__screen.paired") and code not in visible_text(scr))

    # ---------------- Leaving preach: screen keeps nothing from the sermon
    ctl.click('#p-exit'); ctl.wait_for_selector('#home:not([hidden])'); scr.wait_for_timeout(600)
    check('exit preach: screen clears to an empty backdrop', scr.evaluate("document.getElementById('slide').textContent.trim()") == '')

    # ---------------- New code: old screen disconnects to the neutral waiting state
    ctl.click('#btn-settings'); ctl.wait_for_selector('#dlg-settings[open]')
    ctl.click('#s-screen-new'); ctl.click('#confirm-yes')
    scr.wait_for_selector('#wait:not([hidden])', timeout=5000)
    new_code = ctl.evaluate("window.__preach.settings.screenCode")
    check('new code: screen drops back to waiting, code still never shown', new_code != code and scr.input_value('#pair-code') == '' and new_code not in visible_text(scr) and code not in visible_text(scr))
    ctl.locator('#s-screen-section .switch').click(); ctl.wait_for_timeout(300)
    ctl.click('#dlg-settings [data-close]')
    check('turning Big screen off hides the controls', not ctl.evaluate("window.__preach.settings.screenEnabled") and not ctl.is_visible('#screen-btn'))
    check('no JS errors', not errors, errors[:3])
    ctx.close()

    # ---------------- Unconfigured: screen mode hidden / explains setup
    c2 = browser.new_context(viewport={'width': 1280, 'height': 720}, service_workers='block')
    c2.route('**/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=LOCAL))
    q = c2.new_page(); q.goto(BASE + 'screen.html'); q.wait_for_timeout(500)
    check('unconfigured: screen page explains setup, no code entry', 'set up' in q.inner_text('#wait') and not q.is_visible('#pair-code'))
    q.goto(BASE); q.wait_for_selector('#home:not([hidden])'); q.click('#btn-settings'); q.wait_for_selector('#dlg-settings[open]')
    check('unconfigured: no Big screen settings', not q.is_visible('#s-screen-section'))
    c2.close(); browser.close()

ok = sum(1 for r in results if r[0])
print(f'\n{ok}/{len(results)} checks passed')
sys.exit(0 if ok == len(results) else 1)
