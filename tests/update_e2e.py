"""
Update delivery + offline tests for the service worker (network-first app code, safe auto-reload).
  python tests/update_e2e.py
Copies the site to a temp dir and serves it on its own port (with a switchable slow-network delay),
so releases can be simulated by editing files.
"""
import sys, re, json, shutil, tempfile, threading, time, pathlib, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = pathlib.Path(tempfile.mkdtemp(prefix='preach-upd-'))
for item in ['index.html', 'review.html', 'screen.html', 'config.js', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'fonts', 'icons', 'vendor']:
    src = ROOT / item
    (shutil.copytree if src.is_dir() else shutil.copy)(src, SITE / item)
DELAY = {'s': 0.0, 'paths': ('.js', '.html', '/')}

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'max-age=600')  # like GitHub Pages: the SW must revalidate anyway
        super().end_headers()
    def do_GET(self):
        p = self.path.split('?')[0]
        if DELAY['s'] and p.endswith(DELAY['paths']): time.sleep(DELAY['s'])
        return super().do_GET()

srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=str(SITE)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}/'

results = []
def check(name, cond, detail=''):
    results.append((bool(cond), name)); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

def release(ver, marker=None):
    """Simulate deploying a new version: bump sw.js + app.js VERSION (and optionally mark index.html)."""
    sw = (SITE / 'sw.js').read_text(); (SITE / 'sw.js').write_text(re.sub(r"preach-v[\d.]+[a-z0-9-]*", f'preach-v{ver}', sw, count=1))
    app = (SITE / 'js/app.js').read_text(); (SITE / 'js/app.js').write_text(re.sub(r"VERSION = '[^']+'", f"VERSION = '{ver}'", app, count=1))
    if marker:
        idx = (SITE / 'index.html').read_text(); (SITE / 'index.html').write_text(idx.replace('</body>', f'<i id="{marker}" hidden></i></body>'))

