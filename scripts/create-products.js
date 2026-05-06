// One-time: create Zen Media paid-funnel Stripe products + prices.
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
  description: '1,000 prompts tested across 3 AI engines (ChatGPT, Gemini, Grok). Live interactive dashboard. Raw prompt-and-response data exported. Branded vs non-branded citation breakdown per platform. Custom 7-day plan based on your audit findings.',
  amount: 9500,
 },
 {
  tier: 'sprint-495',
  name: 'AI Visibility Sprint',
  description: '1,000 prompts tested across 5 AI engines (ChatGPT, Claude, Gemini, Perplexity, Grok). Live interactive dashboard. Raw prompt-and-response data. Branded vs non-branded citation breakdown. Custom 7-day execution plan. Capped at 10 spots per month.',
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
 {
  tier: 'ai-pack-2500',
  name: 'AI Visibility Accelerator Pack',
  description: 'Sales-led custom engagement deposit. AI Visibility Accelerator Pack.',
  amount: 250000,
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
 let updated = false;
 if (!product) {
  product = await stripe.products.create({
   name,
   description,
   active: true,
   metadata: { tier, funnel: 'zen-media-ai-visibility' },
  });
  created = true;
 } else if (product.description !== description || product.name !== name) {
  product = await stripe.products.update(product.id, { name, description });
  updated = true;
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
 return { product, price, created, updated };
}

async function main() {
 console.log(`[create-products] mode=${isLiveKey ? 'live' : 'test'}`);
 const results = {};
 for (const def of PRODUCTS) {
  const { product, price, created, updated } = await ensureProduct(def);
  const status = created ? 'CREATED' : updated ? 'UPDATED' : 'EXISTS ';
  console.log(`${status}  ${def.tier}`);
  console.log(`  product: ${product.id}`);
  console.log(`  price:   ${price.id}`);
  results[def.tier] = { product: product.id, price: price.id, amount: def.amount };
 }
 const outPath = new URL('../.stripe-products.json', import.meta.url);
 fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
 console.log(`\n✓ wrote ${outPath.pathname}`);
 console.log('\nAdd these to .env:');
 console.log(`STRIPE_PRICE_AUDIT_95=${results['audit-95'].price}`);
 console.log(`STRIPE_PRICE_SPRINT_495=${results['sprint-495'].price}`);
 console.log(`STRIPE_PRICE_COMPETITOR_147=${results['competitor-comparison-147'].price}`);
 console.log(`STRIPE_PRICE_BRAND_REP_147=${results['brand-reputation-exec-147'].price}`);
 console.log(`STRIPE_PRICE_AI_PACK_2500=${results['ai-pack-2500'].price}`);
}

main().catch(e => {
 console.error(e);
 process.exit(1);
});
