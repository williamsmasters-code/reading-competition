// TEST ONLY. A tiny local stand-in for a Supabase project so the REAL site code (supabase-js from
// the CDN) and the REAL admin-users Edge Function can be exercised against the REAL SQL files.
// PGlite (Postgres 18) + Supabase shim, with just enough of PostgREST and GoTrue:
//   /auth/v1/token, /auth/v1/user, /auth/v1/logout, /auth/v1/admin/users[/id]
//   /rest/v1/<table> GET/POST/PATCH/DELETE (eq/neq/is/in filters, order, limit, select columns, count)
//   /rest/v1/rpc/<fn>
//   /functions/v1/admin-users -> forwarded to the Edge Function running under deno on :8000
// Every request runs in its own transaction as anon / authenticated(sub) / service_role, like PostgREST.
import http from 'http';
import fs from 'fs';
import { PGlite } from '@electric-sql/pglite';
export const ANON = 'mock-public-key-not-real-0123456789', SECRET = 'mock-service-key-not-real-0123456789';
const PORT = +(process.env.MOCK_PORT || 54321), FN = process.env.FN_URL || 'http://127.0.0.1:8000';
const db = new PGlite();
await db.exec(fs.readFileSync('supabase_shim.sql', 'utf8'));
await db.exec(`alter table auth.users add column if not exists created_at timestamptz default now();`);
for (const f of ['01_schema', '02_rls', '03_rpcs', '04_realtime', '05_storage', '07_email_sync']) await db.exec(fs.readFileSync(`../supabase/${f}.sql`, 'utf8'));
await db.exec(`grant service_role to current_user;`).catch(() => {});
const pw = new Map(), banned = new Set(), pendingEmail = new Map();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (u) => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) }) + '.mocksig';
const userObj = (r) => ({ id: r.id, aud: 'authenticated', role: 'authenticated', email: r.email, email_confirmed_at: new Date().toISOString(), app_metadata: r.raw_app_meta_data || {}, user_metadata: r.raw_user_meta_data || {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), identities: [] });
const who = (req) => {
  const a = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (a === SECRET || req.headers.apikey === SECRET && !a) return { role: 'service_role', sub: '' };
  const parts = a.split('.');
  if (parts.length === 3) { try { const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); return { role: 'authenticated', sub: p.sub }; } catch (e) { /* */ } }
  return { role: 'anon', sub: '' };
};
let chain = Promise.resolve();
const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
async function tx(w, fn) {
  return serial(async () => {
    await db.exec('begin');
    try {
      await db.exec(`set local role ${w.role}`);
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [w.sub || '']);
      const r = await fn(); await db.exec('commit'); return r;
    } catch (e) { await db.exec('rollback'); throw e; }
  });
}
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw Object.assign(new Error('bad identifier ' + s), { status: 400 }); return '"' + s + '"'; };
function where(params, args) {
  const w = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue;
    const m = /^(eq|neq|is|in|gt|lt|gte|lte)\.(.*)$/s.exec(v); if (!m) continue;
    const c = ident(k);
    if (m[1] === 'is') w.push(`${c} is ${m[2] === 'null' ? 'null' : m[2] === 'true' ? 'true' : 'false'}`);
    else if (m[1] === 'in') { const vals = m[2].replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')); w.push(`${c}::text = any($${args.push(vals)})`); }
    else w.push(`${c} ${{ eq: '=', neq: '<>', gt: '>', lt: '<', gte: '>=', lte: '<=' }[m[1]]} $${args.push(m[2])}`);
  }
  return w.length ? ' where ' + w.join(' and ') : '';
}
const cols = (sel) => (!sel || sel.trim() === '*') ? '*' : sel.split(',').map((s) => ident(s.trim())).join(', ');
const send = (res, status, body, extra) => {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'Content-Range' }, extra || {}));
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const pgErr = (e) => ({ code: e.code || 'P0001', message: e.message, details: e.detail || null, hint: e.hint || null });
export const log = [];
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); let raw = '';
  for await (const ch of req) raw += ch;
  const body = raw ? (() => { try { return JSON.parse(raw); } catch (e) { return raw; } })() : null;
  log.push(req.method + ' ' + u.pathname);
  try {
    if (req.method === 'OPTIONS') return send(res, 200, undefined);
    const p = u.pathname;
    // ---------------- auth ----------------
    if (p === '/auth/v1/token') {
      const r = (await db.query('select * from auth.users where lower(email) = lower($1)', [body.email || ''])).rows[0];
      if (!r || pw.get(r.id) !== body.password) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
      if (banned.has(r.id)) return send(res, 400, { error: 'invalid_grant', error_description: 'User is banned', code: 'user_banned', msg: 'User is banned' });
      return send(res, 200, { access_token: jwt(r), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-' + r.id, user: userObj(r) });
    }
    if (p === '/auth/v1/user') {
      const w = who(req); if (w.role !== 'authenticated') return send(res, 401, { code: 401, msg: 'invalid JWT', error_code: 'bad_jwt' });
      const r = (await db.query('select * from auth.users where id = $1', [w.sub])).rows[0];
      if (!r || banned.has(r.id)) return send(res, 401, { code: 401, msg: 'User not found', error_code: 'user_not_found' });
      if (req.method === 'PUT' && body && body.password) { if (body.password.length < 8) return send(res, 422, { code: 422, msg: 'Password should be at least 8 characters.', error_code: 'weak_password' }); pw.set(r.id, body.password); }
      if (req.method === 'PUT' && body && body.email) { // like Supabase: pending until the link is clicked
        if ((await db.query('select 1 from auth.users where lower(email)=lower($1) and id<>$2', [body.email, r.id])).rows.length) return send(res, 422, { code: 422, msg: 'A user with this email address has already been registered', error_code: 'email_exists' });
        pendingEmail.set(r.id, body.email.toLowerCase()); log.push('EMAIL-REDIRECT ' + (u.searchParams.get('redirect_to') || ''));
        return send(res, 200, Object.assign(userObj(r), { new_email: body.email.toLowerCase(), email_change_sent_at: new Date().toISOString() }));
      }
      return send(res, 200, userObj(r));
    }
    if (p === '/auth/v1/logout') return send(res, 204, undefined);
    if (p.startsWith('/auth/v1/admin/users')) {
      if (who(req).role !== 'service_role') return send(res, 403, { msg: 'not admin' });
      const id = p.split('/')[5];
      if (req.method === 'POST') {
        const r = (await db.query('insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values (lower($1), $2, $3) returning *', [body.email, body.user_metadata || {}, body.app_metadata || {}])).rows[0];
        if (body.password) pw.set(r.id, body.password);
        return send(res, 200, userObj(r));
      }
      if (req.method === 'PUT') {
        const r = (await db.query('select * from auth.users where id = $1', [id])).rows[0]; if (!r) return send(res, 404, { msg: 'User not found' });
        if (body.password) pw.set(id, body.password);
        if (body.email) { if ((await db.query('select 1 from auth.users where lower(email)=lower($1) and id<>$2', [body.email, id])).rows.length) return send(res, 422, { msg: 'A user with this email address has already been registered', error_code: 'email_exists' }); await db.query('update auth.users set email=lower($1) where id=$2', [body.email, id]); }
        if (body.ban_duration) { if (body.ban_duration === 'none') banned.delete(id); else banned.add(id); }
        return send(res, 200, userObj(r));
      }
      if (req.method === 'DELETE') { await db.query('delete from auth.users where id = $1', [id]); return send(res, 200, {}); }
    }
    if (p === '/mock/confirm_email') { // test hook: "click" every pending confirmation link
      for (const [id, e] of pendingEmail) await db.query('update auth.users set email=$1 where id=$2', [e, id]);
      const n = pendingEmail.size; pendingEmail.clear(); return send(res, 200, { confirmed: n });
    }
    if (p === '/mock/token') { // test hook: a session like the one in an invite / reset link
      const r = (await db.query('select * from auth.users where lower(email)=lower($1)', [u.searchParams.get('email')])).rows[0];
      return send(res, 200, { access_token: jwt(r), refresh_token: 'refresh-' + r.id });
    }
    if (p === '/mock/log') return send(res, 200, log.filter((x) => x.startsWith('EMAIL')));
    // ---------------- edge function ----------------
    if (p.startsWith('/functions/v1/')) {
      const r = await fetch(FN + '/', { method: req.method, headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '', Origin: req.headers.origin || '' }, body: req.method === 'POST' ? raw : undefined });
      const t = await r.text(); const h = {}; r.headers.forEach((v, k) => { if (/^access-control|content-type/i.test(k)) h[k] = v; });
      res.writeHead(r.status, h); return res.end(t);
    }
    // ---------------- rest ----------------
    const w = who(req);
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = ident(p.slice(13)); const args = []; const named = Object.entries(body || {}).map(([k, v]) => `${ident(k)} => $${args.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v)}`);
      const r = await tx(w, () => db.query(`select public.${fn}(${named.join(', ')}) as r`, args));
      const v = r.rows[0] ? r.rows[0].r : null;
      return send(res, 200, v === '' ? null : v);
    }
    if (p.startsWith('/rest/v1/')) {
      const t = 'public.' + ident(p.slice(9)); const args = []; const q = u.searchParams;
      const wantObj = /vnd\.pgrst\.object/.test(req.headers.accept || ''); const prefer = req.headers.prefer || '';
      const fin = (rows, count) => {
        const extra = count != null ? { 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${count}` } : {};
        if (req.method === 'HEAD') return send(res, 200, undefined, extra);
        if (wantObj) { if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null }); return send(res, 200, rows[0], extra); }
        if (req.method !== 'GET' && !/return=representation/.test(prefer)) return send(res, 201, undefined, extra);
        return send(res, 200, rows, extra);
      };
      if (req.method === 'GET' || req.method === 'HEAD') {
        let sql = `select ${cols(q.get('select'))} from ${t}` + where(q, args);
        if (q.get('order')) sql += ' order by ' + q.get('order').split(',').map((o) => { const [c, d, n] = o.split('.'); return ident(c) + (d === 'desc' ? ' desc' : ' asc') + (n === 'nullsfirst' ? ' nulls first' : n === 'nullslast' ? ' nulls last' : ''); }).join(', ');
        if (q.get('limit')) sql += ' limit ' + (+q.get('limit'));
        const r = await tx(w, () => db.query(sql, args));
        let count = null; if (/count=exact/.test(prefer)) count = r.rows.length;
        return fin(r.rows, count);
      }
      const sel = cols(q.get('select'));
      if (req.method === 'POST') {
        const rows = Array.isArray(body) ? body : [body]; const keys = [...new Set(rows.flatMap(Object.keys))].map(ident);
        const r = await tx(w, () => db.query(`insert into ${t} (${keys.join(',')}) select ${keys.join(',')} from json_populate_recordset(null::${t}, $1) returning ${sel}`, [JSON.stringify(rows)]));
        return fin(r.rows);
      }
      if (req.method === 'PATCH') {
        const keys = Object.keys(body).map(ident); args.push(JSON.stringify(body));
        const set = keys.length === 1 ? `${keys[0]} = (select ${keys[0]} from json_populate_record(null::${t}, $1))` : `(${keys.join(',')}) = (select ${keys.join(',')} from json_populate_record(null::${t}, $1))`;
        const r = await tx(w, () => db.query(`update ${t} set ${set}${where(q, args)} returning ${sel}`, args));
        return fin(r.rows);
      }
      if (req.method === 'DELETE') { const r = await tx(w, () => db.query(`delete from ${t}${where(q, args)} returning ${sel}`, args)); return fin(r.rows); }
    }
    if (p.startsWith('/storage/')) return send(res, 400, { statusCode: '400', error: 'not_in_mock', message: 'Storage is not part of the local mock.' });
    return send(res, 404, { message: 'not found in mock: ' + p });
  } catch (e) {
    console.log('ERR', req.method, u.pathname + u.search, raw.slice(0, 300), '->', e.message);
    return send(res, e.status || 400, pgErr(e));
  }
});
// seed: 6 accounts like the real setup (created as the admin-users function / dashboard would)
export async function seed() {
  const mk = async (email, role, name) => { const r = (await db.query('insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning id', [email, { full_name: name }, role ? { role } : {}])).rows[0]; pw.set(r.id, 'Password-123'); return r.id; };
  await mk('admin@mock.test', 'site_admin', 'Mock Admin'); await mk('head@mock.test', 'head_judge', 'Mock Head Judge');
  for (let i = 1; i <= 4; i++) { const id = await mk(`judge${i}@mock.test`, 'judge', 'Mock Judge ' + i); await db.query('insert into public.panel (judge_id, seat) values ($1, $2)', [id, i]); }
  await mk('nobody@mock.test', null, 'No Role Person');
  await db.exec(`insert into public.readers (student_name, school, item, reading_date, round, district, position) values
    ('Mock Reader One','Dover Gov''t','Just Harriet','2026-11-20','Round 1','ONE',1), ('Mock Reader Two','Harvey Vale Gov''t','Just Harriet','2026-11-20','Round 1','ONE',2)`);
}
await seed();
server.listen(PORT, '127.0.0.1', () => console.log('mock supabase on', PORT));
