"""Setup tab (Items / Rounds / Districts), reorder and Edit details, in demo mode.
Phone 390x844 and tablet 1024x768. Screenshots: build-screenshots/setup-*.png"""
import json
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:8766/reading-competition/'
OUT = '/workspace/reading_competition/build-screenshots/'
notes, probs = [], []
def ok(c, m): notes.append(('PASS ' if c else 'FAIL ') + m)
def st(pg): return json.loads(pg.evaluate("localStorage.getItem('mcrc_demo_state_v2')"))
def scores_sig(pg): return json.dumps(sorted([[x['reader_id'], x['judge_id'], x['criterion_id'], x['score'], x.get('comment', '')] for x in st(pg)['scores']]))
with sync_playwright() as p:
    b = p.chromium.launch()
    for sz, (w, h) in {'tablet': (1024, 768), 'phone': (390, 844)}.items():
        ctx = b.new_context(viewport={'width': w, 'height': h}); pg = ctx.new_page()
        pg.on('console', lambda m: m.type in ('error', 'warning') and probs.append((sz, m.type, m.text)))
        pg.on('pageerror', lambda e: probs.append((sz, 'pageerror', str(e))))
        def login(uid, dest):
            try: pg.evaluate("window.MC && MC.api && MC.api.signOut && MC.api.signOut()")
            except Exception: pass
            pg.goto(BASE + 'login.html?demo=1'); pg.click(f'button[data-id="{uid}"]'); pg.wait_for_url('**/' + dest); pg.wait_for_timeout(600)
        def tab(hid): pg.click(f'nav.tabs [role=tab][aria-controls="{hid}"]'); pg.wait_for_timeout(300)
        def modal_ok(): pg.locator('.modal button[type=submit]').last.evaluate('b => b.click()'); pg.wait_for_timeout(500)
        def shot(name, full=True):
            pg.evaluate("document.querySelectorAll('.toast').forEach(t => t.hidden = true)")
            if full: pg.evaluate('window.scrollTo(0,0)')
            pg.wait_for_timeout(300); pg.screenshot(path=OUT + name + '.png', full_page=full)
        def aligned(tag):
            rows = pg.locator('#setup form.addrow2').all()
            good = True
            for f in rows:
                i = f.locator('input').bounding_box(); bt = f.locator('button').bounding_box(); card = f.locator('xpath=ancestor::section[1]').bounding_box()
                same = abs(i['y'] - bt['y']) < 1.5 and abs(i['height'] - bt['height']) < 1.5
                inside = bt['x'] + bt['width'] <= card['x'] + card['width'] + 0.5 and i['x'] >= card['x']
                good = good and same and inside
            ok(len(rows) == 2 and good, f'{sz}: {tag} add rows: input and + Add button share top and height, inside the card')
        def addrows_x():
            return [round(f.locator('button').bounding_box()['x'] + f.locator('button').bounding_box()['width'] - f.locator('xpath=ancestor::section[1]').bounding_box()['x'] - f.locator('xpath=ancestor::section[1]').bounding_box()['width'], 1) for f in pg.locator('#setup form.addrow2').all()]
        pg.goto(BASE + 'index.html?demo=1&scenario=mid'); pg.wait_for_timeout(500)
        sig0 = None
        # ---------------- Head Judge ----------------
        login('u-head', 'head.html'); sig0 = scores_sig(pg)
        tab('setup')
        ok('Just Harriet' in pg.inner_text('#setup') and 'Default: Round 1' in pg.inner_text('#setup'), f'{sz}: HJ sees items with round default')
        pg.fill('#new-item', 'The Coconut Thief'); pg.click('form[data-sform=add_item] button'); pg.wait_for_timeout(500)
        ok('The Coconut Thief' in pg.inner_text('#setup'), f'{sz}: HJ adds an item')
        pg.click('[data-rcount="2"]'); pg.wait_for_timeout(500)
        ok(pg.inner_text('.stepper .n') == '2', f'{sz}: HJ sets 2 rounds')
        pg.fill('[data-rname="2"]', 'Final'); pg.press('[data-rname="2"]', 'Tab'); pg.wait_for_timeout(500)
        ok(any(r['number'] == 2 and r['name'] == 'Final' for r in st(pg)['rounds']), f'{sz}: HJ names round 2 "Final"')
        coco = [i for i in st(pg)['items'] if i['title'] == 'The Coconut Thief'][0]['id']
        pg.select_option('[data-rdefault="2"]', coco); pg.wait_for_timeout(500)
        ok(any(r['number'] == 2 and r['default_item_id'] == coco for r in st(pg)['rounds']), f'{sz}: HJ sets round 2 default item')
        pg.fill('#new-district', 'TWO'); pg.press('#new-district', 'Enter'); pg.wait_for_timeout(500)
        ok('TWO' in pg.inner_text('#h-districts >> xpath=..'), f'{sz}: HJ adds district (Enter key)')
        ok(pg.locator('[data-dremove]').first.is_disabled(), f'{sz}: district in use cannot be removed')
        aligned('HJ')
        shot(f'setup-head-{sz}')
        # reorder in running order tab
        tab('order')
        names = lambda: [x['student_name'] for x in sorted(st(pg)['readers'], key=lambda r: r['position'])]
        before = names()
        pg.click('#order-list [data-mvdown="r3"]'); pg.wait_for_timeout(500)
        after = names()
        ok(after[2] == before[3] and after[3] == before[2], f'{sz}: ↓ moves reader 3 to place 4')
        ok(pg.evaluate("document.activeElement && document.activeElement.dataset.mvdown") == 'r3', f'{sz}: focus stays on the moved reader\'s button')
        pg.click('#order-list [data-mvup="r3"]'); pg.wait_for_timeout(500)
        ok(names() == before, f'{sz}: ↑ moves it back')
        ok(pg.locator('#order-list [data-mvup="r1"]').is_disabled(), f'{sz}: first reader ↑ disabled')
        ok('Move Example Reader A up' in (pg.get_attribute('#order-list [data-mvup="r1"]', 'aria-label') or ''), f'{sz}: move buttons have spoken labels')
        pg.locator('#order-list .rrow').nth(2).scroll_into_view_if_needed()
        shot(f'setup-reorder-{sz}', full=False)
        # Edit details: reader 1 has turned-in sheets
        pg.click('#order-list [data-rdetails="r1"]'); pg.wait_for_timeout(300)
        pg.select_option('.modal select[name=item]', coco)
        pg.select_option('.modal select[name=district]', label='TWO')
        shot(f'setup-head-edit-details-{sz}', full=False)
        modal_ok()
        warn = pg.locator('.modal .warn').first.inner_text() if pg.locator('.modal .warn').count() else ''
        ok('already turned in' in warn, f'{sz}: warning before changing Item for a reader with turned-in sheets')
        shot(f'setup-head-edit-details-warning-{sz}', full=False)
        modal_ok()
        r1 = [r for r in st(pg)['readers'] if r['id'] == 'r1'][0]
        ok(r1['item'] == 'The Coconut Thief' and r1['district'] == 'TWO' and r1['round'] == 'Round 1', f'{sz}: reader 1 now has its own item + district TWO')
        others = [r['item'] for r in st(pg)['readers'] if r['id'] != 'r1']
        ok(all(x == 'Just Harriet' for x in others), f'{sz}: other readers keep the round default')
        ok('Own item' in pg.inner_text('#order-list'), f'{sz}: running order marks the own item')
        # Move reader 2 to round 2 (Final): item = round 2 default
        pg.click('#order-list [data-rdetails="r2"]'); pg.wait_for_timeout(300)
        pg.select_option('.modal select[name=round]', '2'); modal_ok()
        if pg.locator('.modal').count(): modal_ok()
        r2 = [r for r in st(pg)['readers'] if r['id'] == 'r2'][0]
        ok(r2['round'] == 'Final' and r2['item'] == 'The Coconut Thief', f'{sz}: reader 2 in round "Final" shows round 2 default item')
        # score sheet header
        tab('score'); pg.select_option('#hj-pick', 'r1'); pg.wait_for_timeout(400)
        hdr = pg.inner_text('#sheet .meta')
        ok('The Coconut Thief' in hdr and 'TWO' in hdr, f'{sz}: score sheet header shows the effective item + district')
        ok(scores_sig(pg) == sig0, f'{sz}: no score changed by any setup change')
        tab('setup')
        ok(pg.locator('[data-rcount="1"]').is_disabled(), f'{sz}: cannot drop round 2 while a reader is in it')
        # ---------------- Judge: no setup ----------------
        login('u-j1', 'judge.html')
        ok(pg.locator('[aria-controls=setup]').count() == 0 and pg.locator('[data-mvup]').count() == 0 and pg.locator('[data-rdetails]').count() == 0, f'{sz}: judge has no Setup tab or reorder controls')
        err = pg.evaluate("MC.api.setupChange('add_item', {title:'x'}).then(()=>'ok', e=>e.message)")
        ok('Only the Head Judge or the Site Admin' in err, f'{sz}: judge blocked from setup changes')
        # ---------------- Site Admin ----------------
        login('u-admin', 'admin.html'); tab('setup')
        it = [i for i in st(pg)['items'] if i['title'] == 'Just Harriet'][0]['id']
        pg.click(f'[data-irename="{it}"]'); pg.fill('.modal input[name=v]', 'Just Harriet (2026)'); modal_ok()
        ok(all(r['item'] == 'Just Harriet (2026)' for r in st(pg)['readers'] if r['id'] not in ('r1', 'r2')), f'{sz}: admin renames item, readers follow')
        pg.fill('#new-district', 'THREE'); pg.click('form[data-sform=add_district] button'); pg.wait_for_timeout(400)
        d3 = [d for d in st(pg)['districts'] if d['name'] == 'THREE'][0]['id']
        pg.click(f'[data-dremove="{d3}"]'); modal_ok()
        ok(not any(d['name'] == 'THREE' for d in st(pg)['districts']), f'{sz}: admin removes an unused district')
        aligned('Admin')
        shot(f'setup-admin-{sz}')
        # admin readers tab: form uses pick-lists; add a reader in round "Final"
        tab('readers')
        ok(pg.locator('#rform-round option').count() == 2 and 'Final' in pg.inner_text('#rform-round'), f'{sz}: admin reader form Round list comes from Setup')
        pg.fill('#rform input[name=student_name]', 'Example Reader G'); pg.select_option('#rform-round', '2')
        ok('The Coconut Thief' in pg.inner_text('#rform-item'), f'{sz}: form shows the round default item')
        pg.click('#rform-save'); pg.wait_for_timeout(500)
        g = [r for r in st(pg)['readers'] if r['student_name'] == 'Example Reader G']
        ok(g and g[0]['round'] == 'Final' and g[0]['item'] == 'The Coconut Thief' and g[0]['position'] == 7, f'{sz}: admin adds reader in round 2 with derived item')
        pg.click(f'#readers-table [data-mvup="{g[0]["id"]}"]'); pg.wait_for_timeout(500)
        ok([r for r in st(pg)['readers'] if r['id'] == g[0]['id']][0]['position'] == 6, f'{sz}: admin ↑ on Readers tab')
        ok(scores_sig(pg) == sig0, f'{sz}: still no score changed')
        ctx.close()
    b.close()
for n in notes: print(n)
print(sum(n.startswith('FAIL') for n in notes), 'failed;', len(probs), 'console problems')
for x in probs: print('PROB', x)
