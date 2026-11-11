// Michelle Coy Reading Competition service worker. Change VERSION to roll out an update
// (old caches are deleted on activate). Same approach as Carriacou Connect:
// caches ONLY the app shell (same-origin HTML/CSS/JS/icons below) and an offline page.
// NEVER caches Supabase, auth, realtime, storage, CDN or any other cross-origin response,
// never config.js, and never any non-GET request: those requests are not intercepted at all,
// so scores, results and sign-ins always come fresh from Supabase.
const VERSION = 'v1.2.2';
const C = 'mcrc-shell-' + VERSION, OFF = './offline.html';
const SHELL = ['./', './index.html', './login.html', './judge.html', './head.html', './admin.html', './offline.html',
  './css/style.css', './js/core.js', './js/api.js', './js/console.js', './js/scoresheet.js', './js/judge.js', './js/head.js', './js/admin.js',
  './js/landing.js', './js/export.js', './js/setup.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(C).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('mcrc-') && k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
const isShell = (u) => { const base = new URL('./', self.registration.scope).pathname; const p = u.pathname.startsWith(base) ? './' + u.pathname.slice(base.length) : null; return p !== null && SHELL.includes(p); };
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;               // Supabase / CDN / POST: never touched
  if (/supabase|\/auth\/|\/rest\/|\/realtime\/|\/storage\//i.test(u.href) || u.pathname.endsWith('config.js')) return;
  if (r.mode === 'navigate') { e.respondWith(fetch(r).catch(() => caches.match(r, { ignoreSearch: true }).then((m) => m || caches.match(OFF)))); return; }
  if (isShell(u)) e.respondWith(caches.open(C).then((c) => fetch(r).then((res) => { if (res.ok && res.type === 'basic') c.put(r, res.clone()); return res; }).catch(() => c.match(r))));
});
