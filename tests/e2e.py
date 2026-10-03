"""
End-to-end test for Preach (Playwright, Python).
Run:  python3 -m http.server 8765 --bind 127.0.0.1   (from preach-app/)
      python tests/e2e.py [base_url]
Saves screenshots to preach-app/screenshots/.
"""
import sys, pathlib, time, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8765/'
ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'screenshots'; SHOTS.mkdir(exist_ok=True)
FIX = ROOT / 'tests' / 'fixtures'
results = []

def check(name, cond, detail=''):
    results.append((bool(cond), name, detail))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))

PASTE_HTML = """<meta charset='utf-8'><b style="font-weight:normal;" id="docs-internal-guid-1">
<h1><span style="font-weight:700">Sermon: Running the Race</span></h1>
<p><span>Today we're in </span><span style="font-weight:700">Hebrews 12:1-3</span><span>. Let's talk about </span><span style="font-style:italic">endurance</span><span>.</span></p>
<h2>Point 1 — Lay it down</h2>
<ul><li><p>Read 1 Cor 9:24-27 together.</p></li><li><p>Look at Phil 3:13-14.</p></li></ul>
""" + "".join(f"<p>Paragraph {i}: Paul reminds us in Romans 12:{(i % 20) + 1} that grace changes everything. Endurance is not about speed; it is about direction, and the people running beside you matter more than you think. Keep going, keep looking to Jesus, and don't run alone.</p>" for i in range(1, 26)) + """
<h2>Point 2 — Look to Jesus</h2><ol><li>Fix your eyes</li><li>Remember the cross (Psalm 23)</li></ol><p><b>Close in prayer.</b></p></b>"""

def visible_text_top(pg):
    return pg.evaluate("""() => { const P = window.__preach.paginator; const i = P.anchor;
      const [n, o] = P._locate(i); return n.nodeValue.slice(o, o + 40); }""")

