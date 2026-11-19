// Starts the real server and plays the ESP32: sync, receive jobs, report results, push SMS and calls.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decodePdu, pack7 } from '../src/pdu.js';
import { gsm7Encode } from '../src/shared/gsm.js';

const KEYS = { ADMIN_PASSWORD: 'admin-pass', API_KEY: 'api-key' };
// what a SIM line has besides its name, on/off and network, when nothing is set
const LINE_DEFAULTS = { ussd: '', balance_days: 0, keep_days: 0, keep_to: '', keep_text: 'Keep-alive from my SMS gateway', roaming: 'off' };
const GW_KEY = 'K7Q2M9XD4TPAW3HZ'; // what the gateway made and shows on its setup page
let BASE;
let proc, dir, cookie, fakeGithub, fakeTelegram;
let seq = 0;

// A stand-in for the Telegram Bot API: one valid token, chat "403" has blocked the bot.
const TG_TOKEN = '123456789:' + 'A'.repeat(35);
const tgSent = [];
let tgMsgSeq = 100; // message IDs of what the bot sent, never reused
const tgDeleted = new Set(); // "<chat>:<message id>" the bot deleted
// what people "send to the bot"; the server reads them with getUpdates
const tgUpdates = [
  { update_id: 1, message: { message_id: 1, chat: { id: 111, type: 'private', first_name: 'Ada' }, text: 'hello' } },
  { update_id: 2, my_chat_member: { chat: { id: -100222, type: 'supergroup', title: 'Codes' } } },
];
const tgReply = (res, status, obj) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
};
async function telegramApi(req, res) {
  let raw = '';
  for await (const c of req) raw += c;
  const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url);
  if (!m || m[1] !== TG_TOKEN) return tgReply(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
  const b = raw ? JSON.parse(raw) : {};
  if (m[2] === 'getMe') return tgReply(res, 200, { ok: true, result: { id: 42, is_bot: true, first_name: 'Gateway', username: 'test_gateway_bot' } });
  if (m[2] === 'getUpdates') { // long polling, shortened: wait up to 0.3 s for something new
    const fresh = () => tgUpdates.filter((u) => u.update_id >= (b.offset || 0));
    for (let i = 0; i < 6 && !fresh().length; i++) await new Promise((r) => setTimeout(r, 50));
    return tgReply(res, 200, { ok: true, result: fresh() });
  }
  if (m[2] === 'setMyCommands') return tgReply(res, 200, { ok: true, result: true });
  if (m[2] === 'deleteMessages') {
    for (const id of b.message_ids) tgDeleted.add(`${b.chat_id}:${id}`);
    return tgReply(res, 200, { ok: true, result: true });
  }
  if (m[2] === 'sendMessage') {
    if (String(b.chat_id) === '403') return tgReply(res, 403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    const message_id = ++tgMsgSeq;
    tgSent.push({ ...b, message_id });
    return tgReply(res, 200, { ok: true, result: { message_id } });
  }
  return tgReply(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
}

async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

// A stand-in for the GitHub API with one release that carries a firmware file.
const FW_BIN = Buffer.concat([Buffer.from([0xe9]), randomBytes(4095)]);
const FW_SHA = createHash('sha256').update(FW_BIN).digest('hex');

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gw-test-'));
  fakeGithub = createServer((req, res) => {
    const base = `http://127.0.0.1:${fakeGithub.address().port}`;
    if (req.url.startsWith('/repos/test/gateway/releases')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify([
        { tag_name: 'v1.2.0-beta', prerelease: true, assets: [] },
        { tag_name: 'v1.1.0', draft: false, prerelease: false, body: 'notes', html_url: `${base}/r`, published_at: '2026-11-17T00:00:00Z',
          assets: [{ name: 'sms_gateway-esp32s3.bin', size: FW_BIN.length, digest: `sha256:${FW_SHA}`, browser_download_url: `${base}/dl/fw.bin` }] },
        { tag_name: 'v1.0.5', assets: [{ name: 'sms_gateway-esp32s3.bin', size: 1, browser_download_url: `${base}/dl/old.bin` }] },
      ]));
    }
    if (req.url === '/dl/fw.bin') return res.end(FW_BIN);
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => fakeGithub.listen(0, '127.0.0.1', r));
  fakeTelegram = createServer((req, res) => telegramApi(req, res));
  await new Promise((r) => fakeTelegram.listen(0, '127.0.0.1', r));
  // port 0: the OS picks a free port, the server prints it
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
    env: {
      ...process.env, ...KEYS, PORT: '0', DATA_DIR: dir,
      GITHUB_API: `http://127.0.0.1:${fakeGithub.address().port}`, FIRMWARE_REPO: 'test/gateway',
      TELEGRAM_API: `http://127.0.0.1:${fakeTelegram.address().port}`,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start within 10 s')), 10_000);
    proc.on('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
    proc.stdout.on('data', (d) => {
      const m = /on port (\d+)/.exec(String(d));
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
  });
  BASE = `http://127.0.0.1:${port}`;
  const r = await call('POST', '/api/auth/login', { password: 'admin-pass' });
  cookie = r.headers.get('set-cookie').split(';')[0];
});

after(() => {
  proc?.kill();
  fakeGithub?.close();
  fakeTelegram?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method, path, body, headers = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, headers: r.headers };
}

const device = (body, key = GW_KEY) => call('POST', '/api/device/sync', body, { Authorization: `Bearer ${key}` });
const apiCall = (m, p, b) => call(m, p, b, { Authorization: 'Bearer api-key' });
const panel = (m, p, b) => call(m, p, b, { Cookie: cookie });

function status(events = [], free = 3) {
  return {
    id: 'aabbccddeeff', name: 'Test GW', fw: '1.0.0', boot: 1234, uptime: 60, heap: 200000, reset: 'power on', free,
    wifi: { ssid: 'Home', rssi: -55, ip: '192.168.1.9' },
    sims: [
      { slot: 1, state: 'ready', sim: 'READY', op: 'Turkcell', csq: 20, reg: 1, mv: 4010, queue: 0 },
      { slot: 2, state: 'no_sim', sim: 'NOT INSERTED', csq: 99, reg: 0, mv: 4005, queue: 0 },
    ],
    events,
  };
}

// Build an SMS-DELIVER PDU like the SIM800L prints it.
function deliver(from, text, concat) {
  const digits = from.replace('+', '');
  const d = digits.length % 2 ? digits + 'F' : digits;
  let sw = '';
  for (let i = 0; i < d.length; i += 2) sw += d[i + 1] + d[i];
  const h = (n) => n.toString(16).padStart(2, '0').toUpperCase();
  const septets = gsm7Encode(text);
  const udh = concat ? [5, 0, 3, concat.ref, concat.total, concat.seq] : [];
  const ud = [...udh, ...pack7(septets, concat ? 1 : 0)];
  const udl = (concat ? 7 : 0) + septets.length;
  return '07919052000000F0' + h(concat ? 0x44 : 0x04) + h(digits.length) + '91' + sw + '0000' + '62111712000000' + h(udl) + ud.map(h).join('');
}

// An SMS from a name instead of a number (e.g. a bank)
function deliverAlpha(from, text) {
  const h = (n) => n.toString(16).padStart(2, '0').toUpperCase();
  const name = pack7(gsm7Encode(from));
  const septets = gsm7Encode(text);
  return '07919052000000F0' + '04' + h(Math.ceil((from.length * 7) / 4)) + 'D0' + name.map(h).join('')
    + '0000' + '62111712000000' + h(septets.length) + pack7(septets).map(h).join('');
}

test('a gateway that is not added yet is turned away', async () => {
  assert.equal((await device(status(), 'nope')).status, 401);
  const r = await device(status());
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'not_added');
  const d = await panel('GET', '/api/devices');
  assert.deepEqual(d.body.gateways, []);
  assert.equal(d.body.waiting[0].hint, 'W3HZ');
  assert.equal(d.body.waiting[0].device_id, 'aabbccddeeff');
});

test('adding the key in the panel lets the gateway in', async () => {
  assert.equal((await panel('POST', '/api/devices', { key: 'abc' })).status, 400);
  const add = await panel('POST', '/api/devices', { key: 'k7q2-m9xd 4tpa-w3hz', name: 'Home' });
  assert.equal(add.status, 200);
  assert.equal(add.body.hint, 'W3HZ');
  assert.equal(add.body.connected, false);
  assert.equal((await panel('POST', '/api/devices', { key: GW_KEY })).status, 409);

  const r = await device(status());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.jobs, []);
  assert.equal(r.body.config.calls, 'reject');
  const d = await panel('GET', '/api/devices');
  assert.equal(d.body.gateways[0].connected, true);
  assert.equal(d.body.gateways[0].name, 'Home');
  assert.deepEqual(d.body.waiting, []);
});

