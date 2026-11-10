// Public landing page: start time banner, published results, photo gallery. Public data only (public_landing()).
(function () {
  'use strict';
  const { $, esc, fmtDate, fmtTime, fmtStamp, ordinal, api } = window.MC;
  const MED = ['🥇', '🥈', '🥉'];
  function render(d) {
    const year = (d.event_date || '2026').slice(0, 4);
    $('#when').textContent = '📅 ' + year + ' Competition: ' + fmtDate(d.event_date) + (d.start_time ? ' · Starts ' + fmtTime(d.start_time) : '');
    const photos = d.photos || [];
    $('#photos').hidden = $('#nav-photos').hidden = photos.length === 0;
    $('#gallery').innerHTML = photos.map((p) => `<figure><img src="${esc(p.url)}" alt="${esc(p.caption || 'Photo from the competition')}" loading="lazy">${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}</figure>`).join('');
    const box = $('#results-body');
    if (!d.published || !(d.results || []).length) {
      box.innerHTML = `<p class="placeholder">🌟 The results will appear here after the judges have finished and the Head Judge posts the final results on competition day. Good luck to every reader!</p>`;
      return;
    }
    const res = d.results.slice().sort((a, b) => a.place - b.place);
    const top = res.filter((r) => r.place <= 3);
    box.innerHTML = `${api.demo ? '<p class="example-banner">EXAMPLE DATA: names and scores are made up to show the layout</p>' : ''}
      <p class="posted-line">✅ Final results · Posted ${esc(fmtStamp(d.published_at).replace(/,\s*\d{1,2}:\d{2}.*$/, ''))}</p>
      <div class="podium">${top.map((r) => `<div class="pod p${r.place}"><div class="m" aria-hidden="true">${MED[r.place - 1]}</div><div class="pl">${ordinal(r.place)} Place</div>
        <div class="nm">${esc(r.name)}</div><div class="sc">${esc(r.school)}</div><div class="tt"><small>Total</small>${esc(r.total)}</div></div>`).join('')}</div>
      <h3>Full standings</h3>
      <div class="scroll"><table class="standings"><caption class="sr">Full standings</caption>
        <thead><tr><th scope="col">Place</th><th scope="col">Reader &amp; school</th><th scope="col">Total</th></tr></thead>
        <tbody>${res.map((r) => `<tr class="${r.place <= 3 ? 'top' : ''}"><td class="rk">${esc(r.place)}</td><td><strong>${esc(r.name)}</strong><br><span class="schl">${esc(r.school)}</span></td><td class="tot">${esc(r.total)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">Each reader's Total is the sum of all the judges' score sheets. Congratulations to every reader who took part!</p>`;
  }
  async function load() {
    try { render(await api.publicLanding()); }
    catch (e) { console.warn(e); $('#results-body').innerHTML = '<p class="placeholder">🌟 The results will appear here after the Head Judge posts the final results on competition day.</p>'; }
  }
  load();
  if (api.demo) api.subscribe(load);
  setInterval(() => { if (!document.hidden) load(); }, 60000);   // results day: refresh every minute
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
