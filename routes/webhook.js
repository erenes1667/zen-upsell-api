import { Router, raw } from 'express';
import { stripe } from '../lib/stripe.js';
import { notify, fmtPurchase } from '../lib/slack.js';
import { sendNotification, fmtPurchaseEmail } from '../lib/mailer.js';

const router = Router();

const SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Stripe requires the raw body to verify the signature.
router.post('/', raw({ type: 'application/json' }), async (req, res) => {
 if (!SECRET) {
  console.error('[webhook] STRIPE_WEBHOOK_SECRET not set');
  return res.status(500).send('webhook secret not configured');
 }

 const sig = req.headers['stripe-signature'];
 let event;
 try {
  event = stripe.webhooks.constructEvent(req.body, sig, SECRET);
 } catch (err) {
  console.error('[webhook] signature verification failed', err.message);
  return res.status(400).send(`Webhook signature error: ${err.message}`);
 }

 try {
  switch (event.type) {
   case 'checkout.session.completed': {
    const session = event.data.object;
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 20 });
    const products = items.data.map(i => `${i.description || i.price?.id} ($${(i.amount_total / 100).toFixed(2)})`);
    const payload = {
     email: session.customer_details?.email,
     products,
     total: session.amount_total,
     sessionId: session.id,
     tier: session.metadata?.tier,
    };
    // Slack always fires immediately so sales sees the lead in real time.
    // Email only fires here for sprint-495 (no upsells coming).
    // For audit-95, /api/order/finalize sends a consolidated email after upsells settle.
    const ops = [notify(fmtPurchase(payload))];
    if (payload.tier === 'sprint-495') {
     ops.push(sendNotification(fmtPurchaseEmail(payload)));
    }
    await Promise.allSettled(ops);
    break;
   }
   case 'payment_intent.succeeded': {
    // Already handled by /upsell-2/charge for the upsell intent — no double-notify
    // unless this is some other PI. Filter on metadata.
    const pi = event.data.object;
    if (pi.metadata?.tier === 'upsell-2-brand-rep') break; // already notified inline
    break;
   }
   default:
    // Other events ignored for now
    break;
  }
  res.json({ received: true });
 } catch (err) {
  console.error('[webhook] handler error', err);
  res.status(500).json({ error: err.message });
 }
});

export default router;