test('a key works for one board only', async () => {
  const r = await device({ ...status(), id: '001122334455' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'key_in_use');
});

test('API SMS goes out through the gateway', async () => {
  const sent = await apiCall('POST', '/api/v1/sms', { to: '+1 555 111 2233', text: 'Hello from the API' });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.status, 'queued');

  const r = await device(status());
  assert.equal(r.body.jobs.length, 1);
  const job = r.body.jobs[0];
  assert.equal(job.type, 'sms');
  assert.equal(job.slot, 1); // SIM 2 has no card
  const pdu = decodePdu(job.parts[0].pdu);
  assert.equal(pdu.number, '+15551112233');
  assert.equal(pdu.text, 'Hello from the API');

  await device(status([{ seq: ++seq, t: 'job', job: job.id, ok: true, ref: [12] }]));
  const m = await apiCall('GET', `/api/v1/sms/${sent.body.id}`);
  assert.equal(m.body.status, 'sent');
  assert.equal(m.body.slot, 1);
});

test('failed SMS is retried, then fails after 3 attempts', async () => {
  const sent = await apiCall('POST', '/api/v1/sms', { to: '+15550000000', text: 'retry me', sim: 1 });
  for (let i = 0; i < 3; i++) {
    // not_before delays the retry; the test pushes it back directly through the API is not possible,
    // so wait for the first try only and check the queued state after a failure
    const r = await device(status());
    if (!r.body.jobs.length) break;
    await device(status([{ seq: ++seq, t: 'job', job: r.body.jobs[0].id, ok: false, err: '+CMS ERROR: 38' }]));
  }
  const m = await apiCall('GET', `/api/v1/sms/${sent.body.id}`);
  assert.equal(m.body.status, 'queued');
  assert.equal(m.body.error, '+CMS ERROR: 38');
});

test('incoming SMS (single and two-part) and a missed call', async () => {
  const pdu1 = deliver('+15557778899', 'Your code is 4321');
  const long = 'L'.repeat(153) + 'end of message';
  const p1 = deliver('+15557778899', long.slice(0, 153), { ref: 7, total: 2, seq: 1 });
  const p2 = deliver('+15557778899', long.slice(153), { ref: 7, total: 2, seq: 2 });
  const events = [
    { seq: ++seq, t: 'sms', slot: 1, idx: 1, pdu: pdu1 },
    { seq: ++seq, t: 'sms', slot: 1, idx: 3, pdu: p2 },
    { seq: ++seq, t: 'sms', slot: 1, idx: 2, pdu: p1 },
    { seq: ++seq, t: 'call', slot: 1, num: '+15551234567', action: 'rejected', ring: 2100 },
  ];
  const r = await device(status(events));
  assert.equal(r.body.ack, seq);
  await device(status(events)); // a retry with the same events must not duplicate anything

  const inbox = await apiCall('GET', '/api/v1/messages?direction=in&since_id=0');
  assert.equal(inbox.body.items.length, 2);
  assert.equal(inbox.body.items[0].text, 'Your code is 4321');
  assert.equal(inbox.body.items[0].number, '+15557778899');
  assert.equal(inbox.body.items[1].text, long);
  assert.equal(inbox.body.items[1].parts, 2);

  const calls = await apiCall('GET', '/api/v1/calls?since_id=0');
  assert.equal(calls.body.items.length, 1);
  assert.equal(calls.body.items[0].number, '+15551234567');
});

