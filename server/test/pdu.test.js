import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSubmit, decodePdu, normalizeNumber } from '../src/pdu.js';
import { GSM7, analyzeText } from '../src/shared/gsm.js';

test('GSM alphabet has 128 entries', () => {
  assert.equal(GSM7.length, 128);
});

test('encodes the classic SMS-SUBMIT example', () => {
  const [p] = encodeSubmit('+46708251358', 'hellohello');
  assert.equal(p.pdu, '0011000B916407281553F80000AA0AE8329BFD4697D9EC37');
  assert.equal(p.len, 23);
});

test('decodes the classic SMS-DELIVER example', () => {
  const m = decodePdu('07917283010010F5040BC87238880900F10000993092516195800AE8329BFD4697D9EC37');
  assert.equal(m.type, 'deliver');
  assert.equal(m.text, 'hellohello');
  assert.equal(m.number, '27838890001');
  assert.equal(m.smsc, '+27381000015');
  assert.equal(new Date(m.time).toISOString(), '1999-03-29T13:16:59.000Z'); // 15:16:59 at UTC+2
});

test('round trip: GSM-7 with extension characters', () => {
  const text = 'Price: 10€ [ok] {x} ~ ^ | \\ test';
  const parts = encodeSubmit('05551234567', text);
  assert.equal(parts.length, 1);
  const m = decodePdu(parts[0].pdu);
  assert.equal(m.type, 'submit');
  assert.equal(m.text, text);
  assert.equal(m.number, '05551234567');
});

test('round trip: long GSM-7 text becomes concatenated parts', () => {
  const text = 'A'.repeat(152) + '€' + 'B'.repeat(200);
  const parts = encodeSubmit('+905551234567', text, { ref: 42 });
  assert.equal(parts.length, 3);
  const decoded = parts.map((p) => decodePdu(p.pdu));
  decoded.forEach((d, i) => assert.deepEqual(d.concat, { ref: 42, total: 3, seq: i + 1 }));
  assert.equal(decoded.map((d) => d.text).join(''), text);
  assert.ok(!decoded[0].text.endsWith('\x1b'));
});

test('round trip: Persian and Turkish text uses UCS-2', () => {
  const text = 'سلام دنیا! Şimdi ğüzel ıslak 😀';
  const [p] = encodeSubmit('+905551234567', text);
  const m = decodePdu(p.pdu);
  assert.equal(m.encoding, 'ucs2');
  assert.equal(m.text, text);
});

test('round trip: long UCS-2 text', () => {
  const text = 'ş'.repeat(66) + '😀' + 'ğ'.repeat(80);
  const parts = encodeSubmit('+905551234567', text);
  assert.equal(parts.length, 3);
  assert.equal(parts.map((p) => decodePdu(p.pdu).text).join(''), text);
});

test('decodes an alphanumeric sender', () => {
  // SMS-DELIVER from "Test" (alphanumeric), text "hi"
  const pdu = '0004' + '07D0D4F29C0E' + '0000' + '62113121000000' + '02' + 'E834';
  const m = decodePdu(pdu);
  assert.equal(m.number, 'Test');
  assert.equal(m.numberType, 'alphanumeric');
  assert.equal(m.text, 'hi');
});

test('number normalisation', () => {
  assert.equal(normalizeNumber('+90 555 123-45-67').display, '+905551234567');
  assert.equal(normalizeNumber('0090555').display, '+90555');
  assert.equal(normalizeNumber('abc'), null);
});

test('analyzeText', () => {
  assert.deepEqual(analyzeText('hi'), { encoding: 'GSM-7', units: 2, parts: 1, perPart: 160, left: 158 });
  assert.equal(analyzeText('x'.repeat(161)).parts, 2);
  assert.equal(analyzeText('سلام').encoding, 'UCS-2');
});

test('rejects bad input', () => {
  assert.throws(() => encodeSubmit('12', 'x'));
  assert.throws(() => encodeSubmit('+905551234567', ''));
  assert.throws(() => decodePdu('zz'));
});
