import express from 'express';
import checkoutRouter from './routes/checkout.js';
import upsell1Router from './routes/upsell1.js';
import upsellRouter from './routes/upsell.js';
import webhookRouter from './routes/webhook.js';
import { isLiveKey } from './lib/stripe.js';

const app = express();

// CORS — allow the GHL hosts that serve the static LP HTML to call this API.
// Replace with the real GHL funnel URL once known. For now, permissive.
app.use((req, res, next) => {
 res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
 res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
 res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 if (req.method === 'OPTIONS') return res.sendStatus(204);
 next();
});

// Webhook MUST come before express.json() — it needs the raw body.
app.use('/api/stripe/webhook', webhookRouter);

// JSON body for all other routes
app.use(express.json());

app.get('/', (_req, res) => {
 res.json({
  name: 'zen-upsell-api',
  ok: true,
  mode: isLiveKey ? 'live' : 'test',
 });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/checkout', checkoutRouter);
app.use('/api/upsell-1', upsell1Router);
app.use('/api/upsell-2', upsellRouter);

// 404
app.use((req, res) => {
 res.status(404).json({ error: 'not found', path: req.path });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
 console.log(`[zen-upsell-api] listening on :${PORT} (mode=${isLiveKey ? 'live' : 'test'})`);
});
