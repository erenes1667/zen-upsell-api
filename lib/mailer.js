// Mailgun-backed transactional email for internal lead notifications.
// Sends from MAILGUN_DOMAIN to NOTIFY_EMAIL_TO. Optional, no-ops if unconfigured.

const API_KEY = process.env.MAILGUN_API_KEY;
const DOMAIN = process.env.MAILGUN_DOMAIN;
const FROM = process.env.NOTIFY_EMAIL_FROM || 'Zen Media Notifications <no-reply@' + (DOMAIN || 'mg.zenmedia.com') + '>';
const TO = process.env.NOTIFY_EMAIL_TO;

export async function sendNotification({ subject, text, html }) {
 if (!API_KEY || !DOMAIN || !TO) {
  console.warn('[mailer] disabled (missing MAILGUN_API_KEY / MAILGUN_DOMAIN / NOTIFY_EMAIL_TO)');
  return { ok: false, skipped: true };
 }
 const form = new URLSearchParams();
 form.set('from', FROM);
 form.set('to', TO);
 form.set('subject', subject);
 if (text) form.set('text', text);
 if (html) form.set('html', html);

 const res = await fetch(`https://api.mailgun.net/v3/${DOMAIN}/messages`, {
  method: 'POST',
  headers: {
   Authorization: 'Basic ' + Buffer.from('api:' + API_KEY).toString('base64'),
   'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: form.toString(),
 });
 if (!res.ok) {
  const t = await res.text().catch(() => '');
  console.error('[mailer] non-2xx', res.status, t);
  return { ok: false, status: res.status };
 }
 return { ok: true };
}

export function fmtPurchaseEmail({ email, products, total, sessionId, tier }) {
 const totalUSD = `$${(total / 100).toFixed(2)}`;
 const productList = products && products.length ? products.join('\n  - ') : '(no line items)';
 const tierLabel = tier ? ` [${tier}]` : '';
 const stripeLink = `https://dashboard.stripe.com/${sessionId.startsWith('cs_test_') ? 'test/' : ''}checkout/sessions/${sessionId}`;

 const subject = `New Zen Media purchase, ${totalUSD} from ${email || 'unknown buyer'}${tierLabel}`;

 const text = [
  `New purchase came in for the AI Visibility funnel.`,
  ``,
  `Total: ${totalUSD}`,
  `Buyer: ${email || '(no email captured)'}`,
  `Tier: ${tier || '(unknown)'}`,
  `Products purchased:`,
  `  - ${productList}`,
  ``,
  `Session: ${sessionId}`,
  `Stripe Dashboard: ${stripeLink}`,
  ``,
  `Sales follow-up: reach out to the buyer within 1 business hour.`,
 ].join('\n');

 const html = `
<!DOCTYPE html>
<html><body style="font-family:'DM Sans',Arial,sans-serif;color:#111;background:#fafafa;padding:24px;">
 <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 1px 3px rgba(16,24,40,.08);">
  <div style="display:inline-block;background:#6f1fd4;color:#fff;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;padding:6px 14px;border-radius:99px;margin-bottom:16px;">New Purchase</div>
  <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:700;line-height:1.2;margin:0 0 6px;color:#111;">${totalUSD} from ${escapeHtml(email || 'unknown buyer')}</h1>
  <p style="margin:0 0 22px;color:#475467;font-size:14px;">AI Visibility funnel${tierLabel ? ' &middot; ' + escapeHtml(tier) : ''}</p>
  <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
   <tr><td style="padding:8px 0;border-bottom:1px solid #e5e5e5;color:#475467;font-size:13px;width:100px;">Total</td><td style="padding:8px 0;border-bottom:1px solid #e5e5e5;font-weight:700;">${totalUSD}</td></tr>
   <tr><td style="padding:8px 0;border-bottom:1px solid #e5e5e5;color:#475467;font-size:13px;">Buyer</td><td style="padding:8px 0;border-bottom:1px solid #e5e5e5;">${escapeHtml(email || '(no email captured)')}</td></tr>
   <tr><td style="padding:8px 0;border-bottom:1px solid #e5e5e5;color:#475467;font-size:13px;">Tier</td><td style="padding:8px 0;border-bottom:1px solid #e5e5e5;">${escapeHtml(tier || '(unknown)')}</td></tr>
   <tr><td style="padding:8px 0;color:#475467;font-size:13px;vertical-align:top;">Products</td><td style="padding:8px 0;"><ul style="margin:0;padding-left:18px;">${(products || []).map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul></td></tr>
  </table>
  <a href="${stripeLink}" style="display:inline-block;background:#6f1fd4;color:#fff;font-weight:700;padding:12px 22px;border-radius:8px;text-decoration:none;">Open in Stripe Dashboard &rarr;</a>
  <p style="margin:22px 0 0;color:#475467;font-size:13px;line-height:1.5;">Reach out to the buyer within 1 business hour. Slack channel pinged in parallel.</p>
  <p style="margin:18px 0 0;color:#9ca3af;font-size:11px;">Session ID: <code>${escapeHtml(sessionId)}</code></p>
 </div>
</body></html>`;

 return { subject, text, html };
}

function escapeHtml(s) {
 if (s === null || s === undefined) return '';
 return String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
}
