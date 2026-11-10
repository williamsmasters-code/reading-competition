"""Live-mode (local mock Supabase + real Edge Function) tests for email change and invite/reset links."""
import re, json, urllib.request
from playwright.sync_api import sync_playwright
B = 'http://127.0.0.1:8767/reading-competition/'; MOCK = 'http://127.0.0.1:54321'
notes, probs = [], []
def ok(c, m): notes.append(('PASS ' if c else 'FAIL ') + m)
get = lambda path: json.loads(urllib.request.urlopen(MOCK + path).read())
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 390, 'height': 844})
    ctx.route('https://mockproj.supabase.co/**', lambda r: r.fulfill(response=r.fetch(url=r.request.url.replace('https://mockproj.supabase.co', MOCK))))
    ctx.route_web_socket(re.compile(r'wss://.*'), lambda ws: None)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type in ('error', 'warning') and probs.append((m.type, m.text)))
    pg.on('pageerror', lambda e: probs.append(('pageerror', str(e))))
    def fresh(): pg.goto(B + 'index.html'); pg.evaluate("localStorage.clear(); sessionStorage.clear()"); pg.goto('about:blank')
    def login(email, pw='Password-123', dest=None):
        fresh(); pg.goto(B + 'login.html'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw); pg.click('#f button[type=submit]')
        if dest:
            try: pg.wait_for_url('**/' + dest, timeout=10000); pg.wait_for_timeout(1200); return True
            except Exception: return False
        pg.wait_for_timeout(2000); return False
    def modal_ok(): pg.click('.modal button[type=submit]'); pg.wait_for_timeout(1500)
    try:
        # 1. self-service change (judge) -> pending until link clicked
        login('judge1@mock.test', dest='judge.html')
        pg.click('#embtn'); pg.fill('.modal [name=email]', 'Judge1.New@Mock.test'); modal_ok()
        ok('confirmation link' in pg.inner_text('body'), 'self change: user told to click the confirmation link')
        ok(any('login.html' in x for x in get('/mock/log')), 'self change: confirmation link returns to login.html')
        ok(login('judge1@mock.test', dest='judge.html'), 'self change: old email still works before confirming')
        get('/mock/confirm_email')
        ok(not login('judge1@mock.test', dest='judge.html'), 'self change: old email stops working after confirming')
        ok(login('judge1.new@mock.test', dest='judge.html'), 'self change: new email (any capitals) signs in, same password')
        # 2. Site Admin changes someone else's email (immediate), and the table shows it
        login('admin@mock.test', dest='admin.html'); pg.click('nav.tabs [aria-controls=users]'); pg.wait_for_timeout(400)
        ok('judge1.new@mock.test' in pg.inner_text('#users-table'), 'profiles.email synced from Auth (admin sees new email)')
        pg.locator('#users-table tr', has_text='judge2@mock.test').locator('[data-uemail]').click(); pg.fill('.modal [name=email]', 'judge2.renamed@mock.test'); modal_ok()
        ok('judge2.renamed@mock.test' in pg.inner_text('#users-table'), 'admin change: users table updated at once (Edge Function update_email)')
        pg.locator('#users-table tr', has_text='judge3@mock.test').locator('[data-uemail]').click(); pg.fill('.modal [name=email]', 'judge1.new@mock.test'); modal_ok()
        ok('already uses' in pg.inner_text('body'), 'admin change: duplicate email refused')
        # admin changes own email through the same tool
        pg.locator('#users-table tr', has_text='admin@mock.test').locator('[data-uemail]').click(); pg.fill('.modal [name=email]', 'admin2@mock.test'); modal_ok()
        ok(login('admin2@mock.test', dest='admin.html'), 'admin change: Site Admin can change their own email and sign in with it')
        ok(login('judge2.renamed@mock.test', dest='judge.html'), 'admin change: judge signs in with the new email')
        # 3. password-reset link landing on the Site URL (index.html)
        t = get('/mock/token?email=judge3@mock.test'); fresh()
        pg.goto(B + f"index.html#access_token={t['access_token']}&expires_in=3600&refresh_token={t['refresh_token']}&token_type=bearer&type=recovery"); pg.wait_for_timeout(2500)
        ok(pg.url.split('#')[0].endswith('login.html') and pg.is_visible('#setpw'), 'reset link on index.html goes to login.html "choose a new password"')
        pg.fill('#pwf [name=pw]', 'Fresh-pass-333'); pg.fill('#pwf [name=pw2]', 'Fresh-pass-333'); pg.click('#pwf button'); 
        try: pg.wait_for_url('**/judge.html', timeout=10000); ok(True, 'reset link: password saved, judge goes to their console')
        except Exception: ok(False, 'reset link: password saved, judge goes to their console: ' + pg.inner_text('#pwmsg'))
        ok(login('judge3@mock.test', 'Fresh-pass-333', 'judge.html'), 'reset link: new password works')
        # 4. invite link for an account that has no role yet
        t = get('/mock/token?email=nobody@mock.test'); fresh()
        pg.goto(B + f"index.html#access_token={t['access_token']}&expires_in=3600&refresh_token={t['refresh_token']}&token_type=bearer&type=invite"); pg.wait_for_timeout(2500)
        ok('Welcome' in pg.inner_text('#setpw-title'), 'invite link shows "Welcome! Choose your password"')
        pg.fill('#pwf [name=pw]', 'Invite-pass-1'); pg.fill('#pwf [name=pw2]', 'Invite-pass-2'); pg.click('#pwf button'); pg.wait_for_timeout(500)
        ok('not the same' in pg.inner_text('#pwmsg'), 'invite: mismatched passwords caught')
        pg.fill('#pwf [name=pw2]', 'Invite-pass-1'); pg.click('#pwf button'); pg.wait_for_timeout(2500)
        ok('does not have access yet' in pg.inner_text('#pwmsg'), 'invite: password saved; no-role account told to wait for a role')
        # 5. expired link
        fresh(); pg.goto(B + 'index.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'); pg.wait_for_timeout(1500)
        ok('did not work' in pg.inner_text('#msg'), 'expired link: friendly message on login page')
    except Exception as e:
        notes.append('FAIL exception: ' + str(e).split('\n')[0])
    br.close()
print('\n'.join(notes))
for x in probs: print('CONSOLE', x)
print(sum(n.startswith('FAIL') for n in notes), 'failed;', len(probs), 'console problems')
