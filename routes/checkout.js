import { Router } from 'express';
import { stripe } from '../lib/stripe.js';

const router = Router();

const CALENDLY = process.env.CALENDLY_URL;
const SUCCESS = process.env.SUCCESS_URL;
const CANCEL = process.env.CANCEL_URL;

// Tier registry. Both AI Visibility tiers route to /upsell-1 then /upsell-2
// (the post-purchase upsell sequence), regardless of entry price.
const TIERS = {
 'audit-95': {
  price: process.env.STRIPE_PRICE_AUDIT_95,
  cancelPath: process.env.CANCEL_URL,
 },
 'sprint-495': {
  price: process.env.STRIPE_PRICE_SPRINT_495,
  cancelPath: 'https://offer.zenmedia.com/495',
 },
};

router.post('/create-session', async (req, res) => {
 try {
  const tier = (req.body && req.body.tier) || 'audit-95';
  const cfg = TIERS[tier];
  if (!cfg) {
   return res.status(400).json({ error: `Unknown tier: ${tier}` });
  }
  if (!cfg.price) {
   return res.status(500).json({ error: `Tier ${tier} has no Stripe price configured (env STRIPE_PRICE_${tier.toUpperCase().replace('-','_')})` });
  }
  if (!SUCCESS) {
   return res.status(500).json({ error: 'SUCCESS_URL not configured' });
  }

  const session = await stripe.checkout.sessions.create({
   mode: 'payment',
   line_items: [{ price: cfg.price, quantity: 1 }],
   // Save the card for the sequential 1-click upsells (same across tiers).
   payment_intent_data: { setup_future_usage: 'off_session' },
   customer_creation: 'always',
   billing_address_collection: 'auto',
   success_url: `${SUCCESS}?session_id={CHECKOUT_SESSION_ID}`,
   cancel_url: cfg.cancelPath,
   metadata: {
    funnel: 'zen-media-ai-visibility',
    tier,
   },
  });

  res.json({ id: session.id, url: session.url });
 } catch (err) {
  console.error('[checkout/create-session] error', err);
  res.status(500).json({ error: err.message || 'failed to create session' });
 }
});

export default router;
