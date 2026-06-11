// Supabase Edge Function: stripe-webhook
// Receives checkout.session.completed events from Stripe and marks the
// purchasing user's profile as Pro.
//
// Required secrets (supabase secrets set KEY=value):
//   STRIPE_SECRET_KEY      — sk_live_... or sk_test_...
//   STRIPE_WEBHOOK_SECRET  — whsec_... (from the Stripe webhook endpoint)
//
// Deploy with JWT verification OFF (Stripe can't send a Supabase JWT):
//   supabase functions deploy stripe-webhook --no-verify-jwt

import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
    );
  } catch (e) {
    console.error("Webhook signature verification failed:", e);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id;
    if (session.payment_status === "paid" && userId) {
      // Service role bypasses RLS — this is the only place is_pro is set
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { error } = await admin.from("profiles").update({
        is_pro: true,
        stripe_customer_id: (session.customer as string) ?? null,
        stripe_session_id: session.id,
        purchased_at: new Date().toISOString(),
      }).eq("id", userId);
      if (error) {
        console.error("Failed to mark user pro:", error);
        return new Response("DB update failed", { status: 500 });
      }
      console.log("User upgraded to Pro:", userId);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
