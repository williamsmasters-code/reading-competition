// Site Admin console: accounts, judges panel, readers, criteria, live scores, start time,
// finalization (export + revert requests) and event photos.
(function () {
  'use strict';
  const MC = window.MC;
  const { $, esc, api, fmtDate, fmtStamp, roleLabel } = MC;
  const S = () => MC.state;
  const ok = (m) => MC.toast(m);
  const run = (btn, fn, msg) => MC.withBusy(btn, async () => { await fn(); if (msg) ok(msg); await MC.refresh(); });

  // ---------- overview ----------
  function renderOverview(s) {
    const P = s.panel;
    const full = s.readers.filter((r) => P.length && P.every((p) => { const sh = MC.sheetOf(s, r.id, p.judge_id); return sh && sh.status === 'turned_in'; })).length;
    $('#stats').innerHTML = `<div class="stat"><b>${s.profiles.filter((p) => p.role && p.active).length}</b><span>Accounts set up</span></div>
      <div class="stat"><b>${s.readers.length}</b><span>Readers</span></div>
      <div class="stat"><b>${full} / ${s.readers.length}</b><span>Readers fully scored</span></div>
      <div class="stat"><b>${s.final.status === 'published' ? 'Posted' : 'Not posted'}</b><span>Public results</span></div>`;
    $('#ev-date').textContent = fmtDate(s.event.event_date);
    if (document.activeElement !== $('#ev-time')) $('#ev-time').value = s.event.start_time || '';
  }
  // ---------- users ----------
  function seatOf(s, id) { const p = s.panel.find((x) => x.judge_id === id); return p ? p.seat : null; }
  function renderUsers(s) {
    const order = { site_admin: 0, head_judge: 1, judge: 2 };
    const list = s.profiles.slice().sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3) || (seatOf(s, a.id) ?? 99) - (seatOf(s, b.id) ?? 99) || a.full_name.localeCompare(b.full_name));
    $('#users-table').innerHTML = `<div class="scroll"><table class="t"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.map((p) => {
      const seat = seatOf(s, p.id);
      const rl = p.role === 'judge' ? (seat ? 'Judge ' + seat : 'Judge') : roleLabel(p.role);
      return `<tr><td><strong>${esc(p.full_name || '(no name)')}</strong>${p.id === s.me.id ? ' <span class="chip f">You</span>' : ''}<br><span class="small">${esc(p.email || '')}</span></td>
        <td><span class="role ${esc(p.role || 'none')}">${esc(rl)}</span>${p.role === 'judge' && !seat ? '<br><span class="chip d">Not on panel</span>' : ''}</td>
        <td><span class="dot${p.active ? ' on' : ''}"></span>${p.active ? 'Active' : 'Deactivated'}</td>
        <td><button class="mini" data-uedit="${esc(p.id)}">Edit</button><button class="mini" data-uemail="${esc(p.id)}">Change email</button><button class="mini" data-upw="${esc(p.id)}">Reset password</button>${p.id === s.me.id ? '' : `<button class="mini" data-uact="${esc(p.id)}">${p.active ? 'Deactivate' : 'Activate'}</button><button class="mini danger" data-udel="${esc(p.id)}">Delete</button>`}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  const roleOptions = (cur) => [{ value: 'judge', label: 'Judge' }, { value: 'head_judge', label: 'Head Judge' }, { value: 'site_admin', label: 'Site Admin' }, { value: '', label: 'No access' }].map((o) => o).filter((o) => o.value !== '' || cur !== undefined);
  async function addUser() {
    const v = await MC.dialog({ title: 'Add a user', ok: 'Create account', html: MAIL_NOTE('starting'), fields: [
      { name: 'full_name', label: 'Full name', required: true, maxlength: 100 },
      { name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'off' },
      { name: 'role', label: 'Role', type: 'select', value: 'judge', options: roleOptions() },
      { name: 'password', label: 'Starting password (at least 8 characters)', type: 'text', required: true, minlength: 8, autocomplete: 'off' },
      { name: 'send_email', label: 'Send login email (site link, login email, role, optional "Choose your own password" link)', type: 'checkbox', value: true },
      { name: 'panel', label: 'Also add to the judges panel (Judges only)', type: 'checkbox', value: true }] });
    if (!v) return;
    await MC.withBusy(null, async () => {
      const r = await api.adminUsers('create_user', { full_name: v.full_name, email: v.email, role: v.role, password: v.password, add_to_panel: v.role === 'judge' && v.panel, send_email: v.send_email });
      await mailResult(r, 'Account created for ' + v.full_name + '.', v.email); await MC.refresh();
    });
  }
  // Shared wording for the Add user and Reset password dialogs.
  const MAIL_NOTE = (kind) => `<p class="small">The ${kind === 'starting' ? 'starting' : 'new'} password works straight away and keeps working until the person changes it. Tell them the password yourself (in person or by phone); it is <strong>never</strong> put in the email.</p>
    <p class="small">"Send login email" sends one email from Supabase with the site link, their login email, their role and an optional link to choose their own password. Supabase's free email only sends about 2 emails an hour, so if the limit is reached, untick it and just tell them.</p>`;
  async function mailResult(r, done, email) {
    if (r && r.warning) {
      await MC.dialog({ title: 'Saved, but no email was sent', cancel: false, ok: 'OK', html: '<p class="warn">' + esc(r.warning) + '</p>' });
      MC.toast(done);
    } else MC.toast(done + (r && r.email_sent ? ' Login email sent to ' + email + '.' + (api.demo ? ' (Demo: no real email.)' : '') : ''));
  }
  async function editUser(id) {
    const s = S(); const p = s.profiles.find((x) => x.id === id);
    const v = await MC.dialog({ title: 'Edit ' + (p.full_name || p.email), ok: 'Save', html: p.id === s.me.id ? '<p class="small">You can\'t change your own role.</p>' : '<p class="small">Only one Site Admin and one Head Judge are allowed. To swap the Head Judge, first change the current Head Judge to Judge.</p>', fields: [
      { name: 'full_name', label: 'Full name', value: p.full_name, required: true, maxlength: 100 },
      { name: 'role', label: 'Role', type: 'select', value: p.role || '', options: roleOptions(p.role) }] });
    if (!v) return;
    const patch = { full_name: v.full_name }; if (p.id !== s.me.id && (v.role || null) !== p.role) patch.role = v.role || null;
    await run(null, () => api.updateProfile(id, patch), 'Saved.');
  }
  // ---------- panel ----------
  function renderPanel(s) {
    const P = MC.panelRows(s);
    $('#panel-list').innerHTML = P.map((p) => `<article class="jrow"><div class="who"><strong>${esc(p.label)}</strong>${p.seat === 0 ? ' <span class="chip f">Required</span>' : ''}<span class="small">${esc(p.name)}</span></div>${p.seat === 0 ? '<span class="locked">Can\'t be removed</span>' : `<button type="button" class="mini danger" data-premove="${esc(p.judge_id)}">Remove</button>`}</article>`).join('');
    const free = s.profiles.filter((x) => x.role === 'judge' && x.active && !s.panel.some((p) => p.judge_id === x.id));
    $('#panel-pick').innerHTML = free.length ? '<option value="">Select a judge account…</option>' + free.map((x) => `<option value="${esc(x.id)}">${esc(x.full_name)} (${esc(x.email)})</option>`).join('') : '<option value="">No judge accounts waiting. Add one under Users &amp; roles.</option>';
  }
  // ---------- readers ----------
  function renderReaders(s) {
    $('#readers-note').innerHTML = `${s.readers.length} reader${s.readers.length === 1 ? '' : 's'}. The first readers were loaded from <strong>Judge1 Readers.xlsx</strong>. Use the form below to add one, or the buttons to edit, substitute or remove.`;
    $('#readers-table').innerHTML = `<div class="scroll"><table class="t"><thead><tr><th>#</th><th>Reader</th><th>School</th><th>Item · Round · District</th><th>Judging</th><th></th></tr></thead><tbody>${s.readers.map((r, i) => `<tr>
      <td><span class="movebtns">${MC.orderControls(s, r, i).split('<button type="button" class="mini" data-rdetails')[0]}</span> ${i + 1}</td>
      <td><strong>${esc(r.student_name)}</strong></td><td>${esc(r.school)}</td><td class="small">${MC.readerDetailsLine(s, r)}<br>${esc(fmtDate(r.reading_date))}</td><td>${MC.statusChip(r.judging_status)}</td>
      <td><button class="mini" data-redit="${esc(r.id)}">Edit</button><button class="mini" data-rdetails="${esc(r.id)}">Edit details</button><button class="mini" data-rsub="${esc(r.id)}">Substitute</button><button class="mini danger" data-rdel="${esc(r.id)}">Remove</button></td></tr>`).join('') || '<tr><td colspan="6">No readers yet.</td></tr>'}</tbody></table></div>`;
    const schools = Array.from(new Set(s.readers.map((r) => r.school).filter(Boolean).concat(["St Thomas Aquinas Catholic", "Dover Gov't", "Mt Pleasant Gov't", "Hillsborough Gov't", "Our Lady of the Rosary Catholic", "Harvey Vale Gov't"])));
    $('#schools').innerHTML = schools.map((x) => `<option value="${esc(x)}">`).join('');
    fillReaderSelects(s);
  }
  // Round / District pick-lists from the Setup tab. The Item comes from the round's default
  // (a single reader's own item is set with Edit details).
  function fillReaderSelects(s) {
    const f = $('#rform'); const r = f.round_no.value, d = f.district_id.value;
    f.round_no.innerHTML = s.rounds.map((x) => `<option value="${x.number}">${esc(MC.roundLabel(s, x.number))}</option>`).join('');
    f.district_id.innerHTML = '<option value="">No district</option>' + s.districts.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    if (r && s.rounds.some((x) => String(x.number) === r)) f.round_no.value = r;
    if (d && s.districts.some((x) => x.id === d)) f.district_id.value = d;
    showFormItem();
  }
  function showFormItem() {
    const s = S(); if (!s) return; const f = $('#rform');
    const rd = s.rounds.find((x) => String(x.number) === f.round_no.value) || {};
    const own = f.item_id.value && s.items.find((x) => x.id === f.item_id.value);
    const def = s.items.find((x) => x.id === rd.default_item_id);
    $('#rform-item').innerHTML = own ? `Item: <strong>${esc(own.title)}</strong> (this reader's own item; change it with Edit details).`
      : `Item: <strong>${esc(def ? def.title : 'none')}</strong> (the round's default; pick items and defaults on the Setup tab).`;
  }
  function resetReaderForm() {
    const f = $('#rform'); f.reset(); f.id.value = ''; $('#rform-title').textContent = 'Add a reader'; $('#rform-save').textContent = 'Save reader';
    const s = S(); const last = s && s.readers[s.readers.length - 1];
    f.item_id.value = ''; f.reading_date.value = String((last && last.reading_date) || (s ? s.event.event_date : '')).slice(0, 10);
    if (s) { fillReaderSelects(s); f.round_no.value = last ? String(last.round_no) : '1'; f.district_id.value = (last && last.district_id) || ''; showFormItem(); }
  }
  // ---------- criteria ----------
  function renderCriteria(s) {
    const n = s.criteria.length;
    $('#crit-note').textContent = `Each criterion is scored 1 to 5. There are ${n} criteria. A reader's Total is the sum of all judges on the panel. Use ↑ ↓ to reorder.`;
    $('#crit-list').innerHTML = s.criteria.map((c, i) => `<li class="critrow"><span class="cn" aria-hidden="true">${i + 1}</span><span class="ct">${esc(c.text)}</span>
      <span><button class="mini" data-cup="${esc(c.id)}" aria-label="Move criterion ${i + 1} up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="mini" data-cdown="${esc(c.id)}" aria-label="Move criterion ${i + 1} down" ${i === n - 1 ? 'disabled' : ''}>↓</button><button class="mini" data-cedit="${esc(c.id)}" aria-label="Edit criterion ${i + 1}">Edit</button><button class="mini danger" data-cdel="${esc(c.id)}" aria-label="Remove criterion ${i + 1}">Remove</button></span></li>`).join('');
    $('#crit-warn').hidden = !s.scores.length;
  }
  // ---------- live + final ----------
  function renderLive(s) {
    const P = MC.panelRows(s);
    $('#live-table').innerHTML = MC.scoresTable(s) + `<p class="small" style="margin-top:.6rem">Turned in for every reader: ${P.map((p) => { const n = s.readers.filter((r) => { const sh = MC.sheetOf(s, r.id, p.judge_id); return sh && sh.status === 'turned_in'; }).length; return `<span class="chip ${n === s.readers.length && n ? 'f' : 'd'}">${esc(p.label)} ${n}/${s.readers.length}</span>`; }).join(' ')}</p>`;
  }
  function renderFinal(s) {
    const pub = s.final.status === 'published';
    const reqs = s.requests.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const head = (id) => (s.profiles.find((p) => p.id === id) || {}).full_name || 'Head Judge';
    const pending = reqs.filter((r) => r.status === 'pending'), done = reqs.filter((r) => r.status !== 'pending');
    $('#final-body').innerHTML = `<p><strong>Public results:</strong> ${pub ? 'Posted ' + esc(fmtStamp(s.final.published_at)) + ' · <a href="index.html#results">see the landing page</a>' : 'Not posted yet. The Head Judge posts them once every judge has turned in every sheet.'}</p>
      ${MC.exportBlock(pub)}
      <h3>Revert requests from the Head Judge</h3>
      ${pending.length ? pending.map((r) => `<div class="req"><p><strong>Request</strong> · ${esc(head(r.requested_by))} · ${esc(fmtStamp(r.created_at))}</p><p style="margin:.4rem 0">“${esc(r.reason)}”</p>
        <button class="btn danger" data-rvok="${esc(r.id)}">Revert finalization</button> <button class="btn ghost" data-rvno="${esc(r.id)}">Decline</button>
        <p class="small" style="margin-top:.5rem">Reverting takes the results off the public page and lets the Head Judge reopen scoring.</p></div>`).join('') : '<p class="small">No requests waiting.</p>'}
      ${done.length ? '<h3>Earlier requests</h3>' + done.map((r) => `<p class="small">${esc(fmtStamp(r.created_at))} · <span class="chip ${r.status === 'approved' ? 'f' : 'n'}">${r.status === 'approved' ? 'Reverted' : 'Declined'}</span> “${esc(r.reason)}”${r.decision_note ? ' · Note: ' + esc(r.decision_note) : ''}</p>`).join('') : ''}`;
    if (pub) MC.wireExport($('#final-body'), s);
  }
  // ---------- photos ----------
  function renderPhotos(s) {
    $('#photo-list').innerHTML = s.photos.length ? s.photos.map((p) => `<figure><img src="${esc(p.url)}" alt="${esc(p.caption || 'Event photo')}" loading="lazy"><figcaption>${esc(p.caption || '')}</figcaption><button class="mini danger del" data-phdel="${esc(p.id)}">Remove</button></figure>`).join('') : '<p class="placeholder">No photos yet, so the gallery is hidden on the landing page.</p>';
  }
  function resizeImage(file, max) {
    return new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); c.toBlob((b) => b ? res(b) : rej(new Error('Could not read that photo.')), 'image/jpeg', 0.85); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that photo. Try a JPEG or PNG.')); };
      img.src = url;
    });
  }

  function render(s, first) {
    renderOverview(s); renderUsers(s); renderPanel(s); renderReaders(s); renderCriteria(s); renderLive(s); renderFinal(s); renderPhotos(s);
    MC.renderSetup(s, $('#setup'), true);
    if (!first) return;
    $('#rform-round').onchange = showFormItem;
    MC.tabs($('.tabs'));
    resetReaderForm();
    $('#ev-form').onsubmit = (e) => { e.preventDefault(); const t = $('#ev-time').value; run(e.submitter, () => api.setStartTime(t || null), t ? 'Start time saved.' : 'Start time cleared.'); };
    $('#ev-clear').onclick = (e) => { $('#ev-time').value = ''; run(e.target, () => api.setStartTime(null), 'Start time cleared. The landing page shows the date only.'); };
    $('#add-user').onclick = addUser;
    $('#panel-form').onsubmit = (e) => { e.preventDefault(); const id = $('#panel-pick').value; if (!id) { MC.toast('Pick a judge account first.', true); return; } run(e.submitter, () => api.addToPanel(id), 'Judge added to the panel.'); };
    $('#rform').onsubmit = async (e) => {
      e.preventDefault(); const f = e.target; const v = Object.fromEntries(new FormData(f).entries());
      if (!v.student_name.trim()) { MC.toast('Type the student\'s name.', true); f.student_name.focus(); return; }
      v.round_no = +v.round_no || 1;
      if (v.id) {
        const s = S(); const r = s.readers.find((x) => x.id === v.id);
        if (r && v.round_no === r.round_no && (v.district_id || null) === (r.district_id || null)) { delete v.round_no; delete v.district_id; delete v.item_id; }
        else if (r && v.round_no !== r.round_no && s.sheets.some((x) => x.reader_id === r.id && x.status === 'turned_in')) {
          if (!(await MC.confirmBox('Change ' + r.student_name + "'s round?", '<p class="warn">Score sheets for ' + esc(r.student_name) + ' are already turned in. Changing the round changes what those sheets and the export show.</p><p>The scores themselves are kept exactly as they are.</p>', 'Change anyway', true))) return;
        }
      }
      await MC.withBusy(e.submitter, async () => { await api.saveReader(v); ok(v.id ? 'Reader updated.' : 'Reader added.'); resetReaderForm(); await MC.refresh(); });
    };
    $('#rform-cancel').onclick = resetReaderForm;
    $('#crit-form').onsubmit = async (e) => {
      e.preventDefault(); const t = e.target.text.value.trim(); if (!t) return;
      if (S().scores.length && !(await MC.confirmBox('Add a criterion now?', '<p>Judges have already saved scores. Every score sheet gets this new item, sheets already turned in will be missing it, and the possible totals go up. The Head Judge would need to reopen turned-in sheets.</p>', 'Add criterion', true))) return;
      await run(e.submitter, () => api.addCriterion(t), 'Criterion added.'); e.target.reset();
    };
    $('#photo-form').onsubmit = async (e) => {
      e.preventDefault(); const f = e.target; const file = f.file.files[0]; if (!file) { MC.toast('Choose a photo first.', true); return; }
      await MC.withBusy(e.submitter, async () => { const blob = await resizeImage(file, api.demo ? 800 : 1600); await api.uploadPhoto(blob, f.caption.value.trim()); ok('Photo added. It shows on the landing page now.'); f.reset(); await MC.refresh(); });
    };
  }

  document.addEventListener('click', async (e) => {
    const s = S(); if (!s) return;
    const t = e.target.closest('button'); if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.detail) { const [rid, jid] = d.detail.split('|'); MC.showDetail(s, rid, jid); return; }
    if (d.uedit) return editUser(d.uedit);
    if (d.uemail) {
      const p = s.profiles.find((x) => x.id === d.uemail);
      const v = await MC.dialog({ title: 'Change login email for ' + (p.full_name || p.email), ok: 'Change email', html: '<p class="small">Now: <strong>' + esc(p.email) + '</strong>. The change is immediate (no confirmation email), so check the spelling. Tell the person to sign in with the new email; their password stays the same.</p>', fields: [{ name: 'email', label: 'New email', type: 'email', required: true, autocomplete: 'off' }] });
      if (v) await run(t, () => api.adminUsers('update_email', { user_id: p.id, email: v.email }), 'Email changed.');
      return;
    }
    if (d.upw) {
      const p = s.profiles.find((x) => x.id === d.upw);
      const v = await MC.dialog({ title: 'Reset password for ' + (p.full_name || p.email), ok: 'Set new password', html: MAIL_NOTE('new'), fields: [
        { name: 'pw', label: 'New password (at least 8 characters)', required: true, minlength: 8, autocomplete: 'off' },
        { name: 'send_email', label: 'Send login email to ' + p.email + ' (optional "Choose your own password" link)', type: 'checkbox', value: true }] });
      if (v) await MC.withBusy(t, async () => { const r = await api.adminUsers('reset_password', { user_id: p.id, password: v.pw, send_email: v.send_email }); await mailResult(r, 'Password reset. The new password works now.', p.email); await MC.refresh(); });
      return;
    }
    if (d.uact) {
      const p = s.profiles.find((x) => x.id === d.uact);
      if (p.active && !(await MC.confirmBox('Deactivate ' + p.full_name + '?', '<p>They will not be able to see or score anything until you activate the account again.' + (s.panel.some((x) => x.judge_id === p.id) ? ' They stay on the panel list, but cannot score.' : '') + '</p>', 'Deactivate', true))) return;
      await run(t, () => api.updateProfile(p.id, { active: !p.active }), p.active ? 'Account deactivated.' : 'Account activated.');
      return;
    }
    if (d.udel) {
      const p = s.profiles.find((x) => x.id === d.udel); const n = s.scores.filter((x) => x.judge_id === p.id).length;
      if (!(await MC.confirmBox('Delete ' + p.full_name + '?', `<p>This deletes the login for good${n ? ` <strong>and their ${n} saved scores</strong>` : ''}. To just stop access, use Deactivate instead.</p>`, 'Delete account', true))) return;
      await run(t, () => api.adminUsers('delete_user', { user_id: p.id }), 'Account deleted.');
      return;
    }
    if (d.premove) {
      const P = MC.panelRows(s); const p = P.find((x) => x.judge_id === d.premove);
      if (!(await MC.confirmBox('Remove ' + p.label + '?', `<p>Removing <strong>${esc(p.name)}</strong> takes their scores out of every reader's Total. The possible total changes because the number of judges on the panel changes. Their saved scores are kept, and come back if you add them again.</p>`, 'Remove ' + p.label, true))) return;
      await run(t, () => api.removeFromPanel(p.judge_id), p.label + ' removed from the panel.');
      return;
    }
    if (d.redit) {
      const r = s.readers.find((x) => x.id === d.redit); const f = $('#rform');
      f.id.value = r.id; f.student_name.value = r.student_name; f.school.value = r.school; f.item_id.value = r.item_id || ''; f.reading_date.value = String(r.reading_date || '').slice(0, 10); f.round_no.value = String(r.round_no); f.district_id.value = r.district_id || ''; showFormItem();
      $('#rform-title').textContent = 'Edit ' + r.student_name; $('#rform-save').textContent = 'Save changes'; f.student_name.focus(); f.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (d.rsub) {
      const r = s.readers.find((x) => x.id === d.rsub); const n = s.scores.filter((x) => x.reader_id === r.id).length;
      const v = await MC.dialog({ title: 'Substitute ' + r.student_name, ok: 'Substitute', html: `<p class="small">The new reader takes place ${s.readers.indexOf(r) + 1} in the running order.${n ? ` <strong>${r.student_name} already has ${n} saved scores; these will be cleared.</strong>` : ''}</p>`, danger: !!n,
        fields: [{ name: 'name', label: 'New student name', required: true, maxlength: 120 }, { name: 'school', label: 'School', value: r.school, maxlength: 120 }] });
      if (!v) return;
      await run(t, () => api.substituteReader(r.id, v.name, v.school, n > 0), 'Reader substituted.');
      return;
    }
    if (d.rdel) {
      const r = s.readers.find((x) => x.id === d.rdel); const n = s.scores.filter((x) => x.reader_id === r.id).length;
      if (!(await MC.confirmBox('Remove ' + r.student_name + '?', `<p>${n ? `<strong>${r.student_name} already has ${n} saved scores. They will be deleted too.</strong> ` : ''}This can't be undone.</p>`, 'Remove reader', true))) return;
      await run(t, () => api.deleteReader(r.id), 'Reader removed.');
      return;
    }
    const move = async (list, id, dir, table) => { const i = list.findIndex((x) => x.id === id); const j = i + dir; if (j < 0 || j >= list.length) return; await run(t, () => api.swapPositions(table, list[i], list[j])); };
    if (d.cup) return move(s.criteria, d.cup, -1, 'criteria');
    if (d.cdown) return move(s.criteria, d.cdown, 1, 'criteria');
    if (d.cedit) {
      const c = s.criteria.find((x) => x.id === d.cedit);
      const v = await MC.dialog({ title: 'Edit criterion', ok: 'Save', fields: [{ name: 'text', label: 'Criterion', type: 'textarea', value: c.text, required: true, maxlength: 300 }] });
      if (v) await run(t, () => api.updateCriterion(c.id, v.text), 'Criterion saved.');
      return;
    }
    if (d.cdel) {
      const c = s.criteria.find((x) => x.id === d.cdel); const n = s.scores.filter((x) => x.criterion_id === c.id).length;
      if (!(await MC.confirmBox('Remove this criterion?', `<p>“${esc(c.text)}”</p>${n ? `<p class="warn">Judges have already saved ${n} scores for it. Those scores will be deleted and the totals will change.</p>` : ''}`, 'Remove criterion', true))) return;
      await run(t, () => api.deleteCriterion(c.id), 'Criterion removed.');
      return;
    }
    if (d.rvok || d.rvno) {
      const approve = !!d.rvok;
      const v = await MC.dialog({ title: approve ? 'Revert the finalization?' : 'Decline this request?', ok: approve ? 'Revert finalization' : 'Decline', danger: approve,
        html: approve ? '<p>The results come off the public landing page now, and the Head Judge can reopen score sheets and publish again.</p>' : '<p>The results stay posted.</p>',
        fields: [{ name: 'note', label: 'Note to the Head Judge (optional)', maxlength: 500 }] });
      if (!v) return;
      await run(t, () => api.decideRevert(d.rvok || d.rvno, approve, v.note), approve ? 'Finalization reverted. Results are off the public page.' : 'Request declined.');
      return;
    }
    if (d.phdel) {
      const p = s.photos.find((x) => x.id === d.phdel);
      if (!(await MC.confirmBox('Remove this photo?', '<p>It disappears from the landing page.</p>', 'Remove photo', true))) return;
      await run(t, () => api.deletePhoto(p), 'Photo removed.');
    }
  });
  MC.startConsole({ roles: ['site_admin'], onState: render });
})();
