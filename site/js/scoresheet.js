// The judging card used by Judges and the Head Judge: 1-5 buttons + comments per criterion,
// autosave (with an on-device retry queue for patchy Wi-Fi), turn in with a confirm step.
(function () {
  'use strict';
  const MC = window.MC;
  const { esc, api, fmtDate, toast } = MC;

  MC.ScoreSheet = function (el) {
    let s = null, readerId = null, draft = {}, dirty = new Set(), timer = null, saving = false, failed = false, retryT = null;
    const me = () => s.me.id;
    const pkey = () => 'mcrc_pending_' + me() + '_' + readerId;
    const sheet = () => MC.sheetOf(s, readerId, me());
    const reader = () => s.readers.find((r) => r.id === readerId);
    const locked = () => !reader() || reader().judging_status === 'not_opened' || (sheet() && sheet().status === 'turned_in') || s.final.status === 'published';
    const seatLabel = () => { const p = s.panel.find((x) => x.judge_id === me()); return p ? MC.panelLabel(p) : 'Not on the panel'; };

    function fromServer() { // merge server values for criteria the judge isn't editing right now
      s.criteria.forEach((c) => {
        if (dirty.has(c.id)) return;
        const x = s.scores.find((y) => y.reader_id === readerId && y.judge_id === me() && y.criterion_id === c.id);
        draft[c.id] = { score: x ? x.score : null, comment: x ? x.comment || '' : '' };
      });
    }
    function loadPending() {
      try { const p = JSON.parse(localStorage.getItem(pkey()) || 'null'); if (p) Object.entries(p).forEach(([k, v]) => { draft[k] = v; dirty.add(k); }); } catch (e) { /* ignore */ }
    }
    function keepPending() {
      const o = {}; dirty.forEach((k) => { o[k] = draft[k]; });
      if (dirty.size) localStorage.setItem(pkey(), JSON.stringify(o)); else localStorage.removeItem(pkey());
    }
    function setSave(text, bad) { const x = el.querySelector('[data-save]'); if (x) { x.textContent = text; x.classList.toggle('bad', !!bad); } }
    async function flush() {
      clearTimeout(timer); clearTimeout(retryT);
      if (!dirty.size || locked()) return true;
      if (saving) { timer = setTimeout(flush, 300); return false; }
      saving = true; setSave('Saving…');
      const keys = Array.from(dirty); const items = keys.map((k) => ({ criterion_id: k, score: draft[k].score, comment: draft[k].comment }));
      try {
        await api.saveScores(readerId, items);
        keys.forEach((k) => { const cur = draft[k], sent = items.find((i) => i.criterion_id === k); if (cur.score === sent.score && cur.comment === sent.comment) dirty.delete(k); });
        keepPending(); failed = false; setSave('All changes saved ✓');
        return true;
      } catch (e) {
        failed = true; keepPending();
        setSave('Not saved yet: ' + e.message + ' Retrying…', true);
        if (!/turned in|posted|locked|not opened/i.test(e.message)) retryT = setTimeout(flush, 5000);
        return false;
      } finally { saving = false; }
    }
    const later = (ms) => { clearTimeout(timer); timer = setTimeout(flush, ms); };
    window.addEventListener('beforeunload', (e) => { if (dirty.size && !locked()) { keepPending(); e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('online', () => flush());

    function total() { return s.criteria.reduce((t, c) => t + (draft[c.id] && draft[c.id].score ? draft[c.id].score : 0), 0); }
    function updateTotal() { const t = el.querySelector('[data-total]'); if (t) t.textContent = total(); }

    function render() {
      el.dataset.locked = String(locked());
      const r = reader();
      if (!r) { el.innerHTML = '<p class="placeholder">Pick a reader from the list to score.</p>'; return; }
      const ro = locked(); const sh = sheet();
      const reason = s.final.status === 'published' ? '<div class="posted"><p><strong>Results have been posted.</strong> Scores are locked.</p></div>'
        : sh && sh.status === 'turned_in' ? (s.me.role === 'head_judge' ? '<div class="posted"><p><strong>Turned in.</strong> This sheet is read-only. To change it, reopen it from the All judges\' scores tab.</p></div>' : '<div class="posted"><p><strong>Turned in and sent to the Head Judge.</strong> This sheet is read-only. Ask the Head Judge if you need to change anything.</p></div>')
          : r.judging_status === 'not_opened' ? '<div class="warn">🔒 The Head Judge has not opened judging for this reader yet.</div>'
            : `<p class="note">Drafts save automatically as you score. You can change them until you finalize.${r.judging_status === 'closed' ? ' Judging for this reader is closed, but you can still finish your sheet.' : ''}</p>`;
      el.innerHTML = `
        <div class="sheet-body">
        <p class="sheet-id"><strong>${esc(r.student_name)}</strong> · ${esc(r.item || '—')} · ${esc(r.school || '—')} · ${esc(r.round || '—')} · ${esc(r.district || '—')} · ${esc(fmtDate(r.reading_date) || '—')} · ${esc(s.me.full_name)} (${esc(seatLabel())})</p>
        <div class="meta">
          <div class="full">Reader<span>${esc(r.student_name)}</span></div>
          <div>Item (reading)<span>${esc(r.item || '—')}</span></div>
          <div>School<span>${esc(r.school || '—')}</span></div>
          <div>Round<span>${esc(r.round || '—')}</span></div>
          <div>District<span>${esc(r.district || '—')}</span></div>
          <div>Date<span>${esc(fmtDate(r.reading_date) || '—')}</span></div>
          <div>Judge<span>${esc(s.me.full_name)} (${esc(seatLabel())})</span></div>
        </div>
        ${reason}
        <p class="sheet-intro">Score each item <strong>1–5</strong>. <span class="sheet-keys">Keyboard: <strong>1–5</strong> to score, arrow keys to move, Tab to the next item.</span></p>
        <div class="sheet-head"><div>Category</div><div class="h-score">Score</div></div>
        ${s.criteria.map((c, i) => {
          const d = draft[c.id] || { score: null, comment: '' };
          return `<div class="crit" data-crit="${esc(c.id)}">
            <div class="crit-q" id="q-${esc(c.id)}"><span class="num" aria-hidden="true">${i + 1}</span><p>${esc(c.text)}</p></div>
            <div class="score-row" role="group" aria-labelledby="q-${esc(c.id)}">
              ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="score-btn" data-score="${n}" aria-pressed="${d.score === n}" aria-label="Score ${n} for item ${i + 1}" ${ro ? 'disabled' : ''}>${n}</button>`).join('')}
            </div>
            <label class="comment-lab">Comments <textarea rows="1" maxlength="1000" placeholder="${ro ? '' : 'Optional comments…'}" ${ro ? 'readonly' : ''}>${esc(d.comment)}</textarea></label>
          </div>`;
        }).join('')}
        <div class="warn" data-missing hidden role="alert"></div>
        </div>
        <div class="total-bar">
          <div>Total <strong data-total>${total()}</strong><span class="savestate" data-save aria-live="polite">${ro ? '' : dirty.size ? (failed ? 'Not saved yet. Retrying…' : 'Saving…') : 'All changes saved ✓'}</span></div>
          ${ro ? `<span class="chip f" style="font-size:.85rem;padding:.35rem .7rem">${sh && sh.status === 'turned_in' ? 'Turned in' : 'Read-only'}</span>` :
            '<div class="bar-acts"><button class="btn ghost" type="button" data-act="save">Save draft</button><button class="btn" type="button" data-act="final">Finalize my scores</button></div>'}
        </div>`;
      syncRoving();
      if (dirty.size && !ro) later(200);
    }
    function syncRoving() {
      el.querySelectorAll('.score-row').forEach((row) => {
        const btns = row.querySelectorAll('.score-btn');
        let pick = row.querySelector('.score-btn[aria-pressed="true"]');
        if (!pick) pick = btns[0];
        btns.forEach((b) => { b.tabIndex = (b === pick && !b.disabled) ? 0 : -1; });
      });
    }
    function applyScore(btn) {
      if (!btn || btn.disabled) return;
      const c = btn.closest('[data-crit]').dataset.crit; const n = +btn.dataset.score;
      draft[c] = Object.assign({}, draft[c], { score: n }); dirty.add(c); keepPending();
      const row = btn.closest('.score-row');
      row.querySelectorAll('.score-btn').forEach((x) => {
        const on = +x.dataset.score === n;
        x.setAttribute('aria-pressed', String(on));
        x.tabIndex = (on && !x.disabled) ? 0 : -1;
      });
      btn.closest('.crit').classList.remove('missing');
      updateTotal(); setSave('Saving…'); later(150);
      const m = el.querySelector('[data-missing]'); if (m && !m.hidden) checkMissing(true);
    }

    el.addEventListener('click', async (e) => {
      const b = e.target.closest('.score-btn');
      if (b && !b.disabled) { applyScore(b); return; }
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'save') { const ok = await flush(); if (ok) toast('Draft saved.'); return; }
      if (a.dataset.act === 'final') {
        if (checkMissing(false)) return;
        const r = reader();
        const yes = await MC.confirmBox('Finalize your scores?', `<p>Turn in your scores for <strong>${esc(r.student_name)}</strong> (total ${total()}). After you finalize, this sheet becomes read-only. ${s.me.role === 'head_judge' ? 'You can reopen it later from the All judges\' scores tab.' : 'Ask the Head Judge if you need to change anything.'}</p>`, 'Finalize my scores');
        if (!yes) return;
        a.disabled = true;
        if (!(await flush())) { a.disabled = false; toast('Your scores could not be saved yet, so they were not turned in. Check the connection and try again.', true); return; }
        try { await api.turnIn(readerId); toast('Turned in. Thank you!'); await MC.refresh(); }
        catch (err) { a.disabled = false; toast(err.message, true); }
      }
    });
    el.addEventListener('keydown', (e) => {
      const btn = e.target.closest('.score-btn');
      if (!btn || btn.disabled || !el.contains(btn)) return;
      const row = btn.closest('.score-row');
      const btns = Array.from(row.querySelectorAll('.score-btn'));
      const i = btns.indexOf(btn);
      let go = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go = btns[Math.min(btns.length - 1, i + 1)];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go = btns[Math.max(0, i - 1)];
      else if (e.key === 'Home') go = btns[0];
      else if (e.key === 'End') go = btns[btns.length - 1];
      else if (/^[1-5]$/.test(e.key)) go = btns.find((x) => x.dataset.score === e.key);
      else return;
      if (!go) return;
      e.preventDefault();
      applyScore(go);
      go.focus();
    });
    el.addEventListener('input', (e) => {
      const t = e.target.closest('textarea'); if (!t || t.readOnly) return;
      const c = t.closest('[data-crit]').dataset.crit;
      draft[c] = Object.assign({}, draft[c], { comment: t.value }); dirty.add(c); keepPending(); setSave('Saving…'); later(900);
    });
    function checkMissing(quiet) {
      const miss = s.criteria.map((c, i) => (!draft[c.id] || !draft[c.id].score) ? i + 1 : null).filter(Boolean);
      const m = el.querySelector('[data-missing]');
      el.querySelectorAll('.crit').forEach((x) => { const i = s.criteria.findIndex((c) => c.id === x.dataset.crit); x.classList.toggle('missing', miss.includes(i + 1)); });
      if (!miss.length) { m.hidden = true; return false; }
      m.textContent = 'Please score every criterion before you finalize. ' + (miss.length === 1 ? 'Item ' + miss[0] + ' has' : 'Items ' + miss.slice(0, -1).join(', ') + ' and ' + miss[miss.length - 1] + ' have') + ' no score yet.';
      m.hidden = false; if (!quiet) { const first = el.querySelector('.crit.missing'); if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      return true;
    }

    return {
      async show(state, rid) {
        if (rid !== readerId) { if (readerId) await flush(); readerId = rid; draft = {}; dirty = new Set(); failed = false; s = state; loadPending(); fromServer(); render(); return; }
        s = state;
        // keep focus/typing intact: only re-render if something besides my own unsaved edits changed
        const before = JSON.stringify(draft); const lockedBefore = el.dataset.locked;
        fromServer();
        const lk = String(locked());
        const focusText = document.activeElement && el.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA';
        if (JSON.stringify(draft) !== before || lockedBefore !== lk || el.querySelectorAll('.crit').length !== s.criteria.length) { if (!focusText || lockedBefore !== lk) render(); }
      },
      flush, get readerId() { return readerId; }
    };
  };
})();
// Send any scores that were saved on this device while offline (any reader), once at start-up.
window.MC.flushAllPending = async function (s) {
  const pre = 'mcrc_pending_' + s.me.id + '_';
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i); if (!k || !k.startsWith(pre)) continue;
    const rid = k.slice(pre.length);
    try {
      const p = JSON.parse(localStorage.getItem(k) || '{}');
      const items = Object.entries(p).map(([cid, v]) => ({ criterion_id: cid, score: v.score, comment: v.comment || '' }));
      if (items.length && s.readers.some((r) => r.id === rid)) await window.MC.api.saveScores(rid, items);
      localStorage.removeItem(k);
    } catch (e) { if (/turned in|posted|locked|no longer/i.test(e.message)) localStorage.removeItem(k); }
  }
};
