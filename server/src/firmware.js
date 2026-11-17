// Firmware updates: watch the project's GitHub releases, keep the newest firmware on disk,
// and offer it to gateways (daily at the chosen hour, or at once after "Update now").
// Gateways download the file from this server, not from GitHub.
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { db, dataDir, setting, setSetting, log } from './db.js';

export const FIRMWARE_REPO = process.env.FIRMWARE_REPO || 'mirzaaghazadeh/SmsGateway';
const GITHUB_API = process.env.GITHUB_API || 'https://api.github.com';
export const ASSET = 'sms_gateway-esp32s3.bin'; // the app image a release must carry
const DIR = join(dataDir, 'firmware');

export function semver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim());
  return m ? m.slice(1).map(Number) : null;
}

// true when version a is newer than b
export function newer(a, b) {
  const x = semver(a);
  const y = semver(b);
  if (!x) return false;
  if (!y) return true;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

const json = (key) => {
  try {
    return JSON.parse(setting(key) || 'null');
  } catch {
    return null;
  }
};

export const latestRelease = () => json('fw_latest');

// The newest firmware that is downloaded, checked and ready to hand out.
export function cachedFirmware() {
  const c = json('fw_cached');
  if (!c || !existsSync(join(DIR, `${c.version}.bin`))) return null;
  return { ...c, path: join(DIR, `${c.version}.bin`) };
}

async function get(url, accept) {
  const headers = { 'User-Agent': 'sms-gateway-server', Accept: accept };
  if (process.env.GITHUB_TOKEN && url.startsWith(GITHUB_API)) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r;
}

async function ensureCached(rel) {
  const have = cachedFirmware();
  if (have && have.version === rel.version) return have;
  const buf = Buffer.from(await (await get(rel.url, 'application/octet-stream')).arrayBuffer());
  if (rel.size && buf.length !== rel.size) throw new Error(`firmware ${rel.version}: got ${buf.length} bytes, expected ${rel.size}`);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  let expected = rel.sha256;
  if (!expected && rel.sha_url) expected = (await (await get(rel.sha_url, 'text/plain')).text()).trim().split(/\s+/)[0];
  if (expected && expected.toLowerCase() !== sha256) throw new Error(`firmware ${rel.version}: checksum does not match the release`);
  if (buf[0] !== 0xe9) throw new Error(`firmware ${rel.version}: not an ESP32 app image`);
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `${rel.version}.bin`);
  writeFileSync(file + '.part', buf);
  renameSync(file + '.part', file);
  for (const f of readdirSync(DIR)) if (f !== `${rel.version}.bin`) unlinkSync(join(DIR, f)); // keep only the newest
  setSetting('fw_cached', JSON.stringify({ version: rel.version, sha256, size: buf.length }));
  log(`Firmware ${rel.version} downloaded from GitHub and checked (${Math.round(buf.length / 1024)} KB)`);
  return cachedFirmware();
}

let running = null;

// Look at the GitHub releases, remember the newest one with a firmware file, download it.
export function checkReleases() {
  if (FIRMWARE_REPO === 'none') return Promise.resolve(null);
  if (running) return running;
  running = (async () => {
    try {
      const r = await get(`${GITHUB_API}/repos/${FIRMWARE_REPO}/releases?per_page=20`, 'application/vnd.github+json');
      let best = null;
      for (const rel of await r.json()) {
        if (rel.draft || rel.prerelease || !semver(rel.tag_name)) continue;
        const asset = (rel.assets || []).find((a) => a.name === ASSET);
        if (!asset) continue;
        const version = rel.tag_name.replace(/^v/, '');
        if (best && !newer(version, best.version)) continue;
        best = {
          version,
          url: asset.browser_download_url,
          size: asset.size,
          sha256: String(asset.digest || '').startsWith('sha256:') ? asset.digest.slice(7) : null,
          sha_url: (rel.assets.find((a) => a.name === `${ASSET}.sha256`) || {}).browser_download_url || null,
          notes: String(rel.body || '').slice(0, 4000),
          page: rel.html_url,
          published_at: rel.published_at,
        };
      }
      setSetting('fw_check_error', '');
      if (best) {
        if (latestRelease()?.version !== best.version) log(`Firmware release ${best.version} found on GitHub`);
        setSetting('fw_latest', JSON.stringify(best));
        await ensureCached(best);
      }
    } catch (e) {
      setSetting('fw_check_error', e.message);
      log(`Firmware check failed: ${e.message}`, { level: 'warn' });
    } finally {
      setSetting('fw_checked_at', Date.now());
      running = null;
    }
    return firmwareView();
  })();
  return running;
}

// Called on gateway check-ins: check again when the last check is old (6 h), or every 15 min while
// no release is known yet (for example a server deployed just before the first release was built).
let lastAuto = 0;
export function maybeCheckReleases(now = Date.now()) {
  if (FIRMWARE_REPO === 'none' || running || now - lastAuto < 60_000) return;
  const every = cachedFirmware() ? 6 * 3600_000 : 15 * 60_000;
  if (now - Number(setting('fw_checked_at', 0)) < every) return;
  lastAuto = now;
  checkReleases().catch(() => {});
}

export function firmwareSettings() {
  return {
    auto: setting('fw_auto', 'on') === 'on',
    hour: Number(setting('fw_hour', 3)),
    tz: setting('fw_tz', 'UTC'),
  };
}

export function firmwareView() {
  const c = cachedFirmware();
  return {
    repo: FIRMWARE_REPO,
    latest: latestRelease(),
    ready: c ? c.version : null,
    checked_at: Number(setting('fw_checked_at', 0)) || null,
    error: setting('fw_check_error', '') || null,
    ...firmwareSettings(),
  };
}

function localHour(now, tz) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date(now)));
  } catch {
    return new Date(now).getUTCHours();
  }
}

// Called on every gateway check-in. Returns the update to install, or null.
export function updateOffer(deviceId, fw, now = Date.now()) {
  const c = cachedFirmware();
  if (!c || !newer(c.version, fw)) return null;
  const d = db.prepare('SELECT fw_requested, fw_offered, fw_offered_at FROM devices WHERE id = ?').get(deviceId);
  if (!d) return null;
  const sameOffer = d.fw_offered === c.version;
  if (sameOffer && now - (d.fw_offered_at || 0) < 10 * 60_000) return null; // it is installing it right now
  const s = firmwareSettings();
  const daily = s.auto && localHour(now, s.tz) === s.hour && !(sameOffer && now - (d.fw_offered_at || 0) < 20 * 3600_000);
  if (!d.fw_requested && !daily) return null;
  db.prepare('UPDATE devices SET fw_requested = 0, fw_offered = ?, fw_offered_at = ?, fw_result = ? WHERE id = ?')
    .run(c.version, now, `installing ${c.version}`, deviceId);
  log(`Firmware ${c.version} sent to the gateway (it has ${fw || 'unknown'})${d.fw_requested ? '' : ', daily update'}`, { device_id: deviceId });
  return { version: c.version, path: `/api/device/firmware?v=${encodeURIComponent(c.version)}`, size: c.size, sha256: c.sha256 };
}

export function readFirmware(version) {
  const c = cachedFirmware();
  if (!c || c.version !== version) return null;
  return readFileSync(c.path);
}
