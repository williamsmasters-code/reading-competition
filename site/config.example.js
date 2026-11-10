// Michelle Coy Reading Competition: Supabase connection.
// Copy this file to config.js and fill in the two values from
// Supabase Dashboard > Project Settings > API Keys.
// ONLY the public key goes here: the "Publishable key" (sb_publishable_...) or, on older
// projects, the legacy "anon public" key. NEVER put a Secret key (sb_secret_...) or the
// legacy service_role key in this site.
// While these placeholders are in place (or config.js is missing) the site runs in DEMO mode
// with made-up EXAMPLE data and nothing is saved online.
window.MCRC_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY"
};