def mark(pg): pg.evaluate("window.__notReloaded = true")
def reloaded(pg): return not pg.evaluate("!!window.__notReloaded")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1180, 'height': 820}, service_workers='allow')
    pg = ctx.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    cur = pg.evaluate  # noqa

    # ---- first visit: SW installs + takes control, no surprise reload
    pg.goto(BASE); pg.wait_for_selector('#home:not([hidden])'); mark(pg)
    pg.wait_for_function("!!navigator.serviceWorker.controller", timeout=10000); pg.wait_for_timeout(800)
    check('first install: SW controls the page without reloading it', not reloaded(pg))
    reg = pg.evaluate("navigator.serviceWorker.getRegistration().then(r => ({uvc: r.updateViaCache, active: !!r.active}))")
    check('SW registered with updateViaCache: none', reg['uvc'] == 'none' and reg['active'], json.dumps(reg))
    ver = pg.evaluate("window.__preach.VERSION")
    pg.click('#btn-settings'); pg.wait_for_selector('#dlg-settings[open]')
    check('Settings shows the version number', pg.text_content('#s-version') == 'v' + ver and pg.is_visible('#s-version'), pg.text_content('#s-version'))
    pg.click('#s-check-update'); pg.wait_for_function("document.getElementById('s-update-status').textContent && !document.getElementById('s-update-status').textContent.startsWith('Checking')", timeout=8000)
    check('Settings: "Check for updates" says up to date', 'latest version' in pg.text_content('#s-update-status'), pg.text_content('#s-update-status'))
    pg.click('#dlg-settings [data-close]')

    # ---- network-first: an HTML/JS change shows on the very next load (no stale cache, despite max-age)
    idx = (SITE / 'index.html').read_text(); (SITE / 'index.html').write_text(idx.replace('</body>', '<i id="nf-marker" hidden></i></body>'))
    (SITE / 'js/util.js').write_text((SITE / 'js/util.js').read_text() + '\nwindow.__utilMarker = 1;\n')
    pg.reload(); pg.wait_for_selector('#home:not([hidden])')
    check('network-first: changed index.html served on next load', pg.locator('#nf-marker').count() == 1)
    check('network-first: changed JS module served on next load', pg.evaluate("window.__utilMarker === 1"), pg.evaluate("fetch('js/util.js').then(r => r.text()).then(t => t.slice(-40))"))

    # ---- new release while on the home screen: auto-activates + reloads once
    pg.wait_for_timeout(500); mark(pg)
    release('9.0.0')
    pg.evaluate("window.__preach.update.check()")
    try: pg.wait_for_function("window.__preach && window.__preach.VERSION === '9.0.0' && !window.__notReloaded", timeout=15000)
    except Exception: pass
    check('home screen: new version activates and page reloads itself once', reloaded(pg) and pg.evaluate("window.__preach.VERSION") == '9.0.0', pg.evaluate("window.__preach.VERSION"))
    pg.wait_for_timeout(1500); mark(pg); pg.wait_for_timeout(1500)
    check('reloads only once (no loop)', not reloaded(pg))
    sw_ver = pg.evaluate("caches.keys()")
    check('old caches deleted', sw_ver == ['preach-v9.0.0'], str(sw_ver))

    # ---- visibilitychange triggers an update check
    release('9.0.1')
    pg.evaluate("Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true}); document.dispatchEvent(new Event('visibilitychange'))")
    try: pg.wait_for_function("window.__preach && window.__preach.VERSION === '9.0.1'", timeout=15000)
    except Exception: pass
    check('coming back to the app (visibilitychange) picks up the update', pg.evaluate("window.__preach.VERSION") == '9.0.1')

    # ---- new release while preaching: no reload, pill instead; reload after leaving the preach view
    pg.wait_for_selector('#home:not([hidden])'); pg.wait_for_timeout(800)
    pg.click('#tile-sample'); pg.wait_for_selector('#preach:not([hidden])'); pg.wait_for_timeout(600)
    pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(300); mark(pg)
    page_before = pg.evaluate("window.__preach.paginator.page")
    release('9.0.2')
    pg.evaluate("window.__preach.update.check()")
    try: pg.wait_for_selector('#update-pill:not([hidden])', timeout=15000)
    except Exception: pass
    check('preaching: no reload mid-sermon', not reloaded(pg) and pg.is_visible('#preach') and pg.evaluate("window.__preach.paginator.page") == page_before)
    check('preaching: small "Update ready — tap to refresh" pill shown', pg.is_visible('#update-pill') and 'Update ready' in pg.text_content('#update-pill'))
    pg.screenshot(path=str(ROOT / 'screenshots' / 'update-pill.png'))
    pg.wait_for_timeout(1500)
    check('preaching: still no reload after waiting', not reloaded(pg))
    pg.click('#p-exit')
    try: pg.wait_for_function("window.__preach && window.__preach.VERSION === '9.0.2' && !window.__notReloaded", timeout=10000)
    except Exception: pass
    check('after leaving the preach view: reloads to the new version', reloaded(pg) and pg.evaluate("window.__preach.VERSION") == '9.0.2')

    # ---- tapping the pill refreshes immediately
    pg.wait_for_selector('#home:not([hidden])'); pg.wait_for_timeout(800)
    pg.click('#tile-sample'); pg.wait_for_selector('#preach:not([hidden])'); mark(pg)
    release('9.0.3'); pg.evaluate("window.__preach.update.check()")
    pg.wait_for_selector('#update-pill:not([hidden])', timeout=15000)
    pg.click('#update-pill')
    try: pg.wait_for_function("window.__preach && window.__preach.VERSION === '9.0.3' && !window.__notReloaded", timeout=10000)
    except Exception: pass
    check('tapping the pill refreshes to the new version', reloaded(pg) and pg.evaluate("window.__preach.VERSION") == '9.0.3')

    # ---- slow network: falls back to the cache after ~3 s
    pg.wait_for_selector('#home:not([hidden])'); pg.wait_for_timeout(800)
    DELAY['s'] = 8.0
    t0 = time.time(); pg.reload(wait_until='domcontentloaded'); pg.wait_for_selector('#home:not([hidden])', timeout=30000); dt = time.time() - t0
    DELAY['s'] = 0.0
    check('slow network: app still opens from cache (timeout fallback)', pg.is_visible('#tile-sample') and dt < 20, f'{dt:.1f}s')
    pg.wait_for_timeout(9000)  # let the slow background fetches finish

    # ---- offline: open + preach with the network off
    ctx.set_offline(True)
    pg.reload(); pg.wait_for_selector('#home:not([hidden])', timeout=10000)
    check('offline: app opens', pg.is_visible('#tile-sample') and pg.evaluate("window.__preach.VERSION") == '9.0.3')
    pg.click('#tile-sample'); pg.wait_for_timeout(800)
    check('offline: sample sermon preaches', pg.evaluate('window.__preach.paginator.pages') > 1)
    pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(300)
    check('offline: page turns work', pg.evaluate('window.__preach.paginator.page') >= 1)
    pg.click('#p-exit'); pg.wait_for_selector('#home:not([hidden])')
    pg.click('#btn-settings'); pg.click('#s-check-update'); pg.wait_for_timeout(1500)
    check('offline: "Check for updates" fails gracefully', 'offline' in pg.text_content('#s-update-status').lower() or 'latest' in pg.text_content('#s-update-status'), pg.text_content('#s-update-status'))
    pg.click('#dlg-settings [data-close]')
    pg.goto(BASE + 'review.html'); pg.wait_for_timeout(1000)
    check('offline: review page shell loads from cache', pg.locator('h1').first.text_content() == 'Review')
    ctx.set_offline(False)

    check('no JS errors', not errors, '; '.join(errors[:5]))
    browser.close()
srv.shutdown(); shutil.rmtree(SITE, ignore_errors=True)
print(f'{sum(r[0] for r in results)}/{len(results)} checks passed')
sys.exit(0 if all(r[0] for r in results) else 1)
