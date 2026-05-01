import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
 throw new Error('STRIPE_SECRET_KEY is not set');
}

export const stripe = new Stripe(key, {
 apiVersion: '2024-12-18.acacia',
 maxNetworkRetries: 2,
 timeout: 20_000,
});

export const isLiveKey = key.startsWith('sk_live_') || key.startsWith('rk_live_');
