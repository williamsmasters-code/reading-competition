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


  // 2025 Winner collage lightbox (the seven photos on this page only).
  const POST_2025 = 'https://www.facebook.com/MinOfCPMA/posts/pfbid0v5QjSDAxPgGwyFcjsRhxaJzw2PWhNaCEgebzWwwTeHa35bUoPVmBB7GgAgjPCAW7l';
  (function winnerLightbox() {
    const { $$ } = window.MC;
    const roots = document.querySelector('#winner-2025');
    if (!roots) return;
    const links = $$('[data-gallery-open]', roots);
    if (!links.length) return;
    const items = links.map((a) => {
      const img = a.querySelector('img');
      return { src: a.getAttribute('href'), alt: (img && img.getAttribute('alt')) || '' };
    });
    const lb = document.createElement('div');
    lb.className = 'lb';
    lb.hidden = true;
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-labelledby', 'lb-cap');
    lb.innerHTML = '<button type="button" class="btn ghost lb-close" data-lb="close">Close</button>' +
      '<img alt="">' +
      '<p class="lb-cap" id="lb-cap"></p>' +
      '<div class="lb-acts">' +
      '<button type="button" class="btn ghost" data-lb="prev">Previous</button>' +
      '<button type="button" class="btn ghost" data-lb="next">Next</button>' +
      '<a class="btn" href="' + POST_2025 + '" rel="noopener" target="_blank">View the full post on Facebook</a>' +
      '</div>';
    document.body.appendChild(lb);
    const img = lb.querySelector('img');
    const cap = lb.querySelector('#lb-cap');
    const closeBtn = lb.querySelector('[data-lb=close]');
    let i = 0, lastFocus = null;
    const inertables = () => [document.querySelector('header'), document.querySelector('main'), document.querySelector('footer'), document.querySelector('.demo-bar'), document.querySelector('.a2hs')].filter(Boolean);
    function focusables() {
      return $$('button, a[href]', lb).filter((el) => !el.disabled && el.getAttribute('aria-hidden') !== 'true');
    }
    function show(n) {
      i = (n + items.length) % items.length;
      img.src = items[i].src;
      img.alt = items[i].alt;
      cap.textContent = (i + 1) + ' of ' + items.length + (items[i].alt ? ' · ' + items[i].alt : '');
    }
    function open(n) {
      lastFocus = document.activeElement;
      show(n);
      lb.hidden = false;
      inertables().forEach((el) => el.setAttribute('inert', ''));
      closeBtn.focus();
    }
    function close() {
      if (lb.hidden) return;
      lb.hidden = true;
      inertables().forEach((el) => el.removeAttribute('inert'));
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    roots.addEventListener('click', (e) => {
      const a = e.target.closest('[data-gallery-open]');
      if (!a || !roots.contains(a)) return;
      e.preventDefault();
      const idx = parseInt(a.getAttribute('data-gallery-open'), 10);
      open(Number.isFinite(idx) ? idx : 0);
    });
    lb.addEventListener('click', (e) => {
      if (e.target === lb) { close(); return; }
      const act = e.target.closest('[data-lb]');
      if (!act) return;
      if (act.dataset.lb === 'close') close();
      if (act.dataset.lb === 'prev') show(i - 1);
      if (act.dataset.lb === 'next') show(i + 1);
    });
    document.addEventListener('keydown', (e) => {
      if (lb.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); show(i + 1); return; }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!lb.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    });
  })();
