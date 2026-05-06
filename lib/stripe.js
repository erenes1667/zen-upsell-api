import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
 throw new Error('STRIPE_SECRET_KEY is not set');
}

const STRIPE_OPTS = {
 apiVersion: '2024-12-18.acacia',
 maxNetworkRetries: 2,
 timeout: 20_000,
};

export const stripe = new Stripe(key, STRIPE_OPTS);
export const isLiveKey = key.startsWith('sk_live_') || key.startsWith('rk_live_');

// Optional second client used by the ?stripe_mode=test toggle. Lets Burak
// (or anyone) hit the live URL with 4242 4242 4242 4242 by appending
// ?stripe_mode=test, without affecting live customers on default mode.
const testKey = process.env.STRIPE_SECRET_KEY_TEST;
export const hasTestKey = !!testKey && (testKey.startsWith('sk_test_') || testKey.startsWith('rk_test_'));
export const stripeTest = hasTestKey ? new Stripe(testKey, STRIPE_OPTS) : null;

export function pickStripe(mode) {
 if (mode === 'test') {
  if (!stripeTest) throw new Error('test mode not configured on this server (STRIPE_SECRET_KEY_TEST missing)');
  return stripeTest;
 }
 return stripe;
}

export function pickPublishableKey(mode) {
 if (mode === 'test') return process.env.STRIPE_PUBLISHABLE_KEY_TEST || process.env.STRIPE_PUBLISHABLE_TEST_KEY || null;
 return process.env.STRIPE_PUBLISHABLE_KEY || null;
}
