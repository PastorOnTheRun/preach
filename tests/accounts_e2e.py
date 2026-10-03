"""
Accounts / sync / admin review tests with a MOCKED Supabase client (no real project needed).
  python tests/accounts_e2e.py [base_url]
vendor/supabase.js is replaced by tests/mock-supabase.js and config.js gets fake credentials.
"""
import sys, json, pathlib
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8765/'
ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'screenshots'
MOCK = (ROOT / 'tests' / 'mock-supabase.js').read_text()
CONFIG = "window.PREACH_CONFIG = { supabaseUrl: 'https://mockproject.supabase.co', supabaseAnonKey: 'mock-anon-key', apiBibleKey: '' };"
results = []
def check(name, cond, detail=''):
    results.append((bool(cond), name)); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from seed_data import SEED, JAKE, ANA, BEN

def mockdb(pg): return pg.evaluate("JSON.parse(localStorage.getItem('__mockdb'))")

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    ctx = browser.new_context(viewport={'width': 1180, 'height': 820}, device_scale_factor=2, permissions=['microphone'], service_workers='block')
    ctx.add_init_script(f"window.__MOCK_SEED = {json.dumps(SEED)};")
    ctx.route('**/vendor/supabase.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=MOCK))
    ctx.route('**/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=CONFIG))
    pg = ctx.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

    # ---------------- Signed out: app works locally, offers sign-in
    pg.goto(BASE); pg.wait_for_selector('#home:not([hidden])'); pg.wait_for_timeout(500)
    check('signed-out: account button shows "Sign in"', pg.is_visible('#btn-account') and pg.inner_text('#acct-label') == 'Sign in')
    check('signed-out: sign-in banner shown', pg.is_visible('#signin-banner'))
    check('signed-out: review link hidden', not pg.is_visible('#btn-review'))
    pg.click('#tile-sample'); pg.wait_for_timeout(800)
    check('signed-out: local sermon preaches', pg.evaluate('window.__preach.paginator.pages') > 1)
    pg.click('#p-exit'); pg.wait_for_selector('#home:not([hidden])')
    pg.screenshot(path=str(SHOTS / 'accounts-home-signed-out.png'))

    # ---------------- Create an account (new preacher, no email, team invite code)
    pg.click('#banner-signin'); pg.wait_for_selector('#signin:not([hidden])')
    check('sign-in: button offers a code, no link wording', 'code' in pg.inner_text('#si-send').lower() and 'link' not in pg.inner_text('#si-email-form').lower(), pg.inner_text('#si-send'))
    check('sign-in: prominent "Create an account" button', pg.is_visible('#si-to-signup') and 'Create an account' in pg.text_content('#si-to-signup'))
    pg.screenshot(path=str(SHOTS / 'signin.png'))
    pg.fill('#si-email', 'chris@familychurch.org'); pg.click('#si-to-signup')
    pg.wait_for_selector('#si-signup-form:not([hidden])'); pg.wait_for_timeout(150)
    check('sign-up: title "Create an account", sign-in form hidden', pg.text_content('#si-title') == 'Create an account' and not pg.is_visible('#si-email-form'))
    check('sign-up: email prefilled from sign-in, name focused', pg.input_value('#su-email') == 'chris@familychurch.org' and pg.evaluate("document.activeElement.id") == 'su-name')
    fields = pg.eval_on_selector_all('#si-signup-form .si-input', 'es => es.map(e => ({id: e.id, ac: e.autocomplete, h: e.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(e).fontSize)}))')
    check('sign-up: name, email, password, confirm, invite code (big iPad fields)', [f['id'] for f in fields] == ['su-name', 'su-email', 'su-pw', 'su-pw2', 'su-code'] and all(f['h'] >= 48 and f['fs'] >= 17 for f in fields), json.dumps(fields))
    check('sign-up: password fields use new-password', fields[2]['ac'] == 'new-password' and fields[3]['ac'] == 'new-password')
    check('sign-up: big "Create my account" button + hint about invite code', pg.eval_on_selector('#su-create', 'e => e.getBoundingClientRect().height') >= 56 and 'Ask Jake' in pg.inner_text('#si-signup-form'))
    pg.click('#su-create'); pg.wait_for_timeout(150)
    check('sign-up: name required', 'your name' in pg.inner_text('#si-status'), pg.inner_text('#si-status'))
    pg.fill('#su-name', 'Chris Park'); pg.fill('#su-pw', 'short'); pg.fill('#su-pw2', 'short'); pg.click('#su-create'); pg.wait_for_timeout(150)
    check('sign-up: password must be 8+ characters', '8 characters' in pg.inner_text('#si-status'), pg.inner_text('#si-status'))
    pg.fill('#su-pw', 'chris-pass-123'); pg.fill('#su-pw2', 'chris-pass-124'); pg.click('#su-create'); pg.wait_for_timeout(150)
    check('sign-up: passwords must match', 'don’t match' in pg.inner_text('#si-status'), pg.inner_text('#si-status'))
    pg.fill('#su-pw2', 'chris-pass-123'); pg.click('#su-create'); pg.wait_for_timeout(150)
    check('sign-up: invite code required (client)', 'invite code' in pg.inner_text('#si-status'), pg.inner_text('#si-status'))
    pg.fill('#su-code', 'GRACE-9999'); pg.click('#su-create'); pg.wait_for_timeout(500)
    check('sign-up: wrong invite code -> friendly server message', 'invite code isn’t right' in pg.inner_text('#si-status') and pg.is_visible('#si-signup-form'), pg.inner_text('#si-status'))
    check('sign-up: wrong code created no account', not any(u['email'] == 'chris@familychurch.org' for u in mockdb(pg)['users']))
    pg.screenshot(path=str(SHOTS / 'signup-error.png'))
    pg.fill('#su-code', 'grace 1234'); pg.screenshot(path=str(SHOTS / 'signup.png')); pg.click('#su-create')
    pg.wait_for_selector('#home:not([hidden])', timeout=5000); pg.wait_for_timeout(1500)
    check('sign-up: signed straight in (no email), label shows name', pg.inner_text('#acct-label') == 'Chris Park', pg.inner_text('#acct-label'))
    check('banner hidden after sign-in', not pg.is_visible('#signin-banner'))
    db = mockdb(pg)
    check('sign-up: no email sent (signUp only, no OTP)', any(l['type'] == 'signup' for l in db['log']) and not any(l['type'] in ('otp', 'otp-request') for l in db['log'] if l.get('email') == 'chris@familychurch.org'), json.dumps(db['log'][-3:])[:200])
    pg.wait_for_function("window.__preach.sync.status === 'synced'", timeout=8000)
    db = mockdb(pg); chris = next(u for u in db['users'] if u['email'] == 'chris@familychurch.org')
    check('signup trigger created preacher profile with display_name', any(pr['id'] == chris['id'] and pr['role'] == 'preacher' and pr.get('display_name') == 'Chris Park' for pr in db['profiles']), json.dumps(db['profiles'])[-200:])
    mine = [s for s in db['sermons'] if s['user_id'] == chris['id']]
    check('local (signed-out) sermon claimed + uploaded', len(mine) == 1 and mine[0]['title'].startswith('Sample'), str([s['title'] for s in mine]))
    check('sync dot green', pg.get_attribute('#sync-dot', 'data-s') == 'synced')
    check('preacher sees no Review button', not pg.is_visible('#btn-review'))
    check("preacher library doesn't include other preachers' sermons", 'Unshakable' not in pg.inner_text('#library'))

    # ---------------- Sync: edits, positions, LWW both directions, delete
    sid = mine[0]['id']
    pg.evaluate(f"window.__preach.enterPreach('{sid}')"); pg.wait_for_timeout(700)
    pg.click('#timer-pill'); pg.click('#t-presets .chip[data-min="35"]'); pg.click('#dlg-timer [data-close]')
    pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(300); pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(300)
    pos_local = pg.evaluate(f"window.__preach.state.positions['{sid}']")
    pg.evaluate("window.__preach.sync.syncNow()"); pg.wait_for_timeout(800)
    row = next(s for s in mockdb(pg)['sermons'] if s['id'] == sid)
    check('timer settings synced per sermon', (row.get('timer_settings') or {}).get('minutes') == 35, str(row.get('timer_settings')))
    check('last page (position) synced', row['last_position'] == pos_local and row['position_updated_at'], f"{row['last_position']} vs {pos_local}")
    pg.click('#p-exit'); pg.wait_for_selector('#home:not([hidden])')
    # remote edit newer than local -> remote wins
    pg.evaluate(f"""() => {{ const db = JSON.parse(localStorage.getItem('__mockdb')); const r = db.sermons.find(s => s.id === '{sid}');
        r.title = 'Edited on my laptop'; r.content_html = '<h1>Edited on my laptop</h1><p>New intro about John 1:1.</p>';
        r.updated_at = new Date().toISOString(); db.clock = Date.now() + 5; r.synced_at = new Date(db.clock).toISOString();
        localStorage.setItem('__mockdb', JSON.stringify(db)); }}""")
    pg.evaluate("window.__preach.sync.syncNow()"); pg.wait_for_timeout(800)
    check('LWW: newer remote edit replaces local', 'Edited on my laptop' in pg.inner_text('#library'))
    # local edit newer than remote -> local wins
    pg.click('#library li [data-act="edit"]'); pg.wait_for_selector('#edit:not([hidden])')
    pg.fill('#edit-title', 'Edited on the iPad'); pg.wait_for_timeout(900)
    pg.click('#edit-back'); pg.wait_for_function(f"(() => {{ const r = JSON.parse(localStorage.getItem('__mockdb')).sermons.find(s => s.id === '{sid}'); return r && r.title === 'Edited on the iPad'; }})()", timeout=8000)
    check('LWW: newer local edit pushed (debounced autosync)', True)
    # local delete -> server soft delete
    pg.click('#tile-paste'); pg.wait_for_selector('#edit:not([hidden])')
    pg.fill('#edit-title', 'Throwaway draft'); pg.evaluate("document.getElementById('editor').innerHTML = '<p>Delete me</p>'; document.getElementById('editor').dispatchEvent(new Event('input'))")
    pg.wait_for_timeout(900); pg.click('#edit-back'); pg.evaluate("window.__preach.sync.syncNow()"); pg.wait_for_timeout(800)
    pg.locator('#library li', has_text='Throwaway draft').locator('[data-act="delete"]').click(); pg.click('#confirm-yes')
    pg.evaluate("window.__preach.sync.syncNow()"); pg.wait_for_timeout(800)
    tw = [s for s in mockdb(pg)['sermons'] if s['title'] == 'Throwaway draft']
    check('delete syncs as soft-delete', len(tw) == 1 and tw[0]['deleted'] is True)

    # ---------------- Offline while signed in
    ctx.set_offline(True)
    pg.locator('#library li', has_text='Edited on the iPad').locator('[data-act="edit"]').click(); pg.wait_for_selector('#edit:not([hidden])')
    pg.fill('#edit-title', 'Edited offline'); pg.wait_for_timeout(900); pg.click('#edit-back')
    pg.evaluate("window.__preach.sync.syncNow()"); pg.wait_for_timeout(500)
    check('offline: edit kept locally, status offline', pg.evaluate("window.__preach.sync.status") == 'offline' and 'Edited offline' in pg.inner_text('#library'))
    ctx.set_offline(False); pg.evaluate("window.dispatchEvent(new Event('online'))")
    try:
        pg.wait_for_function(f"(() => {{ const r = JSON.parse(localStorage.getItem('__mockdb')).sermons.find(s => s.id === '{sid}'); return r && r.title === 'Edited offline'; }})()", timeout=8000)
    except Exception:
        print('DEBUG', pg.evaluate(f"JSON.stringify({{st: window.__preach.sync.status, err: window.__preach.sync.error, on: navigator.onLine, oc: window.__preach.auth.offlineCached, u: !!window.__preach.auth.user, row: JSON.parse(localStorage.getItem('__mockdb')).sermons.find(s => s.id === '{sid}'), meta: localStorage.getItem('preach.v1.meta')}})"))
        raise
    check('back online: pending edit syncs', True)

    # ---------------- Recording -> Send for feedback uploads to Storage + recordings row
    pg.evaluate(f"window.__preach.enterPreach('{sid}')"); pg.wait_for_timeout(600)
    pg.click('#rec-btn'); pg.wait_for_timeout(2500); pg.click('#rec-btn'); pg.click('#rec-stop')
    pg.wait_for_selector('#dlg-saved[open]', timeout=10000)
    pg.fill('#fb-notes', 'Did the ending land?'); pg.click('#fb-send')
    pg.wait_for_function("document.getElementById('fb-status').textContent.startsWith('Sent')", timeout=8000)
    check('send: "Feedback is on its way" shown', 'Feedback is on its way' in pg.inner_text('#fb-status'), pg.inner_text('#fb-status'))
    db = mockdb(pg)
    rec = [r for r in db['recordings'] if r['user_id'] == chris['id']]
    path = rec[0]['storage_path'] if rec else ''
    check('recording row inserted (status uploaded → claimed)', len(rec) == 1 and rec[0]['status'] in ('uploaded', 'processing') and rec[0]['sermon_id'] == sid and rec[0]['notes'] == 'Did the ending land?', json.dumps(rec[0] if rec else {})[:160])
    check('audio uploaded to recordings/<user_id>/<sermon_id>/<timestamp>.<ext>', path.startswith(f"{chris['id']}/{sid}/") and path in db['objects'] and db['objects'][path]['size'] > 0, path)
    pg.screenshot(path=str(SHOTS / 'accounts-feedback-sent.png'))
    pg.click('#dlg-saved .dlg-head [data-close]'); pg.click('#p-exit'); pg.wait_for_selector('#home:not([hidden])')
    try: pg.wait_for_function("document.getElementById('recordings').innerText.includes('sent for review')", timeout=6000)
    except Exception: pass
    check('recording marked as sent in list', 'sent for review' in pg.inner_text('#recordings'))

    # ---------------- Phase 2: automatic AI feedback (grade-recording Edge Function, mocked)
    rid = rec[0]['id']
    fn = mockdb(pg).get('fnlog') or []
    check('send: grade-recording invoked with the new row id and the preacher JWT', len(fn) == 1 and fn[0]['name'] == 'grade-recording' and fn[0]['body'] == {'recording_id': rid} and fn[0]['uid'] == chris['id'], json.dumps(fn)[:200])
    check('send: row claimed (status processing)', next(r for r in mockdb(pg)['recordings'] if r['id'] == rid)['status'] == 'processing')
    pg.wait_for_selector('#recordings .fb-pill', timeout=6000)
    check('list: "Feedback on its way…" pill', 'Feedback on its way' in pg.text_content('#recordings .fb-slot'), pg.text_content('#recordings .fb-slot'))
    # grading fails -> error pill + Retry
    pg.evaluate(f"window.__mockFinishGrading('{rid}', {{fail: true}})"); pg.reload(); pg.wait_for_selector('#home:not([hidden])')
    pg.wait_for_selector('#recordings .fb-pill[data-state="error"]', timeout=8000)
    check('list: failed grading shows "Feedback failed" + Retry', 'Feedback failed' in pg.text_content('#recordings .fb-slot') and pg.is_visible('#recordings [data-act="retry"]'))
    check('list: error detail in tooltip', 'Unsupported audio' in (pg.get_attribute('#recordings .fb-pill', 'title') or ''))
    pg.click('#recordings [data-act="retry"]'); pg.wait_for_selector('#recordings .fb-pill[data-state="waiting"]', timeout=5000)
    fn = mockdb(pg).get('fnlog') or []
    check('retry: invokes grade-recording again (no force for preachers)', len(fn) == 2 and fn[1]['body'] == {'recording_id': rid})
    check('retry: toast "Feedback is on its way."', 'Feedback is on its way' in pg.inner_text('body'))
    # grading succeeds -> grade pill + feedback dialog
    pg.evaluate(f"window.__mockFinishGrading('{rid}')"); pg.reload(); pg.wait_for_selector('#home:not([hidden])')
    pg.wait_for_selector('#recordings .fb-pill[data-state="graded"]', timeout=8000)
    check('list: graded shows "Grade B+" + View feedback', 'Grade B+' in pg.text_content('#recordings .fb-slot') and pg.is_visible('#recordings [data-act="feedback"]'))
    pg.screenshot(path=str(SHOTS / 'feedback-list-graded.png'))
    pg.click('#recordings [data-act="feedback"]'); pg.wait_for_selector('#dlg-feedback[open]')
    fbt = pg.text_content('#dlg-feedback')
    check('feedback dialog: grade, summary, 7 areas', 'B+' in fbt and 'father’s welcome' in fbt and pg.eval_on_selector_all('#dlg-feedback .grade-table tr', 'e => e.length') == 8, fbt[:120])
    check('feedback dialog: strengths, growth areas, answer to their question', all(x in fbt for x in ['Strengths', 'Growth areas', 'Did the ending land?', 'give one specific step']))
    check('feedback dialog: timing line', '27:00 preached · 25 min planned · 2:00 over · 138 words/min' in fbt)
    pg.screenshot(path=str(SHOTS / 'feedback-dialog.png'))
    pg.click('#dlg-feedback [data-close]')
    cached = pg.evaluate("""new Promise(res => { const o = indexedDB.open('preach'); o.onsuccess = () => { try { const t = o.result.transaction('recordings').objectStore('recordings').getAll(); t.onsuccess = () => res(t.result.map(r => r.cloud && r.cloud.feedback && r.cloud.feedback.status)); } catch (e) { res(String(e)); } }; o.onerror = () => res('noidb'); })""")
    check('feedback cached on the device recording (works offline)', isinstance(cached, list) and 'graded' in cached, str(cached))

    # ---------------- Preacher can't use the review page
    pg.goto(BASE + 'review.html'); pg.wait_for_timeout(1000)
    check('review page: preacher sees "Admins only"', 'Admins only' in pg.inner_text('#rv-msg'))
    pg.goto(BASE); pg.wait_for_selector('#home:not([hidden])'); pg.wait_for_timeout(600)

    # ---------------- Account dialog + sign out (shared iPad)
    pg.click('#btn-account'); pg.wait_for_selector('#dlg-account[open]')
    check('account dialog shows email + role', 'chris@familychurch.org' in pg.inner_text('#acct-email') and pg.text_content('#acct-role') == 'Preacher')
    pg.screenshot(path=str(SHOTS / 'accounts-account-dialog.png'))
    check('account dialog: shared-iPad sign out is the obvious first choice', pg.is_visible('#acct-signout-clear') and 'clear this iPad' in pg.inner_text('#acct-signout-clear') and pg.is_visible('#acct-signout'))
    pg.click('#acct-signout-clear'); pg.wait_for_timeout(800)
    check('signed out + cleared: back on a fresh sign-in screen for the next preacher', pg.is_visible('#signin') and pg.input_value('#si-email') == '' and 'ready for the next preacher' in pg.inner_text('body'))
    pg.click('#si-back'); pg.wait_for_selector('#home:not([hidden])')
    check('signed out: library cleared of that account', 'Edited offline' not in pg.inner_text('#library') and pg.inner_text('#acct-label') == 'Sign in')

    # ---------------- Code sign-in for an existing account (shared iPad)
    pg.click('#btn-account'); pg.wait_for_selector('#signin:not([hidden])')
    pg.fill('#si-email', 'stranger@example.com'); pg.click('#si-send'); pg.wait_for_timeout(400)
    check('code sign-in: unknown email -> "no account, create one" (no email sent)', 'no account' in pg.inner_text('#si-status') and 'Create an account' in pg.inner_text('#si-status') and pg.is_visible('#si-email-form'), pg.inner_text('#si-status'))
    pg.fill('#si-email', 'chris@familychurch.org'); pg.click('#si-send')
    pg.wait_for_selector('#si-sent:not([hidden])')
    db = mockdb(pg)
    check('code requested (signInWithOtp) for that email', db['log'][-1]['type'] == 'otp' and db['log'][-1]['email'] == 'chris@familychurch.org')
    pg.wait_for_timeout(200)
    attrs = pg.eval_on_selector('#si-code', 'e => ({im: e.inputMode, ac: e.autocomplete, focused: document.activeElement === e, fs: parseFloat(getComputedStyle(e).fontSize)})')
    check('code step: big numeric one-time-code field, focused', attrs['im'] == 'numeric' and attrs['ac'] == 'one-time-code' and attrs['focused'] and attrs['fs'] >= 30, json.dumps(attrs))
    check('code step: title + email shown', pg.text_content('#si-title') == 'Enter your code' and 'chris@familychurch.org' in pg.inner_text('#si-sent'))
    pg.screenshot(path=str(SHOTS / 'signin-code.png'))
    pg.fill('#si-code', '000000'); pg.wait_for_timeout(500)
    check('wrong code (auto-submitted at 6 digits) shows friendly error', 'didn’t work' in pg.inner_text('#si-status'), pg.inner_text('#si-status'))
    pg.fill('#si-code', '12'); pg.wait_for_timeout(100)
    check('typing clears the error and partial codes are not submitted', pg.inner_text('#si-status') == '' and pg.is_visible('#si-sent'))
    pg.fill('#si-code', ''); pg.focus('#si-code')
    pg.evaluate("""() => { const el = document.getElementById('si-code'); const dt = new DataTransfer(); dt.setData('text/plain', 'Your code: 123 456');
      el.value = dt.getData('text/plain'); el.dispatchEvent(new Event('input', { bubbles: true })); }""")  # paste "123 456"
    pg.wait_for_selector('#home:not([hidden])', timeout=5000); pg.wait_for_timeout(1200)
    check('code sign-in returns home signed in', pg.inner_text('#acct-label') == 'Chris Park', pg.inner_text('#acct-label'))
    try: pg.wait_for_function("document.getElementById('library').innerText.includes('Edited offline')", timeout=8000)
    except Exception: pass
    check('code sign-in: synced sermons come back', 'Edited offline' in pg.inner_text('#library'), pg.evaluate("JSON.stringify({lib: document.getElementById('library').innerText.slice(0,200), st: window.__preach.sync.status, err: window.__preach.sync.error, meta: localStorage.getItem('preach.v1.meta'), rows: JSON.parse(localStorage.getItem('__mockdb')).sermons.filter(s=>s.title.startsWith('Edited')).map(s=>[s.user_id,s.deleted])})"))
    pg.click('#btn-account'); pg.wait_for_selector('#dlg-account[open]'); pg.click('#acct-signout-clear'); pg.wait_for_timeout(800)
    pg.click('#si-back'); pg.wait_for_selector('#home:not([hidden])')
    check('signed out again', pg.inner_text('#acct-label') == 'Sign in')

    # ---------------- Admin (password sign-in) + review page
    pg.click('#btn-account'); pg.wait_for_selector('#signin:not([hidden])')
    pg.click('#si-use-pw'); pg.fill('#si-pw-email', 'jake@familychurch.org'); pg.fill('#si-pw', 'wrong-password'); pg.click('#si-pw-signin'); pg.wait_for_timeout(400)
    check('bad password -> friendly error', 'don’t match' in pg.inner_text('#si-status'))
    pg.fill('#si-pw', 'jake-pass-123'); pg.click('#si-pw-signin')
    pg.wait_for_selector('#home:not([hidden])', timeout=5000); pg.wait_for_timeout(1200)
    check('admin: Review button visible', pg.is_visible('#btn-review'))
    check('admin: own library only in the app', 'Unshakable' not in pg.inner_text('#library'))
    pg.screenshot(path=str(SHOTS / 'accounts-home-admin.png'))
    pg.click('#btn-review'); pg.wait_for_selector('#rv-main:not([hidden])', timeout=8000); pg.wait_for_timeout(500)
    check('review: admin sees the team invite code', pg.is_visible('#rv-invite') and pg.text_content('#rv-invite-code') == 'GRACE-1234' and 'app_settings' in pg.text_content('#rv-invite'), pg.text_content('#rv-invite'))
    titles = pg.eval_on_selector_all('#rv-list .rv-title', 'e => e.map(x => x.textContent)')
    check('review: all preachers’ recordings, newest first', len(titles) == 3 and titles[0].startswith('Edited offline') and titles[1] == 'The Prodigal’s Brother' and titles[2].startswith('Unshakable'), str(titles))
    opts = pg.eval_on_selector_all('#rv-preacher option', 'e => e.map(x => x.textContent)')
    check('review: preacher filter lists profiles', 'Ana Rivera' in opts and 'Ben Carter' in opts, str(opts))
    pg.select_option('#rv-preacher', ANA); pg.wait_for_timeout(200)
    check('review: filter by preacher', pg.eval_on_selector_all('#rv-list .rv-title', 'e => e.length') == 1)
    pg.click('#rv-list .rv-row'); pg.wait_for_selector('#rv-list audio', timeout=5000); pg.wait_for_timeout(500)
    det = pg.inner_text('#rv-list .rv-detail')
    check('review: plays recording via signed URL', pg.eval_on_selector('#rv-list audio', 'a => a.src.startsWith("blob:")'))
    check('review: shows summary, grade, transcript', 'Strong opening story' in det and 'B+' in det and 'Clarity of big idea' in det and 'Hebrews chapter twelve' in det)
    check('review: shows overtime', '+3:32 over' in pg.inner_text('#rv-list .rv-sub'))
    pg.screenshot(path=str(SHOTS / 'review-recordings.png'), full_page=True)
    pg.select_option('#rv-preacher', ''); pg.click('#rv-tabs [data-tab="sermons"]'); pg.wait_for_timeout(200)
    st = pg.eval_on_selector_all('#rv-list .rv-title', 'e => e.map(x => x.textContent)')
    check('review: all sermons newest first (deleted hidden)', len(st) == 3 and 'Throwaway draft' not in st, str(st))
    pg.screenshot(path=str(SHOTS / 'review-sermons.png'))
    pg.locator('#rv-list .rv-row', has_text='Unshakable').click(); pg.wait_for_selector('#dlg-sermon[open]'); pg.wait_for_timeout(400)
    check('review: sermon opens read-only', 'Unshakable' in pg.inner_text('#sv-title') and 'read-only' in pg.inner_text('#sv-meta') and pg.eval_on_selector('#sv-body', 'e => !e.isContentEditable'))
    pg.screenshot(path=str(SHOTS / 'review-sermon-open.png'))
    pg.click('#dlg-sermon [data-close]')
    # Phase 2 on the review page: AI feedback section + admin re-run + email deep link
    pg.click('#rv-tabs [data-tab="recordings"]'); pg.wait_for_timeout(200)
    pg.locator('#rv-list .rv-row', has_text='Edited offline').click(); pg.wait_for_selector('#rv-list .rv-ai', timeout=5000)
    det = pg.text_content('#rv-list .rv-detail')
    check('review: AI feedback (strengths, growth, answer) for graded recording', all(x in det for x in ['AI feedback', 'Strengths', 'Growth areas', 'give one specific step', 'AI feedback ready']), det[:200])
    check('review: badge shows grade', 'B+' in pg.locator('#rv-list .rv-item', has_text='Edited offline').locator('.status-badge').inner_text())
    pg.screenshot(path=str(SHOTS / 'review-ai-feedback.png'), full_page=True)
    pg.click('#rv-list .rv-detail [data-act="grade"]'); pg.wait_for_timeout(400)
    fn = mockdb(pg).get('fnlog') or []
    check('review: admin "Re-run AI feedback" forces a re-grade', fn and fn[-1]['body'] == {'recording_id': rid, 'force': True} and fn[-1]['uid'] == JAKE, json.dumps(fn[-1:]))
    pg.goto(BASE + 'review.html?rec=' + rid); pg.wait_for_selector('#rv-main:not([hidden])', timeout=8000)
    pg.wait_for_selector('#rv-list .rv-detail', timeout=5000)
    check('review: ?rec=<id> deep link (email button) opens that recording', 'Edited offline' in pg.locator('#rv-list .rv-item', has=pg.locator('.rv-detail')).inner_text())
    check('no JS errors', not errors, '; '.join(errors[:4]))
    ctx.close()

    # ---------------- Phone layouts
    c = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, service_workers='block')
    c.add_init_script(f"window.__MOCK_SEED = {json.dumps(SEED)};")
    c.route('**/vendor/supabase.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=MOCK))
    c.route('**/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=CONFIG))
    q = c.new_page(); q.goto(BASE + '#signin'); q.wait_for_selector('#signin:not([hidden])', timeout=5000)
    q.screenshot(path=str(SHOTS / 'signin-phone.png'))
    q.evaluate("localStorage.setItem('__mocksession', JSON.stringify({access_token:'x', user:{id:'%s', email:'jake@familychurch.org'}}))" % JAKE)
    q.goto(BASE + 'review.html'); q.wait_for_selector('#rv-main:not([hidden])', timeout=8000); q.wait_for_timeout(400)
    check('phone: review page renders for admin', q.eval_on_selector_all('#rv-list .rv-item', 'e => e.length') == 2)
    q.screenshot(path=str(SHOTS / 'review-phone.png'))
    c.close()

    # ---------------- Not configured: no account UI at all
    c = browser.new_context(viewport={'width': 1180, 'height': 820}, service_workers='block')
    c.route('**/config.js', lambda route: route.fulfill(status=200, content_type='application/javascript',
        body="window.PREACH_CONFIG = { supabaseUrl: '', supabaseAnonKey: '', apiBibleKey: '' };"))
    q = c.new_page(); q.goto(BASE); q.wait_for_selector('#home:not([hidden])')
    check('unconfigured: no account button/banner (local-only app)', not q.is_visible('#btn-account') and not q.is_visible('#signin-banner'))
    q.goto(BASE + 'review.html'); q.wait_for_timeout(600)
    check('unconfigured: review page explains setup', 'aren’t set up' in q.inner_text('#rv-msg'))
    c.close()
    browser.close()

fails = [r for r in results if not r[0]]
print(f'\n{len(results) - len(fails)}/{len(results)} checks passed')
sys.exit(1 if fails else 0)
