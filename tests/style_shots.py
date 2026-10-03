"""Screenshots of the restyled app (style-*.png). Local-only config, so no network."""
import sys, pathlib
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8765/'
SHOTS = pathlib.Path(__file__).resolve().parent.parent / 'screenshots'; SHOTS.mkdir(exist_ok=True)
LOCAL = "window.PREACH_CONFIG = { supabaseUrl: '', supabaseAnonKey: '', apiBibleKey: '' };"
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(viewport={'width': 1180, 'height': 820}, device_scale_factor=1, service_workers='block')
    c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=LOCAL))
    pg = c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector('#home:not([hidden])')
    pg.click('#tile-sample'); pg.wait_for_selector('#preach:not([hidden])'); pg.wait_for_timeout(900)
    pg.screenshot(path=str(SHOTS / 'style-preach-light.png'))
    pg.evaluate("() => { const t = window.__preach.timer; t.setDuration(1800); t.start(); t.accumulatedMs = 600 * 1000; t.onTick(); }"); pg.wait_for_timeout(300)
    pg.screenshot(path=str(SHOTS / 'style-preach-timer.png'))
    pg.evaluate("() => { const t = window.__preach.timer; t.accumulatedMs = (1800 + 83) * 1000; t.onTick(); }"); pg.wait_for_timeout(250)
    pg.evaluate("document.getElementById('overtime-frame').style.animation = 'none'")
    pg.screenshot(path=str(SHOTS / 'style-preach-overtime.png'))
    pg.evaluate("() => { const t = window.__preach.timer; t.reset(); }")
    pg.evaluate("window.__preach.settings.theme = 'dark'; document.documentElement.dataset.theme = 'dark'"); pg.wait_for_timeout(400)
    pg.screenshot(path=str(SHOTS / 'style-preach-dark.png'))
    pg.evaluate("document.documentElement.dataset.theme = 'light'; window.__preach.settings.theme = 'light'")
    pg.click('#p-exit'); pg.wait_for_selector('#home:not([hidden])'); pg.wait_for_timeout(400)
    pg.screenshot(path=str(SHOTS / 'style-home.png'), full_page=True)
    print('errors', errs); b.close()

# Sign-in and review pages (mocked Supabase, Jake as admin)
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import json
from seed_data import SEED
MOCK = (pathlib.Path(__file__).resolve().parent / 'mock-supabase.js').read_text()
CONFIG = "window.PREACH_CONFIG = { supabaseUrl: 'https://mockproject.supabase.co', supabaseAnonKey: 'mock-anon-key', apiBibleKey: '' };"
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(viewport={'width': 1180, 'height': 820}, device_scale_factor=1, service_workers='block')
    c.add_init_script(f"window.__MOCK_SEED = {json.dumps(SEED)};")
    c.route('**/vendor/supabase.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=MOCK))
    c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=CONFIG))
    pg = c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector('#home:not([hidden])'); pg.wait_for_timeout(500)
    pg.screenshot(path=str(SHOTS / 'style-home-signed-out.png'))
    pg.click('#btn-account'); pg.wait_for_selector('#signin:not([hidden])'); pg.wait_for_timeout(400)
    pg.screenshot(path=str(SHOTS / 'style-signin.png'))
    pg.click('#si-use-pw'); pg.fill('#si-pw-email', 'jake@familychurch.org'); pg.fill('#si-pw', 'jake-pass-123'); pg.click('#si-pw-signin')
    pg.wait_for_selector('#home:not([hidden])'); pg.wait_for_selector('#btn-review:not([hidden])', timeout=8000)
    pg.goto(BASE + 'review.html'); pg.wait_for_selector('#rv-main:not([hidden])', timeout=8000); pg.wait_for_timeout(500)
    pg.locator('.rv-item', has_text='Unshakable').locator('.rv-row').click(); pg.wait_for_timeout(700)
    pg.screenshot(path=str(SHOTS / 'style-review.png'))
    print('errors', errs); b.close()
