// ── DEPLOYMENT CONFIG ─────────────────────────────────
// Fill these in after creating your Supabase project (see README.md).
// The anon key is safe to publish — security is enforced by RLS policies.
window.PD_CONFIG = {
  SUPABASE_URL: '',       // e.g. 'https://abcdefgh.supabase.co'
  SUPABASE_ANON_KEY: '',  // Supabase Dashboard → Settings → API → anon public
  PRICE_LABEL: '$25',     // display only — the real price lives in the
                          // create-checkout edge function
  FREE_PLAY_LIMIT: 3,     // free plays with 2D motion before the paywall
};
