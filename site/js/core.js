// Shared helpers: config, demo mode, Supabase client, dialogs, formatting, PWA install.
(function () {
  'use strict';
  const cfg = window.MCRC_CONFIG || {};
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(cfg.SUPABASE_URL || '') &&
    !/YOUR-/i.test(cfg.SUPABASE_URL || '') && (cfg.SUPABASE_ANON_KEY || '').length > 20 && !/YOUR-/i.test(cfg.SUPABASE_ANON_KEY || '');
  // Links in Supabase emails (invite, password reset, email change) land on the Site URL
  // (usually index.html) with details in the #hash. Send them to login.html, which handles them.
  if (/(^|[#&])(type=(invite|recovery|signup|magiclink|email_change)|error_description=|message=)/.test(location.hash) && !/login\.html$/.test(location.pathname)) {
    location.replace(new URL('login.html', location.href).pathname + location.hash);
  }
  const params = new URLSearchParams(location.search);
  if (params.get('demo') === '1') sessionStorage.setItem('mcrc_demo', '1');
  if (params.get('demo') === '0') sessionStorage.removeItem('mcrc_demo');
  const demo = !configured || sessionStorage.getItem('mcrc_demo') === '1';
  if (!configured) console.info('[MCRC] config.js is missing or has placeholder values, so the site is running in DEMO mode with EXAMPLE data. See README.txt.');

  const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js';
  let clientP = null;
  function client() {
    if (demo) return Promise.resolve(null);
    if (clientP) return clientP;
    clientP = new Promise((res) => {
      const make = () => { try { res(window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })); } catch (e) { console.warn('Supabase init failed', e); res(null); } };
      if (window.supabase && window.supabase.createClient) return make();
      const s = document.createElement('script'); s.src = CDN; s.onload = make; s.onerror = () => { console.warn('Could not load supabase-js'); res(null); };
      document.head.appendChild(s);
    });
    return clientP;
  }

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function fmtDate(iso) { // 'YYYY-MM-DD' -> 'November 20, 2026' (no time zone shifting)
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso)); if (!m) return String(iso);
    return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }
  function fmtTime(hhmm) { // '09:00' -> '9:00 AM'
    if (!hhmm) return '';
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm)); if (!m) return String(hhmm);
    let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + m[2] + ' ' + ap;
  }
  function fmtStamp(ts) { // timestamp -> 'November 20, 2026, 3:42 PM (AST)' in Grenada time
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const s = d.toLocaleString('en-US', { timeZone: 'America/Grenada', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
      return s + ' (AST)';
    } catch (e) { return String(ts); }
  }
  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  // ---------- toast + dialogs (accessible, keyboard friendly) ----------
  let toastT = null;
  function toast(msg, bad) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.toggle('bad', !!bad); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 3000);
  }
  // dialog({title, html, fields:[{name,label,type,value,required,options,placeholder}], ok, cancel, danger}) -> Promise<values|null>
  function dialog(o) {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const wrap = document.createElement('div'); wrap.className = 'modal';
      const id = 'dlg' + Math.random().toString(36).slice(2, 8);
      const fields = (o.fields || []).map((f) => {
        const base = `name="${esc(f.name)}" ${f.required ? 'required' : ''} ${f.minlength ? 'minlength="' + f.minlength + '"' : ''} ${f.maxlength ? 'maxlength="' + f.maxlength + '"' : ''} ${f.placeholder ? 'placeholder="' + esc(f.placeholder) + '"' : ''} ${f.autocomplete ? 'autocomplete="' + esc(f.autocomplete) + '"' : ''}`;
        let input;
        if (f.type === 'select') input = `<select ${base}>${f.options.map((op) => `<option value="${esc(op.value)}"${String(op.value) === String(f.value) ? ' selected' : ''}>${esc(op.label)}</option>`).join('')}</select>`;
        else if (f.type === 'textarea') input = `<textarea ${base} rows="3">${esc(f.value || '')}</textarea>`;
        else if (f.type === 'checkbox') return `<label class="chk full"><input type="checkbox" name="${esc(f.name)}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
        else input = `<input type="${esc(f.type || 'text')}" ${base} value="${esc(f.value == null ? '' : f.value)}">`;
        return `<label class="${f.half ? '' : 'full'}">${esc(f.label)}${input}</label>`;
      }).join('');
      wrap.innerHTML = `<form class="modal-card" role="dialog" aria-modal="true" aria-labelledby="${id}" novalidate>
        <h2 id="${id}">${esc(o.title || '')}</h2>${o.html || ''}${fields ? `<div class="form">${fields}</div>` : ''}
        <p class="warn" data-err hidden role="alert"></p>
        <div class="modal-actions"><button type="submit" class="btn ${o.danger ? 'danger' : ''}">${esc(o.ok || 'OK')}</button>${o.cancel === false ? '' : `<button type="button" class="btn ghost" data-cancel>${esc(o.cancel || 'Cancel')}</button>`}</div></form>`;
      document.body.appendChild(wrap);
      const form = wrap.querySelector('form');
      const close = (v) => { wrap.remove(); document.removeEventListener('keydown', key); if (prev && prev.focus) prev.focus(); resolve(v); };
      const key = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        if (e.key === 'Tab') { // trap focus
          const f = $$('button,input,select,textarea,a[href]', form).filter((x) => !x.disabled);
          if (!f.length) return; const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener('keydown', key);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) close(null); });
      const cb = wrap.querySelector('[data-cancel]'); if (cb) cb.onclick = () => close(null);
      form.onsubmit = (e) => {
        e.preventDefault();
        const vals = {};
        for (const f of (o.fields || [])) {
          const el = form.elements.namedItem(f.name);
          vals[f.name] = f.type === 'checkbox' ? el.checked : el.value.trim();
          if (f.required && !vals[f.name]) { const er = form.querySelector('[data-err]'); er.textContent = 'Please fill in "' + f.label + '".'; er.hidden = false; el.focus(); return; }
          if (f.minlength && vals[f.name].length < f.minlength) { const er = form.querySelector('[data-err]'); er.textContent = '"' + f.label + '" needs at least ' + f.minlength + ' characters.'; er.hidden = false; el.focus(); return; }
        }
        close(vals);
      };
      const firstInput = form.querySelector('input,select,textarea') || form.querySelector('button[type=submit]');
      setTimeout(() => firstInput && firstInput.focus(), 0);
    });
  }
  const confirmBox = (title, html, ok, danger) => dialog({ title, html, ok: ok || 'Yes', danger }).then((v) => !!v);

  // ---------- tabs (role=tablist, arrow keys) ----------
  function tabs(nav, onShow) {
    const btns = $$('button[role=tab]', nav);
    const show = (id, focus) => {
      btns.forEach((b) => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
      $$('[role=tabpanel]').forEach((p) => { p.hidden = p.id !== id; });
      if (history.replaceState) history.replaceState(null, '', location.pathname + location.search + '#' + id);
      if (onShow) onShow(id);
    };
    btns.forEach((b, i) => {
      b.onclick = () => show(b.dataset.tab);
      b.onkeydown = (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length]; show(n.dataset.tab, true); }
      };
    });
    const h = location.hash.slice(1);
    show(btns.some((b) => b.dataset.tab === h) ? h : btns[0].dataset.tab);
    return show;
  }

  // ---------- demo banner ----------
  function demoBar() {
    if (!demo) return;
    const b = document.createElement('div'); b.className = 'demo-bar'; b.setAttribute('role', 'note');
    b.innerHTML = 'EXAMPLE DATA · Demo mode: names and scores are made up and nothing is saved online.' +
      ' <button type="button" data-reset>Reset demo</button>';
    document.body.prepend(b);
    b.querySelector('[data-reset]').onclick = () => { if (window.MC.api && window.MC.api.resetDemo) window.MC.api.resetDemo(); location.reload(); };
  }

  // ---------- service worker + Add to Home Screen (same approach as Carriacou Connect) ----------
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  const A2HS_KEY = 'mcrc_a2hs_dismissed';
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ua = navigator.userAgent;
  const ios = (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  let installEv = null;
  function installButtons() {
    if (standalone()) return;
    const t = +localStorage.getItem(A2HS_KEY) || 0; if (t && Date.now() - t < 30 * 864e5) return;
    if (!installEv && !ios) return;
    $$('[data-a2hs-slot]').forEach((slot) => {
      if (slot.querySelector('[data-a2hs]')) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost'; b.dataset.a2hs = '1';
      b.textContent = '📲 Add to Home Screen';
      b.onclick = async () => {
        if (installEv) { installEv.prompt(); const r = await installEv.userChoice.catch(() => null); if (r && r.outcome === 'dismissed') localStorage.setItem(A2HS_KEY, Date.now()); installEv = null; $$('[data-a2hs]').forEach((x) => x.remove()); }
        else dialog({ title: 'Add to Home Screen', html: '<p>On iPhone or iPad: tap the <strong>Share</strong> button in Safari, then <strong>Add to Home Screen</strong>.</p>', ok: 'Got it', cancel: false });
      };
      slot.appendChild(b);
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEv = e; installButtons(); });
  window.addEventListener('appinstalled', () => $$('[data-a2hs]').forEach((x) => x.remove()));
  document.addEventListener('DOMContentLoaded', () => { demoBar(); if (ios) installButtons(); });

  // ---------- ranking: sum of every PANEL judge's total; ties share a place ----------
  function ranking(readers, panel, scores, criteria) {
    const onPanel = new Set(panel.map((p) => p.judge_id));
    const crit = new Set(criteria.map((c) => c.id));
    const tot = {};
    readers.forEach((r) => { tot[r.id] = 0; });
    scores.forEach((s) => { if (onPanel.has(s.judge_id) && crit.has(s.criterion_id) && s.score != null && s.reader_id in tot) tot[s.reader_id] += s.score; });
    const rows = readers.map((r) => ({ reader: r, total: tot[r.id] }))
      .sort((a, b) => b.total - a.total || a.reader.position - b.reader.position || a.reader.student_name.localeCompare(b.reader.student_name));
    let place = 0; rows.forEach((row, i) => { if (i === 0 || row.total !== rows[i - 1].total) place = i + 1; row.place = place; });
    return rows;
  }
  const panelLabel = (p) => (p.seat === 0 ? 'Head Judge' : 'Judge ' + p.seat);
  const roleLabel = (r) => ({ site_admin: 'Site Admin', head_judge: 'Head Judge', judge: 'Judge' }[r] || 'No access');
  const homeFor = (role) => ({ site_admin: 'admin.html', head_judge: 'head.html', judge: 'judge.html' }[role] || 'login.html');

  window.MC = { cfg, configured, demo, client, $, $$, esc, fmtDate, fmtTime, fmtStamp, ordinal, toast, dialog, confirmBox, tabs, ranking, panelLabel, roleLabel, homeFor, installButtons };
})();
