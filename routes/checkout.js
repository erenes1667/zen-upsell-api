import { Router } from 'express';
import { stripe } from '../lib/stripe.js';

const router = Router();

// Tier registry. Per Duran 2026-05-04:
//   audit-95   → keeps post-purchase upsells: /upsell-1 → /upsell-2 → /thank-you-paid
//   sprint-495 → one-time, no upsells: → /thank-you-paid directly
// successUrl is per-tier so we don't need a single SUCCESS_URL env var.
const TIERS = {
 'audit-95': {
  price: process.env.STRIPE_PRICE_AUDIT_95,
  successUrl: 'https://offer.zenmedia.com/upsell-1?session_id={CHECKOUT_SESSION_ID}',
  cancelPath: 'https://offer.zenmedia.com/95',
 },
 'sprint-495': {
  price: process.env.STRIPE_PRICE_SPRINT_495,
  successUrl: 'https://offer.zenmedia.com/thank-you-paid?session_id={CHECKOUT_SESSION_ID}',
  cancelPath: 'https://offer.zenmedia.com/495',
 },
};

function resolveTier(req, res) {
 const tier = (req.body && req.body.tier) || 'audit-95';
 const cfg = TIERS[tier];
 if (!cfg) {
  res.status(400).json({ error: `Unknown tier: ${tier}` });
  return null;
 }
 if (!cfg.price) {
  res.status(500).json({ error: `Tier ${tier} has no Stripe price configured (env STRIPE_PRICE_${tier.toUpperCase().replace('-','_')})` });
  return null;
 }
 return { tier, cfg };
}

// Whitelist of attribution keys we accept from the browser and persist on the
// Stripe Checkout Session metadata. Stripe metadata caps at 50 keys / 500 chars per value.
const ATTRIBUTION_KEYS = [
 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
 'gclid', 'fbclid', 'ttclid', 'msclkid', 'irclickid', 'ref', 'landing_page',
];

function pickAttribution(input) {
 const out = {};
 if (!input || typeof input !== 'object') return out;
 for (const key of ATTRIBUTION_KEYS) {
  const v = input[key];
  if (typeof v === 'string' && v.length > 0) {
   out[key] = v.slice(0, 480); // stay under Stripe's 500-char metadata cap
  }
 }
 return out;
}

// Hosted Stripe Checkout (back-compat). Returns a redirect URL.
router.post('/create-session', async (req, res) => {
 try {
  const t = resolveTier(req, res);
  if (!t) return;
  const { tier, cfg } = t;
  const attribution = pickAttribution(req.body && req.body.attribution);

  const session = await stripe.checkout.sessions.create({
   mode: 'payment',
   line_items: [{ price: cfg.price, quantity: 1 }],
   // Save card so the $95 flow can fire 1-click off-session $147 upsells.
   payment_intent_data: { setup_future_usage: 'off_session' },
   customer_creation: 'always',
   billing_address_collection: 'auto',
   success_url: cfg.successUrl,
   cancel_url: cfg.cancelPath,
   metadata: { funnel: 'zen-media-ai-visibility', tier, ...attribution },
  });

  res.json({ id: session.id, url: session.url });
 } catch (err) {
  console.error('[checkout/create-session] error', err);
  res.status(500).json({ error: err.message || 'failed to create session' });
 }
});

// Embedded Stripe Checkout. Returns a client_secret for stripe.initEmbeddedCheckout.
// Used by /pay-95 and /pay-495 branded payment pages.
router.post('/create-embedded', async (req, res) => {
 try {
  const t = resolveTier(req, res);
  if (!t) return;
  const { tier, cfg } = t;
  const attribution = pickAttribution(req.body && req.body.attribution);

  const session = await stripe.checkout.sessions.create({
   ui_mode: 'embedded',
   mode: 'payment',
   line_items: [{ price: cfg.price, quantity: 1 }],
   payment_intent_data: { setup_future_usage: 'off_session' },
   customer_creation: 'always',
   billing_address_collection: 'auto',
   return_url: cfg.successUrl,
   metadata: { funnel: 'zen-media-ai-visibility', tier, ...attribution },
  });

  res.json({
   id: session.id,
   client_secret: session.client_secret,
   publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
  });
 } catch (err) {
  console.error('[checkout/create-embedded] error', err);
  res.status(500).json({ error: err.message || 'failed to create embedded session' });
 }
});

export default router;