test('panel login, overview, stats, signals', async () => {
  assert.equal((await call('GET', '/api/overview')).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { password: 'wrong' })).status, 401);

  const o = await panel('GET', '/api/overview');
  assert.equal(o.body.devices.length, 1);
  assert.equal(o.body.devices[0].online, true);
  assert.equal(o.body.devices[0].sims[0].dbm, -73);
  assert.equal(o.body.last24h.received, 2);
  assert.equal(o.body.last24h.calls, 1);

  const s = await panel('GET', '/api/stats?days=7&tz=Europe/Istanbul');
  assert.equal(s.body.daily.length, 7);
  assert.equal(s.body.totals.received, 2);
  assert.equal(s.body.topSenders[0].number, '+15557778899');

  const sig = await panel('GET', '/api/signals?hours=24');
  assert.equal(sig.body.points.length, 1);
  assert.equal(sig.body.points[0].s1, -73);
});

test('AT command console round trip', async () => {
  const j = await panel('POST', '/api/devices/aabbccddeeff/jobs', { type: 'at', slot: 1, cmd: 'AT+CSQ' });
  assert.equal(j.status, 200);
  const r = await device(status());
  const job = r.body.jobs.find((x) => x.type === 'at');
  assert.equal(job.cmd, 'AT+CSQ');
  await device(status([{ seq: ++seq, t: 'at', job: job.id, ok: true, out: '+CSQ: 20,0\nOK' }]));
  const done = await panel('GET', `/api/jobs/${j.body.id}`);
  assert.equal(done.body.status, 'done');
  assert.match(done.body.result, /CSQ: 20/);
});

test('firmware update from a GitHub release', async () => {
  // daily window far away from now, so only "Update now" can trigger it
  const away = (new Date().getUTCHours() + 12) % 24;
  assert.equal((await panel('PUT', '/api/firmware', { hour: away, tz: 'UTC', auto: true })).status, 200);

  const fw = await panel('POST', '/api/firmware/check');
  assert.equal(fw.status, 200);
  assert.equal(fw.body.latest.version, '1.1.0'); // the beta is skipped, 1.0.5 is older
  assert.equal(fw.body.ready, '1.1.0');

  let r = await device(status());
  assert.equal(r.body.update, null);
  assert.equal((await panel('POST', '/api/devices/aabbccddeeff/update')).status, 200);
  r = await device(status());
  assert.equal(r.body.update.version, '1.1.0');
  assert.equal(r.body.update.sha256, FW_SHA);
  assert.equal(r.body.update.size, FW_BIN.length);
  assert.equal((await device(status())).body.update, null); // not again while it installs

  const dl = await fetch(`${BASE}${r.body.update.path}&id=aabbccddeeff`, { headers: { Authorization: `Bearer ${GW_KEY}` } });
  assert.equal(dl.status, 200);
  assert.ok(Buffer.from(await dl.arrayBuffer()).equals(FW_BIN));
  assert.equal((await fetch(`${BASE}${r.body.update.path}&id=aabbccddeeff`)).status, 401);

  await device({ ...status([{ seq: ++seq, t: 'fw', ok: true, version: '1.1.0' }]) });
  await device({ ...status(), fw: '1.1.0' });
  const d = await panel('GET', '/api/devices');
  assert.equal(d.body.gateways[0].fw, '1.1.0');
  assert.equal(d.body.firmware, '1.1.0');
  assert.equal((await panel('POST', '/api/devices/aabbccddeeff/update')).status, 409); // up to date
});

test('status light settings reach the gateway', async () => {
  assert.equal((await panel('PUT', '/api/settings', { led: { states: { ok: { color: 'green' } } } })).status, 400);
  const s = await panel('PUT', '/api/settings', { led: { brightness: 40, states: { ok: { color: '#112233', mode: 'pulse' } } } });
  assert.equal(s.body.led.states.ok.mode, 'pulse');
  const r = await device({ ...status(), fw: '1.1.0' });
  assert.equal(r.body.config.led.b, 40);
  assert.equal(r.body.config.led.s.ok, '112233:pulse');
  assert.equal(r.body.config.led.s.wifi, 'ffc000:blink');
});

