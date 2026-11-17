// Outgoing webhooks: POST JSON to the URL set in the panel, signed with HMAC-SHA256.
import { createHmac } from 'node:crypto';
import { setting, persistentSecret, log } from './db.js';

export const EVENTS = ['sms.received', 'sms.sent', 'sms.failed', 'call.missed', 'device.offline', 'device.online'];
const RETRY_MS = [5_000, 30_000, 120_000];

export const webhookSecret = () => persistentSecret('webhook_secret', 24);

export function emit(event, data) {
  const url = setting('webhook_url');
  if (!url) return;
  const body = JSON.stringify({ event, time: new Date().toISOString(), data });
  deliver(url, event, body, 0).catch(() => {});
}

async function post(url, event, body) {
  const sig = 'sha256=' + createHmac('sha256', webhookSecret()).update(body).digest('hex');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Gateway-Event': event, 'X-Gateway-Signature': sig },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.status;
}

async function deliver(url, event, body, attempt) {
  try {
    await post(url, event, body);
  } catch (e) {
    if (attempt < RETRY_MS.length) setTimeout(() => deliver(url, event, body, attempt + 1), RETRY_MS[attempt]);
    else log(`Webhook ${event} to ${url} failed 4 times: ${e.message}`, { level: 'warn' });
  }
}

export async function testWebhook() {
  const url = setting('webhook_url');
  if (!url) return { ok: false, error: 'No webhook URL set' };
  const body = JSON.stringify({ event: 'test', time: new Date().toISOString(), data: { hello: 'from your SMS gateway' } });
  try {
    const status = await post(url, 'test', body);
    return { ok: true, status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
