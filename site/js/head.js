// Head Judge console: open/close judging, own score sheet, everyone's scores live, reopen sheets,
// read-only panel, start time, finalize + publish, revert request, export after posting.
(function () {
  'use strict';
  const MC = window.MC;
  const { $, esc, api, fmtDate, fmtStamp, ordinal } = MC;
  let sheet = null, pick = null, lastOpen;

  function renderOrder(s) {
    const open = s.readers.find((r) => r.judging_status === 'open');
    const pub = s.final.status === 'published';
    $('#order-list').innerHTML = s.readers.length ? s.readers.map((r, i) => {
      const isOpen = r.judging_status === 'open';
      return `<article class="rrow${isOpen ? ' now' : ''}"><div class="rinfo"><span class="ord" aria-hidden="true">${i + 1}</span><div class="rwho"><strong>${esc(r.student_name)}</strong>${isOpen ? ' <span class="nowtag">Now reading</span>' : ''}<span class="small">${esc(r.school)}</span><span class="small">${MC.readerDetailsLine(s, r)}</span></div></div>
        <div class="acts"><span class="setupacts">${MC.orderControls(s, r, i)}</span>${MC.statusChip(r.judging_status)}${pub ? '' : isOpen ? `<button type="button" class="btn alt" data-close="${esc(r.id)}">Close judging</button>` : `<button type="button" class="btn" data-open="${esc(r.id)}">Open judging</button>`}</div></article>`;
    }).join('') : '<p class="placeholder">No readers yet. The Site Admin adds readers.</p>';
    if (pub) $('#order-list').insertAdjacentHTML('afterbegin', '<p class="posted">Results are posted, so judging is closed.</p>');
    $('#ev-date').textContent = fmtDate(s.event.event_date);
    if (document.activeElement !== $('#ev-time')) $('#ev-time').value = s.event.start_time || '';
    void open;
  }
  function renderSheet(s, first) {
    const opened = s.readers.filter((r) => r.judging_status !== 'not_opened');
    const open = s.readers.find((r) => r.judging_status === 'open');
    if (first || !pick || !s.readers.some((r) => r.id === pick)) pick = open ? open.id : (opened[0] && opened[0].id) || null;
    else if (open && open.id !== lastOpen) pick = open.id; // follow the newly opened reader
    lastOpen = open ? open.id : null;
    $('#hj-pick').innerHTML = s.readers.map((r) => {
      const sh = MC.sheetOf(s, r.id, s.me.id);
      const tag = r.judging_status === 'not_opened' ? ' (not opened)' : sh && sh.status === 'turned_in' ? ' (turned in)' : r.judging_status === 'open' ? ' (open now)' : '';
      return `<option value="${esc(r.id)}"${r.id === pick ? ' selected' : ''}>${esc(r.student_name)}${tag}</option>`;
    }).join('');
    if (!sheet) sheet = MC.ScoreSheet($('#sheet'));
    sheet.show(s, pick);
  }
  function renderAll(s) {
    $('#all-table').innerHTML = MC.scoresTable(s);
    const P = MC.panelRows(s); const pub = s.final.status === 'published';
    const blocks = s.readers.map((r) => {
      const btns = P.filter((p) => { const sh = MC.sheetOf(s, r.id, p.judge_id); return sh && sh.status === 'turned_in'; })
        .map((p) => `<button type="button" class="mini" data-reopen="${esc(r.id)}|${esc(p.judge_id)}" ${pub ? 'disabled' : ''}>Reopen for editing: ${esc(p.label)}</button>`).join('');
      return btns ? `<div class="reopen-block"><h3>${esc(r.student_name)}</h3>${btns}</div>` : '';
    }).join('');
    $('#reopen').innerHTML = (pub ? '<p class="note">Results are posted. To change a score, send a revert request to the Site Admin (Finalize &amp; publish tab).</p>' : '') + (blocks || '<p class="small">No sheets have been turned in yet.</p>');
  }
  function renderPanel(s) {
    $('#panel-list').innerHTML = MC.panelRows(s).map((p) => `<article class="jrow"><div class="who"><strong>${esc(p.label)}</strong>${p.judge_id === s.me.id ? ' <span class="chip f">You</span>' : ''}<span class="small">${esc(p.name)}</span></div></article>`).join('');
  }
  function checks(s) {
    const P = MC.panelRows(s);
    const list = [];
    const closed = s.readers.filter((r) => r.judging_status === 'closed').length;
    list.push([closed === s.readers.length && s.readers.length > 0, `All ${s.readers.length} readers' judging is closed` + (closed < s.readers.length ? ` (${s.readers.length - closed} still to close)` : '')]);
    P.forEach((p) => {
      const n = s.readers.filter((r) => { const sh = MC.sheetOf(s, r.id, p.judge_id); return sh && sh.status === 'turned_in' && MC.sheetTotal(s, r.id, p.judge_id).scored === s.criteria.length; }).length;
      list.push([n === s.readers.length, `${p.label} (${p.name}) scores turned in for every reader` + (n < s.readers.length ? ` (${n} of ${s.readers.length})` : '')]);
    });
    return list;
  }
  function rankTable(rows) {
    return `<div class="scroll"><table class="t"><thead><tr><th>Place</th><th>Reader &amp; school</th><th class="tot">Total</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${x.place <= 3 ? ['🥇', '🥈', '🥉'][x.place - 1] + ' ' : ''}${ordinal(x.place)}</td><td><strong>${esc(x.name)}</strong><br><span class="small">${esc(x.school)}</span></td><td class="tot">${esc(x.total)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function renderFinal(s) {
    const box = $('#final-body');
    const pub = s.final.status === 'published';
    const reqs = s.requests.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const reqHtml = reqs.length ? '<h3>My revert requests</h3>' + reqs.map((r) => `<p class="small">${esc(fmtStamp(r.created_at))} · <span class="chip ${r.status === 'pending' ? 'd' : r.status === 'approved' ? 'f' : 'n'}">${esc(r.status === 'pending' ? 'Waiting for the Site Admin' : r.status === 'approved' ? 'Reverted' : 'Declined')}</span> “${esc(r.reason)}”${r.decision_note ? ' · Site Admin: ' + esc(r.decision_note) : ''}</p>`).join('') : '';
    if (pub) {
      const oldTa = box.querySelector('#rv-form textarea');
      const keep = oldTa ? oldTa.value : ''; const hadFocus = oldTa && document.activeElement === oldTa;
      const pending = reqs.some((r) => r.status === 'pending');
      box.innerHTML = `<div class="posted"><p><strong>Public results:</strong> Posted ${esc(fmtStamp(s.final.published_at))}</p><p class="small">This ranking is on the landing page now. If a score must be corrected, send a revert request to the Site Admin. Only the Site Admin can take the results down and reopen scoring.</p></div>
        <h3>Posted ranking</h3>${rankTable(s.final.results || [])}
        ${MC.exportBlock(true)}
        <div class="req"><p><strong>Request revert from the Site Admin</strong></p>
          ${pending ? '<p class="small">You have a request waiting for the Site Admin.</p>' : ''}
          <form id="rv-form"><label>Reason for the request<textarea name="reason" maxlength="1000" required placeholder="Explain what needs to be corrected, e.g. a judge entered a score for the wrong reader."></textarea></label>
          <button type="submit" class="btn danger">Send revert request</button></form>
          <p class="small" style="margin-top:.5rem">If the Site Admin agrees, the results come off the public page and you can reopen score sheets.</p></div>${reqHtml}`;
      $('#rv-form').onsubmit = async (e) => {
        e.preventDefault(); const t = e.target.reason.value.trim();
        if (!t) { MC.toast('Please give a reason.', true); return; }
        await MC.withBusy(e.target.querySelector('button'), async () => { await api.requestRevert(t); e.target.reason.value = ''; MC.toast('Revert request sent to the Site Admin.'); await MC.refresh(); });
      };
      const ta = box.querySelector('#rv-form textarea');
      if (keep) ta.value = keep; if (hadFocus) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      MC.wireExport(box, s);
      return;
    }
    const ch = checks(s); const ready = ch.every((c) => c[0]);
    const rk = MC.ranking(s.readers, s.panel, s.scores, s.criteria).map((x) => ({ place: x.place, name: x.reader.student_name, school: x.reader.school, total: x.total }));
    box.innerHTML = `<h3>Ready to publish?</h3><ul class="checks">${ch.map((c) => `<li class="${c[0] ? 'ok' : 'no'}">${esc(c[1])}</li>`).join('')}</ul>
      <h3>Ranking preview</h3><p class="small">Place is the sum of all judges' totals. Readers with the same Total share a place. This is what will appear on the public landing page.</p>${rankTable(rk)}
      <p class="warn">Finalize and publish posts this ranking on the public landing page. Judges will no longer be able to edit scores. You will be asked to confirm.</p>
      <button type="button" class="btn" id="btn-finalize" ${ready ? '' : 'disabled aria-describedby="nr"'}>Finalize and publish results</button>
      ${ready ? '' : '<p class="small" id="nr" style="margin-top:.4rem">This unlocks when every item in the checklist is ticked.</p>'}${reqHtml}`;
    const b = $('#btn-finalize');
    if (b) b.onclick = async () => {
      const ok = await MC.confirmBox('Finalize and publish results?', `<p>This posts the ranking on the public landing page now. ${esc(rk[0] ? rk[0].name : '')} will show in 1st place with a Total of ${esc(rk[0] ? rk[0].total : 0)}.</p><p>Judges will no longer be able to edit scores.</p>`, 'Finalize and publish');
      if (!ok) return;
      await MC.withBusy(b, async () => { await api.finalize(); MC.toast('Results posted on the landing page. 🎉'); await MC.refresh(); });
    };
  }

  function render(s, first) {
    renderOrder(s); MC.renderSetup(s, $('#setup'), false); renderSheet(s, first); renderAll(s); renderPanel(s); renderFinal(s);
    if (first) {
      MC.tabs($('.tabs'));
      $('#hj-pick').onchange = (e) => { pick = e.target.value; sheet.show(MC.state, pick); };
      $('#ev-form').onsubmit = async (e) => {
        e.preventDefault(); const t = $('#ev-time').value;
        await MC.withBusy(e.submitter, async () => { await api.setStartTime(t || null); MC.toast(t ? 'Start time saved.' : 'Start time cleared.'); await MC.refresh(); });
      };
      $('#ev-clear').onclick = async (e) => { $('#ev-time').value = ''; await MC.withBusy(e.target, async () => { await api.setStartTime(null); MC.toast('Start time cleared. The landing page shows the date only.'); await MC.refresh(); }); };
    }
  }
  document.addEventListener('click', async (e) => {
    const s = MC.state; if (!s) return;
    const o = e.target.closest('[data-open]'), c = e.target.closest('[data-close]'), ro = e.target.closest('[data-reopen]'), d = e.target.closest('[data-detail]');
    if (o) {
      const r = s.readers.find((x) => x.id === o.dataset.open); const cur = s.readers.find((x) => x.judging_status === 'open');
      if (cur) { const yes = await MC.confirmBox('Close ' + cur.student_name + ' first?', `<p>Judging is still open for <strong>${esc(cur.student_name)}</strong>. Close it and open <strong>${esc(r.student_name)}</strong>?</p>`, 'Close and open next'); if (!yes) return; }
      else if (r.judging_status === 'closed') { const yes = await MC.confirmBox('Open judging again?', `<p>${esc(r.student_name)} was already judged. Open judging again so judges can finish or re-score?</p>`, 'Open judging'); if (!yes) return; }
      await MC.withBusy(o, async () => { await api.openReader(r.id, !!cur); MC.toast('Judging open for ' + r.student_name + '.'); await MC.refresh(); });
    } else if (c) {
      await MC.withBusy(c, async () => { await api.closeReader(c.dataset.close); MC.toast('Judging closed.'); await MC.refresh(); });
    } else if (ro) {
      const [rid, jid] = ro.dataset.reopen.split('|'); const r = s.readers.find((x) => x.id === rid); const p = MC.panelRows(s).find((x) => x.judge_id === jid);
      const yes = await MC.confirmBox('Reopen this sheet?', `<p>${esc(p.label)} (${esc(p.name)}) will be able to edit their scores for <strong>${esc(r.student_name)}</strong> again, then turn them in again.</p>`, 'Reopen for editing');
      if (!yes) return;
      await MC.withBusy(ro, async () => { await api.reopenSheet(rid, jid); MC.toast('Sheet reopened.'); await MC.refresh(); });
    } else if (d) {
      const [rid, jid] = d.dataset.detail.split('|'); MC.showDetail(s, rid, jid);
    }
  });
  MC.startConsole({ roles: ['head_judge'], onState: render });
})();
