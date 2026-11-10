// Runs the real SQL files on PGlite (Postgres 18 in WASM) with a Supabase shim,
// then exercises RLS and every RPC as anon / judge / head judge / site admin.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const S = '../supabase/';
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
async function as(uid, fn) {
  await db.exec(uid === 'anon' ? `set role anon; select set_config('request.jwt.claim.sub','',false);`
    : `set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
}
async function q(sql, params) { return (await db.query(sql, params)).rows; }
async function err(fn) { try { await fn(); return null; } catch (e) { return e.message; } }

await db.exec(fs.readFileSync('supabase_shim.sql', 'utf8'));
for (const f of ['01_schema.sql', '02_rls.sql', '03_rpcs.sql', '04_realtime.sql', '05_storage.sql', 'seed_readers.sql']) {
  await db.exec(fs.readFileSync(S + f, 'utf8')); console.log('ran', f);
}
// re-run idempotency
for (const f of ['01_schema.sql', '02_rls.sql', '03_rpcs.sql', '04_realtime.sql', '05_storage.sql', 'seed_readers.sql']) {
  await db.exec(fs.readFileSync(S + f, 'utf8'));
}
console.log('re-ran all files (idempotent)');
ok((await q('select count(*)::int n from readers'))[0].n === 6, 'seed: 6 readers once, even after re-run');
ok((await q('select count(*)::int n from criteria'))[0].n === 10, 'default 10 criteria once');
ok((await q("select count(*)::int n from pg_publication_tables where pubname='supabase_realtime'"))[0].n === 10, 'realtime publication has 10 tables');
const rlsOff = await q(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
ok(rlsOff.length === 0, 'RLS enabled on every public table ' + JSON.stringify(rlsOff));

// accounts (as the admin function / dashboard would create them)
const mk = async (email, role, name) => (await q(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning id`,
  [email, { full_name: name }, role ? { role } : {}]))[0].id;
const A = await mk('admin@x.test', 'site_admin', 'Test Admin');
const H = await mk('head@x.test', 'head_judge', 'Test Head');
const J = []; for (let i = 1; i <= 4; i++) J.push(await mk(`j${i}@x.test`, 'judge', 'Test Judge ' + i));
const J5 = await mk('j5@x.test', 'judge', 'Spare Judge');
const SIGNUP = await mk('random@x.test', null, 'Self signup');      // no app_metadata role
const SIGNUP2 = await mk('sneaky@x.test', null, 'Sneaky');
await q(`update auth.users set raw_user_meta_data='{"role":"site_admin"}' where id=$1`, [SIGNUP2]);
ok((await q('select role from profiles where id=$1', [SIGNUP]))[0].role === null, 'account without app_metadata role gets NO role');
ok((await q("select seat from panel where judge_id=$1", [H]))[0]?.seat === 0, 'Head Judge auto-added to panel seat 0');
ok(!!(await err(() => mk('admin2@x.test', 'site_admin', 'Second admin'))), 'a second Site Admin is rejected');
ok(!!(await err(() => mk('head2@x.test', 'head_judge', 'Second head'))), 'a second Head Judge is rejected');

// anon
await as('anon', async () => {
  ok(!!(await err(() => q('select * from readers'))), 'anon cannot read readers');
  ok(!!(await err(() => q('select * from scores'))), 'anon cannot read scores');
  ok(!!(await err(() => q('select * from profiles'))), 'anon cannot read profiles');
  ok(!!(await err(() => q('select * from finalization'))), 'anon cannot read finalization');
  ok(!!(await err(() => q("select save_scores('00000000-0000-0000-0000-000000000000'::uuid,'[]')"))), 'anon cannot call save_scores');
  const pl = (await q('select public_landing() v'))[0].v;
  ok(pl.published === false && pl.results.length === 0 && pl.event_date === '2026-11-20' && pl.start_time === null, 'anon public_landing(): date, no start time, no results ' + JSON.stringify(pl));
});
// no-role account
await as(SIGNUP, async () => {
  ok((await q('select * from readers')).length === 0, 'account with no role sees no readers');
  ok(!!(await err(() => q("select set_start_time('09:00')"))), 'no-role account cannot set start time');
});
// admin panel
await as(A, async () => {
  for (const j of J) await q('select add_to_panel($1)', [j]);
  ok((await q('select count(*)::int n from panel'))[0].n === 5, 'admin added 4 judges: panel = 5');
  ok(!!(await err(() => q('select remove_from_panel($1)', [H]))), 'admin cannot remove the Head Judge from the panel');
  ok(!!(await err(() => q('delete from panel where judge_id=$1', [H]))), 'direct delete of panel row blocked');
  ok(!!(await err(() => q("update readers set judging_status='open' where position=1"))), 'admin cannot open judging by direct update (column not granted)');
  ok(!!(await err(() => q('select open_reader(id) from readers where position=1'))), 'admin cannot open judging (Head Judge only)');
  await q("select set_start_time('09:00')");
  ok((await q('select count(*)::int n from profiles'))[0].n >= 8, 'admin sees all profiles');
  ok(!!(await err(() => q("update profiles set role='judge' where id=$1", [A]))), 'admin cannot demote themselves');
  await q("update profiles set full_name='Renamed Judge 4' where id=$1", [J[3]]);
  ok((await q('select full_name from profiles where id=$1', [J[3]]))[0].full_name === 'Renamed Judge 4', 'admin can rename a user');
  await q("insert into readers (position, student_name, school) values (7,'Temp Reader','Dover Gov''t')");
  await q("delete from readers where student_name='Temp Reader'");
  ok(true, 'admin can add and remove a reader');
  await q("insert into photos (storage_path, caption) values ('photos/a.jpg','Test')");
});
await as('anon', async () => {
  const pl = (await q('select public_landing() v'))[0].v;
  ok(pl.start_time === '09:00' && pl.photos.length === 1, 'public_landing shows start time 09:00 and 1 photo');
});
const R = (await q('select id from readers order by position')).map(r => r.id);
const C = (await q('select id from criteria order by position')).map(r => r.id);
const items = (vals, cmt = '') => JSON.stringify(C.map((c, i) => ({ criterion_id: c, score: vals[i] ?? null, comment: cmt })));

