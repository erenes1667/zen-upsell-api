import { Router } from 'express';
import { pickStripe, pickPublishableKey, hasTestKey } from '../lib/stripe.js';

const router = Router();

// Tier registry. Per Duran 2026-05-04:
//   audit-95   → keeps post-purchase upsells: /upsell-1 → /upsell-2 → /thank-you-paid
//   sprint-495 → one-time, no upsells: → /thank-you-paid directly
//   ai-pack-2500 → sales-led custom pay; client_reference_id REQUIRED for Salesforce.
// successUrl is per-tier so we don't need a single SUCCESS_URL env var.
// salesLed=true tiers REQUIRE client_reference_id and skip card-saving (no upsells).
// `priceTest` enables the ?stripe_mode=test toggle for QA on a live URL.
const TIERS = {
 'audit-95': {
  price: process.env.STRIPE_PRICE_AUDIT_95,
  priceTest: process.env.STRIPE_PRICE_AUDIT_95_TEST,
  successUrl: 'https://offer.zenmedia.com/upsell-1?session_id={CHECKOUT_SESSION_ID}',
  cancelPath: 'https://offer.zenmedia.com/95',
 },
 'sprint-495': {
  price: process.env.STRIPE_PRICE_SPRINT_495,
  priceTest: process.env.STRIPE_PRICE_SPRINT_495_TEST,
  successUrl: 'https://offer.zenmedia.com/thank-you-paid?session_id={CHECKOUT_SESSION_ID}',
  cancelPath: 'https://offer.zenmedia.com/495',
 },
 'ai-pack-2500': {
  price: process.env.STRIPE_PRICE_AI_PACK_2500,
  priceTest: process.env.STRIPE_PRICE_AI_PACK_2500_TEST,
  successUrl: 'https://zenmedia.com/pay/thank-you?session_id={CHECKOUT_SESSION_ID}',
  cancelPath: 'https://zenmedia.com/pay/ai-pack',
  salesLed: true,
 },
};

function resolveMode(req, res) {
 const m = req.body && req.body.mode;
 if (m && m !== 'live' && m !== 'test') {
  res.status(400).json({ error: `invalid mode: ${m}` });
  return null;
 }
 if (m === 'test' && !hasTestKey) {
  res.status(503).json({ error: 'test mode is not configured on this server' });
  return null;
 }
 return m === 'test' ? 'test' : 'live';
}

// client_reference_id round-trips a Salesforce Opportunity ID through Stripe.
// Stripe accepts up to 200 chars; restrict to safe ID-style chars to block injection.
const CLIENT_REF_RE = /^[A-Za-z0-9_-]{1,200}$/;
function validateClientReferenceId(raw) {
 if (typeof raw !== 'string') return null;
 const s = raw.trim();
 if (!s) return null;
 if (!CLIENT_REF_RE.test(s)) return null;
 return s;
}

function resolveTier(req, res, mode) {
 const tier = (req.body && req.body.tier) || 'audit-95';
 const cfg = TIERS[tier];
 if (!cfg) {
  res.status(400).json({ error: `Unknown tier: ${tier}` });
  return null;
 }
 const price = mode === 'test' ? cfg.priceTest : cfg.price;
 if (!price) {
  const envSuffix = mode === 'test' ? '_TEST' : '';
  res.status(500).json({ error: `Tier ${tier} has no Stripe price configured for ${mode} mode (env STRIPE_PRICE_${tier.toUpperCase().replace(/-/g, '_')}${envSuffix})` });
  return null;
 }
 return { tier, cfg, price };
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
  const mode = resolveMode(req, res);
  if (!mode) return;
  const t = resolveTier(req, res, mode);
  if (!t) return;
  const { tier, cfg, price } = t;
  const stripeClient = pickStripe(mode);
  const attribution = pickAttribution(req.body && req.body.attribution);
  const clientReferenceId = validateClientReferenceId(req.body && req.body.client_reference_id);
  if (cfg.salesLed && !clientReferenceId) {
   return res.status(400).json({ error: 'client_reference_id is required for this tier' });
  }

  const params = {
   mode: 'payment',
   line_items: [{ price, quantity: 1 }],
   customer_creation: 'always',
   billing_address_collection: 'auto',
   success_url: cfg.successUrl,
   cancel_url: cfg.cancelPath,
   metadata: { funnel: 'zen-media-ai-visibility', tier, stripe_mode: mode, ...attribution },
  };
  // Only save card on funnels that fire follow-up off-session charges (audit-95 upsells).
  // Sales-led tiers are one-and-done; saving the card is unnecessary friction.
  if (!cfg.salesLed) {
   params.payment_intent_data = { setup_future_usage: 'off_session' };
  }
  if (clientReferenceId) params.client_reference_id = clientReferenceId;

  const session = await stripeClient.checkout.sessions.create(params);

  res.json({ id: session.id, url: session.url });
 } catch (err) {
  console.error('[checkout/create-session] error', err);
  res.status(500).json({ error: err.message || 'failed to create session' });
 }
});

// Embedded Stripe Checkout. Returns a client_secret for stripe.initEmbeddedCheckout.
// Used by /pay-95, /pay-495, and /pay/ai-pack branded payment pages.
router.post('/create-embedded', async (req, res) => {
 try {
  const mode = resolveMode(req, res);
  if (!mode) return;
  const t = resolveTier(req, res, mode);
  if (!t) return;
  const { tier, cfg, price } = t;
  const stripeClient = pickStripe(mode);
  const attribution = pickAttribution(req.body && req.body.attribution);
  const clientReferenceId = validateClientReferenceId(req.body && req.body.client_reference_id);
  if (cfg.salesLed && !clientReferenceId) {
   return res.status(400).json({ error: 'client_reference_id is required for this tier' });
  }

  const params = {
   ui_mode: 'embedded',
   mode: 'payment',
   line_items: [{ price, quantity: 1 }],
   customer_creation: 'always',
   billing_address_collection: 'auto',
   return_url: cfg.successUrl,
   metadata: { funnel: 'zen-media-ai-visibility', tier, stripe_mode: mode, ...attribution },
  };
  if (!cfg.salesLed) {
   params.payment_intent_data = { setup_future_usage: 'off_session' };
  }
  if (clientReferenceId) params.client_reference_id = clientReferenceId;

  const session = await stripeClient.checkout.sessions.create(params);

  res.json({
   id: session.id,
   client_secret: session.client_secret,
   publishable_key: pickPublishableKey(mode),
   mode,
  });
 } catch (err) {
  console.error('[checkout/create-embedded] error', err);
  res.status(500).json({ error: err.message || 'failed to create embedded session' });
 }
});

export default router;
