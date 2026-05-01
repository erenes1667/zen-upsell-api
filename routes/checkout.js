import { Router } from 'express';
import { stripe } from '../lib/stripe.js';

const router = Router();

const CALENDLY = process.env.CALENDLY_URL;
const SUCCESS = process.env.SUCCESS_URL;
const CANCEL = process.env.CANCEL_URL;

const PRICE_AUDIT_95 = process.env.STRIPE_PRICE_AUDIT_95;

router.post('/create-session', async (req, res) => {
 try {
  if (!PRICE_AUDIT_95) {
   return res.status(500).json({ error: 'STRIPE_PRICE_AUDIT_95 not configured' });
  }
  if (!SUCCESS || !CANCEL) {
   return res.status(500).json({ error: 'SUCCESS_URL or CANCEL_URL not configured' });
  }

  // Per Duran 2026-05-01: no order bump on Stripe Checkout. Both $147 upsells
  // are presented as sequential post-purchase pages (Upsell 1 = Competitor,
  // Upsell 2 = Brand Reputation), each with its own Yes/No decision.
  const session = await stripe.checkout.sessions.create({
   mode: 'payment',
   line_items: [
    { price: PRICE_AUDIT_95, quantity: 1 },
   ],
   // Save the card for the sequential 1-click upsells.
   payment_intent_data: {
    setup_future_usage: 'off_session',
   },
   customer_creation: 'always',
   billing_address_collection: 'auto',
   success_url: `${SUCCESS}?session_id={CHECKOUT_SESSION_ID}`,
   cancel_url: CANCEL,
   metadata: {
    funnel: 'zen-media-ai-visibility',
    tier: 'audit-95',
   },
  });

  res.json({ id: session.id, url: session.url });
 } catch (err) {
  console.error('[checkout/create-session] error', err);
  res.status(500).json({ error: err.message || 'failed to create session' });
 }
});

export default router;