// judge before open
await as(J[0], async () => {
  ok((await q('select * from readers')).length === 6, 'judge sees the readers list');
  ok(!!(await err(() => q('select save_scores($1,$2)', [R[0], items([5, 5])]))), 'judge cannot score a reader that is not opened');
  ok(!!(await err(() => q('select open_reader($1)', [R[0]]))), 'judge cannot open judging');
  ok((await q('select * from profiles')).length === 1, 'judge sees only their own profile');
  ok(!!(await err(() => q('insert into scores (reader_id,judge_id,criterion_id,score) values ($1,$2,$3,5)', [R[0], J[0], C[0]]))), 'judge cannot insert scores directly (RPC only)');
});
// head opens reader 1
await as(H, async () => {
  await q('select open_reader($1)', [R[0]]);
  const e = await err(() => q('select open_reader($1)', [R[1]]));
  ok(e && /still open/.test(e), 'opening a second reader is refused while one is open: ' + e);
  await q('select open_reader($1, true)', [R[1]]);
  const st = await q('select judging_status s from readers order by position');
  ok(st[0].s === 'closed' && st[1].s === 'open', 'open_reader(close_current) closes reader 1 and opens reader 2');
  ok((await q("select count(*)::int n from readers where judging_status='open'"))[0].n === 1, 'only one reader open');
  await q('select close_reader($1)', [R[1]]);
  await q('select open_reader($1)', [R[0]]);
});
// judges score reader 1
await as(J[0], async () => {
  await q('select save_scores($1,$2)', [R[0], items([5, 4, 3])]);
  const e = await err(() => q('select turn_in_sheet($1)', [R[0]]));
  ok(e && /every criterion/.test(e), 'turn in blocked while criteria unscored: ' + e);
  await q('select save_scores($1,$2)', [R[0], items([5, 4, 3, 4, 5, 4, 3, 4, 5, 4], 'Nice')]);
  await q('select turn_in_sheet($1)', [R[0]]);
  ok(!!(await err(() => q('select save_scores($1,$2)', [R[0], items([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])]))), 'turned-in sheet is read-only');
  ok(!!(await err(() => q('select save_scores($1,$2)', [R[0], JSON.stringify([{ criterion_id: C[0], score: 6 }])]))), 'score 6 rejected');
  ok((await q('select * from scores')).every(s => s.judge_id === J[0]), 'judge sees only their own scores');
});
await as(J[1], async () => {
  await q('select save_scores($1,$2)', [R[0], items([3, 3, 3, 3, 3, 3, 3, 3, 3, 3])]);
  ok((await q('select * from scores')).length === 10, 'judge 2 sees exactly their own 10 scores, not judge 1\'s');
  ok((await q('select * from sheets')).length === 1, 'judge 2 sees only their own sheet');
  ok(!!(await err(() => q('select finalize_results()'))), 'judge cannot finalize');
});
await as(J5, async () => {
  ok(!!(await err(() => q('select save_scores($1,$2)', [R[0], items([5])]))), 'judge NOT on the panel cannot score');
});
await as(H, async () => {
  ok((await q('select * from scores')).length === 20, 'Head Judge sees every judge\'s scores');
  await q('select reopen_sheet($1,$2)', [R[0], J[0]]);
  ok((await q('select status from sheets where reader_id=$1 and judge_id=$2', [R[0], J[0]]))[0].status === 'draft', 'Head Judge reopened judge 1 sheet');
  const e = await err(() => q('select finalize_results()'));
  ok(e && /Close judging/.test(e), 'finalize blocked while readers not closed: ' + e);
});
// complete everything
const all = [H, ...J];
await as(H, async () => { for (const r of R) { await q('select open_reader($1, true)', [r]); } await q('select close_reader($1)', [R[5]]); });
for (const [ji, j] of all.entries()) await as(j, async () => {
  for (const [ri, r] of R.entries()) {
    const v = C.map((_, ci) => 1 + ((ri * 3 + ci + ji) % 5));
    await q('select save_scores($1,$2)', [r, items(v, 'c')]);
    await q('select turn_in_sheet($1)', [r]);
  }
});
await as(A, async () => {
  ok(!!(await err(() => q('select finalize_results()'))), 'Site Admin cannot finalize (Head Judge only)');
  await q("select add_to_panel($1)", [J5]);
});
await as(H, async () => {
  const e = await err(() => q('select finalize_results()'));
  ok(e && /not turned in/.test(e), 'finalize blocked when a newly added panel judge has no sheets: ' + e);
});
await as(A, async () => { await q('select remove_from_panel($1)', [J5]); });
let snap;
await as(H, async () => {
  snap = (await q('select finalize_results() v'))[0].v;
  ok(Array.isArray(snap) && snap.length === 6, 'Head Judge finalized: 6 ranked readers');
  const exp = (await q('select reader_id, sum(score)::int t from scores s join panel p using (judge_id) group by reader_id order by t desc'));
  ok(snap[0].total === exp[0].t, 'top total = sum of all panel judges\' totals (' + snap[0].total + ')');
  ok(snap.every((x, i) => i === 0 || x.place >= snap[i - 1].place), 'places in order');
  ok(!!(await err(() => q('select reopen_sheet($1,$2)', [R[0], J[0]]))), 'cannot reopen a sheet after publishing');
});
await as(J[0], async () => {
  ok(!!(await err(() => q('select save_scores($1,$2)', [R[0], items([1])]))), 'scores locked after publishing');
});
await as('anon', async () => {
  const pl = (await q('select public_landing() v'))[0].v;
  ok(pl.published === true && pl.results.length === 6, 'public sees 6 published results');
  ok(!JSON.stringify(pl).includes('"c"') && !('comment' in pl.results[0]) && Object.keys(pl.results[0]).sort().join() === 'name,place,school,total', 'public results carry only place, name, school, total (no comments or per-judge scores)');
});
let rid;
await as(A, async () => { ok(!!(await err(() => q("select request_revert('x')"))), 'Site Admin cannot file a revert request (Head Judge does)'); });
await as(H, async () => { rid = (await q("select request_revert('Judge 2 typo') v"))[0].v; ok(!!rid, 'Head Judge sent a revert request'); });
await as(J[0], async () => { ok((await q('select * from revert_requests')).length === 0, 'judge cannot see revert requests'); });
await as(H, async () => { ok(!!(await err(() => q('select decide_revert($1,true)', [rid]))), 'Head Judge cannot approve their own revert'); });
await as(A, async () => {
  await q('select decide_revert($1,true,$2)', [rid, 'ok']);
  ok((await q('select status from finalization'))[0].status === 'open', 'Site Admin reverted: results unpublished');
});
await as('anon', async () => { ok((await q('select public_landing() v'))[0].v.published === false, 'public results gone after revert'); });
await as(H, async () => { await q('select reopen_sheet($1,$2)', [R[0], J[1]]); ok(true, 'after revert the Head Judge can reopen sheets again'); });
await as(A, async () => {
  const e = await err(() => q("select substitute_reader($1,'New Kid','Dover Gov''t')", [R[2]]));
  ok(e && /Confirm/.test(e), 'substitute asks to confirm when scores exist: ' + e);
  await q("select substitute_reader($1,'New Kid','Dover Gov''t',true)", [R[2]]);
  const r = (await q('select student_name, position, judging_status from readers where id=$1', [R[2]]))[0];
  ok(r.student_name === 'New Kid' && r.position === 3 && r.judging_status === 'not_opened', 'substitute keeps place 3, resets judging');
  ok((await q('select count(*)::int n from scores where reader_id=$1', [R[2]]))[0].n === 0, 'substitute cleared old scores');
  await q("insert into storage.objects (bucket_id, name) values ('event-photos','photos/a.jpg')");
});
await as(J[0], async () => {
  ok(!!(await err(() => q("insert into storage.objects (bucket_id, name) values ('event-photos','photos/b.jpg')"))), 'judge cannot upload photos to storage');
  ok(!!(await err(() => q("insert into photos (storage_path) values ('photos/b.jpg')"))), 'judge cannot add photo rows');
  ok(!!(await err(() => q("select set_start_time('10:00')"))) === true, 'judge cannot set the start time');
});
await as(H, async () => { await q("select set_start_time('10:30')"); ok(true, 'Head Judge can set the start time'); });
ok((await q('select count(*)::int n from audit_log'))[0].n > 10, 'audit log recorded actions');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
