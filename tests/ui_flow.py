"""End-to-end demo-mode flows with screenshots (tablet 1024x768 and phone 390x844)."""
import os, re, sys
from playwright.sync_api import sync_playwright, expect
BASE = 'http://127.0.0.1:8766/reading-competition/'
OUT = '/workspace/reading_competition/build-screenshots/'
os.makedirs(OUT, exist_ok=True)
probs, notes = [], []
def ok(cond, msg):
    notes.append(('PASS' if cond else 'FAIL') + ' ' + msg)
def watch(page, tag):
    page.on('console', lambda m: m.type in ('error', 'warning') and 'config.js' not in (m.location or {}).get('url', '') and probs.append((tag, m.type, m.text, (m.location or {}).get('url'))))
    page.on('pageerror', lambda e: probs.append((tag, 'pageerror', str(e))))
def shot(page, name): page.evaluate('window.scrollTo(0,0)'); page.wait_for_timeout(350); page.screenshot(path=OUT + name + '.png', full_page=True)
def login(page, uid, dest):
    try: page.evaluate("window.MC && window.MC.api && window.MC.api.signOut && window.MC.api.signOut()")
    except Exception: pass
    page.wait_for_timeout(250); page.goto(BASE + 'login.html'); page.wait_for_selector(f'button[data-id="{uid}"]'); page.wait_for_timeout(150)
    page.click(f'button[data-id="{uid}"]'); page.wait_for_url('**/' + dest, timeout=15000); page.wait_for_timeout(600)
def tab(page, hid): page.click(f'nav.tabs [role=tab][aria-controls="{hid}"]'); page.wait_for_timeout(300)
def modal_ok(page): page.click('.modal button[type=submit]'); page.wait_for_timeout(500)

