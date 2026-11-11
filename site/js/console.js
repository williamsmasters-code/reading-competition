// Shared console shell for admin.html, head.html and judge.html:
// role guard, top bar, live status, loading + re-rendering on every live change.
(function () {
  'use strict';
  const MC = window.MC;
  const { $, esc, api, fmtDate, fmtTime, homeFor, roleLabel, panelLabel } = MC;

  MC.startConsole = async function (o) { // {roles:[...], title, onState(state, first)}
    let me = null;
    try { me = await api.me(); } catch (e) { console.warn(e); }
    if (!me || !me.role || !me.active) { location.replace('login.html'); return; }
    if (!o.roles.includes(me.role)) { location.replace(homeFor(me.role)); return; }
    $('#who').innerHTML = 'Signed in as <strong>' + esc(me.full_name || me.email) + '</strong> · <button type="button" class="linkish" id="embtn">Change email</button> · <button type="button" class="linkish" id="pwbtn">Change password</button> · <button type="button" class="linkish" id="logout">Log out</button>';
    $('#logout').onclick = async () => { await api.signOut(); location.href = 'index.html'; };
    $('#embtn').onclick = async () => {
      const v = await MC.dialog({ title: 'Change my login email', html: '<p class="small">Now: <strong>' + esc(me.email) + '</strong></p>' + (api.demo ? '' : '<p class="small">We will email a confirmation link. Your login email changes only after you click it (Supabase may also ask you to confirm from your current address).</p>'),
        fields: [{ name: 'email', label: 'New email', type: 'email', required: true, autocomplete: 'email' }], ok: 'Change email' });
      if (!v) return;
      try {
        const r = await api.changeEmail(v.email);
        if (r && r.pending) MC.toast('Check ' + v.email.trim() + ' for a confirmation link. Until you click it, keep signing in with ' + me.email + '.');
        else { MC.toast('Login email changed to ' + v.email.trim().toLowerCase() + '.'); me.email = v.email.trim().toLowerCase(); }
        MC.refresh();
      } catch (e) { MC.toast(e.message, true); }
    };
    $('#pwbtn').onclick = async () => {
      const v = await MC.dialog({ title: 'Change my password', fields: [{ name: 'pw', label: 'New password (at least 8 characters)', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }], ok: 'Save password' });
      if (!v) return;
      try { await api.changePassword(v.pw); MC.toast('Password changed.'); } catch (e) { MC.toast(e.message, true); }
    };
    let state = null, busy = false, again = false, live = false;
    const status = (s) => {
      const ev = s.event, fin = s.final;
      const open = s.readers.find((r) => r.judging_status === 'open');
      $('#statusline').innerHTML = '<strong>Competition day:</strong> ' + esc(fmtDate(ev.event_date)) + (ev.start_time ? ' · Starts ' + esc(fmtTime(ev.start_time)) : '') +
        (fin.status === 'published' ? ' · <span class="chip f">Results posted</span>' : open ? ' · <span class="live">Judging open: ' + esc(open.student_name) + '</span>' : ' · <span class="live off">No reader open</span>') +
        ' · <span class="small" id="liveflag">' + (live ? '● Live updates on' : '○ Connecting…') + '</span>';
    };
    const refresh = async (first) => {
      if (busy) { again = true; return; }
      busy = true;
      try {
        const s = await api.loadAll();
        if (!s) { location.replace('login.html'); return; }
        state = s; MC.state = s; status(s);
        // keep keyboard focus on the same control when a live update redraws the page
        const ae = document.activeElement; let sel = null;
        if (ae && ae !== document.body && ae.tagName === 'BUTTON') { const k = Object.keys(ae.dataset)[0]; if (k) sel = `button[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${CSS.escape(ae.dataset[k])}"]`; }
        o.onState(s, first);
        if (sel && !document.contains(ae)) { const n = Array.from(document.querySelectorAll(sel)).find((x) => x.offsetParent !== null && !x.disabled) || Array.from(document.querySelectorAll(sel)).find((x) => x.offsetParent !== null); if (n) n.focus(); }
      } catch (e) { console.warn(e); MC.toast(e.message, true); }
      finally { busy = false; if (again) { again = false; refresh(false); } }
    };
    MC.refresh = () => refresh(false);
    await refresh(true);
    if (MC.flushAllPending && state && (me.role === 'judge' || me.role === 'head_judge')) MC.flushAllPending(state).then(() => refresh(false)).catch(() => {});
    api.subscribe(() => refresh(false), (ok) => { live = ok; const f = $('#liveflag'); if (f) f.textContent = ok ? '● Live updates on' : '○ Reconnecting…'; });
  };

  // helpers used by several consoles
  MC.panelRows = (s) => s.panel.slice().sort((a, b) => a.seat - b.seat).map((p) => {
    const pr = s.profiles.find((x) => x.id === p.judge_id) || {};
    return { judge_id: p.judge_id, seat: p.seat, label: panelLabel(p), name: pr.full_name || '(name hidden)', profile: pr };
  });
  MC.sheetOf = (s, readerId, judgeId) => s.sheets.find((x) => x.reader_id === readerId && x.judge_id === judgeId) || null;
  MC.sheetTotal = (s, readerId, judgeId) => {
    const crit = new Set(s.criteria.map((c) => c.id)); let t = 0, n = 0;
    s.scores.forEach((x) => { if (x.reader_id === readerId && x.judge_id === judgeId && crit.has(x.criterion_id) && x.score != null) { t += x.score; n++; } });
    return { total: t, scored: n };
  };
  MC.statusChip = (st) => st === 'open' ? '<span class="op o">Open</span>' : st === 'closed' ? '<span class="op c">Closed</span>' : '<span class="op w">Not opened</span>';
  MC.withBusy = async (btn, fn) => {
    if (btn) btn.disabled = true;
    try { return await fn(); } catch (e) { MC.toast(e.message, true); return undefined; } finally { if (btn) btn.disabled = false; }
  };
  // shared "All judges' scores" table (Head Judge + Site Admin)
  MC.scoresTable = function (s, opts) {
    const P = MC.panelRows(s);
    const rk = MC.ranking(s.readers, s.panel, s.scores, s.criteria);
    const totalOf = Object.fromEntries(rk.map((x) => [x.reader.id, x.total]));
    const rows = s.readers.map((r) => {
      const cells = P.map((p) => {
        const sh = MC.sheetOf(s, r.id, p.judge_id); const t = MC.sheetTotal(s, r.id, p.judge_id);
        if (!t.scored && !sh) return '<td class="pend">—</td>';
        const chip = sh && sh.status === 'turned_in' ? '<span class="chip f">Turned in</span>' : '<span class="chip d">Draft' + (t.scored < s.criteria.length ? ' ' + t.scored + '/' + s.criteria.length : '') + '</span>';
        return `<td><button type="button" class="cellbtn" data-detail="${esc(r.id)}|${esc(p.judge_id)}" aria-label="${esc(p.label)} scores for ${esc(r.student_name)}: ${t.total}">${t.total}</button><br>${chip}</td>`;
      }).join('');
      const any = s.scores.some((x) => x.reader_id === r.id);
      return `<tr><td><strong>${esc(r.student_name)}</strong><br><span class="small">${esc(r.school)}</span></td><td>${MC.statusChip(r.judging_status)}</td>${cells}<td class="tot">${any ? totalOf[r.id] : '—'}</td></tr>`;
    }).join('');
    return `<div class="scroll"><table class="t scores"><caption class="sr">Every judge's total for every reader</caption><thead><tr><th scope="col">Reader</th><th scope="col">Judging</th>${P.map((p) => `<th scope="col">${esc(p.label)}<br><span style="font-weight:600">${esc(p.name)}</span></th>`).join('')}<th scope="col" class="tot">Total</th></tr></thead><tbody>${rows || `<tr><td colspan="${P.length + 3}">No readers yet.</td></tr>`}</tbody></table></div>`;
  };
  // detail modal: one judge's criteria scores + comments for one reader
  MC.showDetail = function (s, readerId, judgeId) {
    const r = s.readers.find((x) => x.id === readerId); const p = MC.panelRows(s).find((x) => x.judge_id === judgeId) || { label: 'Judge', name: '' };
    const t = MC.sheetTotal(s, readerId, judgeId); const sh = MC.sheetOf(s, readerId, judgeId);
    const rows = s.criteria.map((c, i) => { const sc = s.scores.find((x) => x.reader_id === readerId && x.judge_id === judgeId && x.criterion_id === c.id) || {};
      return `<tr><td>${i + 1}</td><td>${esc(c.text)}</td><td class="tot">${sc.score == null ? '—' : sc.score}</td><td>${esc(sc.comment || '')}</td></tr>`; }).join('');
    MC.dialog({ title: (r ? r.student_name : 'Reader') + ' · ' + p.label, cancel: false, ok: 'Close',
      html: `<p class="small">${esc(p.name)} · ${sh && sh.status === 'turned_in' ? 'Turned in' : 'Draft'} · Total <strong>${t.total}</strong></p><div class="scroll"><table class="t"><thead><tr><th>#</th><th>Item</th><th>Score</th><th>Comments</th></tr></thead><tbody>${rows}</tbody></table></div>` });
  };
  MC.roleLabel = roleLabel;
})();
