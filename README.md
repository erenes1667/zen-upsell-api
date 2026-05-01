# zen-upsell-api

Stripe Checkout + post-purchase upsell + Slack incoming-webhook SDR notifications for the Zen Media AI Visibility Accelerator landing page funnel.

Static LP HTML lives at `../dist/final/`. This API serves the dynamic checkout / upsell / webhook bits that the LP HTML cannot do on its own.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/checkout/create-session` | Creates a Stripe Checkout Session for the $95 audit, with the $147 Competitor Comparison as an `optional_items` order bump. Sets `setup_future_usage=off_session` so the card is saved for the post-purchase upsell. Returns `{ id, url }`; the LP redirects the buyer to `url`. |
| POST | `/api/upsell-2/charge` | Body: `{ session_id }`. Pulls Customer + saved payment method from the original Checkout Session, creates a $147 PaymentIntent off-session. On success: Slack ping + redirect to Calendly. |
| POST | `/api/stripe/webhook` | Stripe webhook: listens for `checkout.session.completed` and posts Block Kit message to Slack via `SLACK_WEBHOOK_URL`. Verifies signature with `STRIPE_WEBHOOK_SECRET`. |
| GET | `/health` | Liveness check for Railway. |
| GET | `/` | Mode + identity. |

## Local dev

```bash
cp .env.example .env
# Fill in STRIPE_SECRET_KEY (use sk_test_... for dev), SLACK_WEBHOOK_URL, prices, URLs.
npm install
npm run create:products   # one-time: creates the two $147 products in Stripe
# Copy the printed STRIPE_PRICE_COMPETITOR_147 and STRIPE_PRICE_BRAND_REP_147 into .env
npm run dev
```

To test the webhook locally:

```bash
brew install stripe/stripe-cli/stripe
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
# Copy the whsec_... it prints into STRIPE_WEBHOOK_SECRET in .env
```

## Deploy to Railway

1. Push this `api/` directory as its own repo (or as a subfolder of the LP repo with Railway root set to `api/`).
2. Connect Railway → GitHub.
3. Set env vars in Railway dashboard: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `SLACK_WEBHOOK_URL`, `SUCCESS_URL`, `CANCEL_URL`, `CALENDLY_URL`, `CORS_ORIGIN`.
4. Get Railway public URL.
5. Stripe Dashboard → Developers → Webhooks → Add endpoint pointing at `https://<railway-url>/api/stripe/webhook`. Listen for `checkout.session.completed` and `payment_intent.succeeded`. Copy `whsec_...` and paste into Railway env as `STRIPE_WEBHOOK_SECRET`.

## Wiring into the static LP

In `dist/final/landing-page-v2.html`, the existing Stripe Payment Link button gets replaced with a fetch:

```html
<button type="button" class="btn-green stripe-pay-link" id="btnPay95">
 <span>Pay $95 Securely</span>
 <span class="stripe-pay-link__lock">🔒</span>
</button>

<script>
 document.getElementById('btnPay95').addEventListener('click', async () => {
  const r = await fetch('https://<api-url>/api/checkout/create-session', { method: 'POST' });
  const { url, error } = await r.json();
  if (error) { alert(error); return; }
  window.location.href = url;
 });
</script>
```

In `dist/concepts/upsell-2.html`, the dev stub gets replaced with:

```js
const sessionId = new URLSearchParams(location.search).get('session_id');
btnYes.addEventListener('click', async () => {
 const r = await fetch('https://<api-url>/api/upsell-2/charge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ session_id: sessionId }),
 });
 const j = await r.json();
 window.location.href = j.redirect; // success or graceful failure both go to Calendly
});
```

## Constraints

- The webhook route is mounted BEFORE `express.json()` so Stripe signature verification gets the raw body.
- We use `setup_future_usage=off_session` on the original `payment_intent_data` so the card is saved during the $95 checkout. The upsell charge then uses `off_session: true, confirm: true` against that saved payment method.
- 3DS / `authentication_required` responses on the upsell are caught and routed to Calendly anyway — buyer never gets stuck on the upsell page.
- Live mode is detected from the Stripe key prefix (`sk_live_` or `rk_live_`) and printed at startup.

## Memory / context

- Existing Stripe products from prior session: `~/.claude/projects/-Users-eneseren-vault/memory/zen_media_lp_stripe_products.md`
- Anti-AI-slop rule: every CTA on `upsell-2.html` resolves to a real backend — no dead buttons.
- Hard rule: never deploy via Railway CLI; always GitHub → Railway auto-deploy.