with sync_playwright() as p:
    b = p.chromium.launch()
    for sz, (w, h) in {'tablet': (1024, 768), 'phone': (390, 844)}.items():
        ctx = b.new_context(viewport={'width': w, 'height': h}, accept_downloads=True)
        page = ctx.new_page(); watch(page, sz)
        # ---------- landing, mid-event ----------
        page.goto(BASE + 'index.html?demo=1&scenario=mid'); page.wait_for_timeout(800)
        txt = page.inner_text('body')
        ok('2026 Competition: November 20, 2026' in txt and 'Starts 9:00' in txt, f'{sz}: banner date + start time')
        ok('EXAMPLE DATA' in txt.upper(), f'{sz}: demo banner shown')
        ok('Azariah Williams' in txt and 'Our Lady of the Rosary Roman Catholic School' in txt and 'Grenada Informer' not in txt and 'Facebook, 4 Nov 2025' in txt, f'{sz}: 2025 winner card with Facebook source')
        ok('/250' not in txt, f'{sz}: no /250 anywhere')
        ok(not page.is_visible('#gallery') , f'{sz}: gallery hidden with no photos')
        shot(page, f'{sz}-01-landing-before-results')
        page.goto(BASE + 'login.html'); shot(page, f'{sz}-02-login')
        # ---------- judge B: partial sheet on open reader ----------
        login(page, 'u-j2', 'judge.html'); shot(page, f'{sz}-03-judge-my-readers')
        tab(page, 'score'); shot(page, f'{sz}-04-judge-score-sheet-partial')
        page.click('[data-act=final]'); page.wait_for_timeout(300)
        ok(page.is_visible('[data-missing]') and page.locator('.crit.missing').count() > 0, f'{sz}: finalize blocked + missing items highlighted')
        shot(page, f'{sz}-05-judge-missing-items')
        for c in page.locator('.crit').all():
            if c.locator('.score-btn[aria-pressed=true]').count() == 0: c.locator('.score-btn[data-score="4"]').click()
        page.locator('.crit .comment-in').first.fill('Clear voice, good pace.'); page.wait_for_timeout(1500)
        ok('All changes saved' in page.inner_text('#sheet'), f'{sz}: autosave reports saved')
        page.click('[data-act=final]'); page.wait_for_timeout(300)
        ok(page.is_visible('.modal'), f'{sz}: confirm dialog before turn-in'); shot(page, f'{sz}-06-judge-confirm-turn-in')
        modal_ok(page); page.wait_for_timeout(500)
        ok(page.locator('#sheet .score-btn:not([disabled])').count() == 0, f'{sz}: sheet read-only after turn-in')
        shot(page, f'{sz}-07-judge-turned-in-readonly')
        tab(page, 'turned'); shot(page, f'{sz}-08-judge-turned-in-list')
        page.goto(BASE + 'judge.html'); page.wait_for_timeout(600)
        ok('Example Judge A' not in page.inner_text('main'), f'{sz}: judge sees no other judge names/scores')
        # ---------- head: open next, scores, reopen ----------
        login(page, 'u-head', 'head.html'); shot(page, f'{sz}-09-head-running-order')
        page.locator('[data-open]').first.click(); page.wait_for_timeout(300)
        ok(page.is_visible('.modal'), f'{sz}: confirm to close current reader first'); shot(page, f'{sz}-10-head-confirm-close-current')
        modal_ok(page); ok(page.locator('.nowtag').count() == 1, f'{sz}: exactly one reader open')
        tab(page, 'score'); shot(page, f'{sz}-11-head-own-sheet')
        tab(page, 'all'); shot(page, f'{sz}-12-head-all-scores')
        page.locator('[data-reopen]').first.click(); modal_ok(page); ok(True, f'{sz}: reopen sheet ran')
        tab(page, 'judges'); shot(page, f'{sz}-13-head-judges-readonly')
        tab(page, 'final'); ok(page.is_disabled('#btn-finalize'), f'{sz}: finalize disabled while not ready'); shot(page, f'{sz}-14-head-finalize-not-ready')
        # ---------- ready scenario: publish ----------
        page.goto(BASE + 'head.html?scenario=ready'); page.wait_for_timeout(300)
        login(page, 'u-head', 'head.html'); tab(page, 'final')
        ok(page.is_enabled('#btn-finalize'), f'{sz}: finalize enabled when ready'); shot(page, f'{sz}-15-head-finalize-ready')
        page.click('#btn-finalize'); shot(page, f'{sz}-16-head-confirm-publish'); modal_ok(page); page.wait_for_timeout(500)
        ok('Public results' in page.inner_text('#final-body'), f'{sz}: published'); shot(page, f'{sz}-17-head-posted-export-revert')
        with page.expect_download() as d: page.locator('[data-xj]').first.click()
        dl = d.value; path = f'/workspace/reading_competition/tests/out/ui_{sz}_{dl.suggested_filename}'; dl.save_as(path)
        ok(dl.suggested_filename.endswith('.xlsx'), f'{sz}: export downloaded {dl.suggested_filename}'); notes.append('FILE ' + path)
        with page.expect_download() as d: page.click('[data-xsum]')
        d.value.save_as(f'/workspace/reading_competition/tests/out/ui_{sz}_summary.xlsx'); ok(True, f'{sz}: summary export downloaded')
        page.goto(BASE + 'index.html'); page.wait_for_timeout(800)
        txt = page.inner_text('body'); ok('Total' in txt and '/250' not in txt and page.locator('.podium, [class*=podium]').count() > 0, f'{sz}: landing podium + standings with Total')
        shot(page, f'{sz}-18-landing-results-posted')
        # revert flow
        login(page, 'u-head', 'head.html'); tab(page, 'final')
        page.fill('#rv-form textarea', 'Judge 2 scored the wrong reader for item 3.')
        page.evaluate("window.dispatchEvent(new StorageEvent('storage', {key: 'mcrc_demo_state_v1'}))"); page.wait_for_timeout(400)
        ok(page.input_value('#rv-form textarea').startswith('Judge 2'), f'{sz}: revert reason survives live re-render')
        page.click('#rv-form button[type=submit]'); page.wait_for_timeout(500)
        login(page, 'u-admin', 'admin.html'); shot(page, f'{sz}-19-admin-overview')
        tab(page, 'final'); shot(page, f'{sz}-20-admin-finalization-revert-pending')
        page.click('[data-rvok]'); page.wait_for_timeout(300); shot(page, f'{sz}-21-admin-confirm-revert'); modal_ok(page)
        page.goto(BASE + 'index.html'); page.wait_for_timeout(600)
        ok(page.locator('[class*=podium]').count() == 0, f'{sz}: results off landing after approved revert')
        # ---------- admin tabs ----------
        login(page, 'u-admin', 'admin.html')
        for hid in ['users', 'judges', 'readers', 'criteria', 'live', 'photos']:
            tab(page, hid); shot(page, f'{sz}-22-admin-{hid}')
        tab(page, 'users'); page.click('#add-user'); page.wait_for_timeout(300); shot(page, f'{sz}-23-admin-add-user-dialog'); page.click('.modal [data-cancel]')
        tab(page, 'readers'); page.locator('[data-rsub]').first.click(); page.wait_for_timeout(300); shot(page, f'{sz}-24-admin-substitute-reader'); 
        if page.is_visible('.modal'): page.click('.modal [data-cancel]')
        tab(page, 'criteria'); page.locator('[data-cdel]').first.click(); page.wait_for_timeout(300); shot(page, f'{sz}-25-admin-remove-criterion-warning')
        if page.is_visible('.modal'): page.click('.modal [data-cancel]')
        tab(page, 'judges'); 
        heads = page.locator('[data-premove]').count(); notes.append(f'INFO {sz}: {heads} remove buttons on panel')
        # photo upload (demo)
        tab(page, 'photos')
        page.set_input_files('#photo-form input[type=file]', '/workspace/reading_competition/site/icons/icon-512.png')
        page.click('#photo-form button[type=submit]'); page.wait_for_timeout(1200); shot(page, f'{sz}-26-admin-photo-uploaded')
        page.goto(BASE + 'index.html'); page.wait_for_timeout(800)
        ok(page.is_visible('#gallery'), f'{sz}: gallery appears once a photo exists'); shot(page, f'{sz}-27-landing-with-gallery')
        ctx.close()
    b.close()
print('\n'.join(notes))
for x in probs: print('CONSOLE', x)
print(sum(n.startswith('FAIL') for n in notes), 'failed;', len(probs), 'console problems')
