import { Router } from 'express';
import { stripe } from '../lib/stripe.js';
import { notify, fmtUpsellCharged } from '../lib/slack.js';

const router = Router();

// Where buyers go after upsell-2 (Yes OR No). Per Enes 2026-05-03:
// /thank-you-paid is the post-purchase confirmation page (sales follows up via Slack).
// /thank-you is reserved for V1 (free webinar) post-Calendly bookings.
const REDIRECT_AFTER = process.env.THANK_YOU_URL || 'https://offer.zenmedia.com/thank-you-paid';
const PRICE_BRAND_REP_147 = process.env.STRIPE_PRICE_BRAND_REP_147;

router.post('/charge', async (req, res) => {
 const { session_id } = req.body || {};
 if (!session_id) {
  return res.status(400).json({ ok: false, code: 'missing_session_id', message: 'session_id is required', redirect: REDIRECT_AFTER });
 }
 if (!PRICE_BRAND_REP_147) {
  return res.status(500).json({ ok: false, code: 'price_unconfigured', message: 'STRIPE_PRICE_BRAND_REP_147 not configured', redirect: REDIRECT_AFTER });
 }

 try {
  const session = await stripe.checkout.sessions.retrieve(session_id, {
   expand: ['customer', 'payment_intent.payment_method'],
  });

  if (!session) {
   return res.status(404).json({ ok: false, code: 'session_not_found', message: 'session not found', redirect: REDIRECT_AFTER });
  }
  if (session.payment_status !== 'paid') {
   return res.status(409).json({ ok: false, code: 'session_not_paid', message: 'original session not paid', status: session.payment_status, redirect: REDIRECT_AFTER });
  }

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const pm = session.payment_intent?.payment_method;
  const paymentMethodId = typeof pm === 'string' ? pm : pm?.id;

  if (!customerId || !paymentMethodId) {
   return res.status(409).json({ ok: false, code: 'no_saved_card', message: 'no saved customer or payment method on this session', redirect: REDIRECT_AFTER });
  }

  const price = await stripe.prices.retrieve(PRICE_BRAND_REP_147);

  const intent = await stripe.paymentIntents.create({
   amount: price.unit_amount,
   currency: price.currency,
   customer: customerId,
   payment_method: paymentMethodId,
   off_session: true,
   confirm: true,
   description: 'Brand Reputation + Executive Audit (post-purchase upsell)',
   metadata: {
    funnel: 'zen-media-ai-visibility',
    tier: 'upsell-2-brand-rep',
    parent_session: session_id,
   },
  });

  // Fire-and-forget Slack (don't block buyer's redirect on it)
  const customerEmail = session.customer_details?.email || (typeof session.customer === 'object' ? session.customer.email : null);
  notify(fmtUpsellCharged({
   email: customerEmail,
   amount: price.unit_amount,
   sessionId: session_id,
  })).catch(e => console.error('[slack] notify failed', e));

  res.json({
   ok: true,
   payment_intent_id: intent.id,
   amount: price.unit_amount,
   currency: price.currency,
   tier: 'upsell-2-brand-rep',
   item_name: 'Brand Reputation + Executive Audit',
   redirect: REDIRECT_AFTER,
  });
 } catch (err) {
  console.error('[upsell-2/charge] error', err);
  const code = err.code || err.raw?.code || 'charge_failed';
  const declineCode = err.decline_code || err.raw?.decline_code || null;
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
    redirect: REDIRECT_AFTER,
   });
  }
  res.status(402).json({
   ok: false,
   code,
   decline_code: declineCode,
   message: err.message || 'Your card was declined.',
   redirect: REDIRECT_AFTER,
  });
 }
});

router.post('/retry', async (req, res) => {
 const { session_id } = req.body || {};
 if (!session_id) return res.status(400).json({ ok: false, code: 'missing_session_id', message: 'session_id is required' });
 if (!PRICE_BRAND_REP_147) return res.status(500).json({ ok: false, code: 'price_unconfigured', message: 'STRIPE_PRICE_BRAND_REP_147 not configured' });

 try {
  const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['customer'] });
  if (!session) return res.status(404).json({ ok: false, code: 'session_not_found', message: 'session not found' });
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (!customerId) return res.status(409).json({ ok: false, code: 'no_customer', message: 'no customer on this session' });

  const price = await stripe.prices.retrieve(PRICE_BRAND_REP_147);

  const intent = await stripe.paymentIntents.create({
   amount: price.unit_amount,
   currency: price.currency,
   customer: customerId,
   description: 'Brand Reputation + Executive Audit (retry, new card)',
   automatic_payment_methods: { enabled: true },
   setup_future_usage: 'off_session',
   metadata: {
    funnel: 'zen-media-ai-visibility',
    tier: 'upsell-2-brand-rep',
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
   tier: 'upsell-2-brand-rep',
   item_name: 'Brand Reputation + Executive Audit',
  });
 } catch (err) {
  console.error('[upsell-2/retry] error', err);
  res.status(500).json({ ok: false, code: err.code || 'retry_failed', message: err.message || 'failed to create retry intent' });
 }
});

export default router;
