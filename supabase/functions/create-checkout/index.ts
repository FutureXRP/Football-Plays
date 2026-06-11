// Supabase Edge Function: create-checkout
// Creates a Stripe Checkout session for the one-time Pro purchase.
//
// Required secrets (supabase secrets set KEY=value):
//   STRIPE_SECRET_KEY  — sk_live_... or sk_test_...
//   SITE_URL           — e.g. https://your-app.vercel.app  (fallback for redirects)
//
// Deploy: supabase functions deploy create-checkout

import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const PRICE_CENTS = 2500; // $25.00 one-time
const PRODUCT_NAME = "Play Designer Pro — Lifetime Unlock";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Identify the signed-in user from their JWT
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization") ?? "" },
        },
      },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return json({ error: "You must be signed in to purchase." }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const origin = typeof body.origin === "string" && body.origin.startsWith("http")
      ? body.origin
      : Deno.env.get("SITE_URL") ?? "";

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: PRICE_CENTS,
          product_data: { name: PRODUCT_NAME },
        },
      }],
      success_url: `${origin}?checkout=success`,
      cancel_url: `${origin}?checkout=cancel`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("create-checkout error:", e);
    return json({ error: "Could not create checkout session." }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
