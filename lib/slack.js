const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

export async function notify(payload) {
 if (!WEBHOOK_URL) {
  console.warn('[slack] SLACK_WEBHOOK_URL missing; skipping notification');
  return { ok: false, skipped: true };
 }
 const body = typeof payload === 'string' ? { text: payload } : payload;
 const res = await fetch(WEBHOOK_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
 });
 if (!res.ok) {
  const t = await res.text().catch(() => '');
  console.error('[slack] non-2xx', res.status, t);
 }
 return { ok: res.ok };
}

// Slack Block Kit purchase notification
export function fmtPurchase({ email, products, total, sessionId, attribution }) {
 const totalUSD = `$${(total / 100).toFixed(2)}`;
 const attrLines = formatAttributionLines(attribution);
 const blocks = [
  {
   type: 'header',
   text: { type: 'plain_text', text: '🟢 New Zen Media LP purchase', emoji: true },
  },
  {
   type: 'section',
   fields: [
    { type: 'mrkdwn', text: `*Total*\n${totalUSD}` },
    { type: 'mrkdwn', text: `*Buyer*\n${email || '_unknown_'}` },
   ],
  },
  {
   type: 'section',
   text: { type: 'mrkdwn', text: `*Products*\n${products.map(p => `• ${p}`).join('\n') || '_none_'}` },
  },
 ];
 if (attrLines) {
  blocks.push({
   type: 'section',
   text: { type: 'mrkdwn', text: `*Source*\n${attrLines}` },
  });
 }
 blocks.push({
  type: 'context',
  elements: [
   { type: 'mrkdwn', text: `Session: \`${sessionId}\`` },
  ],
 });
 return {
  text: `New Zen Media LP purchase — ${totalUSD} from ${email || 'unknown'}`,
  blocks,
 };
}

const ATTRIBUTION_DISPLAY = [
 ['utm_source', 'source'],
 ['utm_medium', 'medium'],
 ['utm_campaign', 'campaign'],
 ['utm_content', 'content'],
 ['utm_term', 'term'],
 ['gclid', 'gclid'],
 ['fbclid', 'fbclid'],
 ['ttclid', 'ttclid'],
 ['msclkid', 'msclkid'],
 ['irclickid', 'irclickid'],
 ['ref', 'ref'],
 ['landing_page', 'landing'],
];

function formatAttributionLines(attribution) {
 if (!attribution || typeof attribution !== 'object') return '';
 const lines = [];
 for (const [key, label] of ATTRIBUTION_DISPLAY) {
  const v = attribution[key];
  if (typeof v === 'string' && v.length) lines.push(`• ${label}: \`${v}\``);
 }
 return lines.length ? lines.join('\n') : '_(direct, no UTMs)_';
}

export { formatAttributionLines };

export function fmtUpsellCharged({ email, amount, sessionId }) {
 const amt = `$${(amount / 100).toFixed(2)}`;
 return {
  text: `Upsell charged — ${amt} from ${email || 'unknown'}`,
  blocks: [
   {
    type: 'header',
    text: { type: 'plain_text', text: '💸 Brand Reputation upsell charged', emoji: true },
   },
   {
    type: 'section',
    fields: [
     { type: 'mrkdwn', text: `*Amount*\n${amt}` },
     { type: 'mrkdwn', text: `*Buyer*\n${email || '_unknown_'}` },
    ],
   },
   {
    type: 'context',
    elements: [
     { type: 'mrkdwn', text: `Session: \`${sessionId}\`` },
    ],
   },
  ],
 };
}
