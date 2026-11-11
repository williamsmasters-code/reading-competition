"""Live-mode (local mock Supabase + real admin-users Edge Function): login emails on Add user and
Reset password. The Site Admin's password works at once and keeps working; the email (built-in
mailer, about 2 an hour) holds the site link, login email, role and an optional link."""
import re, json, urllib.request
from playwright.sync_api import sync_playwright
B = 'http://127.0.0.1:8767/reading-competition/'; MOCK = 'http://127.0.0.1:54321'
OUT = '/workspace/reading_competition/build-screenshots/'
notes, probs = [], []
def ok(c, m): notes.append(('PASS ' if c else 'FAIL ') + m)
def call(path, method='GET', body=None):
    req = urllib.request.Request(MOCK + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req).read() or b'{}')
pw_ok = lambda e, p: call(f'/mock/password_ok?email={e}&password={p}')['ok']
with sync_playwright() as p:
    br = p.chromium.launch()
    for sz, (w, h) in {'phone': (390, 844), 'tablet': (1024, 768)}.items():
        call('/mock/mail', 'DELETE'); call('/mock/email_allow', 'POST', {})
        ctx = br.new_context(viewport={'width': w, 'height': h})
        ctx.route('https://mockproj.supabase.co/**', lambda r: r.fulfill(response=r.fetch(url=r.request.url.replace('https://mockproj.supabase.co', MOCK))))
        ctx.route_web_socket(re.compile(r'wss://.*'), lambda ws: None)
        pg = ctx.new_page()
        pg.on('console', lambda m: m.type in ('error', 'warning') and probs.append((sz, m.type, m.text)))
        pg.on('pageerror', lambda e: probs.append((sz, 'pageerror', str(e))))
        def fresh(): pg.goto(B + 'index.html'); pg.evaluate("localStorage.clear(); sessionStorage.clear()"); pg.goto('about:blank')
        def login(email, pw='Password-123', dest=None):
            fresh(); pg.goto(B + 'login.html'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw); pg.click('#f button[type=submit]')
            try: pg.wait_for_url('**/' + dest, timeout=10000); pg.wait_for_timeout(1200); return True
            except Exception: return False
        def submit(): pg.locator('.modal button[type=submit]').last.evaluate('b => b.click()'); pg.wait_for_timeout(2200)
        def shot(name): pg.evaluate("document.querySelectorAll('.toast').forEach(t => t.hidden = true)"); pg.wait_for_timeout(200); pg.screenshot(path=OUT + name + '.png')
        n = 'a' if sz == 'phone' else 'b'
        try:
            ok(login('admin@mock.test', dest='admin.html'), f'{sz}: admin signed in')
            pg.click('nav.tabs [aria-controls=users]'); pg.wait_for_timeout(300)
            # 1. Add user, send login email (default on)
            pg.click('#add-user'); pg.wait_for_timeout(300)
            ok(pg.is_checked('.modal [name=send_email]'), f'{sz}: "Send login email" is ticked by default')
            ok('never' in pg.inner_text('.modal') and '2 emails an hour' in pg.inner_text('.modal'), f'{sz}: dialog explains password is never emailed + the 2-an-hour limit')
            pg.fill('.modal [name=full_name]', f'Mock New Judge {n.upper()}'); pg.fill('.modal [name=email]', f'newjudge{n}@mock.test'); pg.fill('.modal [name=password]', 'Start-pass-11')
            shot(f'dialog-add-user-{sz}')
            submit()
            mails = call('/mock/mail')
            m = mails[-1] if mails else {}
            ok(len(mails) == 1 and m.get('to') == f'newjudge{n}@mock.test', f'{sz}: one login email sent to the new judge')
            ok(m.get('data', {}).get('role_label') == 'Judge' and m['data'].get('email_reason') == 'new_account' and m['data'].get('full_name') == f'Mock New Judge {n.upper()}', f'{sz}: email data: name, role label "Judge", reason new_account')
            ok(m.get('redirect_to', '').endswith('/reading-competition/login.html?from=new_account'), f'{sz}: link goes to the set-password page ' + m.get('redirect_to', ''))
            ok('password' not in json.dumps(m.get('data', {})).lower(), f'{sz}: no password anywhere in the email data')
            ok(pw_ok(f'newjudge{n}@mock.test', 'Start-pass-11'), f'{sz}: starting password works straight away')
            ok(f'newjudge{n}@mock.test' in pg.inner_text('#users-table'), f'{sz}: new account listed')
            pg.click('nav.tabs [aria-controls=judges]'); pg.wait_for_timeout(300)
            ok(f'Mock New Judge {n.upper()}' in pg.inner_text('#panel-list'), f'{sz}: new judge added to the panel')
            # 2. the "Choose your own password" link: optional, Keep my current password
            t = call(f'/mock/token?email=newjudge{n}@mock.test'); fresh()
            pg.goto(B + f"login.html?from=new_account#access_token={t['access_token']}&expires_in=3600&refresh_token={t['refresh_token']}&token_type=bearer&type=recovery"); pg.wait_for_timeout(2500)
            ok('Welcome! Choose your own password' in pg.inner_text('#setpw-title') and 'keeps working' in pg.inner_text('#setpw-note'), f'{sz}: link page says choosing a password is optional')
            shot(f'login-choose-own-password-{sz}')
            pg.click('#keep'); 
            try: pg.wait_for_url('**/judge.html', timeout=8000); kept = True
            except Exception: kept = False
            ok(kept and pw_ok(f'newjudge{n}@mock.test', 'Start-pass-11'), f'{sz}: "Keep my current password" opens the console; starting password still works')
            # 3. Reset password + email
            login('admin@mock.test', dest='admin.html'); pg.click('nav.tabs [aria-controls=users]'); pg.wait_for_timeout(300)
            pg.locator('#users-table tr', has_text=f'newjudge{n}@mock.test').locator('[data-upw]').click(); pg.wait_for_timeout(300)
            ok(pg.is_checked('.modal [name=send_email]'), f'{sz}: reset dialog: send email ticked by default')
            pg.fill('.modal [name=pw]', 'Reset-pass-22'); shot(f'dialog-reset-password-{sz}'); submit()
            mails = call('/mock/mail')
            ok(len(mails) == 2 and mails[-1]['data'].get('email_reason') == 'password_reset' and mails[-1]['redirect_to'].endswith('login.html?from=password_reset'), f'{sz}: reset email sent with reason password_reset')
            ok(pw_ok(f'newjudge{n}@mock.test', 'Reset-pass-22') and not pw_ok(f'newjudge{n}@mock.test', 'Start-pass-11'), f'{sz}: new password works at once; old one stops')
            # 4. third email in the hour -> limit message, password still changed
            pg.locator('#users-table tr', has_text=f'newjudge{n}@mock.test').locator('[data-upw]').click(); pg.wait_for_timeout(300)
            pg.fill('.modal [name=pw]', 'Reset-pass-33'); submit()
            txt = pg.inner_text('.modal') if pg.locator('.modal').count() else ''
            ok('Saved, but no email was sent' in txt and '2 emails an hour' in txt, f'{sz}: clear message when the built-in email limit is reached')
            shot(f'dialog-email-limit-{sz}')
            submit()
            ok(pw_ok(f'newjudge{n}@mock.test', 'Reset-pass-33') and len(call('/mock/mail')) == 2, f'{sz}: password changed even though the email was not sent')
            # 5. Send login email unticked
            pg.locator('#users-table tr', has_text=f'newjudge{n}@mock.test').locator('[data-upw]').click(); pg.wait_for_timeout(300)
            pg.fill('.modal [name=pw]', 'Reset-pass-44'); pg.uncheck('.modal [name=send_email]'); submit()
            ok(pg.locator('.modal').count() == 0 and pw_ok(f'newjudge{n}@mock.test', 'Reset-pass-44'), f'{sz}: unticked: password reset, no email, no warning')
            # 6. built-in mailer refuses addresses outside the Supabase team
            call('/mock/mail', 'DELETE'); call('/mock/email_allow', 'POST', {'list': ['admin@mock.test']})
            pg.click('#add-user'); pg.wait_for_timeout(300)
            pg.fill('.modal [name=full_name]', f'Mock Other Judge {n.upper()}'); pg.fill('.modal [name=email]', f'otherjudge{n}@mock.test'); pg.fill('.modal [name=password]', 'Start-pass-55'); submit()
            txt = pg.inner_text('.modal') if pg.locator('.modal').count() else ''
            ok("project's team" in txt and pw_ok(f'otherjudge{n}@mock.test', 'Start-pass-55'), f'{sz}: "not authorized" address: clear message, account still created')
            submit(); call('/mock/email_allow', 'POST', {})
            # 7. expired link
            fresh(); pg.goto(B + 'login.html?from=password_reset#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'); pg.wait_for_timeout(1500)
            ok('did not work' in pg.inner_text('#msg') and pg.is_visible('#f') and not pg.is_visible('#setpw'), f'{sz}: expired link: friendly message and the normal sign-in form')
            shot(f'login-expired-link-{sz}')
        except Exception as e:
            notes.append('FAIL exception: ' + str(e).split(chr(10))[0])
        ctx.close()
    br.close()
print('\n'.join(notes))
for x in probs: print('CONSOLE', x)
print(sum(n.startswith('FAIL') for n in notes), 'failed;', len(probs), 'console problems')