LOCAL_CONFIG = "window.PREACH_CONFIG = { supabaseUrl: '', supabaseAnonKey: '', apiBibleKey: '' };"
def local_only(c):
    """Core suite tests local-only mode; never touch the real Supabase project."""
    c.route('**/config.js', lambda route: route.fulfill(status=200, content_type='application/javascript', body=LOCAL_CONFIG))
    return c

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
    ctx = local_only(browser.new_context(viewport={'width': 1180, 'height': 820}, device_scale_factor=2, has_touch=False, permissions=['microphone', 'clipboard-read', 'clipboard-write']))
    pg = ctx.new_page()
    # v1.2.1 builds in a team API.Bible key, so the app would prefetch real passages over the network and the
    # session cache would hide the invalid-key case below. Keep API.Bible offline (403) for this suite.
    pg.route('https://rest.api.bible/**', lambda route: route.fulfill(status=403, content_type='application/json',
        headers={'access-control-allow-origin': '*'}, body='{"statusCode": 403, "error": "Forbidden", "message": "Invalid API key"}'))
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'api.bible' not in m.text and '403' not in m.text else None)
    pg.goto(BASE); pg.wait_for_selector('#home:not([hidden])')
    pg.screenshot(path=str(SHOTS / '00-home-empty.png'))

    # ---- 1. Paste rich text (Google Docs style HTML) into the editor
    pg.click('#tile-paste'); pg.wait_for_selector('#edit:not([hidden])')
    pg.evaluate("""html => { const ed = document.getElementById('editor'); ed.focus();
        const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', 'x');
        ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }""", PASTE_HTML)
    pg.wait_for_timeout(300)
    ed_html = pg.inner_html('#editor')
    check('paste keeps headings', '<h1>' in ed_html and '<h2>' in ed_html)
    check('paste keeps bold (styled span) and italics', '<strong>Hebrews 12:1-3</strong>' in ed_html and '<em>endurance</em>' in ed_html)
    check('paste does not bold everything (Google Docs wrapper)', not ed_html.lstrip().startswith('<strong>') and ed_html.count('<strong>') < 6, ed_html[:80])
    check('paste keeps lists', '<ul>' in ed_html and '<ol>' in ed_html)
    check('title guessed from first heading', pg.input_value('#edit-title') == 'Sermon: Running the Race', pg.input_value('#edit-title'))
    pg.screenshot(path=str(SHOTS / '01-editor-pasted.png'))

    # ---- 2. Preach view
    pg.click('#edit-preach'); pg.wait_for_selector('#preach:not([hidden])'); pg.wait_for_timeout(600)
    pages = pg.evaluate('window.__preach.paginator.pages')
    check('paginated into multiple pages', pages > 2, f'{pages} pages')
    check('page indicator', pg.inner_text('#page-text') == f'Page 1 of {pages}', pg.inner_text('#page-text'))
    nrefs = pg.eval_on_selector_all('#flow .ref', 'e => e.length')
    check('verse references detected', nrefs >= 20, f'{nrefs} refs')
    # no text clipped: every page boundary lands between lines (flow height respected)
    pg.screenshot(path=str(SHOTS / 'preach-light.png'))

    def page(): return pg.evaluate('window.__preach.paginator.page')
    pg.click('#next-btn'); pg.wait_for_timeout(350); check('Next button', page() == 1)
    pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(350); check('ArrowRight', page() == 2)
    pg.keyboard.press('PageDown'); pg.wait_for_timeout(350); check('PageDown (pedal)', page() == 3)
    pg.keyboard.press('PageUp'); pg.wait_for_timeout(350); check('PageUp (pedal)', page() == 2)
    pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(350); check('ArrowLeft', page() == 1)
    pg.keyboard.press('Space'); pg.wait_for_timeout(350); check('Space', page() == 2)
    pg.click('#prev-btn'); pg.wait_for_timeout(350); check('Previous button', page() == 1)
    # tap right / left edges (avoid refs: tap near the bottom padding of the viewport)
    vp = pg.locator('#viewport').bounding_box()
    pg.mouse.click(vp['x'] + vp['width'] - 20, vp['y'] + vp['height'] - 8); pg.wait_for_timeout(350); check('tap right edge', page() == 2)
    pg.mouse.click(vp['x'] + 20, vp['y'] + vp['height'] - 8); pg.wait_for_timeout(350); check('tap left edge', page() == 1)
    # swipe left (drag)
    pg.mouse.move(vp['x'] + vp['width'] * .7, vp['y'] + 200); pg.mouse.down()
    pg.mouse.move(vp['x'] + vp['width'] * .4, vp['y'] + 205, steps=6); pg.mouse.up(); pg.wait_for_timeout(350)
    check('swipe left -> next', page() == 2)
    # Space after clicking a toolbar button must turn the page, not re-press the button
    pg.click('#theme-btn'); pg.click('#theme-btn'); pg.keyboard.press('Space'); pg.wait_for_timeout(350)
    check('space turns page after toolbar click (focus not trapped)', page() == 3, f'page={page()}')

    # ---- 3. Text size keeps position
    before_txt = visible_text_top(pg); before_pages = pages
    anchor = pg.evaluate('window.__preach.paginator.anchor')
    pg.click('#font-inc'); pg.wait_for_timeout(250); pg.click('#font-inc'); pg.wait_for_timeout(400)
    after = pg.evaluate("""() => { const P = window.__preach.paginator; return { pages: P.pages, page: P.page, anchorPage: P.pageOfChar(%d) }; }""" % anchor)
    check('A+ repaginates (more pages)', after['pages'] > before_pages, f"{before_pages} -> {after['pages']}")
    check('A+ keeps reading position (anchor text on current page)', after['page'] == after['anchorPage'], json.dumps(after))
    check('font size setting saved', pg.evaluate("JSON.parse(localStorage.getItem('preach.v1.settings')).fontSize") == 36)
    pg.screenshot(path=str(SHOTS / '02-preach-bigger-text.png'))
    pg.click('#font-dec'); pg.wait_for_timeout(250); pg.click('#font-dec'); pg.wait_for_timeout(400)
    after2 = pg.evaluate("() => { const P = window.__preach.paginator; return { page: P.page, anchorPage: P.pageOfChar(%d) }; }" % anchor)
    check('A- keeps reading position', after2['page'] == after2['anchorPage'], json.dumps(after2))

    # ---- 4. Dark mode (same page as the light screenshot)
    pg.evaluate("window.__preach.paginator.goTo(0)"); pg.wait_for_timeout(400)
    pg.click('#theme-btn'); pg.mouse.move(5, 400); pg.wait_for_timeout(400)
    check('dark mode toggled', pg.evaluate("document.documentElement.dataset.theme") == 'dark')
    pg.screenshot(path=str(SHOTS / 'preach-dark.png'))
    pg.click('#theme-btn'); pg.wait_for_timeout(300)
    check('light mode toggled back', pg.evaluate("document.documentElement.dataset.theme") == 'light')

    # ---- 5. Verse popup (no key -> BibleGateway CSB fallback)
    pg.evaluate("window.__preach.paginator.goTo(0)"); pg.wait_for_timeout(400)
    ref = pg.locator('#flow .ref').first
    ref_text = ref.inner_text()
    ref.click(); pg.wait_for_selector('#dlg-verse[open]')
    href = pg.get_attribute('#verse-bg', 'href')
    check('verse popup opens', pg.inner_text('#verse-ref') != '', pg.inner_text('#verse-ref'))
    check('verse tap did not turn page', page() == 0)
    check('BibleGateway fallback pinned to CSB', 'version=CSB' in href and 'biblegateway.com' in href, href)
    check('CSB label shown', pg.inner_text('.verse-ver') == 'CSB')
    pg.screenshot(path=str(SHOTS / '03-verse-popup-no-key.png'))
    pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(200)
    check('pedal press closes verse popup without turning', not pg.is_visible('#dlg-verse') and page() == 0)
    # With an invalid key we expect a friendly error. API.Bible's real 403 response is replayed
    # (route-mocked so the test doesn't depend on network speed).
    pg.route('https://rest.api.bible/**', lambda route: route.fulfill(status=403, content_type='application/json',
        headers={'access-control-allow-origin': '*'}, body='{"statusCode": 403, "error": "Forbidden", "message": "Invalid API key"}'))
    pg.evaluate("window.__preach.settings.apiBibleKey = 'not-a-real-key'")
    pg.locator('#flow .ref').nth(1).click(); pg.wait_for_selector('#dlg-verse[open]')
    pg.wait_for_function("!document.querySelector('#verse-body .spinner')", timeout=15000)
    msg = pg.inner_text('#verse-body')
    check('invalid key -> friendly error + fallback', 'key' in msg.lower() and 'BibleGateway' in msg, msg[:90])
    pg.screenshot(path=str(SHOTS / '04-verse-popup-bad-key.png'))
    pg.click('#dlg-verse .dlg-foot [data-close]')
    pg.evaluate("window.__preach.settings.apiBibleKey = ''")

    # ---- 6. Timer: presets, warnings, overtime
    pg.click('#timer-pill'); pg.wait_for_selector('#dlg-timer[open]')
    pg.click('#t-presets .chip[data-min="25"]')
    check('preset 25 sets 25:00', pg.inner_text('#t-big') == '25:00', pg.inner_text('#t-big'))
    pg.click('#t-plus'); check('custom + minute', pg.inner_text('#t-big') == '26:00')
    pg.screenshot(path=str(SHOTS / '05-timer-sheet.png'))
    pg.click('#dlg-timer [data-close]')
    # Warning colours: jump the clock forward using the timer object.
    pg.evaluate("() => { const t = window.__preach.timer; t.setDuration(600); t.start(); t.accumulatedMs = (600 - 299) * 1000; t.onTick(); }")
    pg.wait_for_timeout(400)
    check('yellow warning at 5 min', pg.get_attribute('#timer-pill', 'data-phase') == 'warn1', pg.inner_text('#timer-text'))
    pg.screenshot(path=str(SHOTS / '06-timer-warning-yellow.png'))
    pg.evaluate("() => { const t = window.__preach.timer; t.accumulatedMs = (600 - 119) * 1000; t.onTick(); }")
    pg.wait_for_timeout(400)
    check('orange warning at 2 min', pg.get_attribute('#timer-pill', 'data-phase') == 'warn2', pg.inner_text('#timer-text'))
    # Real short countdown: 5 seconds, run it out for real.
    pg.evaluate("() => { const t = window.__preach.timer; t.reset(); t.durationSec = 5; t.start(); }")
    pg.wait_for_timeout(1200)
    t1 = pg.inner_text('#timer-text')
    check('short timer counts down', t1 in ('0:04', '0:03'), t1)
    pg.wait_for_timeout(6500)
    t2 = pg.inner_text('#timer-text')
    check('overtime counts up with +', t2.startswith('+0:0'), t2)
    check('overtime body class', pg.evaluate("document.body.classList.contains('overtime') && document.body.classList.contains('running')"))
    anim = pg.evaluate("(() => { const s = getComputedStyle(document.getElementById('overtime-frame')); return { name: s.animationName, dur: s.animationDuration, border: s.borderTopWidth, color: s.borderTopColor, display: s.display }; })()")
    check('red border visible & blinking at 1 Hz', anim['name'] == 'otblink' and anim['dur'] == '1s' and anim['display'] == 'block', json.dumps(anim))
    ops = []
    for _ in range(8):
        ops.append(round(float(pg.evaluate("getComputedStyle(document.getElementById('overtime-frame')).opacity")), 2)); pg.wait_for_timeout(130)
    check('border opacity actually pulses', max(ops) - min(ops) > 0.4, str(ops))
    # capture a frame near full opacity for the screenshot
    for _ in range(20):
        if float(pg.evaluate("getComputedStyle(document.getElementById('overtime-frame')).opacity")) > 0.9: break
        pg.wait_for_timeout(40)
    pg.screenshot(path=str(SHOTS / 'preach-overtime.png'))
    pg.evaluate("document.documentElement.dataset.theme='dark'")
    for _ in range(30):
        if float(pg.evaluate("getComputedStyle(document.getElementById('overtime-frame')).opacity")) > 0.9: break
        pg.wait_for_timeout(40)
    pg.screenshot(path=str(SHOTS / 'preach-overtime-dark.png'))
    pg.evaluate("document.documentElement.dataset.theme='light'")
    pg.click('#timer-toggle'); pg.wait_for_timeout(200)
    check('pause stops blinking (solid border)', pg.evaluate("getComputedStyle(document.getElementById('overtime-frame')).animationName") == 'none')
    pg.click('#timer-pill'); pg.click('#t-reset'); pg.click('#dlg-timer [data-close]')
    check('reset clears overtime', not pg.evaluate("document.body.classList.contains('overtime')"))
    check('timer state persisted', pg.evaluate("!!JSON.parse(localStorage.getItem('preach.v1.state')).timer"))

    # ---- 7. Recording (fake mic) + feedback stub
    pg.click('#rec-btn'); pg.wait_for_timeout(3500)
    check('recording indicator on', 'on' in pg.get_attribute('#rec-btn', 'class'), pg.inner_text('#rec-label'))
    pg.screenshot(path=str(SHOTS / '07-recording.png'))
    pg.click('#rec-btn'); pg.wait_for_selector('#dlg-rec[open]')
    pg.click('#rec-stop'); pg.wait_for_selector('#dlg-saved[open]', timeout=10000)
    size = pg.evaluate("window.__preach.recorder.state")
    check('recorder back to idle', size == 'idle')
    meta = pg.inner_text('#saved-meta')
    check('saved recording has audio', ('KB' in meta or 'MB' in meta), meta)
    pg.fill('#fb-name', 'Jake Labrador'); pg.fill('#fb-notes', 'Was the intro too long?')
    pg.click('#fb-send'); pg.wait_for_function("document.getElementById('fb-status').textContent.includes('switched on')", timeout=5000)
    check('Send for feedback calls stub', 'switched on' in pg.inner_text('#fb-status'))
    pg.screenshot(path=str(SHOTS / '08-recording-saved-feedback.png'))
    pg.click('#dlg-saved .dlg-head [data-close]')
    # Record-with-timer option
    pg.evaluate("window.__preach.settings.recordWithTimer = true")
    pg.click('#timer-toggle'); pg.wait_for_timeout(1500)
    check('timer start also starts recording (option)', pg.evaluate("window.__preach.recorder.state") == 'recording')
    pg.click('#timer-toggle'); pg.wait_for_timeout(300)
    check('timer pause also pauses recording', pg.evaluate("window.__preach.recorder.state") == 'paused')
    pg.click('#rec-btn'); pg.wait_for_selector('#dlg-rec[open]'); pg.click('#rec-stop'); pg.wait_for_selector('#dlg-saved[open]', timeout=10000)
    pg.click('#dlg-saved .dlg-head [data-close]')
    pg.evaluate("window.__preach.settings.recordWithTimer = false; window.__preach.timer.reset()")

    # ---- 8. Persistence across reload
    pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(700)
    saved_page = page()
    pg.reload(); pg.wait_for_selector('#home:not([hidden])'); pg.wait_for_timeout(500)
    check('home shows continue card after reload', pg.is_visible('#continue-card') and 'Running the Race' in pg.inner_text('#cc-title'))
    nrec = pg.eval_on_selector_all('#recordings li', 'e => e.length')
    check('recordings listed from IndexedDB', nrec >= 2, f'{nrec}')
    pg.screenshot(path=str(SHOTS / '09-home-library.png'))
    pg.click('#cc-preach'); pg.wait_for_timeout(800)
    check('reading position restored after reload', page() == saved_page, f'{page()} vs {saved_page}')
    pg.click('#p-exit'); pg.wait_for_selector('#home:not([hidden])')

    # ---- 9. File import: .docx and .md
    pg.set_input_files('#file-input', str(FIX / 'test-sermon.docx')); pg.wait_for_selector('#edit:not([hidden])'); pg.wait_for_timeout(600)
    h = pg.inner_html('#editor')
    check('docx: headings/bold/italic/lists', '<h1>' in h and '<h2>' in h and '<strong>' in h and '<em>' in h and '<li>' in h, h[:120])
    pg.click('#edit-preach'); pg.wait_for_timeout(500)
    check('docx refs linked', pg.eval_on_selector_all('#flow .ref', 'e => e.map(x => x.textContent)') == ['John 10:11', 'Psalm 23', 'Isa 40:11'])
    pg.click('#p-exit'); pg.wait_for_selector('#home:not([hidden])')
    pg.set_input_files('#file-input', str(FIX / 'test-sermon.md')); pg.wait_for_selector('#edit:not([hidden])'); pg.wait_for_timeout(300)
    h = pg.inner_html('#editor')
    check('md: heading/bold/italic/lists', '<h1>Markdown Sermon</h1>' in h and '<strong>Bold</strong>' in h and '<em>italic</em>' in h and '<ol>' in h, h[:120])
    pg.click('#edit-back')

    # ---- 10. Settings screen
    pg.click('#btn-settings'); pg.wait_for_selector('#dlg-settings[open]')
    pg.screenshot(path=str(SHOTS / '10-settings.png'))
    pg.click('#dlg-settings [data-close]')

    # ---- 11. Offline (service worker)
    pg.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller !== null || (navigator.serviceWorker.ready && false)", timeout=1000) if False else None
    pg.evaluate("navigator.serviceWorker.ready")
    pg.reload(); pg.wait_for_timeout(800)
    controlled = pg.evaluate("!!navigator.serviceWorker.controller")
    ctx.set_offline(True)
    pg.reload(); pg.wait_for_selector('#home:not([hidden])', timeout=5000)
    check('works offline after first load (service worker)', controlled and pg.is_visible('#tile-sample'))
    pg.click('#tile-sample'); pg.wait_for_timeout(800)
    check('offline: sample preaches', pg.evaluate('window.__preach.paginator.pages') > 1)
    ctx.set_offline(False)

    check('no JS errors', not errors, '; '.join(errors[:5]))
    ctx.close()

    # ---- 12. Other form factors (screenshots + layout sanity)
    for name, vp, touch in [('ipad-portrait', {'width': 820, 'height': 1180}, True), ('phone', {'width': 390, 'height': 844}, True), ('laptop', {'width': 1440, 'height': 900}, False)]:
        c = local_only(browser.new_context(viewport=vp, device_scale_factor=2, has_touch=touch, is_mobile=touch and vp['width'] < 500))
        q = c.new_page(); q.goto(BASE); q.wait_for_selector('#home')
        q.screenshot(path=str(SHOTS / f'home-{name}.png'))
        q.click('#tile-sample'); q.wait_for_timeout(900)
        overflow = q.evaluate("""() => { const bar = document.querySelector('.pbar.top');
          if (bar.scrollWidth > bar.clientWidth + 1) return 'overflow';
          const els = [...bar.querySelectorAll('button')].filter(b => b.offsetParent).map(b => [b.id, b.getBoundingClientRect()]);
          for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
            const a = els[i][1], b = els[j][1];
            if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) return els[i][0] + ' overlaps ' + els[j][0];
          } return ''; }""")
        check(f'{name}: toolbar fits, no overlapping buttons', not overflow, overflow)
        q.screenshot(path=str(SHOTS / f'preach-{name}.png'))
        c.close()
    browser.close()

    # ---- 13. WebKit (Safari engine) smoke test, iPad landscape
    wk = p.webkit.launch()
    c = local_only(wk.new_context(viewport={'width': 1180, 'height': 820}, device_scale_factor=2, has_touch=True))
    q = c.new_page(); werr = []
    q.on('pageerror', lambda e: werr.append(str(e)))
    q.goto(BASE); q.wait_for_selector('#home'); q.click('#tile-sample'); q.wait_for_timeout(1200)
    wpages = q.evaluate('window.__preach.paginator.pages')
    q.keyboard.press('ArrowRight'); q.wait_for_timeout(400)
    check('webkit: paginates and turns pages', wpages > 1 and q.evaluate('window.__preach.paginator.page') == 1, f'{wpages} pages')
    q.tap('#font-inc'); q.wait_for_timeout(400)
    st = q.evaluate("() => { const P = window.__preach.paginator; return P.page === P.pageOfChar(P.anchor); }")
    check('webkit: A+ keeps position', st)
    q.screenshot(path=str(SHOTS / 'webkit-ipad-landscape.png'))
    check('webkit: no JS errors', not werr, '; '.join(werr[:3]))
    wk.close()

fails = [r for r in results if not r[0]]
print(f'\n{len(results) - len(fails)}/{len(results)} checks passed')
sys.exit(1 if fails else 0)
