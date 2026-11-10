"""Load every page in demo mode at phone and tablet sizes; report console errors."""
import sys
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:8766/reading-competition/'
SIZES = {'phone': (390, 844), 'tablet': (1024, 768)}
probs = []
def watch(page, tag):
    page.on('console', lambda m: m.type in ('error', 'warning') and probs.append((tag, m.type, m.text)))
    page.on('pageerror', lambda e: probs.append((tag, 'pageerror', str(e))))
with sync_playwright() as p:
    b = p.chromium.launch()
    for sz, (w, h) in SIZES.items():
        ctx = b.new_context(viewport={'width': w, 'height': h})
        page = ctx.new_page(); watch(page, sz)
        page.goto(BASE + 'index.html?demo=1&scenario=mid'); page.wait_for_timeout(800)
        for role, url in [('u-admin', 'admin.html'), ('u-head', 'head.html'), ('u-j2', 'judge.html')]:
            page.goto(BASE + 'login.html'); page.wait_for_timeout(300)
            page.click(f'button[data-id="{role}"]'); page.wait_for_url('**/' + url); page.wait_for_timeout(700)
            for tab in page.query_selector_all('nav.tabs button[role=tab]'):
                tab.click(); page.wait_for_timeout(250)
            page.evaluate("window.MC.api.signOut()")
        ctx.close()
    b.close()
for x in probs: print(x)
print(len(probs), 'console problems')
