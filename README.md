# ⚡ Play Designer Pro

A football play-design web app: draw plays on a 2D field, animate all 22
players plus the ball, and review plays in a 3D film room with rigged player
models and five camera angles.

**Business model:** free tier lets anyone draw and run 2D motion on up to
**3 plays** with no account. A **$25 one-time purchase** unlocks everything:

| Feature | Free | Pro ($25 once) |
|---|---|---|
| Draw plays (routes, blocks, motion, ball script) | ✅ 3 plays | ✅ Unlimited |
| 2D motion animation | ✅ | ✅ |
| 3D Film Room (rigged players, 5 cameras, first person) | — | ✅ |
| Save / open `.pdpro` play files | — | ✅ |
| Cloud playbook (plays saved to your account) | — | ✅ |
| PNG screenshots & video export (2D + 3D) | — | ✅ |
| Custom formations | — | ✅ |

The site is fully static (no build step). Accounts and entitlements live in
**Supabase**; payments go through **Stripe Checkout** via a Supabase Edge
Function; hosting is **Vercel** (any static host works).

---

## Repo layout

```
index.html                  app shell, styles, markup
js/app.js                   2D editor + animation engine
js/characters.js            3D rigged-character system (stances, run cycle)
pov.js                      3D film room (Three.js)
js/config.js                ← YOUR Supabase keys go here
js/account.js               auth, paywall gating, cloud playbook
js/vendor/                  three.js r128, GLTFLoader, SkeletonUtils, supabase-js
american_football_players_animated_rigged.glb   3D player models
supabase/migrations/        database schema (profiles, plays, RLS)
supabase/functions/         create-checkout + stripe-webhook edge functions
vercel.json                 cache headers
```

---

## Deployment guide (one-time, ~30 minutes)

### 1. Supabase (accounts + database)

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. In the dashboard, open **SQL Editor** and run the contents of
   `supabase/migrations/0001_init.sql`.
3. **Authentication → Providers → Email**: leave Email enabled.
   (Optional: turn OFF "Confirm email" for friction-free signup.)
4. **Settings → API**: copy the **Project URL** and **anon public** key into
   `js/config.js`:

   ```js
   SUPABASE_URL: 'https://YOURPROJECT.supabase.co',
   SUPABASE_ANON_KEY: 'eyJ...',
   ```

   Commit and push — the anon key is public by design; row-level security
   protects the data.

### 2. Stripe (payments)

1. Create an account at [stripe.com](https://stripe.com) and grab your
   **secret key** (`sk_live_...`, or `sk_test_...` while testing).
2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and link
   the project:

   ```sh
   supabase login
   supabase link --project-ref YOURPROJECT
   ```

3. Set the function secrets and deploy both functions:

   ```sh
   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
   supabase secrets set SITE_URL=https://your-site.vercel.app
   supabase functions deploy create-checkout
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```

4. In the Stripe dashboard, **Developers → Webhooks → Add endpoint**:
   - URL: `https://YOURPROJECT.supabase.co/functions/v1/stripe-webhook`
   - Event: `checkout.session.completed`
   - Copy the signing secret (`whsec_...`) and set it:

   ```sh
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```

> The $25 price is defined in `supabase/functions/create-checkout/index.ts`
> (`PRICE_CENTS = 2500`). Change it there if you ever adjust pricing.

### 3. Vercel (hosting)

1. Go to [vercel.com](https://vercel.com) → **New Project** → import this
   GitHub repo.
2. Framework preset: **Other**. No build command, output directory: root.
3. Deploy. Every push to `main` redeploys automatically.
4. Put the final URL into the `SITE_URL` secret (step 2.3) if it changed.

### 4. Test the purchase flow

1. Use Stripe **test mode** keys first (`sk_test_...`).
2. Visit the site → draw a play → hit a Pro feature → create an account →
   **Unlock Pro** → pay with card `4242 4242 4242 4242`, any future date/CVC.
3. You should land back on the site and see the 🎉 modal within seconds, and
   the header should show a **PRO** badge.
4. Swap in live keys (`sk_live_...`, live webhook + secret) when ready.

---

## How the paywall works

- `js/account.js` wraps the gated functions (`openPOV`, `savePlay`,
  `exportPNG`, …) at load time; non-Pro calls open the upgrade modal.
- The free 3-play allowance is tracked in `localStorage` per browser (and per
  account once signed in). It's a soft client-side gate — the real product
  value (cloud saves, entitlement) is enforced server-side by Supabase RLS.
- `is_pro` can only be set by the Stripe webhook using the service-role key.
  There is no client-side path to grant Pro.

## Local development

Any static server works:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Without keys in `js/config.js` the app runs in free mode with the paywall
visible but checkout disabled.
