import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitText, smsMessages, callMessage, parseChatIds, CHAT_RE, esc, statsMessage, deviceAlert, signalAlert, duration, findCode, parseList, sameSender, skipReason } from '../src/tgformat.js';

test('filters: senders written either way, words, only codes', () => {
  assert.deepEqual(parseList('Promo, +1 555 000 1111\nAd;Promo'), ['Promo', '+1 555 000 1111', 'Ad']);
  assert.ok(sameSender('MyBank', 'mybank'));
  assert.ok(sameSender('+1 (555) 000-1111', '15550001111'));
  assert.ok(sameSender('07700900123', '+447700900123')); // local and international (UK numbers for fiction)
  assert.ok(!sameSender('1111', '+15550001111')); // too short to tell
  assert.ok(!sameSender('Bank', 'MyBank'));
  assert.ok(!sameSender('', ''));
  const f = { senders: ['Promo', '+15550001111'], words: ['discount'] };
  assert.equal(skipReason({ ...f, from: 'PROMO', text: 'hi' }), 'sender');
  assert.equal(skipReason({ ...f, from: '+15550001111' }), 'sender'); // a call
  assert.equal(skipReason({ ...f, from: 'Shop', text: 'Big DISCOUNT today' }), 'word');
  assert.equal(skipReason({ ...f, from: 'Shop', text: 'Hello', mode: 'codes' }), 'no code');
  assert.equal(skipReason({ ...f, from: 'Shop', text: 'Your code is 4821', mode: 'codes' }), null);
  assert.equal(skipReason({ from: 'Shop', text: 'Hello' }), null);
});

test('the one-time code is found, amounts, dates and phone numbers are not', () => {
  assert.equal(findCode('Your verification code is 482913. Do not share it.'), '482913');
  assert.equal(findCode('G-123456 is your Google verification code.'), '123456');
  assert.equal(findCode('Your login code: 123-456'), '123456');
  assert.equal(findCode('کد تأیید شما: ۴۸۲۹۱۳'), '482913');
  assert.equal(findCode('Doğrulama kodunuz 5521'), '5521');
  assert.equal(findCode('Your code 4821 expires on 18.11.2026'), '4821');
  assert.equal(findCode('Card 4417: payment of $24.90 approved'), null); // no code word
  assert.equal(findCode('Call +15551234567 about your password'), null); // a phone number
  assert.equal(findCode('Your password was changed at 12:30'), null);
  const [m] = smsMessages({ from: 'Verify', text: 'Your code is 4321', line: 'Home · SIM 1' });
  assert.match(m, /\n🔑 <code>4321<\/code>\n/);
});

test('/stats text and alerts', () => {
  const now = Date.UTC(2026, 10, 18, 12, 0);
  const text = statsMessage({
    now,
    counts: { received: 8, sent: 3, failed: 1, calls: 4, pending: 2 },
    gateways: [{
      name: 'Home', online: false, lastSeen: now - 14 * 60_000, fw: '1.2.0', ssid: 'HomeWiFi', rssi: -57, uptime: 3 * 86400,
      sims: [{ label: 'Work (SIM 1)', operator: 'Telecom One', state: 'ready', dbm: -79, mv: 4012 },
        { label: 'SIM 2', state: 'no_answer' }],
    }],
  });
  assert.equal(text, [
    '📊 <b>SMS gateway status</b>', '',
    '<b>Home</b> · 🔴 offline for 14 min · firmware 1.2.0',
    'Wi-Fi HomeWiFi -57 dBm · up 3 d 0 h',
    '• Work (SIM 1): Telecom One, ready, -79 dBm (good), 4.01 V',
    '• SIM 2: the SIM800L is not answering', '',
    '<b>Last 24 h</b>: 8 received · 3 sent · 1 failed · 4 missed calls · 2 waiting to send',
  ].join('\n'));
  assert.equal(deviceAlert({ name: 'Home', online: false, lastSeen: now - 120_000, now }),
    '🔴 <b>Home</b> is offline\nNo check-in for 2 min. Check its power and Wi-Fi.');
  assert.equal(deviceAlert({ name: 'Home', online: true, offlineFor: 75 * 60_000 }), '🟢 <b>Home</b> is back online\nIt was offline for 1 h 15 min.');
  assert.equal(signalAlert({ label: 'SIM 2', gateway: 'Home', lost: true, state: 'no_sim', minutes: 3 }),
    '📵 <b>SIM 2</b> has no network\nno SIM card, for 3 min · Home');
  assert.equal(duration(90 * 3600_000), '3 d 18 h');
});

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
  const [m] = smsMessages({ from: '+15551234567', text: 'a < b & c', line: 'Home · SIM 1 · Turkcell', parts: 3, note: '1 of 3 parts never arrived' });
  assert.match(m, /^📩 <b>\+15551234567<\/b>\n<i>Home · SIM 1 · Turkcell · 3 SMS joined<\/i>/);
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
