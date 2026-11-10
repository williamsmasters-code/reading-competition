"""Live-mode run: the real site + real supabase-js (CDN) + real SQL (PGlite) + real admin-users
Edge Function (deno), through tests/mock_supabase.mjs. Playwright routes https://mockproj.supabase.co
to the local mock. Realtime websocket is swallowed (the site falls back to its 30 s poll)."""
import re, sys, json
from playwright.sync_api import sync_playwright
B = 'http://127.0.0.1:8767/reading-competition/'
MOCK = 'http://127.0.0.1:54321'
OUT = '/workspace/reading_competition/build-screenshots/'
notes, probs = [], []
def ok(c, m): notes.append(('PASS ' if c else 'FAIL ') + m)
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={'width': 1024, 'height': 768}, accept_downloads=True)
    def fwd(route):
        r = route.request; url = r.url.replace('https://mockproj.supabase.co', MOCK)
        try: route.fulfill(response=route.fetch(url=url))
        except Exception as e: route.abort()
    ctx.route('https://mockproj.supabase.co/**', fwd)
    ctx.route_web_socket(re.compile(r'wss://mockproj\.supabase\.co/.*'), lambda ws: None)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type in ('error', 'warning') and probs.append((m.type, m.text)))
    pg.on('pageerror', lambda e: probs.append(('pageerror', str(e))))
    pg.on('dialog', lambda d: d.accept())
    def login(email, dest, pw='Password-123'):
        pg.goto(B + 'index.html'); pg.wait_for_timeout(300)
        pg.evaluate("localStorage.clear(); sessionStorage.clear()")
        pg.goto(B + 'login.html'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw); pg.click('#f button[type=submit]')
        if dest: pg.wait_for_url('**/' + dest, timeout=15000); pg.wait_for_timeout(1500)
        else: pg.wait_for_timeout(2500)
    def tab(h): pg.click(f'nav.tabs [role=tab][aria-controls="{h}"]'); pg.wait_for_timeout(400)
    def modal_ok(): pg.click('.modal button[type=submit]'); pg.wait_for_timeout(1200)
    def score_and_turn_in(base=3):
        for i, c in enumerate(pg.locator('#sheet .crit').all()): c.locator(f'.score-btn[data-score="{min(5, base + (i % 2))}"]').click(); pg.wait_for_timeout(60)
        pg.locator('#sheet .crit textarea').first.fill('Live-mode comment'); pg.wait_for_timeout(1500)
        pg.click('#sheet [data-act=final]')
        try: pg.wait_for_selector('.modal', timeout=5000)
        except Exception: notes.append('DEBUG no modal; missing=' + pg.inner_text('#sheet [data-missing]')); pg.screenshot(path='/tmp/fail.png', full_page=True); return False
        modal_ok()
        try: pg.wait_for_function("document.querySelectorAll('#sheet .score-btn:not([disabled])').length === 0", timeout=8000); return True
        except Exception:
            pg.screenshot(path='/tmp/fail.png', full_page=True); notes.append('DEBUG ' + pg.inner_text('#sheet')[-400:].replace(chr(10), ' | ')); return False

    try:
        pg.goto(B + 'index.html'); pg.wait_for_timeout(2000)
        t = pg.inner_text('body')
        ok('EXAMPLE DATA' not in t.upper(), 'live: no demo banner when configured')
        ok('November 20, 2026' in t and 'Starts' not in t, 'live: banner date, no start time yet (from public_landing RPC)')
        login('nobody@mock.test', None); ok('does not have access' in pg.inner_text('#msg'), 'live: no-role account refused at sign-in')
        login('judge1@mock.test', None, 'wrong-pass'); ok('do not match' in pg.inner_text('#msg'), 'live: wrong password message')
        login('judge1@mock.test', 'judge.html'); ok('Mock Judge 1' in pg.inner_text('body'), 'live: judge signed in')
        ok(pg.locator('#readers-list [data-pick]').count() == 0, 'live: no reader can be picked before Head Judge opens judging')
        # head opens reader 1 and sets start time
        login('head@mock.test', 'head.html')
        pg.fill('#ev-time', '09:30'); pg.click('#ev-form button[type=submit]'); pg.wait_for_timeout(1200)
        pg.locator('[data-open]').first.click(); pg.wait_for_timeout(1500)
        ok(pg.locator('.nowtag').count() == 1, 'live: Head Judge opened reader 1 (open_reader RPC)')
        tab('score'); ok(score_and_turn_in(4), 'live: Head Judge scored + turned in reader 1')
        pg.goto(B + 'index.html'); pg.wait_for_timeout(1500); ok('Starts 9:30' in pg.inner_text('body'), 'live: landing shows start time set by Head Judge')
        for j in range(1, 5):
            login(f'judge{j}@mock.test', 'judge.html'); tab('score')
            ok(score_and_turn_in(3 if j % 2 else 4), f'live: judge {j} scored + turned in reader 1 (save_scores + turn_in_sheet)')
        pg.screenshot(path=OUT + 'live-mock-judge-turned-in.png', full_page=True)
        # isolation: judge4 cannot read others' scores
        n_scores = pg.evaluate("MC.state.scores.length"); ok(n_scores == 10, f'live: judge sees only own 10 scores via RLS (got {n_scores})')
        # head opens reader 2 (closing 1)
        login('head@mock.test', 'head.html'); pg.locator('[data-open]').first.click(); pg.wait_for_timeout(500); modal_ok()
        ok('Mock Reader Two' in pg.inner_text('.rrow.now'), 'live: reader 2 open, reader 1 closed')
        tab('score'); ok(score_and_turn_in(5), 'live: Head Judge scored reader 2')
        for j in range(1, 5):
            login(f'judge{j}@mock.test', 'judge.html'); tab('score'); ok(score_and_turn_in(2 + j % 3), f'live: judge {j} scored reader 2')
        # Setup tab against the real 08_setup.sql RPCs (Head Judge), then the Site Admin
        login('head@mock.test', 'head.html'); sc0 = pg.evaluate("JSON.stringify(MC.state.scores.map(x => [x.reader_id, x.judge_id, x.criterion_id, x.score]).sort())")
        tab('setup'); pg.fill('#new-item', 'Mock Second Item'); pg.click('form[data-sform=add_item] button'); pg.wait_for_timeout(1500)
        ok('Mock Second Item' in pg.inner_text('#setup'), 'live: Head Judge added an item (setup_change RPC)')
        pg.locator('[data-rcount="2"]').click(); pg.wait_for_timeout(1500)
        pg.fill('[data-rname="2"]', 'Mock Final'); pg.press('[data-rname="2"]', 'Tab'); pg.wait_for_timeout(1500)
        ok(pg.evaluate("MC.state.rounds.length") == 2 and pg.evaluate("MC.state.rounds[1].name") == 'Mock Final', 'live: Head Judge set 2 rounds and named round 2')
        pg.fill('#new-district', 'MOCKTWO'); pg.click('form[data-sform=add_district] button'); pg.wait_for_timeout(1500)
        tab('order'); r1 = pg.evaluate("MC.state.readers[0].id"); r2 = pg.evaluate("MC.state.readers[1].id")
        pg.click(f'#order-list [data-rdetails="{r1}"]'); pg.wait_for_timeout(300)
        pg.select_option('.modal select[name=item]', label='Mock Second Item'); pg.select_option('.modal select[name=district]', label='MOCKTWO')
        pg.locator('.modal button[type=submit]').evaluate('b => b.click()'); pg.wait_for_timeout(500)
        ok('already turned in' in pg.inner_text('.modal'), 'live: warning before changing the item of a reader with turned-in sheets')
        pg.locator('.modal button[type=submit]').evaluate('b => b.click()'); pg.wait_for_timeout(1800)
        r = pg.evaluate(f"MC.state.readers.find(x => x.id === '{r1}')")
        ok(r['item'] == 'Mock Second Item' and r['district'] == 'MOCKTWO' and r['item_id'], 'live: set_reader_details gave reader 1 its own item + district ' + json.dumps({k: r[k] for k in ('item', 'round', 'district')}))
        pg.click(f'#order-list [data-mvup="{r2}"]'); pg.wait_for_timeout(1800)
        ok(pg.evaluate("MC.state.readers[0].id") == r2 and pg.evaluate("MC.state.readers.map(x => x.position).join()") == '1,2', 'live: move_reader put reader 2 first')
        pg.click(f'#order-list [data-mvdown="{r2}"]'); pg.wait_for_timeout(1800)
        ok(pg.evaluate("MC.state.readers[0].id") == r1, 'live: and back')
        ok(sc0 == pg.evaluate("JSON.stringify(MC.state.scores.map(x => [x.reader_id, x.judge_id, x.criterion_id, x.score]).sort())"), 'live: no score changed by setup changes')
        pg.screenshot(path=OUT + 'live-mock-head-setup.png', full_page=True)
        login('judge1@mock.test', 'judge.html')
        e1 = pg.evaluate("MC.api.setupChange('add_item', {title: 'nope'}).then(() => 'ok', e => e.message)")
        ok('Only the Head Judge or the Site Admin' in e1, 'live: judge refused by setup_change')
        e2 = pg.evaluate(f"MC.api.moveReader('{r1}', 2).then(() => 'ok', e => e.message)")
        ok('Only the Head Judge or the Site Admin' in e2, 'live: judge refused by move_reader')
        login('admin@mock.test', 'admin.html'); tab('readers')
        pg.fill('#rform input[name=student_name]', 'Mock Temp Reader'); pg.select_option('#rform-round', '2'); pg.click('#rform-save'); pg.wait_for_timeout(1800)
        t = pg.evaluate("MC.state.readers.find(x => x.student_name === 'Mock Temp Reader')")
        ok(t and t['round'] == 'Mock Final' and t['round_no'] == 2 and t['position'] == 3, 'live: Site Admin added a reader in round 2 (labels from the trigger) ' + json.dumps(t and {k: t[k] for k in ('item', 'round', 'district')}))
        pg.click(f'#readers-table [data-rdel="{t["id"]}"]'); pg.wait_for_timeout(300); pg.locator('.modal button[type=submit]').evaluate('b => b.click()'); pg.wait_for_timeout(1800)
        ok(pg.evaluate("MC.state.readers.length") == 2, 'live: Site Admin removed the temporary reader')
        # admin: edge function create user, reset password, panel add, criteria warning
        login('admin@mock.test', 'admin.html'); tab('users'); pg.click('#add-user'); pg.wait_for_timeout(300)
        pg.fill('.modal [name=full_name]', 'Mock Judge Five'); pg.fill('.modal [name=email]', 'judge5@mock.test'); pg.fill('.modal [name=password]', 'Temp-pass-55')
        if pg.locator('.modal select[name=role]').count(): pg.select_option('.modal select[name=role]', 'judge')
        pg.uncheck('.modal [name=panel]'); modal_ok(); pg.wait_for_timeout(800)
        ok('judge5@mock.test' in pg.inner_text('#users-table'), 'live: Site Admin created an account through the admin-users Edge Function')
        row = pg.locator('#users-table tr', has_text='judge5@mock.test'); row.locator('[data-upw]').click(); pg.wait_for_timeout(300)
        pg.fill('.modal [name=pw]', 'New-pass-777'); modal_ok()
        login('judge5@mock.test', 'judge.html', 'New-pass-777'); ok('Mock Judge Five' in pg.inner_text('body'), 'live: password reset by Site Admin (Edge Function) lets the user sign in with the new password')
        ok('not on the judging panel' in pg.inner_text('main'), 'live: judge not on the panel sees the not-on-panel warning')
        # head: close reader 2 and finalize
        login('head@mock.test', 'head.html'); pg.locator('[data-close]').first.click(); pg.wait_for_timeout(1500)
        tab('final'); ok(pg.is_enabled('#btn-finalize'), 'live: finalize enabled after all sheets turned in + readers closed')
        pg.click('#btn-finalize'); pg.wait_for_timeout(300); modal_ok(); pg.wait_for_timeout(1000)
        ok('Public results' in pg.inner_text('#final-body'), 'live: finalize_results published')
        pg.screenshot(path=OUT + 'live-mock-head-posted.png', full_page=True)
        with pg.expect_download(timeout=30000) as d: pg.locator('[data-xj]').first.click()
        d.value.save_as('/workspace/reading_competition/tests/out/live_mock_export.xlsx'); ok(True, 'live: export downloaded ' + d.value.suggested_filename)
        pg.goto(B + 'index.html'); pg.wait_for_timeout(2000); t = pg.inner_text('body')
        ok('Mock Reader' in t and 'Total' in t and '1st' in t.replace('1ST', '1st') or '1ST PLACE' in t.upper(), 'live: landing shows podium from public_landing after publish')
        pg.screenshot(path=OUT + 'live-mock-landing-posted.png', full_page=True)
        # judge cannot edit after publish
        login('judge1@mock.test', 'judge.html')
        try: pg.evaluate("MC.api.saveScores(MC.state.readers[0].id, [{criterion_id: MC.state.criteria[0].id, score: 1, comment: ''}])"); ok(False, 'live: save after publish should fail')
        except Exception as e: ok('posted' in str(e).lower() or 'turned in' in str(e).lower() or 'locked' in str(e).lower(), 'live: server refuses score edits after publish: ' + str(e).split('\n')[0][:120])
    except Exception as e:
        notes.append('FAIL exception: ' + str(e).split(chr(10))[0])
    br.close()
print('\n'.join(notes))
for x in probs: print('CONSOLE', x)
print(sum(n.startswith('FAIL') for n in notes), 'failed;', len(probs), 'console problems')
