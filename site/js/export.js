// Excel export: one workbook per panel judge, laid out EXACTLY like "Judge1 Readers.xlsx".
// It opens the blanked copy of that workbook (assets/score-sheet-template.xlsx) and writes the
// values straight into the sheet XML, so every style, merged cell, column width, dropdown,
// formula and print setting stays byte-for-byte as in the original. One sheet per reader:
// scores go in column H and comments in column I (top-left of the merged I:L cells) of the
// criterion rows, which are found as the rows whose column A holds 1, 2, 3 ...
// Header cells: C3 item, C4 student, C5 date, C6 school, J3 round, J5 district, J7 judge.
// fillXlsx() is shared with the Node fidelity test (tests/export_test.mjs).
(function (root) {
  'use strict';
  const JSZIP = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  const TEMPLATE = 'assets/score-sheet-template.xlsx';
  const WS_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
  const WS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';

  const xesc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const xunesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const colNum = (ref) => { const L = /^[A-Z]+/.exec(ref)[0]; let n = 0; for (const ch of L) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const serial = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 864e5 : null; };
  const CELL_RE = (ref) => new RegExp('<c r="' + ref + '"(?=[\\s>/])([^>]*?)(?:/>|>([\\s\\S]*?)</c>)');

  function sstOf(xml) {
    if (!xml) return [];
    return (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map((si) => xunesc((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<t[^>]*>|<\/t>/g, '')).join('')));
  }
  function getCell(xml, ref) { const m = CELL_RE(ref).exec(xml); if (!m) return null; return { attrs: m[1], inner: m[2] || '' }; }
  function cellValue(xml, ref, sst) {
    const c = getCell(xml, ref); if (!c) return null;
    const v = /<v>([\s\S]*?)<\/v>/.exec(c.inner); const t = /\bt="(\w+)"/.exec(c.attrs);
    if (t && t[1] === 's' && v) return sst[+v[1]];
    if (t && t[1] === 'inlineStr') return xunesc((/<t[^>]*>([\s\S]*?)<\/t>/.exec(c.inner) || [])[1] || '');
    if (v) return t && t[1] === 'str' ? xunesc(v[1]) : +v[1];
    return null;
  }
  // val: null (blank, style kept) | number | string | {f: formula, v: cached result}
  function setCell(xml, ref, val) {
    const re = CELL_RE(ref); const m = re.exec(xml);
    const sAttr = m ? ((/\ss="\d+"/.exec(m[1]) || [''])[0]) : '';
    let cell;
    if (val == null || val === '') cell = '<c r="' + ref + '"' + sAttr + '/>';
    else if (typeof val === 'number') cell = '<c r="' + ref + '"' + sAttr + '><v>' + val + '</v></c>';
    else if (typeof val === 'object') cell = '<c r="' + ref + '"' + sAttr + (typeof val.v === 'number' ? '' : ' t="str"') + '><f>' + xesc(val.f) + '</f>' + (val.v == null ? '' : '<v>' + xesc(val.v) + '</v>') + '</c>';
    else cell = '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + xesc(val) + '</t></is></c>';
    if (m) return xml.slice(0, m.index) + cell + xml.slice(m.index + m[0].length);
    // cell not in the file yet: insert it into its row, in column order
    const r = /\d+$/.exec(ref)[0];
    const rowRe = new RegExp('<row r="' + r + '"([^>]*?)(?:/>|>([\\s\\S]*?)</row>)'); const rm = rowRe.exec(xml);
    if (!rm) throw new Error('Template row ' + r + ' is missing.');
    const inner = rm[2] || ''; const want = colNum(ref);
    const cells = inner.match(/<c r="[A-Z]+\d+"[\s\S]*?(?:\/>|<\/c>)/g) || [];
    let pos = inner.length, acc = 0;
    for (const c of cells) { const at = inner.indexOf(c, acc); const cr = /<c r="([A-Z]+)\d+"/.exec(c)[1]; if (colNum(cr) > want) { pos = at; break; } acc = at + c.length; }
    const newRow = '<row r="' + r + '"' + rm[1] + '>' + inner.slice(0, pos) + cell + inner.slice(pos) + '</row>';
    return xml.slice(0, rm.index) + newRow + xml.slice(rm.index + rm[0].length);
  }
  function layout(xml, sst) { // criterion rows (A = 1..N in order) and the Total Score row
    const rows = []; let total = null;
    (xml.match(/<row r="\d+"/g) || []).map((x) => +/\d+/.exec(x)[0]).forEach((r) => {
      const a = cellValue(xml, 'A' + r, sst);
      if (typeof a === 'number' && a === rows.length + 1) rows.push(r);
      const b = cellValue(xml, 'B' + r, sst);
      if (typeof b === 'string' && /^\s*total score\s*$/i.test(b)) total = r;
    });
    return { rows, total };
  }
  function schoolValue(xml, s) { // use the dropdown's own spelling (e.g. "Hillsborough Gov't " with a trailing space)
    const m = /sqref="C6"[^>]*>\s*<formula1>([\s\S]*?)<\/formula1>/.exec(xml);
    if (m) { const list = xunesc(m[1]).replace(/^"|"$/g, '').split(','); const hit = list.find((x) => x.trim().toLowerCase() === String(s || '').trim().toLowerCase()); if (hit) return hit; }
    return s || '';
  }
  function addRowsAfter(xml, afterRow, styleRow, count) { // copies of a criterion row, placed under the Total row
    const rowRe = new RegExp('<row r="' + styleRow + '"[^>]*?(?:/>|>[\\s\\S]*?</row>)'); const src = rowRe.exec(xml)[0];
    const afterRe = new RegExp('<row r="' + afterRow + '"[^>]*?(?:/>|>[\\s\\S]*?</row>)'); const am = afterRe.exec(xml);
    let add = '', merges = '';
    for (let k = 1; k <= count; k++) {
      const n = afterRow + k;
      add += src.replace(/<row r="\d+"/, '<row r="' + n + '"').replace(/<c r="([A-Z]+)\d+"/g, '<c r="$1' + n + '"').replace(/<v>[\s\S]*?<\/v>/g, '').replace(/\st="\w+"/g, '').replace(/<is>[\s\S]*?<\/is>/g, '').replace(/<f>[\s\S]*?<\/f>/g, '');
      merges += '<mergeCell ref="C' + n + ':G' + n + '"/><mergeCell ref="I' + n + ':L' + n + '"/>';
    }
    xml = xml.slice(0, am.index + am[0].length) + add + xml.slice(am.index + am[0].length);
    xml = xml.replace(/<mergeCells count="(\d+)">/, (_, c) => '<mergeCells count="' + (+c + 2 * count) + '">').replace('</mergeCells>', merges + '</mergeCells>');
    xml = xml.replace(/<dimension ref="A1:([A-Z]+)(\d+)"/, (_, c, r) => '<dimension ref="A1:' + c + Math.max(+r, afterRow + count) + '"');
    return xml;
  }
  function fillSheet(xml, r, i, data, sst, round1) {
    xml = setCell(xml, 'C3', r.item || null);
    xml = setCell(xml, 'C4', r.student_name || null);
    xml = setCell(xml, 'C5', serial(r.reading_date));
    xml = setCell(xml, 'C6', schoolValue(xml, r.school) || null);
    xml = setCell(xml, 'J5', r.district || null);
    const f3 = /<f>([\s\S]*?)<\/f>/.exec((getCell(xml, 'J3') || {}).inner || ''); const f7 = /<f>([\s\S]*?)<\/f>/.exec((getCell(xml, 'J7') || {}).inner || '');
    if (i === 0 || !f3 || (r.round || '') !== round1) xml = setCell(xml, 'J3', r.round || null); else xml = setCell(xml, 'J3', { f: xunesc(f3[1]), v: round1 });
    if (i === 0 || !f7) xml = setCell(xml, 'J7', data.judgeName || null); else xml = setCell(xml, 'J7', { f: xunesc(f7[1]), v: data.judgeName || '' });
    const L = layout(xml, sst); const crit = data.criteria; let sum = 0;
    if (crit.length > L.rows.length && L.total) xml = addRowsAfter(xml, L.total, L.rows[L.rows.length - 1], crit.length - L.rows.length);
    const rowsFor = L.rows.slice(); for (let k = L.rows.length; k < crit.length; k++) rowsFor.push(L.total + 1 + k - L.rows.length);
    rowsFor.forEach((row, k) => {
      if (k < crit.length) {
        const sc = r.scores[k] || {};
        if (k >= L.rows.length) xml = setCell(xml, 'A' + row, k + 1);
        if (cellValue(xml, 'B' + row, sst) !== crit[k]) xml = setCell(xml, 'B' + row, crit[k]);
        xml = setCell(xml, 'H' + row, sc.score == null ? null : +sc.score);
        xml = setCell(xml, 'I' + row, sc.comment ? String(sc.comment) : null);
        sum += +sc.score || 0;
      } else { xml = setCell(xml, 'A' + row, null); xml = setCell(xml, 'B' + row, null); xml = setCell(xml, 'H' + row, null); xml = setCell(xml, 'I' + row, null); }
    });
    if (L.total && L.rows.length) {
      let f = 'SUM(H' + L.rows[0] + ':H' + L.rows[L.rows.length - 1] + ')';
      if (crit.length > L.rows.length) f += '+SUM(H' + (L.total + 1) + ':H' + (L.total + crit.length - L.rows.length) + ')';
      xml = setCell(xml, 'H' + L.total, { f, v: sum });
    }
    return xml;
  }
  // data: {judgeName, criteria:[text], readers:[{student_name, school, item, reading_date, round, district, scores:[{score, comment}] in criteria order}]}
  async function fillXlsx(zip, data) {
    const readers = data.readers.length ? data.readers : [{ student_name: '', scores: [] }];
    const sst = sstOf(zip.file('xl/sharedStrings.xml') ? await zip.file('xl/sharedStrings.xml').async('string') : '');
    let wbx = await zip.file('xl/workbook.xml').async('string');
    let rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    let ct = await zip.file('[Content_Types].xml').async('string');
    const relTarget = (id) => new RegExp('<Relationship Id="' + id + '"[^>]*Target="([^"]+)"').exec(rels) || new RegExp('<Relationship [^>]*Target="([^"]+)"[^>]*Id="' + id + '"').exec(rels);
    let sheets = (wbx.match(/<sheet [^>]*\/>/g) || []).map((tag) => ({ tag, name: xunesc(/name="([^"]*)"/.exec(tag)[1]), rid: /r:id="([^"]+)"/.exec(tag)[1] }));
    sheets.forEach((s) => { s.path = 'xl/' + relTarget(s.rid)[1].replace(/^\/?xl\//, ''); });
    // fewer readers than template sheets: drop the extra sheets (never sheet 1, which the formulas point at)
    while (sheets.length > readers.length && sheets.length > 1) {
      const s = sheets.pop();
      wbx = wbx.replace(s.tag, '');
      rels = rels.replace(new RegExp('<Relationship [^>]*Id="' + s.rid + '"[^>]*/>'), '');
      ct = ct.replace(new RegExp('<Override [^>]*PartName="/' + s.path + '"[^>]*/>'), '');
      const relPath = s.path.replace(/worksheets\//, 'worksheets/_rels/') + '.rels';
      if (zip.file(relPath)) {
        const r = await zip.file(relPath).async('string');
        (r.match(/Target="\.\.\/drawings\/[^"]+"/g) || []).forEach((t) => { const d = 'xl/drawings/' + /drawings\/([^"]+)/.exec(t)[1]; zip.remove(d); ct = ct.replace(new RegExp('<Override [^>]*PartName="/' + d + '"[^>]*/>'), ''); });
        zip.remove(relPath);
      }
      zip.remove(s.path);
    }
    // more readers than template sheets: copy the last sheet (same layout), without its empty drawing
    if (readers.length > sheets.length) {
      const src = await zip.file(sheets[sheets.length - 1].path).async('string');
      let maxId = Math.max(...(wbx.match(/sheetId="(\d+)"/g) || ['sheetId="0"']).map((x) => +/\d+/.exec(x)[0]));
      let fileN = Math.max(...Object.keys(zip.files).map((f) => +((/^xl\/worksheets\/sheet(\d+)\.xml$/.exec(f) || [0, 0])[1])));
      while (sheets.length < readers.length) {
        maxId++; fileN++;
        const name = 'R1 Student ' + (sheets.length + 1); const rid = 'rIdMC' + maxId; const path = 'xl/worksheets/sheet' + fileN + '.xml';
        zip.file(path, src.replace(/<drawing r:id="[^"]+"\/>/, '').replace(/<legacyDrawing r:id="[^"]+"\/>/, '').replace(/\stabSelected="1"/, ''));
        const tag = '<sheet state="visible" name="' + xesc(name) + '" sheetId="' + maxId + '" r:id="' + rid + '"/>';
        wbx = wbx.replace('</sheets>', tag + '</sheets>');
        rels = rels.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="' + WS_REL + '" Target="worksheets/sheet' + fileN + '.xml"/></Relationships>');
        ct = ct.replace('</Types>', '<Override ContentType="' + WS_CT + '" PartName="/' + path + '"/></Types>');
        sheets.push({ tag, name, rid, path });
      }
    }
    zip.file('xl/workbook.xml', wbx); zip.file('xl/_rels/workbook.xml.rels', rels); zip.file('[Content_Types].xml', ct);
    const round1 = readers[0].round || '';
    for (let i = 0; i < readers.length; i++) {
      const xml = await zip.file(sheets[i].path).async('string');
      zip.file(sheets[i].path, fillSheet(xml, readers[i], i, data, sst, round1));
    }
    return zip;
  }

  // ---------------- browser side ----------------
  const loadScript = (src, name) => root[name] ? Promise.resolve(root[name]) : new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = () => res(root[name]); s.onerror = () => rej(new Error('Could not load the Excel tool. Check the internet connection.')); document.head.appendChild(s); });
  function dataFor(s, judgeId) {
    const p = (s.profiles || []).find((x) => x.id === judgeId) || {};
    return {
      judgeName: p.full_name || '',
      criteria: s.criteria.map((c) => c.text),
      readers: s.readers.map((r) => Object.assign({}, r, {
        scores: s.criteria.map((c) => { const x = s.scores.find((y) => y.reader_id === r.id && y.judge_id === judgeId && y.criterion_id === c.id) || {}; return { score: x.score == null ? null : x.score, comment: x.comment || '' }; })
      }))
    };
  }
  const safe = (t) => String(t || '').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, ' ') || 'Judge';
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  async function judgeWorkbook(s, judgeId, label) {
    const JSZip = await loadScript(JSZIP, 'JSZip');
    const res = await fetch(TEMPLATE, { cache: 'no-cache' }); if (!res.ok) throw new Error('The score sheet template is missing (assets/score-sheet-template.xlsx).');
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    await fillXlsx(zip, dataFor(s, judgeId));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const p = (s.profiles || []).find((x) => x.id === judgeId) || {};
    download(blob, safe(label) + ' - ' + safe(p.full_name) + ' Readers.xlsx');
  }
  async function summaryWorkbook(s) { // a simple extra: the ranking with each judge's total
    const ExcelJS = await loadScript(EXCELJS, 'ExcelJS');
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Results');
    const P = root.MC.panelRows(s);
    ws.addRow(['Michelle Coy Reading Competition: final results']).font = { bold: true, size: 14 };
    ws.addRow(['Posted ' + root.MC.fmtStamp(s.final.published_at)]);
    ws.addRow([]);
    ws.addRow(['Place', 'Reader', 'School'].concat(P.map((p) => p.label + ' (' + p.name + ')'), ['Total'])).font = { bold: true };
    root.MC.ranking(s.readers, s.panel, s.scores, s.criteria).forEach((x) => ws.addRow([x.place, x.reader.student_name, x.reader.school].concat(P.map((p) => root.MC.sheetTotal(s, x.reader.id, p.judge_id).total), [x.total])));
    ws.columns.forEach((c, i) => { c.width = i === 1 || i === 2 ? 30 : 16; });
    download(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Michelle Coy Reading Competition - Results summary.xlsx');
  }
  const MC = root.MC;
  if (MC) {
    MC.exportBlock = (enabled) => `<div class="export"><h3 style="margin-top:0">Export results</h3>
      <p class="small">${enabled ? 'Download' : 'Available once the Head Judge posts the results. You get'} each judge's workbook laid out exactly like Judge1 Readers.xlsx, with one sheet per reader and every score, comment and total filled in.</p>
      <div class="btnrow" data-export>${enabled ? '' : '<button class="btn" disabled>⬇ Download score sheets (Excel)</button>'}</div>
      ${enabled ? '' : '<p class="small" style="margin-top:.3rem">Unlocks after results are posted</p>'}</div>`;
    MC.wireExport = (container, s) => {
      const box = container.querySelector('[data-export]'); if (!box) return;
      const P = MC.panelRows(s);
      box.innerHTML = P.map((p) => `<button type="button" class="btn ghost" data-xj="${MC.esc(p.judge_id)}">⬇ ${MC.esc(p.label)} (${MC.esc(p.name)})</button>`).join('') +
        '<button type="button" class="btn" data-xall>⬇ Download all score sheets</button><button type="button" class="btn ghost" data-xsum>⬇ Results summary</button>';
      box.onclick = async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        const st = MC.state; const PP = MC.panelRows(st);
        await MC.withBusy(b, async () => {
          if (b.dataset.xj) { const p = PP.find((x) => x.judge_id === b.dataset.xj); await judgeWorkbook(st, p.judge_id, p.label); }
          else if ('xall' in b.dataset) { for (const p of PP) { await judgeWorkbook(st, p.judge_id, p.label); await new Promise((r) => setTimeout(r, 700)); } }
          else if ('xsum' in b.dataset) await summaryWorkbook(st);
          MC.toast('Download started.');
        });
      };
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { fillXlsx, layout, sstOf };
})(typeof window !== 'undefined' ? window : globalThis);
