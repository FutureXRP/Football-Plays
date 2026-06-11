// ── DEPLOYMENT CONFIG ─────────────────────────────────
// Fill these in after creating your Supabase project (see README.md).
// The anon key is safe to publish — security is enforced by RLS policies.
window.PD_CONFIG = {
  SUPABASE_URL: '',       // e.g. 'https://abcdefgh.supabase.co'
  SUPABASE_ANON_KEY: '',  // Supabase Dashboard → Settings → API → anon public
  PRICE_LABEL: '$25',     // display only — the real price lives in the
                          // create-checkout edge function
  FREE_PLAY_LIMIT: 3,     // free plays with 2D motion before the paywall

  // Master switch. false = everything unlocked for everyone (testing mode).
  // Set to true to enforce the paywall once Supabase + Stripe are configured.
  // Note: cloud playbook writes also require is_pro server-side (RLS), so
  // with the paywall off, cloud saves only work for accounts already Pro.
  PAYWALL_ENABLED: false,
};
