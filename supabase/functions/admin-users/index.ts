// Supabase Edge Function: admin-users  (NOT deployed yet; Daniel approves the deploy)
// Lets the signed-in SITE ADMIN create login accounts and reset passwords.
// The service role key is read from the function's environment on Supabase's
// servers (SUPABASE_SERVICE_ROLE_KEY is provided automatically). It never goes
// to the website.
//
// Deploy:  supabase functions deploy admin-users --project-ref <PROJECT-REF>
// Optional secret: supabase secrets set ALLOWED_ORIGINS="https://williamsmasters-code.github.io" --project-ref <PROJECT-REF>
//
// Request (POST JSON, with the admin's normal Authorization: Bearer <access token>):
//   {action:"create_user", email, password, full_name, role:"judge"|"head_judge"|"site_admin", add_to_panel?:true}
//   {action:"reset_password", user_id, password}
//   {action:"set_active", user_id, active:true|false}
//   {action:"delete_user", user_id}
import { createClient } from "npm:@supabase/supabase-js@2";

const ROLES = ["site_admin", "head_judge", "judge"];
const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://williamsmasters-code.github.io,http://localhost:8000")
  .split(",").map((s) => s.trim()).filter(Boolean);

function cors(origin: string | null) {
  const o = origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Supabase injects the new-style key dictionaries (SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS)
// and, on projects that still have them, the legacy SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.
// Use the new "default" key when present, otherwise the legacy one. Neither ever reaches the browser.
function envKey(dictName: string, legacyName: string): string {
  try {
    const d = JSON.parse(Deno.env.get(dictName) ?? "{}") as Record<string, string>;
    if (d && typeof d.default === "string" && d.default) return d.default;
  } catch { /* fall through */ }
  return Deno.env.get(legacyName) ?? "";
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("Origin"));
  const out = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return out(405, { error: "Use POST." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const service = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return out(500, { error: "The account helper is not set up yet." });
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return out(401, { error: "Please sign in again." });

  // Who is calling? (verified by Supabase Auth from their access token)
  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: who, error: whoErr } = await asUser.auth.getUser();
  if (whoErr || !who?.user) return out(401, { error: "Please sign in again." });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: me } = await admin.from("profiles").select("role, active").eq("id", who.user.id).maybeSingle();
  if (!me || me.role !== "site_admin" || !me.active) return out(403, { error: "Only the Site Admin can manage accounts." });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return out(400, { error: "Bad request." }); }
  const action = String(body.action ?? "");
  const log = (a: string, detail: Record<string, unknown>) =>
    admin.from("audit_log").insert({ actor: who.user.id, action: a, detail });

  try {
    if (action === "create_user") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const full_name = String(body.full_name ?? "").trim().slice(0, 100);
      const role = String(body.role ?? "judge");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return out(400, { error: "Type a valid email address." });
      if (password.length < 8) return out(400, { error: "The password must be at least 8 characters." });
      if (!full_name) return out(400, { error: "Type the person's name." });
      if (!ROLES.includes(role)) return out(400, { error: "Pick a role." });
      if (role !== "judge") {
        const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", role);
        if ((count ?? 0) > 0) return out(409, { error: role === "site_admin" ? "There is already a Site Admin." : "There is already a Head Judge." });
      }
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name }, app_metadata: { role },
      });
      if (error) return out(400, { error: error.message });
      const id = data.user!.id;
      // The database trigger made the profile; make sure name/role are set.
      await admin.from("profiles").update({ full_name, role }).eq("id", id);
      if (role === "judge" && body.add_to_panel) {
        const { data: seats } = await admin.from("panel").select("seat").order("seat", { ascending: false }).limit(1);
        const seat = ((seats?.[0]?.seat as number | undefined) ?? 0) + 1;
        await admin.from("panel").insert({ judge_id: id, seat });
      }
      await log("create_user", { id, email, role });
      return out(200, { ok: true, id });
    }

    const user_id = String(body.user_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(user_id)) return out(400, { error: "Unknown account." });

    if (action === "reset_password") {
      const password = String(body.password ?? "");
      if (password.length < 8) return out(400, { error: "The password must be at least 8 characters." });
      const { error } = await admin.auth.admin.updateUserById(user_id, { password });
      if (error) return out(400, { error: error.message });
      await log("reset_password", { id: user_id });
      return out(200, { ok: true });
    }
    if (action === "set_active") {
      if (user_id === who.user.id) return out(400, { error: "You cannot deactivate your own account." });
      const active = body.active === true;
      const { error } = await admin.auth.admin.updateUserById(user_id, { ban_duration: active ? "none" : "876000h" });
      if (error) return out(400, { error: error.message });
      await admin.from("profiles").update({ active }).eq("id", user_id);
      await log("set_active", { id: user_id, active });
      return out(200, { ok: true });
    }
    if (action === "delete_user") {
      if (user_id === who.user.id) return out(400, { error: "You cannot delete your own account." });
      const { data: p } = await admin.from("profiles").select("role").eq("id", user_id).maybeSingle();
      if (p?.role === "head_judge") return out(400, { error: "Give the Head Judge role to someone else before deleting this account." });
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) return out(400, { error: error.message });
      await log("delete_user", { id: user_id });
      return out(200, { ok: true });
    }
    return out(400, { error: "Unknown action." });
  } catch (e) {
    return out(500, { error: "Something went wrong: " + (e instanceof Error ? e.message : String(e)) });
  }
});
