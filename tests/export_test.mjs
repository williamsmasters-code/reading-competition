// Fills the site's template with FAKE data using the site's own export.js (same code the browser runs).
import JSZip from 'jszip';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { fillXlsx } = require('../site/js/export.js');
const CRIT = ['Were all words read accurately?', 'Were phrases read effectively as complete units?', 'Was punctuation interpreted correctly?', 'Were all words pronounced distinctly?', 'Were key words emphasized?', 'Was mood or feeling conveyed effectively?', 'Was volume used effectively?', 'Was pitch used effectively?', 'Was the selection read at an appropriate rate for audience and purpose?', 'Did the student appear relaxed, confident and able to recover quickly if a mistake was made?'];
const SCH = ["St Thomas Aquinas Catholic", "Hillsborough Gov't", "Harvey Vale Gov't", "Mt Pleasant Gov't", "Dover Gov't", "Our Lady of the Rosary Catholic"];
function data(n, crit = CRIT, mix) {
  return { judgeName: 'Fake Judge Person', criteria: crit, readers: Array.from({ length: n }, (_, i) => Object.assign({
    student_name: i === 1 ? "Fake O'Reader & <Co>" : 'Fake Reader ' + (i + 1), school: SCH[i % 6], item: 'Just Harriet', reading_date: '2026-11-20', round: 'Round 1', district: 'ONE',
    scores: crit.map((_, k) => ({ score: 1 + ((i + k) % 5), comment: k % 3 === 0 ? 'Fake comment ' + (i + 1) + '.' + (k + 1) : '' })) }, mix ? mix(i) : {})) };
}
async function run(n, file, crit, mix) {
  const zip = await JSZip.loadAsync(fs.readFileSync('../site/assets/score-sheet-template.xlsx'));
  await fillXlsx(zip, data(n, crit || CRIT, mix));
  fs.writeFileSync('out/' + file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log('wrote out/' + file);
}
await run(6, 'export_6_readers.xlsx');
await run(8, 'export_8_readers.xlsx');
await run(4, 'export_4_readers.xlsx');
await run(6, 'export_12_criteria.xlsx', CRIT.concat(['Fake extra criterion 11?', 'Fake extra criterion 12?']));
await run(6, 'export_8_criteria.xlsx', CRIT.slice(0, 8));
// Setup tab: reader 3 has its own item; readers 4-6 are in round 2 named 'Final', district TWO.
await run(6, 'export_setup_mix.xlsx', CRIT, (i) => (i === 2 ? { item: 'Fake Other Item' } : i >= 3 ? { item: 'Fake Final Item', round: 'Final', district: 'TWO' } : {}));