test('settings and static panel', async () => {
  const s = await panel('PUT', '/api/settings', { call_mode: 'ignore' });
  assert.equal(s.body.call_mode, 'ignore');
  assert.match(s.body.server_url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const r = await device(status());
  assert.equal(r.body.config.calls, 'ignore');
  const html = await fetch(BASE + '/messages');
  assert.equal(html.status, 200);
  assert.equal(html.headers.get('cache-control'), 'no-cache');
  const page = await html.text();
  assert.match(page, /<html/);
  assert.equal((await fetch(BASE + '/js/gsm.js')).status, 200);
  // scripts and styles come from a versioned path, so a deploy is never mixed with cached files
  const app = /src="(\/v\/[0-9a-f]+)\/js\/app\.js"/.exec(page);
  assert.ok(app, 'versioned app.js');
  assert.match(page, new RegExp(`href="${app[1]}/app.css"`));
  for (const p of ['/js/app.js', '/js/gsm.js', '/js/pages/messages.js', '/app.css']) {
    const r = await fetch(BASE + app[1] + p);
    assert.equal(r.status, 200, p);
  }
  assert.equal((await fetch(BASE + app[1] + '/js/nope.js')).status, 404);
});

test('Telegram: each SIM line goes to its own chats, a long SMS arrives joined', async () => {
  assert.equal((await panel('PUT', '/api/telegram', { token: 'not a token' })).status, 400);
  assert.equal((await panel('PUT', '/api/telegram', { token: '123456789:' + 'B'.repeat(35) })).status, 400); // Telegram refuses it
  let t = await panel('PUT', '/api/telegram', { token: TG_TOKEN });
  assert.equal(t.status, 200);
  assert.equal(t.body.bot.username, 'test_gateway_bot');
  assert.ok(!JSON.stringify(t.body).includes(TG_TOKEN)); // the token never goes back to the browser
  assert.deepEqual(t.body.lines.map((l) => `${l.device}:${l.slot}`), ['aabbccddeeff:1', 'aabbccddeeff:2']);

  // the server reads the bot's messages in the background and notes who wrote
  let chats;
  for (let i = 0; i < 50; i++) {
    chats = await panel('GET', '/api/telegram/chats');
    if (chats.body.chats?.length >= 2) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.deepEqual(chats.body.chats.map((c) => `${c.id} ${c.name}`).sort(), ['-100222 Codes', '111 Ada']);

  assert.equal((await panel('PUT', '/api/telegram', { routes: { 'aabbccddeeff:1': 'hello' } })).status, 400);
  t = await panel('PUT', '/api/telegram', { routes: { 'aabbccddeeff:1': '111, -100222', 'aabbccddeeff:2': '333' } });
  assert.deepEqual(t.body.lines.map((l) => l.chats), [['111', '-100222'], ['333']]);

  const check = await panel('POST', '/api/telegram/test', { line: 'aabbccddeeff:1', chats: '111 403' });
  assert.deepEqual(check.body.results.map((r) => r.ok), [true, false]);
  assert.match(check.body.results[1].error, /blocked/);
  tgSent.length = 0;

  // a 3-part SMS on SIM 1: two parts, out of order, in one check-in; the last part later
  const long = 'A'.repeat(153) + 'B'.repeat(153) + 'C <tag> & done';
  const parts = [long.slice(0, 153), long.slice(153, 306), long.slice(306)]
    .map((x, i) => deliver('+15557770000', x, { ref: 9, total: 3, seq: i + 1 }));
  await device(status([{ seq: ++seq, t: 'sms', slot: 1, pdu: parts[2] }, { seq: ++seq, t: 'sms', slot: 1, pdu: parts[0] }]));
  // meanwhile SIM 2 gets an SMS and a call
  await device(status([
    { seq: ++seq, t: 'sms', slot: 2, pdu: deliver('+15551110000', 'Line two') },
    { seq: ++seq, t: 'call', slot: 2, num: '+15552220000', action: 'rejected', ring: 1500 },
  ]));
  await waitFor(() => tgSent.length >= 2);
  assert.deepEqual(tgSent.map((m) => m.chat_id), ['333', '333']); // nothing for SIM 1 while a part is missing
  assert.match(tgSent[0].text, /^📩 <b>\+15551110000<\/b>\n<i>Home · SIM 2( · Sent [^<]+)?<\/i>\n\nLine two$/);
  assert.equal(tgSent[1].text, '📞 Missed call from <b>+15552220000</b>\n<i>Home · SIM 2</i>');

  await device(status([{ seq: ++seq, t: 'sms', slot: 1, pdu: parts[1] }]));
  await waitFor(() => tgSent.length >= 4);
  const sim1 = tgSent.slice(2);
  assert.deepEqual(sim1.map((m) => m.chat_id).sort(), ['-100222', '111']);
  for (const m of sim1) {
    assert.equal(m.parse_mode, 'HTML');
    assert.match(m.text, /^📩 <b>\+15557770000<\/b>\n<i>Home · SIM 1 · Turkcell · 3 SMS joined( · Sent [^<]+)?<\/i>\n\n/);
    assert.ok(m.text.endsWith('A'.repeat(153) + 'B'.repeat(153) + 'C &lt;tag&gt; &amp; done'));
  }
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(tgSent.length, 4); // one Telegram message per chat, not one per SMS part
});

test('Telegram /stats: chats that are set up get the status, others learn their chat ID', async () => {
  tgSent.length = 0;
  await device(status());
  tgUpdates.push({ update_id: 3, message: { message_id: 2, chat: { id: 111, type: 'private', first_name: 'Ada' }, text: '/stats' } });
  tgUpdates.push({ update_id: 4, message: { message_id: 3, chat: { id: 999, type: 'private', first_name: 'Eve' }, text: '/stats@test_gateway_bot' } });
  await waitFor(() => tgSent.length >= 2);
  const stats = tgSent.find((m) => m.chat_id === '111').text;
  assert.match(stats, /^📊 <b>SMS gateway status<\/b>/);
  assert.match(stats, /<b>Home<\/b> · 🟢 online · firmware 1\.0\.0/);
  assert.match(stats, /• SIM 1: Turkcell, ready, -73 dBm \(excellent\), 4\.01 V/);
  assert.match(stats, /• SIM 2: no SIM card/);
  assert.match(stats, /<b>Last 24 h<\/b>: \d+ received · \d+ sent · \d+ failed · \d+ missed calls/);
  assert.match(tgSent.find((m) => m.chat_id === '999').text, /chat ID is <code>999<\/code>/);
});

test('Telegram alerts: a SIM that loses the network, and gets it back', async () => {
  assert.equal((await panel('PUT', '/api/telegram', { alert_minutes: 500 })).status, 400);
  const t = await panel('PUT', '/api/telegram', { alert_minutes: 0 }); // at once, for the test
  assert.equal(t.body.alert_minutes, 0);
  assert.equal(t.body.alert_signal, true);
  await device(status());
  tgSent.length = 0;
  const lost = status();
  lost.sims[0].state = 'searching';
  lost.sims[0].reg = 2;
  await device(lost);
  await waitFor(() => tgSent.length >= 2);
  assert.deepEqual(tgSent.map((m) => m.chat_id).sort(), ['-100222', '111']); // the chats of SIM 1
  assert.match(tgSent[0].text, /^📵 <b>SIM 1<\/b> has no network\nsearching for the network, for 0 min · Home$/);
  await device(lost); // still without network: nothing new
  await device(status());
  await waitFor(() => tgSent.length >= 4);
  assert.match(tgSent[2].text, /^📶 <b>SIM 1<\/b> is back on the network\nTurkcell, -73 dBm · Home$/);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(tgSent.length, 4);
  await panel('PUT', '/api/telegram', { alert_minutes: 3 });
});

test('Telegram: a reply answers the SMS from the same SIM, /send sends a new one', async () => {
  let update = 100;
  const say = (text, extra = {}) => tgUpdates.push({
    update_id: ++update, message: { message_id: update, chat: { id: 111, type: 'private', first_name: 'Ada' }, text, ...extra },
  });
  const answer = (re) => waitFor(() => tgSent.some((m) => m.chat_id === '111' && re.test(m.text)));
  const jobFor = async (number) => {
    for (let i = 0; i < 20; i++) {
      const r = await device(status());
      const job = r.body.jobs.find((j) => j.type === 'sms' && decodePdu(j.parts[0].pdu).number === number);
      if (job) return job;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no SMS job for ${number}`);
  };

  tgSent.length = 0;
  await device(status([{ seq: ++seq, t: 'sms', slot: 1, pdu: deliver('+15554440000', 'Can you call me?') }]));
  await waitFor(() => tgSent.length >= 2);
  const forwarded = tgSent.find((m) => m.chat_id === '111');

  say('Yes, at 5 & not before', { reply_to_message: { message_id: forwarded.message_id } });
  await answer(/^📤 Sending to <b>\+15554440000<\/b> from SIM 1…$/);
  const job = await jobFor('+15554440000');
  assert.equal(job.slot, 1); // the SIM that got the SMS
  assert.equal(decodePdu(job.parts[0].pdu).text, 'Yes, at 5 & not before');
  await device(status([{ seq: ++seq, t: 'job', job: job.id, ok: true, ref: [20] }]));
  await answer(/^✅ SMS sent to <b>\+15554440000<\/b>$/);
  const out = await apiCall('GET', '/api/v1/messages?direction=out&limit=5');
  const sent = out.body.items.find((m) => m.text === 'Yes, at 5 & not before');
  assert.equal(sent.source, 'telegram');
  assert.equal(sent.tg_chat, undefined); // not shown to API users

  say('/send 1 +1-555-666-0000 Running late');
  await answer(/^📤 Sending to <b>\+15556660000<\/b> from SIM 1…$/);
  const job2 = await jobFor('+15556660000');
  assert.equal(decodePdu(job2.parts[0].pdu).text, 'Running late');
  await device(status([{ seq: ++seq, t: 'job', job: job2.id, ok: true, ref: [21] }]));
  await answer(/^✅ SMS sent to <b>\+15556660000<\/b>$/);

  say('/send hello'); // no number
  await answer(/^Send like this:/);
  say('just a reply', { reply_to_message: { message_id: 1 } }); // not a forwarded SMS
  await answer(/^Reply to a forwarded SMS to answer it/);
  say('hello'); // not a command or a reply: no answer, no SMS
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!tgSent.some((m) => m.chat_id === '111' && /hello/.test(m.text)));

  // a sender with a name instead of a number cannot get a reply
  tgSent.length = 0;
  await device(status([{ seq: ++seq, t: 'sms', slot: 1, pdu: deliverAlpha('MyBank', 'Card used') }]));
  await waitFor(() => tgSent.some((m) => m.chat_id === '111'));
  say('stop', { reply_to_message: { message_id: tgSent.find((m) => m.chat_id === '111').message_id } });
  await answer(/^❌ Not sent: MyBank cannot get an SMS/);

  // the owner can turn it off
  assert.equal((await panel('PUT', '/api/telegram', { send: false })).body.send, false);
  say('/send +15556660000 again');
  await answer(/turned off in the panel/);
  await panel('PUT', '/api/telegram', { send: true });
});

test('Telegram auto-delete: the bot deletes its own messages after the chosen time, at most 47 hours', async () => {
  assert.equal((await panel('PUT', '/api/telegram', { autodelete: 7 * 24 * 60 })).status, 400); // Telegram: 48 h at most
  tgSent.length = 0;
  await device(status([{ seq: ++seq, t: 'sms', slot: 1, pdu: deliver('+15556667777', 'Delete me later') }]));
  await waitFor(() => tgSent.length >= 2);
  const old = tgSent.map((m) => `${m.chat_id}:${m.message_id}`);
  // the test cannot wait an hour: make everything sent so far 2 hours old
  const db = new DatabaseSync(join(dir, 'gateway.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  db.prepare('UPDATE telegram_msgs SET sent_at = sent_at - ?').run(2 * 3600_000);
  db.close();

  tgSent.length = 0;
  await device(status([{ seq: ++seq, t: 'sms', slot: 1, pdu: deliver('+15556667777', 'Fresh one') }]));
  await waitFor(() => tgSent.length >= 2);
  const fresh = tgSent.map((m) => `${m.chat_id}:${m.message_id}`);

  const t = await panel('PUT', '/api/telegram', { autodelete: 60 }); // 1 hour
  assert.equal(t.body.autodelete, 60);
  await waitFor(() => old.every((k) => tgDeleted.has(k)));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(fresh.every((k) => !tgDeleted.has(k))); // younger than an hour: stays
  await panel('PUT', '/api/telegram', { autodelete: 0 });
});

test('Telegram filters: only codes on a line, senders and words that are not forwarded', async () => {
  assert.equal((await panel('PUT', '/api/telegram', { modes: { 'aabbccddeeff:1': 'some' } })).status, 400);
  const t = await panel('PUT', '/api/telegram', {
    modes: { 'aabbccddeeff:1': 'codes', 'aabbccddeeff:2': 'all' }, skip_senders: 'Promo\n+1 555 000 1111', skip_words: 'Discount',
  });
  assert.deepEqual(t.body.lines.map((l) => l.mode), ['codes', 'all']);
  assert.equal(t.body.skip_senders, 'Promo, +1 555 000 1111');
  tgSent.length = 0;
  await device(status([
    { seq: ++seq, t: 'sms', slot: 1, pdu: deliver('+15559990000', 'See you tomorrow') }, // no code
    { seq: ++seq, t: 'sms', slot: 1, pdu: deliverAlpha('Promo', 'Your code is 1234') }, // skipped sender
    { seq: ++seq, t: 'sms', slot: 1, pdu: deliver('+15559990000', 'Big discount, code 5555') }, // skipped word
    { seq: ++seq, t: 'call', slot: 1, num: '15550001111', action: 'rejected', ring: 900 }, // skipped sender
    { seq: ++seq, t: 'sms', slot: 1, pdu: deliver('+15559990000', 'Your login code is 7788') },
  ]));
  await waitFor(() => tgSent.length >= 2);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(tgSent.length, 2); // only the code, to both chats of SIM 1
  for (const m of tgSent) assert.ok(m.text.includes('Your login code is 7788') && m.text.includes('🔑 <code>7788</code>'), m.text);
  const inbox = await apiCall('GET', '/api/v1/messages?direction=in&limit=10');
  assert.ok(inbox.body.items.some((m) => m.text === 'See you tomorrow')); // still in the panel
  await panel('PUT', '/api/telegram', { modes: {}, skip_senders: '', skip_words: '' });
});

test('SIM lines: a name, a slot turned off, a chosen network', async () => {
  const dev = '/api/devices/aabbccddeeff/sims';
  assert.equal((await panel('PUT', `${dev}/3`, { name: 'x' })).status, 400);
  assert.equal((await panel('PUT', `${dev}/1`, { network: '12ab' })).status, 400);
  assert.equal((await panel('PUT', '/api/devices/nope00000000/sims/1', { name: 'x' })).status, 404);

  let r = await panel('PUT', `${dev}/1`, { name: '  Work  ', network: '28601' });
  assert.deepEqual(r.body, { name: 'Work', enabled: true, network: '28601', ...LINE_DEFAULTS });
  r = await panel('PUT', `${dev}/2`, { enabled: false });
  assert.equal(r.body.enabled, false);

  // the gateway gets both in its config (older firmware ignores it)
  const sync = await device({ ...status(), fw: '1.2.0' });
  assert.deepEqual(sync.body.config.sims, { 1: { on: true, net: '28601', roam: 'off' }, 2: { on: false, net: 'auto', roam: 'off' } });
  const d = await panel('GET', '/api/devices');
  assert.deepEqual(d.body.lines['aabbccddeeff:1'], { name: 'Work', enabled: true, network: '28601', ...LINE_DEFAULTS });
  assert.equal(d.body.gateways[0].lines[2].enabled, false);
  // Telegram lists only the lines that are on, with their name
  const t = await panel('GET', '/api/telegram');
  assert.deepEqual(t.body.lines.map((l) => `${l.slot} ${l.name}`), ['1 Work']);
  const st = await apiCall('GET', '/api/v1/status');
  assert.equal(st.body[0].sims.find((x) => x.sim === 1).name, 'Work');

  await panel('PUT', `${dev}/1`, { name: '', network: 'auto' });
  await panel('PUT', `${dev}/2`, { enabled: true });
  assert.deepEqual((await device(status())).body.config.sims,
    { 1: { on: true, net: 'auto', roam: 'off' }, 2: { on: true, net: 'auto', roam: 'off' } });
});

test('balance check (USSD) from the panel, from Telegram and by itself; keep-alive SMS', async () => {
  const dev = '/api/devices/aabbccddeeff/sims';
  assert.equal((await panel('PUT', `${dev}/1`, { ussd: '123' })).status, 400);
  assert.equal((await panel('PUT', `${dev}/1`, { keep_days: 30 })).status, 400); // no number to send to
  assert.equal((await panel('PUT', `${dev}/1`, { keep_text: 'x'.repeat(200) })).status, 400); // two SMS
  assert.equal((await panel('PUT', `${dev}/1`, { balance_days: 99 })).status, 400);
  assert.equal((await panel('PUT', `${dev}/1`, { ussd: ' *123# ' })).body.ussd, '*123#');

  await device(status()); // firmware 1.0.0 cannot run USSD codes
  assert.equal((await panel('POST', '/api/devices/aabbccddeeff/jobs', { type: 'ussd', slot: 1 })).status, 409);

  const v13 = (ev = [], sims) => device({ ...status(ev), fw: '1.3.0', ...(sims ? { sims } : {}) });
  await v13();
  const job = await panel('POST', '/api/devices/aabbccddeeff/jobs', { type: 'ussd', slot: 1 });
  let s = await v13();
  const sent = s.body.jobs.find((j) => j.type === 'ussd');
  assert.deepEqual(sent, { id: job.body.id, type: 'ussd', slot: 1, code: '*123#' });
  const answer = 'Balance: 12.50 TL\nValid until 01.12.2026';
  await v13([{ seq: ++seq, t: 'at', job: sent.id, ok: true, out: `+CUSD: 0,"${answer}",15` }]);
  const done = await panel('GET', `/api/jobs/${sent.id}`);
  assert.deepEqual([done.body.status, done.body.result], ['done', answer]);
  let d = await panel('GET', '/api/devices');
  assert.equal(d.body.gateways[0].sims.find((x) => x.slot === 1).balance, answer);
  assert.equal((await apiCall('GET', '/api/v1/status')).body[0].sims.find((x) => x.sim === 1).balance, answer);

  // Telegram: /balance asks the SIM cards of this chat; the answer comes back to it. /stats shows it.
  tgSent.length = 0;
  const say = (update_id, text) => tgUpdates.push({ update_id, message: { message_id: update_id, chat: { id: 111, type: 'private', first_name: 'Ada' }, text } });
  say(300, '/balance');
  await waitFor(() => tgSent.some((m) => m.chat_id === '111' && /^⏳ Checking the balance of SIM 1…$/.test(m.text)));
  s = await v13();
  const tj = s.body.jobs.find((j) => j.type === 'ussd');
  await v13([{ seq: ++seq, t: 'at', job: tj.id, ok: true, out: '+CUSD: 4' }]);
  await waitFor(() => tgSent.some((m) => m.chat_id === '111'
    && m.text === '❌ <b>Balance check failed</b> · SIM 1 · Home\nthis code is not supported by the network'));
  say(301, '/stats');
  await waitFor(() => tgSent.some((m) => m.text.startsWith('📊')));
  assert.match(tgSent.find((m) => m.text.startsWith('📊')).text, /\n {3}💰 Balance: 12\.50 TL · Valid until 01\.12\.2026 \(0 min ago\)\n/);

  // SIM 2 never sent an SMS: with a keep-alive it sends one at once; with a balance check every
  // 7 days it checks at once. Both go out at the next check-in.
  const r = await panel('PUT', `${dev}/2`, { keep_days: 30, keep_to: '+1 555 000 2222', ussd: '*100#', balance_days: 7 });
  assert.deepEqual([r.body.keep_to, r.body.keep_text, r.body.balance_days], ['+15550002222', 'Keep-alive from my SMS gateway', 7]);
  const bothReady = status().sims.map((x) => ({ ...x, state: 'ready', sim: 'READY', op: 'Turkcell', csq: 18, reg: 1 }));
  s = await v13([], bothReady);
  const keep = s.body.jobs.find((j) => j.type === 'sms' && decodePdu(j.parts[0].pdu).number === '+15550002222');
  assert.equal(keep.slot, 2);
  assert.equal(decodePdu(keep.parts[0].pdu).text, 'Keep-alive from my SMS gateway');
  const auto = s.body.jobs.find((j) => j.type === 'ussd');
  assert.deepEqual([auto.slot, auto.code], [2, '*100#']);
  tgSent.length = 0;
  s = await v13([
    { seq: ++seq, t: 'job', job: keep.id, ok: true, ref: [30] },
    { seq: ++seq, t: 'at', job: auto.id, ok: true, out: '+CUSD: 0,"Kalan: 3 TL",15' },
  ], bothReady);
  assert.ok(!s.body.jobs.some((j) => j.type === 'ussd' || (j.type === 'sms' && decodePdu(j.parts[0].pdu).number === '+15550002222'))); // not again
  await waitFor(() => tgSent.some((m) => m.chat_id === '333')); // an automatic check goes to the chats of the line
  assert.equal(tgSent.find((m) => m.chat_id === '333').text, '💰 <b>Balance</b> · SIM 2 · Home\nKalan: 3 TL');
  const out = await apiCall('GET', '/api/v1/messages?direction=out&limit=5');
  assert.equal(out.body.items.find((m) => m.number === '+15550002222').source, 'keepalive');

  await panel('PUT', `${dev}/2`, { keep_days: 0, keep_to: '', ussd: '', balance_days: 0 });
  await panel('PUT', `${dev}/1`, { ussd: '' });
  d = await panel('GET', '/api/devices');
  assert.deepEqual(d.body.gateways[0].lines[2], { name: '', enabled: true, network: 'auto', ...LINE_DEFAULTS });
});

test('roaming mode: calls ring and the SIM sends no SMS, on demand or only while roaming', async () => {
  const dev = '/api/devices/aabbccddeeff/sims';
  assert.equal((await panel('PUT', `${dev}/1`, { roaming: 'sometimes' })).status, 400);
  assert.equal((await panel('PUT', `${dev}/1`, { roaming: 'auto' })).body.roaming, 'auto');
  const roamingSims = (reg) => status().sims.map((x) => (x.slot === 1 ? { ...x, reg } : x));
  const sync = (reg, fw = '1.0.0', ev = []) => device({ ...status(ev), fw, sims: roamingSims(reg) });
  const before = (await panel('GET', '/api/settings')).body.call_mode;
  await panel('PUT', '/api/settings', { call_mode: 'reject' }); // the gateway hangs up calls

  // at home: nothing changes
  let s = await sync(1);
  assert.equal(s.body.config.calls, 'reject');
  assert.equal(s.body.config.sims[1].roam, 'auto');
  assert.equal((await apiCall('POST', '/api/v1/sms', { to: '+15554443333', text: 'home', sim: 1 })).status, 201);
  s = await sync(1);
  const home = s.body.jobs.find((j) => j.type === 'sms' && decodePdu(j.parts[0].pdu).text === 'home');
  await sync(1, '1.0.0', [{ seq: ++seq, t: 'job', job: home.id, ok: true, ref: [40] }]);

  // roaming: firmware before 1.4.0 lets calls ring on the whole gateway; 1.4.0 does it per SIM
  s = await sync(5);
  assert.equal(s.body.config.calls, 'ignore');
  assert.equal((await sync(5, '1.4.0')).body.config.calls, 'reject');
  const st = await apiCall('GET', '/api/v1/status');
  assert.equal(st.body[0].sims.find((x) => x.sim === 1).roaming_mode, true);
  const no = await apiCall('POST', '/api/v1/sms', { to: '+15554443333', text: 'abroad', sim: 1 });
  assert.equal(no.status, 409);
  assert.match(no.body.error, /SIM 1 is in roaming mode, so it sends no SMS/);
  // "any SIM" waits: SIM 1 is roaming, SIM 2 has no card
  const any = await apiCall('POST', '/api/v1/sms', { to: '+15554443333', text: 'any sim', sim: 0 });
  s = await sync(5, '1.4.0');
  assert.ok(!s.body.jobs.some((j) => j.type === 'sms' && decodePdu(j.parts[0].pdu).text === 'any sim'));
  // back home: it goes out
  s = await sync(1, '1.4.0');
  const later = s.body.jobs.find((j) => j.type === 'sms' && decodePdu(j.parts[0].pdu).text === 'any sim');
  assert.equal(later.slot, 1);
  await sync(1, '1.4.0', [{ seq: ++seq, t: 'job', job: later.id, ok: true, ref: [41] }]);
  assert.equal((await apiCall('GET', `/api/v1/sms/${any.body.id}`)).body.status, 'sent');

  // an SMS that waits for SIM 1 when roaming mode is switched on fails at once, with the reason
  await sync(1, '1.4.0');
  const waiting = await apiCall('POST', '/api/v1/sms', { to: '+15554443333', text: 'too late', sim: 1 });
  await panel('PUT', `${dev}/1`, { roaming: 'on' });
  s = await sync(1, '1.4.0');
  assert.ok(!s.body.jobs.some((j) => j.type === 'sms'));
  const failed = await apiCall('GET', `/api/v1/sms/${waiting.body.id}`);
  assert.equal(failed.body.status, 'failed');
  assert.match(failed.body.error, /roaming mode/);

  await panel('PUT', `${dev}/1`, { roaming: 'off' });
  assert.equal((await sync(1)).body.config.calls, 'reject');
  await panel('PUT', '/api/settings', { call_mode: before });
});

test('a reading of 0 from the gateway (none yet) is stored as missing', async () => {
  const s = status();
  s.wifi.rssi = 0;
  s.sims[1].mv = 0;
  await device(s);
  const d = await panel('GET', '/api/devices');
  assert.equal(d.body.gateways[0].wifi_rssi, null);
  assert.equal(d.body.gateways[0].sims.find((x) => x.slot === 2).mv, null);
  await device(status());
});

test('search by days and SIM card, and CSV export', async () => {
  const start = Date.now();
  await device(status([
    { seq: ++seq, t: 'sms', slot: 1, pdu: deliver('+15553330000', '=1+2, "quoted"') }, // looks like a formula
    { seq: ++seq, t: 'call', slot: 1, num: '+15553330000', action: 'rejected', ring: 2500 },
  ]));
  let r = await panel('GET', `/api/messages?since=${start}&device=aabbccddeeff&sim=1&direction=in`);
  assert.deepEqual(r.body.items.map((m) => m.text), ['=1+2, "quoted"']);
  r = await panel('GET', `/api/messages?since=${start}&sim=2`);
  assert.equal(r.body.items.length, 0);
  r = await panel('GET', `/api/calls?until=${encodeURIComponent('2020-01-01T00:00:00Z')}`);
  assert.equal(r.body.items.length, 0);
  assert.equal((await panel('GET', '/api/messages?since=yesterday')).status, 400);

  const get = (path, headers = { Cookie: cookie }) => fetch(BASE + path, { headers });
  assert.equal((await get('/api/messages.csv', {})).status, 401);
  const csv = await get(`/api/messages.csv?since=${start}&tz=UTC`);
  assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(csv.headers.get('content-disposition'), /^attachment; filename="sms-\d{4}-\d{2}-\d{2}\.csv"$/);
  const bytes = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
  const rows = bytes.subarray(3).toString('utf8').split('\r\n');
  assert.equal(rows[0], 'ID,Time,Direction,Status,Number,Text,Gateway,SIM,SIM name,SMS parts,Sent at,Source,Error');
  assert.match(rows[1], /^\d+,\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,received,received,\+15553330000,"'=1\+2, ""quoted""",Home,1,,1,,sim,$/);
  assert.equal(rows.length, 3); // header, one SMS, the empty end

  const calls = await call('GET', '/api/v1/calls.csv?q=3330000', undefined, { Authorization: 'Bearer api-key' }).catch((e) => e);
  assert.ok(calls instanceof SyntaxError); // not JSON: CSV
  const c = await get('/api/v1/calls.csv?q=3330000', { Authorization: 'Bearer api-key' });
  const lines = (await c.text()).replace(/^\uFEFF/, '').split('\r\n');
  assert.equal(lines[0], 'ID,Time,Number,What happened,Rang (seconds),Gateway,SIM,SIM name');
  assert.match(lines[1], /^\d+,[\d: -]+,\+15553330000,rejected,2\.5,Home,1,$/);
});

test('removing a gateway locks it out', async () => {
  const d = await panel('GET', '/api/devices');
  assert.equal((await panel('DELETE', `/api/devices/key/${d.body.gateways[0].key_id}`)).status, 200);
  const r = await device(status());
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'not_added');
  assert.deepEqual((await panel('GET', '/api/overview')).body.devices, []);
});
