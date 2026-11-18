import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCusd, oneLine, USSD_RE } from '../src/ussd.js';

test('USSD answers: plain, over several lines, UCS-2 hex, errors', () => {
  assert.deepEqual(parseCusd('+CUSD: 0,"Your balance is 12.50 TL",15'),
    { ok: true, text: 'Your balance is 12.50 TL', status: 0, error: null });
  const multi = parseCusd('+CUSD: 0,"Balance: 12.50 TL\nValid until 01.12.2026\n",15');
  assert.equal(multi.text, 'Balance: 12.50 TL\nValid until 01.12.2026');
  assert.equal(oneLine(multi.text), 'Balance: 12.50 TL · Valid until 01.12.2026');
  // "Bakiye: 5 ₺" in UCS-2 (dcs 72)
  const hex = [...'Bakiye: 5 ₺'].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();
  assert.equal(parseCusd(`+CUSD: 0,"${hex}",72`).text, 'Bakiye: 5 ₺');
  // Persian without the UCS-2 flag but clearly hex
  const fa = [...'موجودی ۵۰۰۰'].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  assert.equal(parseCusd(`+CUSD: 0,"${fa}",15`).text, 'موجودی ۵۰۰۰');
  assert.equal(parseCusd('+CUSD: 0,"12345678",15').text, '12345678'); // digits stay digits
  assert.equal(parseCusd('+CUSD: 1,"1. Balance\n2. Packages",15').ok, true); // a menu: its text is kept
  assert.deepEqual(parseCusd('+CUSD: 4'), { ok: false, text: '', status: 4, error: 'this code is not supported by the network' });
  assert.equal(parseCusd('+CUSD: 0,"",15').error, 'empty answer');
  assert.equal(parseCusd('ERROR').ok, false);
  for (const ok of ['*123#', '*100*1#', '#123#']) assert.ok(USSD_RE.test(ok), ok);
  for (const bad of ['123', '*123', 'AT+CUSD', '*12a#', '#']) assert.ok(!USSD_RE.test(bad), bad);
});
