// Upsell 1 — Competitor Visibility Comparison ($147), first sequential post-purchase upsell.
// Off-session charge against the saved card from the original $95 checkout.
// On Yes (charge) → redirect to /upsell-2 (next upsell). On any failure → still /upsell-2.
//
// Per Duran 2026-05-01: each upsell is its own focused page with a single Yes/No.
// No bundling, no order bump on the Stripe checkout itself.

import { Router } from 'express';
import { stripe } from '../lib/stripe.js';
import { notify } from '../lib/slack.js';

const router = Router();

const REDIRECT_AFTER = process.env.UPSELL_2_URL || 'https://offer.zenmedia.com/upsell-2';
const PRICE_COMPETITOR_147 = process.env.STRIPE_PRICE_COMPETITOR_147;

router.post('/charge', async (req, res) => {
 const { session_id } = req.body || {};
 if (!session_id) {
  return res.status(400).json({ ok: false, code: 'missing_session_id', message: 'session_id is required', redirect: REDIRECT_AFTER });
 }
 if (!PRICE_COMPETITOR_147) {
  return res.status(500).json({ ok: false, code: 'price_unconfigured', message: 'STRIPE_PRICE_COMPETITOR_147 not configured', redirect: REDIRECT_AFTER });
 }

 try {
  const session = await stripe.checkout.sessions.retrieve(session_id, {
   expand: ['customer', 'payment_intent.payment_method'],
  });

  if (!session) return res.status(404).json({ ok: false, code: 'session_not_found', message: 'session not found', redirect: REDIRECT_AFTER });
  if (session.payment_status !== 'paid') {
   return res.status(409).json({ ok: false, code: 'session_not_paid', message: 'original session not paid', status: session.payment_status, redirect: REDIRECT_AFTER });
  }

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const pm = session.payment_intent?.payment_method;
  const paymentMethodId = typeof pm === 'string' ? pm : pm?.id;

  if (!customerId || !paymentMethodId) {
   return res.status(409).json({ ok: false, code: 'no_saved_card', message: 'no saved customer or payment method', redirect: REDIRECT_AFTER });
  }

  const price = await stripe.prices.retrieve(PRICE_COMPETITOR_147);

  const intent = await stripe.paymentIntents.create({
   amount: price.unit_amount,
   currency: price.currency,
   customer: customerId,
   payment_method: paymentMethodId,
   off_session: true,
   confirm: true,
   description: 'Competitor Visibility Comparison (post-purchase upsell 1)',
   metadata: {
    funnel: 'zen-media-ai-visibility',
    tier: 'upsell-1-competitor',
    parent_session: session_id,
   },
  });

  // Pass session_id forward so upsell-2 can use the same saved card.
  const redirect = `${REDIRECT_AFTER}?session_id=${encodeURIComponent(session_id)}`;

  const customerEmail = session.customer_details?.email || (typeof session.customer === 'object' ? session.customer.email : null);
  notify({
   text: `Upsell 1 charged: ${customerEmail || 'unknown'} +$${(price.unit_amount / 100).toFixed(2)}`,
   blocks: [
    { type: 'header', text: { type: 'plain_text', text: '💸 Upsell 1 charged (Competitor Comparison)', emoji: true } },
    { type: 'section', fields: [
     { type: 'mrkdwn', text: `*Amount*\n$${(price.unit_amount / 100).toFixed(2)}` },
     { type: 'mrkdwn', text: `*Buyer*\n${customerEmail || '_unknown_'}` },
    ]},
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Session: \`${session_id}\`` }] },
   ],
  }).catch(e => console.error('[slack] notify failed', e));

  res.json({
   ok: true,
   payment_intent_id: intent.id,
   amount: price.unit_amount,
   currency: price.currency,
   tier: 'upsell-1-competitor',
   item_name: 'Competitor Visibility Comparison',
   redirect,
  });
 } catch (err) {
  console.error('[upsell-1/charge] error', err);
  const fallback = `${REDIRECT_AFTER}?session_id=${encodeURIComponent(session_id)}`;
  const code = err.code || err.raw?.code || 'charge_failed';
  const declineCode = err.decline_code || err.raw?.decline_code || null;
  // Card needs 3DS — return the existing PI's client_secret so the page can confirm in-browser
  if (code === 'authentication_required') {
   const piId = err.raw?.payment_intent?.id;
   let clientSecret = null;
   if (piId) {
    try { clientSecret = (await stripe.paymentIntents.retrieve(piId)).client_secret; } catch(e){}
   }
   return res.status(402).json({
    ok: false,
    code: 'authentication_required',
    message: 'Your card requires verification with your bank.',
    payment_intent_id: piId,
    payment_intent_client_secret: clientSecret,
    redirect: fallback,
   });
  }
  // Card declined / insufficient funds / expired etc. — let the page collect a fresh card
  res.status(402).json({
   ok: false,
   code,
   decline_code: declineCode,
   message: err.message || 'Your card was declined.',
   redirect: fallback,
  });
 }
});

// /retry — buyer's first card was declined, they want to try a different card.
// Creates an in-session PaymentIntent (so they can confirm with stripe.confirmPayment in the browser).
// Saves the new payment_method for future off-session use, so upsell-2 can reuse it.
router.post('/retry', async (req, res) => {
 const { session_id } = req.body || {};
 if (!session_id) return res.status(400).json({ ok: false, code: 'missing_session_id', message: 'session_id is required' });
 if (!PRICE_COMPETITOR_147) return res.status(500).json({ ok: false, code: 'price_unconfigured', message: 'STRIPE_PRICE_COMPETITOR_147 not configured' });

 try {
  const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['customer'] });
  if (!session) return res.status(404).json({ ok: false, code: 'session_not_found', message: 'session not found' });
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (!customerId) return res.status(409).json({ ok: false, code: 'no_customer', message: 'no customer on this session' });

  const price = await stripe.prices.retrieve(PRICE_COMPETITOR_147);

  const intent = await stripe.paymentIntents.create({
   amount: price.unit_amount,
   currency: price.currency,
   customer: customerId,
   description: 'Competitor Visibility Comparison (retry, new card)',
   automatic_payment_methods: { enabled: true },
   setup_future_usage: 'off_session', // save the new card so upsell-2 can use it
   metadata: {
    funnel: 'zen-media-ai-visibility',
    tier: 'upsell-1-competitor',
    parent_session: session_id,
    retry: 'true',
   },
  });

  res.json({
   ok: true,
   payment_intent_id: intent.id,
   client_secret: intent.client_secret,
   publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
   amount: price.unit_amount,
   currency: price.currency,
   tier: 'upsell-1-competitor',
   item_name: 'Competitor Visibility Comparison',
  });
 } catch (err) {
  console.error('[upsell-1/retry] error', err);
  res.status(500).json({ ok: false, code: err.code || 'retry_failed', message: err.message || 'failed to create retry intent' });
 }
});

export default router;
