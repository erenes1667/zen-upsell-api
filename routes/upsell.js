import { Router } from 'express';
import { stripe } from '../lib/stripe.js';
import { notify, fmtUpsellCharged } from '../lib/slack.js';

const router = Router();

// Where buyers go after upsell-2 (Yes OR No). Per brief Part 7 step 9:
// straight to the Calendly booking page so they pick a slot immediately.
// Post-booking, Calendly's confirmation can route to /thank-you for the
// "Before You Join Your Strategy Call" content (configured in Calendly UI).
const REDIRECT_AFTER = process.env.CALENDLY_URL;
const PRICE_BRAND_REP_147 = process.env.STRIPE_PRICE_BRAND_REP_147;

router.post('/charge', async (req, res) => {
 const { session_id } = req.body || {};
 if (!session_id) {
  return res.status(400).json({ error: 'session_id is required' });
 }
 if (!PRICE_BRAND_REP_147) {
  return res.status(500).json({ error: 'STRIPE_PRICE_BRAND_REP_147 not configured' });
 }

 try {
  const session = await stripe.checkout.sessions.retrieve(session_id, {
   expand: ['customer', 'payment_intent.payment_method'],
  });

  if (!session) {
   return res.status(404).json({ error: 'session not found' });
  }
  if (session.payment_status !== 'paid') {
   return res.status(409).json({ error: 'original session not paid', status: session.payment_status });
  }

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const pm = session.payment_intent?.payment_method;
  const paymentMethodId = typeof pm === 'string' ? pm : pm?.id;

  if (!customerId || !paymentMethodId) {
   return res.status(409).json({ error: 'no saved customer or payment method on this session' });
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

  // Fire-and-forget Telegram (don't block buyer's redirect on it)
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
   redirect: REDIRECT_AFTER,
  });
 } catch (err) {
  console.error('[upsell-2/charge] error', err);
  // Stripe-specific authentication-required (3DS) — rare for already-saved cards but possible
  if (err.code === 'authentication_required' || err.raw?.code === 'authentication_required') {
   return res.status(402).json({
    error: 'card requires re-authentication',
    payment_intent: err.raw?.payment_intent?.id,
    redirect: REDIRECT_AFTER, // still let them book; we follow up out-of-band
   });
  }
  res.status(500).json({ error: err.message || 'charge failed', redirect: REDIRECT_AFTER });
 }
});

export default router;
