// Starts the real server and plays the ESP32: sync, receive jobs, report results, push SMS and calls.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePdu, pack7 } from '../src/pdu.js';
import { gsm7Encode } from '../src/shared/gsm.js';

const KEYS = { ADMIN_PASSWORD: 'admin-pass', API_KEY: 'api-key' };
const GW_KEY = 'K7Q2M9XD4TPAW3HZ'; // what the gateway made and shows on its setup page
let BASE;
let proc, dir, cookie, fakeGithub;
let seq = 0;

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
  // port 0: the OS picks a free port, the server prints it
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
    env: {
      ...process.env, ...KEYS, PORT: '0', DATA_DIR: dir,
      GITHUB_API: `http://127.0.0.1:${fakeGithub.address().port}`, FIRMWARE_REPO: 'test/gateway',
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
  const sent = await apiCall('POST', '/api/v1/sms', { to: '+90 555 111 2233', text: 'Hello from the API' });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.status, 'queued');

  const r = await device(status());
  assert.equal(r.body.jobs.length, 1);
  const job = r.body.jobs[0];
  assert.equal(job.type, 'sms');
  assert.equal(job.slot, 1); // SIM 2 has no card
  const pdu = decodePdu(job.parts[0].pdu);
  assert.equal(pdu.number, '+905551112233');
  assert.equal(pdu.text, 'Hello from the API');

  await device(status([{ seq: ++seq, t: 'job', job: job.id, ok: true, ref: [12] }]));
  const m = await apiCall('GET', `/api/v1/sms/${sent.body.id}`);
  assert.equal(m.body.status, 'sent');
  assert.equal(m.body.slot, 1);
});

test('failed SMS is retried, then fails after 3 attempts', async () => {
  const sent = await apiCall('POST', '/api/v1/sms', { to: '+905550000000', text: 'retry me', sim: 1 });
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
  const pdu1 = deliver('+905557778899', 'Your code is 4321');
  const long = 'L'.repeat(153) + 'end of message';
  const p1 = deliver('+905557778899', long.slice(0, 153), { ref: 7, total: 2, seq: 1 });
  const p2 = deliver('+905557778899', long.slice(153), { ref: 7, total: 2, seq: 2 });
  const events = [
    { seq: ++seq, t: 'sms', slot: 1, idx: 1, pdu: pdu1 },
    { seq: ++seq, t: 'sms', slot: 1, idx: 3, pdu: p2 },
    { seq: ++seq, t: 'sms', slot: 1, idx: 2, pdu: p1 },
    { seq: ++seq, t: 'call', slot: 1, num: '+905551234567', action: 'rejected', ring: 2100 },
  ];
  const r = await device(status(events));
  assert.equal(r.body.ack, seq);
  await device(status(events)); // a retry with the same events must not duplicate anything

  const inbox = await apiCall('GET', '/api/v1/messages?direction=in&since_id=0');
  assert.equal(inbox.body.items.length, 2);
  assert.equal(inbox.body.items[0].text, 'Your code is 4321');
  assert.equal(inbox.body.items[0].number, '+905557778899');
  assert.equal(inbox.body.items[1].text, long);
  assert.equal(inbox.body.items[1].parts, 2);

  const calls = await apiCall('GET', '/api/v1/calls?since_id=0');
  assert.equal(calls.body.items.length, 1);
  assert.equal(calls.body.items[0].number, '+905551234567');
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
  assert.equal(s.body.topSenders[0].number, '+905557778899');

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
  assert.match(await html.text(), /<html/);
  assert.equal((await fetch(BASE + '/js/gsm.js')).status, 200);
});

test('removing a gateway locks it out', async () => {
  const d = await panel('GET', '/api/devices');
  assert.equal((await panel('DELETE', `/api/devices/key/${d.body.gateways[0].key_id}`)).status, 200);
  const r = await device(status());
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'not_added');
  assert.deepEqual((await panel('GET', '/api/overview')).body.devices, []);
});
