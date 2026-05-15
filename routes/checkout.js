import { Router } from 'express';
import { pickStripe, pickPublishableKey } from '../lib/stripe.js';

const router = Router();

// Tier registry. Per Duran:
//   audit-95   → keeps post-purchase upsells: /upsell-1 → /upsell-2 → /thank-you-paid
//   sprint-495 → one-time, no upsells: → /thank-you-paid directly
//   ai-pack-2500 → branded /pay/ai-pack checkout page on zenmedia.com.
//                  Anyone can use it; client_reference_id (Salesforce Opp ID)
//                  is accepted and round-tripped when present, but optional.
//   migration-audit-495 → Optimum7 Migration Accelerator Pack audit. One-time, no upsells.
//                  Funnel host is TBD (offer.optimum7.com vs optimum7.com/migration-...).
//                  Default success/cancel URLs use offer.optimum7.com; flip to the WP host
//                  if Q1 lands on optimum7.com/migration-accelerator-pack.
// successUrl is per-tier so we don't need a single SUCCESS_URL env var.
// salesLed=true skips card-saving (no follow-up off-session charges expected).
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
 'ai-pack-2500': {
  price: process.env.STRIPE_PRICE_AI_PACK_2500,
  successUrl: 'https://zenmedia.com/pay/thank-you?session_id={CHECKOUT_SESSION_ID}',
  cancelPath: 'https://zenmedia.com/pay/ai-pack',
  salesLed: true,
 },
 // Per Duran 2026-05-12: Migration Pack moved from Zen Media to Optimum7.
 // Routes to the Optimum7 Stripe account via the multi-account pattern.
 'migration-pack-2500': {
  price: process.env.STRIPE_PRICE_MIGRATION_PACK_2500,
  successUrl: 'https://optimum7.com/pay/thank-you?session_id={CHECKOUT_SESSION_ID}',
  cancelPath: 'https://optimum7.com/pay/migration-pack',
  salesLed: true,
  stripeAccount: 'optimum7',
 },
 // Per Duran 2026-05-15: Migration Audit (deposit tier) lives on Optimum7 Stripe.
 // GHL slugs verified live: /migration-bundle → /payment-migration-audit → /checkout-complete.
 'migration-audit-495': {
  price: process.env.STRIPE_PRICE_MIGRATION_AUDIT_495,
  successUrl: 'https://offer.optimum7.com/checkout-complete?session_id={CHECKOUT_SESSION_ID}',
  cancelPath: 'https://offer.optimum7.com/migration-bundle',
  stripeAccount: 'optimum7',
 },
};

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

function resolveTier(req, res) {
 const tier = (req.body && req.body.tier) || 'audit-95';
 const cfg = TIERS[tier];
 if (!cfg) {
  res.status(400).json({ error: `Unknown tier: ${tier}` });
  return null;
 }
 if (!cfg.price) {
  res.status(500).json({ error: `Tier ${tier} has no Stripe price configured (env STRIPE_PRICE_${tier.toUpperCase().replace(/-/g, '_')})` });
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

// `metadata.funnel` differentiates the brand at the SF / reporting layer.
// Tiers default to zen-media unless their config opts into a different funnel
// label (typically aligned with the stripeAccount routing).
function funnelLabel(cfg) {
 if (cfg.stripeAccount === 'optimum7') return 'optimum7-custom-pay';
 return 'zen-media-ai-visibility';
}

// Hosted Stripe Checkout (back-compat). Returns a redirect URL.
router.post('/create-session', async (req, res) => {
 try {
  const t = resolveTier(req, res);
  if (!t) return;
  const { tier, cfg } = t;
  const stripeClient = pickStripe(cfg.stripeAccount);
  const attribution = pickAttribution(req.body && req.body.attribution);
  const clientReferenceId = validateClientReferenceId(req.body && req.body.client_reference_id);

  const params = {
   mode: 'payment',
   line_items: [{ price: cfg.price, quantity: 1 }],
   customer_creation: 'always',
   billing_address_collection: 'auto',
   success_url: cfg.successUrl,
   cancel_url: cfg.cancelPath,
   metadata: { funnel: funnelLabel(cfg), tier, ...attribution },
  };
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
// Used by /pay-95, /pay-495, /pay/ai-pack (zenmedia), /pay/migration-pack (optimum7).
router.post('/create-embedded', async (req, res) => {
 try {
  const t = resolveTier(req, res);
  if (!t) return;
  const { tier, cfg } = t;
  const stripeClient = pickStripe(cfg.stripeAccount);
  const attribution = pickAttribution(req.body && req.body.attribution);
  const clientReferenceId = validateClientReferenceId(req.body && req.body.client_reference_id);

  const params = {
   ui_mode: 'embedded',
   mode: 'payment',
   line_items: [{ price: cfg.price, quantity: 1 }],
   customer_creation: 'always',
   billing_address_collection: 'auto',
   return_url: cfg.successUrl,
   metadata: { funnel: funnelLabel(cfg), tier, ...attribution },
  };
  if (!cfg.salesLed) {
   params.payment_intent_data = { setup_future_usage: 'off_session' };
  }
  if (clientReferenceId) params.client_reference_id = clientReferenceId;

  const session = await stripeClient.checkout.sessions.create(params);

  res.json({
   id: session.id,
   client_secret: session.client_secret,
   publishable_key: pickPublishableKey(cfg.stripeAccount),
  });
 } catch (err) {
  console.error('[checkout/create-embedded] error', err);
  res.status(500).json({ error: err.message || 'failed to create embedded session' });
 }
});

export default router;
