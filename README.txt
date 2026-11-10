MICHELLE COY READING COMPETITION - judging and results website
==============================================================
Static site (HTML/CSS/vanilla JS, no build step) + Supabase (auth, Postgres with RLS,
Realtime, Storage, one Edge Function). Hosted on GitHub Pages under /reading-competition/.

FOLDERS
  site/                 the website (what GitHub Pages serves)
    index.html          public landing page: about, 2025 winner, results after posting, photos
    login.html          sign in (accounts are made by the Site Admin only)
    judge.html          Judge console        head.html   Head Judge console
    admin.html          Site Admin console   offline.html
    js/ css/ icons/     app code, styles, PWA icons
    assets/score-sheet-template.xlsx   blank copy of Judge1 Readers.xlsx used for exports
    manifest.webmanifest, sw.js        PWA (service worker caches the app shell only)
    config.example.js   copy to config.js for a real backend (config.js is NOT in git)
  supabase/             SQL to run in order + Edge Function + SETUP_STEPS.txt
  tests/                local tests (PGlite Postgres, Playwright, export comparison)
  .github/workflows/    Pages deploy (writes config.js from repo variables) + keep-alive

RUN LOCALLY (demo mode, made-up EXAMPLE data, nothing saved online)
  cd site && python3 -m http.server 8000     then open http://localhost:8000/
  Demo mode is on when config.js is missing/placeholder, or with ?demo=1.
  Scenarios: ?scenario=mid | ready | posted.  "Reset demo" in the top bar.
  The 404 for config.js in the browser console is expected in demo mode.

TESTS (cd tests; npm install once)
  node sql_test.mjs            all SQL on PGlite (Postgres 18) + RLS/RPC checks
  node assign_roles_test.mjs   06_assign_roles.sql
  node export_test.mjs && python3 compare_export.py     Excel export fidelity
  python3 ui_smoke.py / ui_flow.py    Playwright demo-mode (serve /tmp/ghpages, port 8766)
  node mock_supabase.mjs + ui_live_mock.py   live-mode run against a local mock Supabase

SECURITY NOTES
  Only the public (publishable/anon) key is ever in the browser. The service/secret key
  lives only inside the Edge Function environment. Every table has RLS; judges can read
  only their own scores; the public sees results only through public_landing().
  Do not commit: site/config.js, supabase/seed_readers.sql (real student names),
  Judge1 Readers.xlsx.
