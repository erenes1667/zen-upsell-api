import Stripe from 'stripe';

const STRIPE_OPTS = {
 apiVersion: '2024-12-18.acacia',
 maxNetworkRetries: 2,
 timeout: 20_000,
};

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
 throw new Error('STRIPE_SECRET_KEY is not set');
}

// Default ("zenmedia") Stripe client.
export const stripe = new Stripe(key, STRIPE_OPTS);
export const isLiveKey = key.startsWith('sk_live_') || key.startsWith('rk_live_');

// Optional Optimum7 client. Activated when STRIPE_SECRET_KEY_OPTIMUM7 is set.
// Tiers with `stripeAccount: 'optimum7'` route here. Tiers without the field
// (or with 'zenmedia') keep using the default `stripe` above.
const optimum7Key = process.env.STRIPE_SECRET_KEY_OPTIMUM7;
export const stripeOptimum7 = optimum7Key ? new Stripe(optimum7Key, STRIPE_OPTS) : null;
export const hasOptimum7Key = !!stripeOptimum7;

const ACCOUNTS = {
 zenmedia: () => stripe,
 optimum7: () => {
  if (!stripeOptimum7) throw new Error('optimum7 account not configured on this server (STRIPE_SECRET_KEY_OPTIMUM7 missing)');
  return stripeOptimum7;
 },
};

export function pickStripe(account) {
 const a = account || 'zenmedia';
 const fn = ACCOUNTS[a];
 if (!fn) throw new Error(`unknown stripe account: ${a}`);
 return fn();
}

export function pickPublishableKey(account) {
 const a = account || 'zenmedia';
 if (a === 'optimum7') return process.env.STRIPE_PUBLISHABLE_KEY_OPTIMUM7 || null;
 return process.env.STRIPE_PUBLISHABLE_KEY || null;
}
