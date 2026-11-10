// Data layer. Same methods for the real Supabase backend and the in-browser DEMO backend.
// Pages call MC.api.* and never talk to Supabase directly.
(function () {
  'use strict';
  const MC = window.MC;
  const BUCKET = 'event-photos';
  const t5 = (t) => (t ? String(t).slice(0, 5) : null);
  const byPos = (a, b) => (a.position - b.position) || String(a.id).localeCompare(String(b.id));

  // =====================================================================
  // Supabase backend
  // =====================================================================
  function supaApi() {
    const sb = () => MC.client().then((c) => { if (!c) throw new Error('Could not reach the server. Check your internet connection and try again.'); return c; });
    const chk = (r) => { if (r.error) throw new Error(friendly(r.error)); return r.data; };
    const friendly = (e) => {
      const m = (e && (e.message || e.error_description)) || String(e);
      if (/Invalid login credentials/i.test(m)) return 'That email and password do not match. Ask the Site Admin if you need a new password.';
      if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No connection to the server. Your work is kept on this device; try again in a moment.';
      if (/JWT|session|not authenticated/i.test(m)) return 'Your sign-in has expired. Please sign in again.';
      return m;
    };
    const rpc = async (fn, args) => chk(await (await sb()).rpc(fn, args || {}));

    const api = {
      demo: false,
      async signIn(email, password) {
        const c = await sb();
        chk(await c.auth.signInWithPassword({ email, password }));
        const me = await api.me();
        if (!me || !me.role || !me.active) { await c.auth.signOut(); throw new Error('This account does not have access yet. Ask the Site Admin.'); }
        return me;
      },
      async signOut() { const c = await sb(); await c.auth.signOut(); },
      async me() {
        const c = await sb();
        const { data } = await c.auth.getUser();
        if (!data || !data.user) return null;
        const p = chk(await c.from('profiles').select('*').eq('id', data.user.id).maybeSingle());
        return p ? Object.assign({ email: data.user.email }, p) : null;
      },
      async changePassword(pw) { const c = await sb(); chk(await c.auth.updateUser({ password: pw })); },
      // Supabase emails a confirmation link (to the new address, and to the old one too when
      // "Secure email change" is on). The email changes when the link is clicked; a database
      // trigger then copies it into profiles.email.
      async changeEmail(email) {
        const c = await sb();
        const back = new URL('login.html', location.href).href.split('#')[0].split('?')[0];
        const d = chk(await c.auth.updateUser({ email: String(email).trim().toLowerCase() }, { emailRedirectTo: back }));
        return { pending: !!(d && d.user && d.user.new_email) || (d && d.user && d.user.email !== String(email).trim().toLowerCase()) };
      },
      async session() { const c = await sb(); const { data } = await c.auth.getSession(); return data && data.session; },
      async loadAll() {
        const c = await sb();
        const me = await api.me();
        if (!me) return null;
        const isMgr = me.role === 'site_admin' || me.role === 'head_judge';
        const q = (t, sel, ord) => { let x = c.from(t).select(sel || '*'); if (ord) x = x.order(ord); return x; };
        const [profiles, panel, readers, criteria, scores, sheets, event, fin, reqs, photos] = await Promise.all([
          q('profiles', '*', 'full_name'), q('panel', '*', 'seat'), q('readers', '*', 'position'), q('criteria', '*', 'position'),
          q('scores'), q('sheets'), c.from('event_settings').select('*').eq('id', 1).maybeSingle(),
          c.from('finalization').select('*').eq('id', 1).maybeSingle(),
          isMgr ? q('revert_requests', '*', 'created_at') : Promise.resolve({ data: [] }),
          q('photos', '*', 'position')
        ]);
        [profiles, panel, readers, criteria, scores, sheets, event, fin, reqs, photos].forEach((r) => { if (r.error) throw new Error(friendly(r.error)); });
        const ev = event.data || { event_date: '2026-11-20', start_time: null };
        return {
          me, profiles: profiles.data, panel: panel.data, readers: readers.data, criteria: criteria.data,
          scores: scores.data, sheets: sheets.data,
          event: { event_date: ev.event_date, start_time: t5(ev.start_time) },
          final: fin.data || { status: 'open' }, requests: reqs.data || [],
          photos: photos.data.map((p) => Object.assign({ url: c.storage.from(BUCKET).getPublicUrl(p.storage_path).data.publicUrl }, p))
        };
      },
      async publicLanding() {
        const c = await sb();
        const d = chk(await c.rpc('public_landing'));
        d.photos = (d.photos || []).map((p) => ({ caption: p.caption, url: c.storage.from(BUCKET).getPublicUrl(p.path).data.publicUrl }));
        return d;
      },
      saveScores: (reader, items) => rpc('save_scores', { p_reader: reader, p_items: items }),
      turnIn: (reader) => rpc('turn_in_sheet', { p_reader: reader }),
      reopenSheet: (reader, judge) => rpc('reopen_sheet', { p_reader: reader, p_judge: judge }),
      openReader: (reader, closeCurrent) => rpc('open_reader', { p_reader: reader, p_close_current: !!closeCurrent }),
      closeReader: (reader) => rpc('close_reader', { p_reader: reader }),
      setStartTime: (t) => rpc('set_start_time', { p_time: t || null }),
      addToPanel: (judge) => rpc('add_to_panel', { p_judge: judge }),
      removeFromPanel: (judge) => rpc('remove_from_panel', { p_judge: judge }),
      substituteReader: (id, name, school, clear) => rpc('substitute_reader', { p_reader: id, p_name: name, p_school: school, p_clear_scores: !!clear }),
      finalize: () => rpc('finalize_results'),
      requestRevert: (reason) => rpc('request_revert', { p_reason: reason }),
      decideRevert: (id, approve, note) => rpc('decide_revert', { p_request: id, p_approve: !!approve, p_note: note || '' }),
      async saveReader(r) {
        const c = await sb();
        const row = { student_name: r.student_name, school: r.school, item: r.item, reading_date: r.reading_date || null, round: r.round, district: r.district };
        if (r.id) return chk(await c.from('readers').update(row).eq('id', r.id).select('id'));
        const max = chk(await c.from('readers').select('position').order('position', { ascending: false }).limit(1));
        row.position = ((max[0] && max[0].position) || 0) + 1;
        return chk(await c.from('readers').insert(row).select('id'));
      },
      async deleteReader(id) { const c = await sb(); chk(await c.from('readers').delete().eq('id', id)); },
      async swapPositions(table, a, b) { // a,b = {id, position}
        const c = await sb();
        chk(await c.from(table).update({ position: b.position }).eq('id', a.id));
        chk(await c.from(table).update({ position: a.position }).eq('id', b.id));
      },
      async addCriterion(text) {
        const c = await sb();
        const max = chk(await c.from('criteria').select('position').order('position', { ascending: false }).limit(1));
        chk(await c.from('criteria').insert({ text, position: ((max[0] && max[0].position) || 0) + 1 }));
      },
      async updateCriterion(id, text) { const c = await sb(); chk(await c.from('criteria').update({ text }).eq('id', id)); },
      async deleteCriterion(id) { const c = await sb(); chk(await c.from('criteria').delete().eq('id', id)); },
      async updateProfile(id, patch) { const c = await sb(); chk(await c.from('profiles').update(patch).eq('id', id)); },
      async adminUsers(action, payload) {
        const c = await sb();
        const { data, error } = await c.functions.invoke('admin-users', { body: Object.assign({ action }, payload) });
        if (error) {
          let msg = error.message || String(error);
          try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* ignore */ }
          if (/Failed to send|not found|404/i.test(msg)) msg = 'The account tool (admin-users Edge Function) is not switched on yet. See SETUP_STEPS.txt.';
          throw new Error(msg);
        }
        if (data && data.error) throw new Error(data.error);
        return data;
      },
      async uploadPhoto(blob, caption) {
        const c = await sb();
        const path = 'photos/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
        chk(await c.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
        const max = chk(await c.from('photos').select('position').order('position', { ascending: false }).limit(1));
        const ins = await c.from('photos').insert({ storage_path: path, caption: caption || '', position: ((max[0] && max[0].position) || 0) + 1 });
        if (ins.error) { await c.storage.from(BUCKET).remove([path]); throw new Error(friendly(ins.error)); }
      },
      async deletePhoto(p) {
        const c = await sb();
        chk(await c.storage.from(BUCKET).remove([p.storage_path]));
        chk(await c.from('photos').delete().eq('id', p.id));
      },
      // Live updates: Realtime postgres_changes (RLS-filtered) + a 30 s safety poll.
      subscribe(cb, onStatus) {
        let timer = null, ch = null, poll = null;
        const fire = () => { clearTimeout(timer); timer = setTimeout(cb, 350); };
        MC.client().then((c) => {
          if (!c) return;
          ch = c.channel('mcrc-live');
          ['readers', 'scores', 'sheets', 'panel', 'criteria', 'event_settings', 'finalization', 'revert_requests', 'photos', 'profiles']
            .forEach((t) => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, fire));
          ch.subscribe((s) => { if (onStatus) onStatus(s === 'SUBSCRIBED'); });
        });
        poll = setInterval(() => { if (!document.hidden) cb(); }, 30000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) cb(); });
        return () => { clearInterval(poll); if (ch) ch.unsubscribe(); };
      }
    };
    return api;
  }

  // =====================================================================
  // DEMO backend: in-browser, EXAMPLE data, kept in localStorage so the
  // demo consoles can be tried in several tabs at once (changes sync live).
  // Mirrors the database rules in supabase/03_rpcs.sql.
  // =====================================================================
  function demoApi() {
    const KEY = 'mcrc_demo_state_v1', UKEY = 'mcrc_demo_uid';
    const fail = (m) => { throw new Error(m); };
    const now = () => new Date().toISOString();
    const uid = () => 'x' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const CRITERIA = ['Were all words read accurately?', 'Were phrases read effectively as complete units?', 'Was punctuation interpreted correctly?',
      'Were all words pronounced distinctly?', 'Were key words emphasized?', 'Was mood or feeling conveyed effectively?', 'Was volume used effectively?',
      'Was pitch used effectively?', 'Was the selection read at an appropriate rate for audience and purpose?',
      'Did the student appear relaxed, confident and able to recover quickly if a mistake was made?'];
    const COMMENTS = ['EXAMPLE: Clear and confident.', 'EXAMPLE: Lovely expression.', 'EXAMPLE: Watch the pace.', '', '', ''];

    function seed(scenario) {
      const P = (id, full_name, email, role) => ({ id, full_name, email, role, active: true, created_at: now() });
      const profiles = [P('u-admin', 'Example Admin', 'example.admin@example.com', 'site_admin'), P('u-head', 'Example Head Judge', 'example.head.judge@example.com', 'head_judge'),
        P('u-j1', 'Example Judge A', 'example.judge.a@example.com', 'judge'), P('u-j2', 'Example Judge B', 'example.judge.b@example.com', 'judge'),
        P('u-j3', 'Example Judge C', 'example.judge.c@example.com', 'judge'), P('u-j4', 'Example Judge D', 'example.judge.d@example.com', 'judge'),
        P('u-j5', 'Example Judge E', 'example.judge.e@example.com', 'judge')];
      const panel = [{ judge_id: 'u-head', seat: 0 }, { judge_id: 'u-j1', seat: 1 }, { judge_id: 'u-j2', seat: 2 }, { judge_id: 'u-j3', seat: 3 }, { judge_id: 'u-j4', seat: 4 }];
      const schools = [["Example Reader A", "Mt Pleasant Gov't", 4.2], ["Example Reader B", "Dover Gov't", 3.8], ["Example Reader C", "Hillsborough Gov't", 4.7],
        ["Example Reader D", "Harvey Vale Gov't", 3.7], ["Example Reader E", "St Thomas Aquinas Catholic", 3.1], ["Example Reader F", "Our Lady of the Rosary Catholic", 4.55]];
      const readers = schools.map((s, i) => ({ id: 'r' + (i + 1), position: i + 1, student_name: s[0], school: s[1], item: 'Just Harriet', reading_date: '2026-11-20', round: 'Round 1', district: 'ONE', judging_status: 'not_opened', _q: s[2] }));
      const criteria = CRITERIA.map((t, i) => ({ id: 'c' + (i + 1), position: i + 1, text: t }));
      const scores = [], sheets = [];
      const val = (r, j, c) => { const n = Math.sin((r + 1) * 12.9898 + (j + 1) * 78.233 + (c + 1) * 37.719) * 43758.5453; const f = n - Math.floor(n); return Math.max(1, Math.min(5, Math.round(readers[r]._q + (f - 0.5) * 1.6))); };
      const fill = (ri, ji, upto, status) => {
        const r = readers[ri], j = panel[ji].judge_id;
        criteria.forEach((c, ci) => { if (ci < upto) scores.push({ reader_id: r.id, judge_id: j, criterion_id: c.id, score: val(ri, ji, ci), comment: COMMENTS[(ri + ji + ci) % COMMENTS.length], updated_at: now() }); });
        sheets.push({ reader_id: r.id, judge_id: j, status, turned_in_at: status === 'turned_in' ? now() : null, updated_at: now() });
      };
      let fin = { status: 'open', published_at: null, results: null };
      if (scenario === 'posted' || scenario === 'ready') {
        readers.forEach((r, ri) => { r.judging_status = 'closed'; panel.forEach((p, ji) => fill(ri, ji, 10, 'turned_in')); });
      } else { // mid-event
        [0, 1].forEach((ri) => { readers[ri].judging_status = 'closed'; panel.forEach((p, ji) => fill(ri, ji, 10, 'turned_in')); });
        readers[2].judging_status = 'open';
        fill(2, 0, 10, 'draft'); fill(2, 1, 10, 'draft'); fill(2, 3, 10, 'draft'); fill(2, 2, 8, 'draft');
      }
      readers.forEach((r) => { delete r._q; });
      const st = { v: 1, scenario: scenario || 'mid', profiles, panel, readers, criteria, scores, sheets,
        event: { event_date: '2026-11-20', start_time: '09:00' }, final: fin, requests: [], photos: [], audit: [] };
      if (scenario === 'posted') publish(st, 'u-head');
      return st;
    }
    function publish(st, by) {
      const rk = MC.ranking(st.readers, st.panel, st.scores, st.criteria);
      st.final = { status: 'published', published_at: now(), published_by: by, results: rk.map((x) => ({ place: x.place, name: x.reader.student_name, school: x.reader.school, total: x.total })) };
    }
    const params = new URLSearchParams(location.search);
    let st;
    function load() { try { st = JSON.parse(localStorage.getItem(KEY)); } catch (e) { st = null; } if (!st || st.v !== 1) { st = seed('mid'); save(true); } }
    const listeners = new Set();
    function save(quiet) { localStorage.setItem(KEY, JSON.stringify(st)); if (!quiet) setTimeout(() => listeners.forEach((f) => f()), 0); }
    if (params.get('scenario')) { st = seed(params.get('scenario')); save(true); } else load();
    window.addEventListener('storage', (e) => { if (e.key === KEY) { load(); listeners.forEach((f) => f()); } });

    const meId = () => sessionStorage.getItem(UKEY);
    const me = () => st.profiles.find((p) => p.id === meId() && p.active && p.role) || null;
    const role = () => (me() ? me().role : null);
    const isAdmin = () => role() === 'site_admin', isHead = () => role() === 'head_judge';
    const onPanel = (id) => { const p = st.profiles.find((x) => x.id === id); return !!(p && p.active && st.panel.some((x) => x.judge_id === id)); };
    const published = () => st.final.status === 'published';
    const reader = (id) => st.readers.find((r) => r.id === id) || fail('That reader no longer exists.');
    const log = (action, detail) => st.audit.push({ actor: meId(), action, detail, at: now() });
    const clone = (x) => JSON.parse(JSON.stringify(x));

    const api = {
      demo: true,
      demoAccounts: () => st.profiles.filter((p) => p.role && p.active).map((p) => ({ id: p.id, name: p.full_name, role: p.role, email: p.email, seat: (st.panel.find((x) => x.judge_id === p.id) || {}).seat })),
      demoSignInAs(id) { sessionStorage.setItem(UKEY, id); return api.me(); },
      resetDemo() { localStorage.removeItem(KEY); },
      async signIn(email) {
        const p = st.profiles.find((x) => x.email.toLowerCase() === String(email).trim().toLowerCase());
        if (!p || !p.active || !p.role) fail('That email and password do not match. In demo mode, pick one of the example accounts below.');
        sessionStorage.setItem(UKEY, p.id); return clone(p);
      },
      async signOut() { sessionStorage.removeItem(UKEY); },
      async me() { const m = me(); return m ? clone(m) : null; },
      async changePassword() { /* demo: nothing to do */ },
      async changeEmail(email) {
        const m = me(); const e = String(email).trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) fail('Type a valid email address.');
        if (st.profiles.some((p) => p.id !== m.id && p.email.toLowerCase() === e)) fail('Another account already uses that email.');
        st.profiles.find((p) => p.id === m.id).email = e; save(); return { pending: false };
      },
      async session() { return me() ? { demo: true } : null; },
      async loadAll() {
        const m = me(); if (!m) return null;
        const mgr = m.role === 'site_admin' || m.role === 'head_judge';
        const mine = (x) => mgr || x.judge_id === m.id;
        return clone({
          me: m,
          profiles: m.role === 'site_admin' ? st.profiles : m.role === 'head_judge' ? st.profiles.filter((p) => p.id === m.id || p.role === 'judge' || p.role === 'head_judge') : [m],
          panel: st.panel.slice().sort((a, b) => a.seat - b.seat), readers: st.readers.slice().sort(byPos), criteria: st.criteria.slice().sort(byPos),
          scores: st.scores.filter(mine), sheets: st.sheets.filter(mine), event: st.event, final: st.final,
          requests: mgr ? st.requests : [], photos: st.photos
        });
      },
      async publicLanding() {
        return clone({ event_date: st.event.event_date, start_time: st.event.start_time, published: published(), published_at: published() ? st.final.published_at : null,
          results: published() ? st.final.results : [], photos: st.photos.map((p) => ({ url: p.url, caption: p.caption })) });
      },
      async saveScores(rid, items) {
        const m = me(); if (!m || !onPanel(m.id)) fail('Only judges on the panel can score.');
        if (published()) fail('Results have been posted, so scores are locked.');
        const r = reader(rid); if (r.judging_status === 'not_opened') fail('The Head Judge has not opened judging for this reader yet.');
        const sh = st.sheets.find((s) => s.reader_id === rid && s.judge_id === m.id);
        if (sh && sh.status === 'turned_in') fail('You have already turned in this sheet. Ask the Head Judge to reopen it.');
        items.forEach((it) => {
          if (!st.criteria.some((c) => c.id === it.criterion_id)) return;
          const sc = it.score == null || it.score === '' ? null : +it.score; if (sc != null && (sc < 1 || sc > 5)) fail('Scores must be 1 to 5.');
          let row = st.scores.find((s) => s.reader_id === rid && s.judge_id === m.id && s.criterion_id === it.criterion_id);
          if (!row) { row = { reader_id: rid, judge_id: m.id, criterion_id: it.criterion_id }; st.scores.push(row); }
          row.score = sc; row.comment = String(it.comment || '').slice(0, 1000); row.updated_at = now();
        });
        if (!sh) st.sheets.push({ reader_id: rid, judge_id: m.id, status: 'draft', updated_at: now() }); else sh.updated_at = now();
        save(); return { saved: items.length };
      },
      async turnIn(rid) {
        const m = me(); if (!m || !onPanel(m.id)) fail('Only judges on the panel can score.');
        if (published()) fail('Results have been posted, so scores are locked.');
        const r = reader(rid); if (r.judging_status === 'not_opened') fail('The Head Judge has not opened judging for this reader yet.');
        const missing = st.criteria.filter((c) => !st.scores.some((s) => s.reader_id === rid && s.judge_id === m.id && s.criterion_id === c.id && s.score != null)).length;
        if (missing) fail('Please score every criterion before you finalize (' + missing + ' still unscored).');
        let sh = st.sheets.find((s) => s.reader_id === rid && s.judge_id === m.id);
        if (!sh) { sh = { reader_id: rid, judge_id: m.id }; st.sheets.push(sh); }
        sh.status = 'turned_in'; sh.turned_in_at = now(); log('turn_in_sheet', { reader: rid }); save();
      },
      async reopenSheet(rid, jid) {
        if (!(isHead() || isAdmin())) fail('Only the Head Judge can reopen a score sheet.');
        if (published()) fail('Results are posted. Ask the Site Admin to revert the finalization first.');
        const sh = st.sheets.find((s) => s.reader_id === rid && s.judge_id === jid && s.status === 'turned_in');
        if (!sh) fail('That sheet is not turned in, so there is nothing to reopen.');
        sh.status = 'draft'; sh.reopened_at = now(); log('reopen_sheet', { reader: rid, judge: jid }); save();
      },
      async openReader(rid, closeCurrent) {
        if (!isHead()) fail('Only the Head Judge can open judging.');
        if (published()) fail('Results are posted, so judging is closed.');
        const r = reader(rid); const cur = st.readers.find((x) => x.judging_status === 'open' && x.id !== rid);
        if (cur) { if (!closeCurrent) fail('Judging is still open for ' + cur.student_name + '. Close it first.'); cur.judging_status = 'closed'; cur.closed_at = now(); }
        r.judging_status = 'open'; r.opened_at = now(); log('open_reader', { reader: rid }); save();
      },
      async closeReader(rid) {
        if (!isHead()) fail('Only the Head Judge can close judging.');
        const r = reader(rid); if (r.judging_status !== 'open') fail('That reader is not open.');
        r.judging_status = 'closed'; r.closed_at = now(); save();
      },
      async setStartTime(t) { if (!(isHead() || isAdmin())) fail('Only the Head Judge or Site Admin can set the start time.'); st.event.start_time = t || null; save(); },
      async addToPanel(jid) {
        if (!isAdmin()) fail('Only the Site Admin can add judges to the panel.');
        const p = st.profiles.find((x) => x.id === jid); if (!p || p.role !== 'judge') fail('Pick an account with the Judge role.');
        if (!p.active) fail('That account is deactivated.');
        if (st.panel.some((x) => x.judge_id === jid)) fail('That judge is already on the panel.');
        st.panel.push({ judge_id: jid, seat: Math.max(0, ...st.panel.map((x) => x.seat)) + 1 }); save();
      },
      async removeFromPanel(jid) {
        if (!isAdmin()) fail('Only the Site Admin can remove judges from the panel.');
        const p = st.profiles.find((x) => x.id === jid); if (p && p.role === 'head_judge') fail('The Head Judge is always on the panel and cannot be removed.');
        const n = st.panel.length; st.panel = st.panel.filter((x) => x.judge_id !== jid); if (st.panel.length === n) fail('That judge is not on the panel.'); save();
      },
      async substituteReader(rid, name, school, clear) {
        if (!isAdmin()) fail('Only the Site Admin can substitute a reader.');
        if (published()) fail('Results are posted. Revert the finalization before changing readers.');
        if (!String(name || '').trim()) fail('Type the new reader\'s name.');
        const n = st.scores.filter((s) => s.reader_id === rid).length;
        if (n && !clear) fail('This reader already has ' + n + ' scores. Confirm to clear them.');
        st.scores = st.scores.filter((s) => s.reader_id !== rid); st.sheets = st.sheets.filter((s) => s.reader_id !== rid);
        const r = reader(rid); r.student_name = name.trim(); if (school) r.school = school; r.judging_status = 'not_opened'; save();
      },
      async finalize() {
        if (!isHead()) fail('Only the Head Judge can finalize and publish results.');
        if (published()) fail('Results are already posted.');
        if (!st.readers.length) fail('There are no readers.');
        const notClosed = st.readers.filter((r) => r.judging_status !== 'closed').length;
        if (notClosed) fail('Close judging for every reader first (' + notClosed + ' not closed).');
        let missing = 0;
        st.readers.forEach((r) => st.panel.forEach((p) => {
          const sh = st.sheets.find((s) => s.reader_id === r.id && s.judge_id === p.judge_id && s.status === 'turned_in');
          const full = st.criteria.every((c) => st.scores.some((s) => s.reader_id === r.id && s.judge_id === p.judge_id && s.criterion_id === c.id && s.score != null));
          if (!sh || !full) missing++;
        }));
        if (missing) fail('Some score sheets are not turned in or not complete (' + missing + ' missing).');
        publish(st, meId()); log('finalize_results', {}); save(); return st.final.results;
      },
      async requestRevert(reason) {
        if (!isHead()) fail('Only the Head Judge can request a revert.');
        if (!published()) fail('Results are not posted, so there is nothing to revert.');
        if (!String(reason || '').trim()) fail('Please give a reason.');
        st.requests.push({ id: uid(), requested_by: meId(), reason: reason.trim(), status: 'pending', created_at: now() }); save();
      },
      async decideRevert(id, approve, note) {
        if (!isAdmin()) fail('Only the Site Admin can revert a finalization.');
        const r = st.requests.find((x) => x.id === id && x.status === 'pending'); if (!r) fail('That request was already handled.');
        r.status = approve ? 'approved' : 'declined'; r.decided_at = now(); r.decision_note = note || '';
        if (approve) { st.final = { status: 'open', results: null, published_at: null, reverted_at: now() }; st.requests.forEach((x) => { if (x.status === 'pending') { x.status = 'approved'; x.decision_note = 'Handled with another request'; } }); }
        save();
      },
      async saveReader(r) {
        if (!isAdmin()) fail('Only the Site Admin can change readers.');
        if (!String(r.student_name || '').trim()) fail('Type the student\'s name.');
        const row = { student_name: r.student_name.trim(), school: r.school || '', item: r.item || '', reading_date: r.reading_date || null, round: r.round || 'Round 1', district: r.district || '' };
        if (r.id) Object.assign(reader(r.id), row);
        else st.readers.push(Object.assign({ id: uid(), position: Math.max(0, ...st.readers.map((x) => x.position)) + 1, judging_status: 'not_opened' }, row));
        save();
      },
      async deleteReader(id) {
        if (!isAdmin()) fail('Only the Site Admin can remove readers.');
        st.readers = st.readers.filter((r) => r.id !== id); st.scores = st.scores.filter((s) => s.reader_id !== id); st.sheets = st.sheets.filter((s) => s.reader_id !== id); save();
      },
      async swapPositions(table, a, b) {
        if (!isAdmin()) fail('Only the Site Admin can reorder.');
        const list = table === 'readers' ? st.readers : st.criteria;
        const A = list.find((x) => x.id === a.id), B = list.find((x) => x.id === b.id); const p = A.position; A.position = B.position; B.position = p; save();
      },
      async addCriterion(text) { if (!isAdmin()) fail('Only the Site Admin can change the score sheet.'); st.criteria.push({ id: uid(), text, position: Math.max(0, ...st.criteria.map((c) => c.position)) + 1 }); save(); },
      async updateCriterion(id, text) { if (!isAdmin()) fail('Only the Site Admin can change the score sheet.'); st.criteria.find((c) => c.id === id).text = text; save(); },
      async deleteCriterion(id) { if (!isAdmin()) fail('Only the Site Admin can change the score sheet.'); st.criteria = st.criteria.filter((c) => c.id !== id); st.scores = st.scores.filter((s) => s.criterion_id !== id); save(); },
      async updateProfile(id, patch) {
        if (!isAdmin()) fail('Only the Site Admin can change accounts.');
        const p = st.profiles.find((x) => x.id === id);
        if (id === meId() && ((patch.role && patch.role !== p.role) || patch.active === false)) fail('You cannot change your own role or deactivate your own account.');
        if (patch.role && patch.role !== p.role && patch.role !== 'judge' && st.profiles.some((x) => x.role === patch.role && x.id !== id)) fail(patch.role === 'site_admin' ? 'There is already a Site Admin.' : 'There is already a Head Judge. Change their role first.');
        Object.assign(p, patch);
        if (p.role === 'head_judge') { st.panel = st.panel.filter((x) => x.seat !== 0 && x.judge_id !== id); st.panel.push({ judge_id: id, seat: 0 }); }
        else if (p.role !== 'judge') st.panel = st.panel.filter((x) => x.judge_id !== id);
        else { const s = st.panel.find((x) => x.judge_id === id); if (s && s.seat === 0) st.panel = st.panel.filter((x) => x.judge_id !== id); }
        save();
      },
      async adminUsers(action, b) {
        if (!isAdmin()) fail('Only the Site Admin can manage accounts.');
        if (action === 'create_user') {
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) fail('Type a valid email address.');
          if ((b.password || '').length < 8) fail('The password must be at least 8 characters.');
          if (st.profiles.some((p) => p.email.toLowerCase() === b.email.toLowerCase())) fail('A user with this email address has already been registered');
          if (b.role !== 'judge' && st.profiles.some((p) => p.role === b.role)) fail(b.role === 'site_admin' ? 'There is already a Site Admin.' : 'There is already a Head Judge.');
          const id = uid(); st.profiles.push({ id, full_name: b.full_name, email: b.email.toLowerCase(), role: b.role, active: true, created_at: now() });
          if (b.role === 'head_judge') st.panel.push({ judge_id: id, seat: 0 });
          if (b.role === 'judge' && b.add_to_panel) st.panel.push({ judge_id: id, seat: Math.max(0, ...st.panel.map((x) => x.seat)) + 1 });
          save(); return { ok: true, id };
        }
        const p = st.profiles.find((x) => x.id === b.user_id) || fail('Unknown account.');
        if (action === 'update_email') {
          const e = String(b.email || '').trim().toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) fail('Type a valid email address.');
          if (st.profiles.some((x) => x.id !== p.id && x.email.toLowerCase() === e)) fail('Another account already uses that email.');
          p.email = e; save(); return { ok: true };
        }
        if (action === 'reset_password') { if ((b.password || '').length < 8) fail('The password must be at least 8 characters.'); return { ok: true }; }
        if (action === 'set_active') { if (p.id === meId()) fail('You cannot deactivate your own account.'); p.active = !!b.active; save(); return { ok: true }; }
        if (action === 'delete_user') {
          if (p.id === meId()) fail('You cannot delete your own account.');
          if (p.role === 'head_judge') fail('Give the Head Judge role to someone else before deleting this account.');
          st.profiles = st.profiles.filter((x) => x.id !== p.id); st.panel = st.panel.filter((x) => x.judge_id !== p.id);
          st.scores = st.scores.filter((x) => x.judge_id !== p.id); st.sheets = st.sheets.filter((x) => x.judge_id !== p.id); save(); return { ok: true };
        }
        fail('Unknown action.');
      },
      async uploadPhoto(blob, caption) {
        if (!isAdmin()) fail('Only the Site Admin can add photos.');
        const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
        st.photos.push({ id: uid(), storage_path: 'photos/demo.jpg', caption: caption || '', position: st.photos.length + 1, url });
        try { save(); } catch (e) { st.photos.pop(); fail('The demo can only hold a few photos on this device.'); }
      },
      async deletePhoto(p) { if (!isAdmin()) fail('Only the Site Admin can remove photos.'); st.photos = st.photos.filter((x) => x.id !== p.id); save(); },
      subscribe(cb, onStatus) { listeners.add(cb); if (onStatus) setTimeout(() => onStatus(true), 0); return () => listeners.delete(cb); }
    };
    return api;
  }

  MC.api = MC.demo ? demoApi() : supaApi();
})();
