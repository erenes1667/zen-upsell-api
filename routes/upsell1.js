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
  return res.status(400).json({ error: 'session_id is required', redirect: REDIRECT_AFTER });
 }
 if (!PRICE_COMPETITOR_147) {
  return res.status(500).json({ error: 'STRIPE_PRICE_COMPETITOR_147 not configured', redirect: REDIRECT_AFTER });
 }

 try {
  const session = await stripe.checkout.sessions.retrieve(session_id, {
   expand: ['customer', 'payment_intent.payment_method'],
  });

  if (!session) return res.status(404).json({ error: 'session not found', redirect: REDIRECT_AFTER });
  if (session.payment_status !== 'paid') {
   return res.status(409).json({ error: 'original session not paid', status: session.payment_status, redirect: REDIRECT_AFTER });
  }

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const pm = session.payment_intent?.payment_method;
  const paymentMethodId = typeof pm === 'string' ? pm : pm?.id;

  if (!customerId || !paymentMethodId) {
   return res.status(409).json({ error: 'no saved customer or payment method', redirect: REDIRECT_AFTER });
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
   redirect,
  });
 } catch (err) {
  console.error('[upsell-1/charge] error', err);
  // Always pass session_id forward on the redirect so upsell-2 still works.
  const fallback = `${REDIRECT_AFTER}?session_id=${encodeURIComponent(session_id)}`;
  if (err.code === 'authentication_required' || err.raw?.code === 'authentication_required') {
   return res.status(402).json({
    error: 'card requires re-authentication',
    payment_intent: err.raw?.payment_intent?.id,
    redirect: fallback,
   });
  }
  res.status(500).json({ error: err.message || 'charge failed', redirect: fallback });
 }
});

export default router;
