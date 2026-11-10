// Tests supabase/06_assign_roles.sql: dashboard-made accounts (no role) get roles and panel seats.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite(); let fail = 0;
const ok = (c, m) => { console.log(c ? '  PASS' : '  FAIL', m); if (!c) fail++; };
await db.exec(fs.readFileSync('supabase_shim.sql', 'utf8'));
for (const f of ['01_schema', '02_rls', '03_rpcs', '04_realtime', '05_storage']) await db.exec(fs.readFileSync(`../supabase/${f}.sql`, 'utf8'));
const emails = ['admin', 'headjudge', 'judge1', 'judge2', 'judge3', 'judge4'];
for (const e of emails) await db.query(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, '{}', '{}')`, [`${e.toUpperCase()}@Example.org`]);
ok((await db.query(`select count(*)::int n from profiles where role is null`)).rows[0].n === 6, 'dashboard accounts start with no access');
let sql = fs.readFileSync('../supabase/06_assign_roles.sql', 'utf8').replace(/CHANGE-ME-([a-z0-9]+)@example\.com/g, '$1@example.org').replace(/CHANGE-ME ([^']+) name/g, 'Test $1');
ok(!/CHANGE-ME/.test(sql), 'all placeholders substituted');
await db.exec(sql);
const rows = (await db.query(`select p.email, p.full_name, p.role, pn.seat from profiles p left join panel pn on pn.judge_id = p.id order by pn.seat`)).rows;
console.table(rows);
ok(rows.filter((r) => r.role === 'site_admin').length === 1 && rows.filter((r) => r.role === 'head_judge').length === 1 && rows.filter((r) => r.role === 'judge').length === 4, '1 admin, 1 head, 4 judges');
ok(JSON.stringify(rows.map((r) => r.seat)) === JSON.stringify([0, 1, 2, 3, 4, null]), 'panel seats 0-4, admin not on panel');
await db.exec(sql); ok((await db.query('select count(*)::int n from panel')).rows[0].n === 5, 're-running is safe');
process.exit(fail ? 1 : 0);
