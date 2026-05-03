// One-time: create the two $147 Stripe products + prices.
// Idempotent — checks Product metadata.tier before creating.
// Safe in live mode: products do not charge anything until used in a Checkout Session or PaymentIntent.
//
// Usage: node scripts/create-products.js
// Writes IDs to ./.stripe-products.json (gitignored).

import { stripe, isLiveKey } from '../lib/stripe.js';
import fs from 'node:fs';

const PRODUCTS = [
 {
  tier: 'audit-95',
  name: 'AI Visibility Audit',
  description: '1,000 prompts tested across 5 AI engines (ChatGPT, Claude, Gemini, Perplexity, Grok). Live interactive dashboard. Raw prompt-and-response data exported (5,000 total AI responses). Branded vs non-branded citation breakdown per platform. 30-minute strategy call walking you through every gap and your custom 7-day plan.',
  amount: 9500,
 },
 {
  tier: 'sprint-495',
  name: 'AI Visibility Sprint',
  description: 'Everything in the AI Visibility Audit plus a custom 7-day execution plan and a 60-minute strategy call. 1,000 prompts across 5 AI engines, raw verification data, branded vs non-branded citation breakdown, and the full sprint roadmap.',
  amount: 49500,
 },
 {
  tier: 'competitor-comparison-147',
  name: 'Competitor Visibility Comparison',
  description: '1,000-prompt comparison across 5 AI engines (you vs. up to 3 competitors). Topic cluster ownership map. Top 25 priority gaps. Full raw data export. Delivered alongside base audit.',
  amount: 14700,
 },
 {
  tier: 'brand-reputation-exec-147',
  name: 'Brand Reputation + Executive Audit',
  description: 'Sentiment sweep across Reddit, reviews, social, AI engines. Volume + trajectory of mentions (90 days). Top 5 negative + positive narratives. AI perception snapshot. Plus: LinkedIn / personal AI visibility / reverse image / AI perception summary for up to 4 named executives.',
  amount: 14700,
 },
];

async function findExisting(tier) {
 const search = await stripe.products.search({
  query: `metadata['tier']:'${tier}' AND active:'true'`,
  limit: 1,
 });
 return search.data[0] || null;
}

async function ensureProduct({ tier, name, description, amount }) {
 let product = await findExisting(tier);
 let created = false;
 if (!product) {
  product = await stripe.products.create({
   name,
   description,
   active: true,
   metadata: { tier, funnel: 'zen-media-ai-visibility' },
  });
  created = true;
 }
 // Find an existing active price matching the amount/currency
 const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
 let price = prices.data.find(p => p.unit_amount === amount && p.currency === 'usd' && p.type === 'one_time');
 if (!price) {
  price = await stripe.prices.create({
   product: product.id,
   unit_amount: amount,
   currency: 'usd',
   metadata: { tier, funnel: 'zen-media-ai-visibility' },
  });
 }
 return { product, price, created };
}

async function main() {
 console.log(`[create-products] mode=${isLiveKey ? 'live' : 'test'}`);
 const results = {};
 for (const def of PRODUCTS) {
  const { product, price, created } = await ensureProduct(def);
  console.log(`${created ? 'CREATED' : 'EXISTS '}  ${def.tier}`);
  console.log(`  product: ${product.id}`);
  console.log(`  price:   ${price.id}`);
  results[def.tier] = { product: product.id, price: price.id, amount: def.amount };
 }
 const outPath = new URL('../.stripe-products.json', import.meta.url);
 fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
 console.log(`\n✓ wrote ${outPath.pathname}`);
 console.log('\nAdd these to .env:');
 console.log(`STRIPE_PRICE_AUDIT_95=${results['audit-95'].price}`);
 console.log(`STRIPE_PRICE_COMPETITOR_147=${results['competitor-comparison-147'].price}`);
 console.log(`STRIPE_PRICE_BRAND_REP_147=${results['brand-reputation-exec-147'].price}`);
}

main().catch(e => {
 console.error(e);
 process.exit(1);
});
