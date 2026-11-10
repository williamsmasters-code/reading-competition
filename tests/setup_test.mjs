// Tests supabase/08_setup.sql: mapping of readers that already exist (the live project's case),
// list management + permissions, per-reader overrides, round defaults, reorder, and that
// none of it touches scores.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const S = '../supabase/';
const db = new PGlite(); let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
const q = async (sql, p) => (await db.query(sql, p)).rows;
const err = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
}
await db.exec(fs.readFileSync('supabase_shim.sql', 'utf8'));
// Live order: 01-05, 07, seed (already applied), THEN 08.
for (const f of ['01_schema', '02_rls', '03_rpcs', '04_realtime', '05_storage', '07_email_sync', 'seed_readers']) await db.exec(fs.readFileSync(S + f + '.sql', 'utf8'));
const before = await q('select id, student_name, item, round, district, position from readers order by position');
await db.exec(fs.readFileSync(S + '08_setup.sql', 'utf8'));
await db.exec(fs.readFileSync(S + '08_setup.sql', 'utf8'));   // idempotent
const after = await q('select id, student_name, item, round, district, position, round_no, district_id, item_id from readers order by position');
ok(JSON.stringify(before) === JSON.stringify(after.map(({ round_no, district_id, item_id, ...x }) => x)), 'existing readers show exactly the same Item / Round / District / order after 08');
ok((await q('select count(*)::int n from items'))[0].n === 1 && (await q("select title from items"))[0].title === 'Just Harriet', 'one item created: Just Harriet');
ok((await q('select count(*)::int n from rounds'))[0].n === 1 && (await q('select i.title from rounds r join items i on i.id = r.default_item_id where number = 1'))[0]?.title === 'Just Harriet', 'Round 1 default item = Just Harriet');
ok((await q("select count(*)::int n from districts"))[0].n === 1 && (await q("select name from districts"))[0].name === 'ONE', 'one district: ONE');
ok(after.every((r) => r.round_no === 1 && r.district_id && r.item_id === null), 'every reader: round 1, district ONE, no item override');
ok((await q("select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename in ('items','rounds','districts')"))[0].n === 3, 'items/rounds/districts in realtime publication');
const rls = await q(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
ok(rls.length === 0, 'RLS on every public table');

const mk = async (email, role) => (await q(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, '{}', $2) returning id`, [email, role ? { role } : {}]))[0].id;
const A = await mk('a@x.test', 'site_admin'), H = await mk('h@x.test', 'head_judge'), J = await mk('j@x.test', 'judge'), N = await mk('n@x.test', null);
await q('insert into panel (judge_id, seat) values ($1, 1)', [J]);
const R = after.map((r) => r.id);
// permissions
await as(J, async () => {
  ok((await q('select * from items')).length === 1, 'judge can read the lists');
  ok(!!(await err(() => q("select setup_change('add_item', '{\"title\":\"X\"}')"))), 'judge cannot change setup');
  ok(!!(await err(() => q('select set_reader_details($1, 1, null, null)', [R[0]]))), 'judge cannot change reader details');
  ok(!!(await err(() => q('select move_reader($1, 3)', [R[0]]))), 'judge cannot reorder readers');
  ok(!!(await err(() => q("insert into items (title) values ('Sneaky')"))), 'judge cannot write items directly');
});
await as(N, async () => { ok((await q('select * from rounds')).length === 0, 'no-role account sees no lists'); });
await as(A, async () => {
  ok(!!(await err(() => q("insert into items (title) values ('Direct')"))), 'even the admin writes lists only through setup_change');
  ok(!!(await err(() => q("update readers set item = 'Typed' where id = $1", [R[0]]))), 'nobody writes reader labels directly');
  ok(!!(await err(() => q("update readers set position = 9 where id = $1", [R[0]]))), 'position changes only through move_reader');
  await q("update readers set school = 'Dover Gov''t' where id = $1", [R[4]]);
  ok((await q('select school, district from readers where id=$1', [R[4]]))[0].district === 'ONE', 'admin still edits name/school directly; labels kept');
});
// scores to prove nothing is touched
const crit = (await q('select id from criteria order by position'))[0].id;
await q("update readers set judging_status = 'open' where id = $1", [R[0]]);
await as(J, async () => { await q(`select save_scores($1, $2)`, [R[0], JSON.stringify(Array.from({ length: 1 }, () => ({ criterion_id: crit, score: 4, comment: 'kept' })))]); });
await q("insert into sheets (reader_id, judge_id, status) values ($1, $2, 'turned_in') on conflict (reader_id, judge_id) do update set status='turned_in'", [R[0], J]);
ok((await q('select count(*)::int n from scores'))[0].n > 0, 'a score exists before setup changes');
const scoresBefore = JSON.stringify(await q('select reader_id, judge_id, criterion_id, score, comment from scores order by 1,2,3'));
// Head Judge manages setup
let IT2, D2;
await as(H, async () => {
  IT2 = (await q("select setup_change('add_item', '{\"title\":\"The Coconut Thief\"}') v"))[0].v.id;
  ok(!!IT2, 'Head Judge adds an item');
  ok(/already/.test(await err(() => q("select setup_change('add_item', '{\"title\":\"just harriet\"}')"))), 'duplicate item (any case) refused');
  await q("select setup_change('set_round_count', '{\"count\":3}')");
  ok((await q('select count(*)::int n from rounds'))[0].n === 3, 'Head Judge sets 3 rounds');
  ok((await q('select count(*)::int n from rounds where default_item_id is not null'))[0].n === 3, 'new rounds start with the last default item');
  await q("select setup_change('set_round', $1)", [JSON.stringify({ number: 2, name: 'Semi-final', default_item_id: IT2 })]);
  D2 = (await q("select setup_change('add_district', '{\"name\":\"TWO\"}') v"))[0].v.id;
  // reader 2 -> round 2, district TWO, round default item
  await q('select set_reader_details($1, 2, $2, null)', [R[1], D2]);
  let r = (await q('select item, round, district from readers where id=$1', [R[1]]))[0];
  ok(r.item === 'The Coconut Thief' && r.round === 'Semi-final' && r.district === 'TWO', 'reader moved to round 2: shows round name + round default item + new district ' + JSON.stringify(r));
  // override one reader's item in round 1
  await q('select set_reader_details($1, 1, (select district_id from readers where id=$1), $2)', [R[0], IT2]);
  ok((await q('select item from readers where id=$1', [R[0]]))[0].item === 'The Coconut Thief', 'single-reader item override (turned-in sheet allowed)');
  ok((await q('select item from readers where id=$1', [R[2]]))[0].item === 'Just Harriet', 'other round-1 readers keep the round default');
  // change round 1 default: only non-overridden readers follow
  const IT1 = (await q("select id from items where title='Just Harriet'"))[0].id;
  await q("select setup_change('set_round', $1)", [JSON.stringify({ number: 1, default_item_id: IT2 })]);
  await q("select setup_change('set_round', $1)", [JSON.stringify({ number: 1, default_item_id: IT1 })]);
  ok((await q('select item from readers where id=$1', [R[2]]))[0].item === 'Just Harriet' && (await q('select item from readers where id=$1', [R[0]]))[0].item === 'The Coconut Thief', 'round default change follows non-overridden readers only');
  // rename item -> labels update
  await q("select setup_change('rename_item', $1)", [JSON.stringify({ id: IT1, title: 'Just Harriet (2026)' })]);
  ok((await q('select count(*)::int n from readers where item = $1', ['Just Harriet (2026)']))[0].n === 4, 'renaming an item updates every reader who uses it');
  await q("select setup_change('set_round', $1)", [JSON.stringify({ number: 1, name: 'Preliminary' })]);
  ok((await q("select count(*)::int n from readers where round = 'Preliminary'"))[0].n === 5, 'round name shows for its readers');
  await q("select setup_change('set_round', $1)", [JSON.stringify({ number: 1, name: '' })]);
  ok((await q("select count(*)::int n from readers where round = 'Round 1'"))[0].n === 5, 'blank round name falls back to "Round 1"');
  // blocks
  ok(/still has readers/.test(await err(() => q("select setup_change('set_round_count', '{\"count\":1}')"))), 'cannot drop a round that still has readers');
  ok(/default item/.test(await err(() => q("select setup_change('remove_item', $1)", [JSON.stringify({ id: IT1 })]))), 'cannot remove an item that is a round default');
  ok(/reader/.test(await err(() => q("select setup_change('remove_item', $1)", [JSON.stringify({ id: IT2 })]))), 'cannot remove an item set as an override');
  const D1 = (await q("select id from districts where name='ONE'"))[0].id;
  ok(/reader/.test(await err(() => q("select setup_change('remove_district', $1)", [JSON.stringify({ id: D1 })]))), 'cannot remove a district in use');
  await q("select setup_change('rename_district', $1)", [JSON.stringify({ id: D1, name: 'District One' })]);
  ok((await q("select count(*)::int n from readers where district = 'District One'"))[0].n === 5, 'renaming a district updates its readers');
  const D3 = (await q("select setup_change('add_district', '{\"name\":\"THREE\"}') v"))[0].v.id;
  await q("select setup_change('remove_district', $1)", [JSON.stringify({ id: D3 })]);
  ok((await q('select count(*)::int n from districts'))[0].n === 2, 'unused district removed');
  // reorder
  await q('select move_reader($1, 1)', [R[5]]);
  const ord = (await q('select id from readers order by position')).map((x) => x.id);
  ok(ord[0] === R[5] && ord[1] === R[0] && ord[5] === R[4], 'Head Judge moves reader 6 to first; others shift down');
  ok(JSON.stringify((await q('select position from readers order by position')).map((x) => x.position)) === '[1,2,3,4,5,6]', 'positions stay 1..6');
  await q('select move_reader($1, 99)', [R[5]]);
  ok((await q('select id from readers order by position desc limit 1'))[0].id === R[5], 'move past the end puts the reader last');
});
// Site Admin can do the same, and adds a reader with the pick-lists
await as(A, async () => {
  await q('select move_reader($1, 2)', [R[3]]);
  const it = (await q("select id from items where title='The Coconut Thief'"))[0].id;
  const id = (await q("insert into readers (student_name, school, round_no, district_id, item_id, position) values ('New One', 'Dover Gov''t', 2, $1, null, 7) returning id", [D2]))[0].id;
  const r = (await q('select item, round, district from readers where id=$1', [id]))[0];
  ok(r.item === 'The Coconut Thief' && r.round === 'Semi-final' && r.district === 'TWO', 'admin adds a reader with round/district picks: labels derived ' + JSON.stringify(r));
  ok(!!(await err(() => q("insert into readers (student_name, item) values ('Typed', 'free text')"))), 'admin cannot insert free-text labels');
  void it;
});
ok(scoresBefore === JSON.stringify(await q('select reader_id, judge_id, criterion_id, score, comment from scores order by 1,2,3')), 'no score changed through any of this');
ok((await q("select status from sheets where reader_id=$1 and judge_id=$2", [R[0], J]))[0].status === 'turned_in', 'turned-in sheet still turned in');
ok((await q("select count(*)::int n from audit_log where action like 'setup_%' or action in ('move_reader','set_reader_details')"))[0].n >= 15, 'setup changes are in the audit log');
// fresh-install order (08 before seed) gives the same result
const db2 = new PGlite();
await db2.exec(fs.readFileSync('supabase_shim.sql', 'utf8'));
for (const f of ['01_schema', '02_rls', '03_rpcs', '04_realtime', '05_storage', '07_email_sync', '08_setup', 'seed_readers']) await db2.exec(fs.readFileSync(S + f + '.sql', 'utf8'));
const fresh = (await db2.query('select student_name, item, round, district, item_id from readers order by position')).rows;
ok(JSON.stringify(fresh.map(({ item_id, ...x }) => x)) === JSON.stringify(before.map(({ id, position, ...x }) => x)) && fresh.every((r) => r.item_id === null), 'fresh install (08 before seed) maps the seed the same way');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
