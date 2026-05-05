import { Router } from 'express';
import { stripe } from '../lib/stripe.js';
import { sendNotification, fmtPurchaseEmail } from '../lib/mailer.js';
import { notify, fmtPurchase } from '../lib/slack.js';

const router = Router();

// Called from /thank-you-paid on page load. Aggregates the initial Checkout
// Session line items + any subsequent off-session PaymentIntents (the upsells)
// and sends ONE consolidated email. Idempotent via session.metadata.email_finalized.
router.post('/finalize', async (req, res) => {
 try {
  const { session_id } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'missing session_id' });

  const session = await stripe.checkout.sessions.retrieve(session_id, {
   expand: ['line_items'],
  });

  if (session.metadata?.email_finalized === 'true') {
   return res.json({ ok: true, alreadySent: true });
  }

  const tier = session.metadata?.tier || 'audit-95';
  const customerId = session.customer;
  const email = session.customer_details?.email;
  const sessionCreated = session.created;
  const attribution = pickAttributionFromMetadata(session.metadata);

  const products = [];
  let total = 0;

  // Initial purchase line items
  for (const li of session.line_items?.data || []) {
   products.push(`${li.description || li.price?.id} ($${(li.amount_total / 100).toFixed(2)})`);
   total += li.amount_total || 0;
  }

  // Subsequent off-session upsell PaymentIntents on this customer (audit-95 only).
  // Range [sessionCreated, now] catches /upsell-1 and /upsell-2 charges.
  if (customerId) {
   const pis = await stripe.paymentIntents.list({
    customer: customerId,
    created: { gte: sessionCreated },
    limit: 20,
   });
   for (const pi of pis.data) {
    if (pi.status !== 'succeeded') continue;
    // Skip the original Checkout Session payment, already counted via line_items.
    if (pi.metadata?.parent_session !== session_id) continue;
    const label = pi.description || pi.metadata?.tier || pi.id;
    products.push(`${label} ($${(pi.amount / 100).toFixed(2)})`);
    total += pi.amount || 0;
   }
  }

  const payload = { email, products, total, sessionId: session_id, tier, attribution };

  // Always send the consolidated email (Slack already pinged via webhook on initial)
  await sendNotification(fmtPurchaseEmail(payload));

  // Optional: also fire a Slack "order finalized" summary so the channel sees the full total
  await notify(fmtPurchase(payload)).catch(e => console.error('[order/finalize] slack failed', e));

  // Mark idempotent
  await stripe.checkout.sessions.update(session_id, {
   metadata: { ...session.metadata, email_finalized: 'true' },
  });

  res.json({ ok: true, productsCount: products.length, totalCents: total });
 } catch (err) {
  console.error('[order/finalize] error', err);
  res.status(500).json({ error: err.message || 'failed to finalize order' });
 }
});

const ATTRIBUTION_KEYS = [
 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
 'gclid', 'fbclid', 'ttclid', 'msclkid', 'irclickid', 'ref', 'landing_page',
];

function pickAttributionFromMetadata(metadata) {
 const out = {};
 if (!metadata) return out;
 for (const k of ATTRIBUTION_KEYS) {
  if (typeof metadata[k] === 'string' && metadata[k].length) out[k] = metadata[k];
 }
 return out;
}

export default router;
