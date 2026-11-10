// Competition setup (Setup tab) shared by the Head Judge and Site Admin consoles:
// Items (readings), Rounds (how many, optional names, a default Item each), Districts,
// and the running order with each reader's Item / Round / District ("Edit details").
// None of these changes touch scores. The database rules are in supabase/08_setup.sql.
(function () {
  'use strict';
  const MC = window.MC;
  const { $, esc, api } = MC;
  const S = () => MC.state;
  const roundLabel = (s, n) => { const r = (s.rounds || []).find((x) => x.number === n); return (r && String(r.name || '').trim()) || 'Round ' + n; };
  const itemTitle = (s, id) => { const i = (s.items || []).find((x) => x.id === id); return i ? i.title : ''; };
  const effItem = (s, r) => r.item_id || ((s.rounds || []).find((x) => x.number === r.round_no) || {}).default_item_id || null;
  const turnedIn = (s, rid) => s.sheets.filter((x) => x.reader_id === rid && x.status === 'turned_in').length;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  MC.roundLabel = roundLabel;

  const run = (btn, fn, msg) => MC.withBusy(btn, async () => { await fn(); if (msg) MC.toast(msg); await MC.refresh(); });

  // ----- running order rows with reorder + Edit details (used in Setup and the HJ running order) -----
  MC.orderControls = function (s, r, i) {
    const n = s.readers.length;
    return `<span class="movebtns" role="group" aria-label="Move ${esc(r.student_name)}">
      <button type="button" class="mini mv" data-mvup="${esc(r.id)}" aria-label="Move ${esc(r.student_name)} up (now ${i + 1} of ${n})" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="mini mv" data-mvdown="${esc(r.id)}" aria-label="Move ${esc(r.student_name)} down (now ${i + 1} of ${n})" ${i === n - 1 ? 'disabled' : ''}>↓</button></span>
      <button type="button" class="mini" data-rdetails="${esc(r.id)}">Edit details</button>`;
  };
  MC.readerDetailsLine = (s, r) => `${esc(r.item || 'No item')}${r.item_id ? ' <span class="chip d">Own item</span>' : ''} · ${esc(r.round)} · ${esc(r.district || 'No district')}`;

  function itemsCard(s) {
    const rows = s.items.map((it) => {
      const used = s.readers.filter((r) => effItem(s, r) === it.id).length;
      const own = s.readers.filter((r) => r.item_id === it.id).length;
      const defs = s.rounds.filter((r) => r.default_item_id === it.id).map((r) => roundLabel(s, r.number));
      const why = defs.length ? 'It is the default for ' + defs.join(', ') + '.' : own ? 'It is set for ' + plural(own, 'reader') + '.' : '';
      return `<li><div class="li-main"><span class="nm">${esc(it.title)}</span>${defs.map((d) => ` <span class="def">Default: ${esc(d)}</span>`).join('')}<br><span class="use">${used ? 'Used by ' + plural(used, 'reader') : 'Not used yet'}</span></div>
        <div class="li-acts"><button type="button" class="mini" data-irename="${esc(it.id)}">Rename</button><button type="button" class="mini danger" data-iremove="${esc(it.id)}" ${why ? 'disabled aria-disabled="true" title="' + esc(why) + '"' : ''}>Remove</button></div></li>`;
    }).join('');
    return `<section class="card setup-card" aria-labelledby="h-items"><h2 id="h-items">📚 Items (readings)</h2>
      <p class="small">What the readers read. Each round has a default item (pick it under Rounds). To give one reader a different item, use <strong>Edit details</strong> on that reader. Renaming an item updates every reader who uses it.</p>
      <ul class="slist">${rows || '<li class="empty">No items yet. Add the first one below.</li>'}</ul>
      <form class="addrow2" data-sform="add_item"><label class="sr" for="new-item">New item</label><input id="new-item" name="v" maxlength="200" placeholder="New item, e.g. a poem title" required autocomplete="off"><button class="btn" type="submit">+ Add</button></form></section>`;
  }
  function roundsCard(s) {
    const maxUsed = Math.max(1, ...s.readers.map((r) => r.round_no || 1));
    const n = s.rounds.length;
    const opts = (sel) => `<option value="">No item</option>` + s.items.map((it) => `<option value="${esc(it.id)}"${it.id === sel ? ' selected' : ''}>${esc(it.title)}</option>`).join('');
    const rows = s.rounds.map((r) => {
      const cnt = s.readers.filter((x) => x.round_no === r.number).length;
      return `<li class="round-row"><div class="li-main"><span class="nm">Round ${r.number}</span><br><span class="use">${plural(cnt, 'reader')}</span></div>
        <div class="round-fields">
          <label>Name (optional)<input data-rname="${r.number}" maxlength="40" value="${esc(r.name || '')}" placeholder="Round ${r.number}" autocomplete="off"></label>
          <label>Default item<select data-rdefault="${r.number}">${opts(r.default_item_id)}</select></label>
        </div></li>`;
    }).join('');
    return `<section class="card setup-card" aria-labelledby="h-rounds"><h2 id="h-rounds">🔢 Rounds</h2>
      <p class="small">How many rounds the competition has. A name is optional; without one it shows as "Round 1", "Round 2"… on the score sheet and in the export (cell J3).</p>
      <div class="stepper" role="group" aria-label="Number of rounds"><button type="button" class="stepbtn" data-rcount="${n - 1}" aria-label="Fewer rounds" ${n <= maxUsed ? 'disabled' : ''}>−</button><span class="n" aria-live="polite">${n}</span><button type="button" class="stepbtn" data-rcount="${n + 1}" aria-label="More rounds" ${n >= 20 ? 'disabled' : ''}>+</button><span class="small">${n === 1 ? 'round' : 'rounds'}</span></div>
      ${n <= maxUsed && n > 1 ? `<p class="note">You can't go below ${esc(roundLabel(s, maxUsed))} while readers are in it.</p>` : ''}
      <ul class="slist">${rows}</ul></section>`;
  }
  function districtsCard(s) {
    const rows = s.districts.map((d) => {
      const used = s.readers.filter((r) => r.district_id === d.id).length;
      return `<li><div class="li-main"><span class="nm">${esc(d.name)}</span><br><span class="use">${used ? 'Used by ' + plural(used, 'reader') : 'Not used yet'}</span></div>
        <div class="li-acts"><button type="button" class="mini" data-drename="${esc(d.id)}">Rename</button><button type="button" class="mini danger" data-dremove="${esc(d.id)}" ${used ? 'disabled aria-disabled="true" title="' + esc(d.name) + ' has readers"' : ''}>Remove</button></div></li>`;
    }).join('');
    return `<section class="card setup-card" aria-labelledby="h-districts"><h2 id="h-districts">🗺️ Districts</h2>
      <p class="small">Add, rename or remove districts. A district can't be removed while readers are in it.</p>
      <ul class="slist">${rows || '<li class="empty">No districts yet.</li>'}</ul>
      <form class="addrow2" data-sform="add_district"><label class="sr" for="new-district">New district</label><input id="new-district" name="v" maxlength="40" placeholder="New district" required autocomplete="off"><button class="btn" type="submit">+ Add</button></form>
      <p class="small">${plural(s.districts.length, 'district')}</p></section>`;
  }
  function orderCard(s, isAdmin) {
    const rows = s.readers.map((r, i) => `<li class="orow"><span class="ord" aria-hidden="true">${i + 1}</span><div class="li-main"><strong>${esc(r.student_name)}</strong> ${MC.statusChip(r.judging_status)}<br><span class="use">${MC.readerDetailsLine(s, r)}</span></div><div class="li-acts">${MC.orderControls(s, r, i)}</div></li>`).join('');
    return `<section class="card" aria-labelledby="h-sorder"><h2 id="h-sorder">Running order &amp; reader details</h2>
      <p class="small">Use ↑ ↓ to change the order readers go up, and <strong>Edit details</strong> to change one reader's Round, District or Item. Scores always stay with the reader. ${isAdmin ? 'Add or remove readers on the Readers tab.' : 'Only the Site Admin adds or removes readers.'}</p>
      <ol class="slist olist">${rows || '<li class="empty">No readers yet.</li>'}</ol></section>`;
  }

  MC.renderSetup = function (s, root, isAdmin) {
    const keep = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null;
    const keepSel = keep && (keep.id || (keep.dataset.rname && 'rname' + keep.dataset.rname));
    const vals = {}; root.querySelectorAll('.addrow2 input').forEach((x) => { vals[x.id] = x.value; });
    const editing = keep && keep.dataset.rname ? { n: keep.dataset.rname, v: keep.value } : null;
    root.innerHTML = `<section class="card" aria-labelledby="h-setup"><h2 id="h-setup">Competition setup</h2>
      <p class="small">These lists fill in the score sheet header (Item, Round, District) and the Excel export. The Head Judge and the Site Admin can both change them at any time, even during the competition. Nothing here resets the competition or changes any scores. Ranking stays one overall ranking.</p></section>
      <div class="grid3">${itemsCard(s)}${roundsCard(s)}${districtsCard(s)}</div>${orderCard(s, isAdmin)}`;
    root.querySelectorAll('.addrow2 input').forEach((x) => { if (vals[x.id]) x.value = vals[x.id]; });
    if (editing) { const el = root.querySelector(`[data-rname="${editing.n}"]`); if (el) { el.value = editing.v; el.focus(); } }
    else if (keepSel) { const el = root.querySelector('#' + keepSel); if (el) el.focus(); }
  };

  // ----- Edit details dialog (Round, District, Item for one reader) -----
  MC.editReaderDetails = async function (s, rid, btn) {
    const r = s.readers.find((x) => x.id === rid); if (!r) return;
    const defs = s.rounds.map((x) => esc(roundLabel(s, x.number)) + ': ' + esc(itemTitle(s, x.default_item_id) || 'no item')).join('<br>');
    const v = await MC.dialog({
      title: 'Edit details: ' + r.student_name, ok: 'Save details',
      html: `<p class="small">Scores and score sheets stay with ${esc(r.student_name)}; nothing is reset. Round defaults:<br>${defs}</p>`,
      fields: [
        { name: 'round', label: 'Round', type: 'select', value: r.round_no, options: s.rounds.map((x) => ({ value: x.number, label: roundLabel(s, x.number) })) },
        { name: 'district', label: 'District', type: 'select', value: r.district_id || '', options: [{ value: '', label: 'No district' }].concat(s.districts.map((d) => ({ value: d.id, label: d.name }))) },
        { name: 'item', label: 'Item (reading)', type: 'select', value: r.item_id || '', options: [{ value: '', label: "Use the round's default item" }].concat(s.items.map((it) => ({ value: it.id, label: it.title }))) }
      ]
    });
    if (!v) return;
    const round = +v.round, district = v.district || null, item = v.item || null;
    const newEff = item || ((s.rounds.find((x) => x.number === round) || {}).default_item_id) || null;
    const n = turnedIn(s, rid);
    if (n && (round !== r.round_no || newEff !== effItem(s, r))) {
      const what = [round !== r.round_no ? 'Round (' + roundLabel(s, r.round_no) + ' → ' + roundLabel(s, round) + ')' : '', newEff !== effItem(s, r) ? 'Item (' + (itemTitle(s, effItem(s, r)) || 'none') + ' → ' + (itemTitle(s, newEff) || 'none') + ')' : ''].filter(Boolean).join(' and ');
      const yes = await MC.confirmBox('Change ' + r.student_name + "'s details?", `<p class="warn">${plural(n, 'judge')} already turned in a score sheet for ${esc(r.student_name)}. Changing the ${esc(what)} changes what those sheets and the export show.</p><p>The scores themselves are kept exactly as they are.</p>`, 'Change anyway', true);
      if (!yes) return;
    }
    await run(btn, () => api.setReaderDetails(rid, round, district, item), 'Details saved for ' + r.student_name + '.');
  };
  MC.moveReaderBy = async function (s, rid, dir, btn) {
    const i = s.readers.findIndex((x) => x.id === rid); const j = i + dir;
    if (i < 0 || j < 0 || j >= s.readers.length) return;
    const name = s.readers[i].student_name;
    await MC.withBusy(btn, async () => { await api.moveReader(rid, j + 1); await MC.refresh(); });
    const vis = (sel) => Array.from(document.querySelectorAll(sel)).find((x) => x.offsetParent !== null && !x.disabled);
    const again = vis(`[data-${dir < 0 ? 'mvup' : 'mvdown'}="${rid}"]`) || vis(`[data-${dir < 0 ? 'mvdown' : 'mvup'}="${rid}"]`);
    if (again) again.focus();
    MC.toast(name + ' is now number ' + (j + 1) + '.');
  };

  // ----- events -----
  document.addEventListener('click', async (e) => {
    const s = S(); if (!s || !s.items) return;
    const t = e.target.closest('button'); if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.mvup) return MC.moveReaderBy(s, d.mvup, -1, t);
    if (d.mvdown) return MC.moveReaderBy(s, d.mvdown, 1, t);
    if (d.rdetails) return MC.editReaderDetails(s, d.rdetails, t);
    if (d.rcount) {
      const n = +d.rcount;
      if (n < s.rounds.length && !(await MC.confirmBox('Remove ' + roundLabel(s, s.rounds.length) + '?', '<p>It has no readers, so nothing else changes.</p>', 'Remove round'))) return;
      return run(t, () => api.setupChange('set_round_count', { count: n }), 'The competition now has ' + plural(n, 'round') + '.');
    }
    if (d.irename || d.drename) {
      const isItem = !!d.irename; const id = d.irename || d.drename;
      const cur = isItem ? s.items.find((x) => x.id === id).title : s.districts.find((x) => x.id === id).name;
      const v = await MC.dialog({ title: 'Rename ' + (isItem ? 'item' : 'district'), ok: 'Save', html: '<p class="small">Every reader using it shows the new name. Scores are not affected.</p>', fields: [{ name: 'v', label: isItem ? 'Item title' : 'District name', value: cur, required: true, maxlength: isItem ? 200 : 40, autocomplete: 'off' }] });
      if (!v || v.v === cur) return;
      return run(t, () => api.setupChange(isItem ? 'rename_item' : 'rename_district', isItem ? { id, title: v.v } : { id, name: v.v }), 'Renamed to "' + v.v + '".');
    }
    if (d.iremove || d.dremove) {
      const isItem = !!d.iremove; const id = d.iremove || d.dremove;
      const nm = isItem ? s.items.find((x) => x.id === id).title : s.districts.find((x) => x.id === id).name;
      if (!(await MC.confirmBox('Remove "' + nm + '"?', '<p>No reader uses it, so nothing else changes.</p>', 'Remove', true))) return;
      return run(t, () => api.setupChange(isItem ? 'remove_item' : 'remove_district', { id }), '"' + nm + '" removed.');
    }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-sform]'); if (!f) return;
    e.preventDefault();
    const v = f.v.value.trim(); if (!v) { MC.toast('Type a name first.', true); f.v.focus(); return; }
    const action = f.dataset.sform;
    await MC.withBusy(f.querySelector('button'), async () => {
      await api.setupChange(action, action === 'add_item' ? { title: v } : { name: v });
      f.v.value = ''; MC.toast('"' + v + '" added.'); await MC.refresh();
      const again = document.querySelector(`form[data-sform="${action}"] input`); if (again) again.focus();
    });
  });
  document.addEventListener('change', async (e) => {
    const s = S(); if (!s || !s.rounds) return;
    const el = e.target;
    if (el.dataset.rname) {
      const n = +el.dataset.rname; const v = el.value.trim();
      const cur = (s.rounds.find((x) => x.number === n) || {}).name || '';
      if (v === cur) return;
      await MC.withBusy(el, async () => { await api.setupChange('set_round', { number: n, name: v }); MC.toast(v ? 'Round ' + n + ' is now called "' + v + '".' : 'Round ' + n + ' shows as "Round ' + n + '".'); await MC.refresh(); });
    } else if (el.dataset.rdefault) {
      const n = +el.dataset.rdefault; const id = el.value || null;
      const affected = s.readers.filter((r) => r.round_no === n && !r.item_id);
      const sheets = affected.reduce((a, r) => a + turnedIn(s, r.id), 0);
      if (sheets && !(await MC.confirmBox('Change the default item for ' + roundLabel(s, n) + '?', `<p class="warn">${plural(affected.length, 'reader')} in ${esc(roundLabel(s, n))} use the default item, and ${plural(sheets, 'score sheet')} for them are already turned in. Their sheets and the export will show "${esc(itemTitle(s, id) || 'no item')}".</p><p>The scores themselves are kept exactly as they are. Readers with their own item are not changed.</p>`, 'Change anyway', true))) {
        el.value = (s.rounds.find((x) => x.number === n) || {}).default_item_id || ''; return;
      }
      await MC.withBusy(el, async () => { await api.setupChange('set_round', { number: n, default_item_id: id }); MC.toast(roundLabel(s, n) + ' default item: ' + (itemTitle(s, id) || 'none') + '.'); await MC.refresh(); });
    }
  });
})();
