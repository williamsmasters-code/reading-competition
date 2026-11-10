// Judge console: my readers (locked until opened), my score sheet, my turned-in sheets.
(function () {
  'use strict';
  const MC = window.MC;
  const { $, esc } = MC;
  let sheet = null, current = null, show = null, lastOpen;
  function rowFor(s, r, i) {
    const sh = MC.sheetOf(s, r.id, s.me.id); const t = MC.sheetTotal(s, r.id, s.me.id);
    const max = 5 * s.criteria.length;
    if (sh && sh.status === 'turned_in') return `<article class="rrow"><div class="rinfo"><span class="ord" aria-hidden="true">${i + 1}</span><div class="rwho"><strong>${esc(r.student_name)}</strong><span class="small">${esc(r.school)}</span></div></div><div class="acts"><span class="op t">Turned in · ${t.total} / ${max}</span><button type="button" class="btn ghost" data-pick="${esc(r.id)}">View scores</button></div></article>`;
    if (r.judging_status === 'not_opened') return `<article class="rrow lock"><div class="rinfo"><span class="ord" aria-hidden="true">${i + 1}</span><div class="rwho"><strong>${esc(r.student_name)}</strong> <span class="locktag">🔒 Locked</span><span class="small">${esc(r.school)}</span></div></div><div class="acts"><span class="op w">Not opened yet</span><button type="button" class="btn ghost" disabled>Can't score yet</button></div></article>`;
    const isOpen = r.judging_status === 'open';
    const label = sh || t.scored ? (isOpen ? 'Continue scoring' : 'Continue draft') : 'Score now';
    return `<article class="rrow${isOpen ? ' now' : ''}"><div class="rinfo"><span class="ord" aria-hidden="true">${i + 1}</span><div class="rwho"><strong>${esc(r.student_name)}</strong>${isOpen ? ' <span class="nowtag">Now reading</span>' : ''}<span class="small">${esc(r.school)}</span></div></div><div class="acts">${sh || t.scored ? `<span class="op d">My draft saved · ${t.scored}/${s.criteria.length}</span>` : isOpen ? '<span class="op o">Open now</span>' : '<span class="op c">Closed</span>'}<button type="button" class="btn${isOpen ? '' : ' ghost'}" data-pick="${esc(r.id)}">${label}</button></div></article>`;
  }
  function render(s, first) {
    const onPanel = s.panel.some((p) => p.judge_id === s.me.id);
    $('#readers-list').innerHTML = (!onPanel ? '<div class="warn">You are not on the judging panel right now, so you cannot score. The Site Admin manages the panel.</div>' : '') +
      (s.readers.length ? s.readers.map((r, i) => rowFor(s, r, i)).join('') : '<p class="placeholder">No readers yet.</p>');
    const done = s.readers.filter((r) => { const sh = MC.sheetOf(s, r.id, s.me.id); return sh && sh.status === 'turned_in'; });
    $('#turned-list').innerHTML = done.length ? done.map((r) => rowFor(s, r, s.readers.indexOf(r))).join('') : '<p class="placeholder">Nothing turned in yet.</p>';
    if (!sheet) sheet = MC.ScoreSheet($('#sheet'));
    // Follow the Head Judge: when a new reader is opened, the score sheet switches to them
    // (any unsaved draft on the previous reader is saved first by ScoreSheet.show).
    const open = s.readers.find((r) => r.judging_status === 'open'); const openId = open ? open.id : null;
    if (first) current = openId;
    else if (openId && openId !== lastOpen) { current = openId; MC.toast('Judging is now open for ' + open.student_name + '.'); }
    lastOpen = openId;
    if (current && !s.readers.some((r) => r.id === current)) current = null;
    sheet.show(s, current);
    if (first) { show = MC.tabs($(".tabs")); }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    current = b.dataset.pick; sheet.show(MC.state, current); show('score'); window.scrollTo(0, 0);
  });
  MC.startConsole({ roles: ['judge'], onState: render });
})();
