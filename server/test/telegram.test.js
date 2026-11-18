import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitText, smsMessages, callMessage, parseChatIds, CHAT_RE, esc } from '../src/tgformat.js';

test('short text stays in one piece', () => {
  assert.deepEqual(splitText('Your code is 4321'), ['Your code is 4321']);
});

test('long text is split under the limit, at spaces, and joins back to the same text', () => {
  const text = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ');
  const pieces = splitText(text, 1000);
  assert.ok(pieces.length > 1);
  for (const p of pieces) assert.ok(p.length <= 1000);
  for (const p of pieces.slice(0, -1)) assert.ok(p.endsWith(' '));
  assert.equal(pieces.join(''), text);
});

test('an emoji is never cut in half', () => {
  const text = 'a'.repeat(9) + '😀' + 'b'.repeat(20); // the emoji sits on the cut
  const pieces = splitText(text, 10);
  assert.equal(pieces.join(''), text);
  for (const p of pieces) assert.ok(!/[\uD800-\uDBFF]$/.test(p));
});

test('SMS notice: sender, line, joined parts, escaping, missing parts', () => {
  const [m] = smsMessages({ from: '+905551234567', text: 'a < b & c', line: 'Home · SIM 1 · Turkcell', parts: 3, note: '1 of 3 parts never arrived' });
  assert.match(m, /^📩 <b>\+905551234567<\/b>\n<i>Home · SIM 1 · Turkcell · 3 SMS joined<\/i>/);
  assert.ok(m.includes('a &lt; b &amp; c'));
  assert.ok(m.endsWith('⚠️ 1 of 3 parts never arrived'));
});

test('SMS longer than one Telegram message is numbered', () => {
  const ms = smsMessages({ from: 'Bank', text: 'x '.repeat(4000), line: 'Home · SIM 2' });
  assert.equal(ms.length, 3);
  assert.match(ms[0], /^📩 <b>Bank<\/b> \(1\/3\)/);
  assert.match(ms[2], /^📩 <b>Bank<\/b> \(3\/3\)/);
  for (const m of ms) assert.ok(m.length <= 4096);
});

test('SMS that arrives late shows when it was sent', () => {
  const sent = Date.UTC(2026, 10, 18, 9, 30);
  const [m] = smsMessages({ from: 'X', text: 'hi', line: 'L', smsTime: sent, receivedAt: sent + 3600_000, tz: 'UTC' });
  assert.match(m, /Sent 18 Nov 2026, 09:30/);
  const [now] = smsMessages({ from: 'X', text: 'hi', line: 'L', smsTime: sent, receivedAt: sent + 30_000 });
  assert.ok(!now.includes('Sent'));
  const [ahead] = smsMessages({ from: 'X', text: 'hi', line: 'L', smsTime: sent, receivedAt: sent - 3 * 3600_000 }); // operator clock ahead
  assert.ok(!ahead.includes('Sent'));
});

test('missed call notice and chat IDs', () => {
  assert.equal(callMessage({ number: '+90<5>', line: 'Home · SIM 1' }), '📞 Missed call from <b>+90&lt;5&gt;</b>\n<i>Home · SIM 1</i>');
  assert.deepEqual(parseChatIds(' 123, -1001234567890\n@my_channel 123 '), ['123', '-1001234567890', '@my_channel']);
  for (const ok of ['123456789', '-1001234567890', '@my_channel']) assert.ok(CHAT_RE.test(ok), ok);
  for (const bad of ['abc', '12a', '@ab', 'https://t.me/x']) assert.ok(!CHAT_RE.test(bad), bad);
  assert.equal(esc('<b>&'), '&lt;b&gt;&amp;');
});
