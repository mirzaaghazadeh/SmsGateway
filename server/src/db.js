import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const dataDir = process.env.DATA_DIR || (process.env.NODE_ENV === 'production' ? '/data' : './data');

function openDatabase() {
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.W_OK);
    return new DatabaseSync(process.env.DB_FILE || join(dataDir, 'gateway.db'));
  } catch (e) {
    console.error(
      `Cannot write the database in ${dataDir} (${e.code || e.message}).\n` +
        'The container runs as user "node" (uid 1000). Use a Docker volume for /data, or make the ' +
        'mounted host folder writable for uid 1000 (chown 1000:1000 <folder>).'
    );
    process.exit(1);
  }
}

export const db = openDatabase();

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, name TEXT, fw TEXT, ip TEXT, ssid TEXT, wifi_rssi INTEGER, heap INTEGER,
  uptime INTEGER, boot INTEGER, reset_reason TEXT, first_seen INTEGER, last_seen INTEGER,
  offline INTEGER NOT NULL DEFAULT 0
);

-- Gateways the owner added in the panel. Each ESP32 makes its own key and shows it on its setup
-- page; the server keeps only a hash. device_id is filled in on the gateway's first check-in.
CREATE TABLE IF NOT EXISTS device_keys (
  id INTEGER PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, hint TEXT NOT NULL, name TEXT,
  device_id TEXT UNIQUE, added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sims (
  device_id TEXT NOT NULL, slot INTEGER NOT NULL, state TEXT, sim TEXT, imei TEXT, iccid TEXT,
  operator TEXT, csq INTEGER, reg INTEGER, mv INTEGER, queue INTEGER, updated_at INTEGER,
  PRIMARY KEY (device_id, slot)
);

CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY, device_id TEXT NOT NULL, ts INTEGER NOT NULL, wifi_rssi INTEGER, heap INTEGER,
  s1_csq INTEGER, s1_reg INTEGER, s1_mv INTEGER, s2_csq INTEGER, s2_reg INTEGER, s2_mv INTEGER
);
CREATE INDEX IF NOT EXISTS samples_dev_ts ON samples (device_id, ts);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  direction TEXT NOT NULL,            -- 'in' | 'out'
  device_id TEXT, slot INTEGER,       -- the SIM that received / sent it
  want_slot INTEGER NOT NULL DEFAULT 0, -- outgoing: SIM asked for (0 = any)
  number TEXT NOT NULL, text TEXT NOT NULL,
  status TEXT NOT NULL,               -- in: received | out: queued, sending, sent, failed
  encoding TEXT, parts INTEGER, pdus TEXT, error TEXT, source TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, not_before INTEGER,
  created_at INTEGER NOT NULL, sent_at INTEGER, sms_time INTEGER, ukey TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS messages_created ON messages (created_at);
CREATE INDEX IF NOT EXISTS messages_status ON messages (status);

CREATE TABLE IF NOT EXISTS sms_parts (
  id INTEGER PRIMARY KEY, device_id TEXT, slot INTEGER, number TEXT, ref INTEGER, total INTEGER,
  seq INTEGER, text TEXT, sms_time INTEGER, received_at INTEGER, message_id INTEGER, ukey TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY, device_id TEXT, slot INTEGER, number TEXT, action TEXT, ring_ms INTEGER,
  ts INTEGER NOT NULL, ukey TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS calls_ts ON calls (ts);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY, device_id TEXT, type TEXT NOT NULL, slot INTEGER, payload TEXT,
  status TEXT NOT NULL,               -- queued, sent, done, failed, lost
  result TEXT, message_id INTEGER, created_at INTEGER, assigned_at INTEGER, done_at INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, device_id TEXT, slot INTEGER, level TEXT, text TEXT, ukey TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS logs_ts ON logs (ts);

-- Telegram messages waiting to be sent (deleted once Telegram has them, or after 24 h).
CREATE TABLE IF NOT EXISTS telegram_outbox (
  id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL, text TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);

-- What the bot sent, so it can delete it again (Settings → Telegram → auto-delete). Kept 48 hours:
-- Telegram lets a bot delete its own message only during the first 48 hours.
CREATE TABLE IF NOT EXISTS telegram_msgs (
  chat_id TEXT NOT NULL, message_id INTEGER NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (chat_id, message_id)
);

-- Which Telegram message carried which SMS, so a reply in Telegram goes back to the sender (30 days).
CREATE TABLE IF NOT EXISTS telegram_sent (
  chat_id TEXT NOT NULL, message_id INTEGER NOT NULL, device_id TEXT, slot INTEGER, number TEXT,
  created_at INTEGER NOT NULL, PRIMARY KEY (chat_id, message_id)
);
`);

// Columns added after the first release: add them to databases made by older versions.
function addColumns(table, columns) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, def] of columns) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
}
addColumns('devices', [
  ['fw_requested', 'INTEGER NOT NULL DEFAULT 0'], // "Update now" pressed in the panel
  ['fw_offered', 'TEXT'],                          // firmware version last offered to this gateway
  ['fw_offered_at', 'INTEGER'],
  ['fw_result', 'TEXT'],                           // what the last update attempt said
  ['wifi_saved', 'TEXT'],                          // firmware 1.5.0: names of its saved Wi-Fi networks (JSON)
]);
addColumns('messages', [['tg_chat', 'TEXT']]);    // outgoing SMS sent from Telegram: tell this chat how it went
addColumns('sims', [
  ['balance', 'TEXT'],          // the last answer to the balance code (USSD)
  ['balance_at', 'INTEGER'],
  ['balance_try', 'INTEGER'],   // last automatic check, so a failing one is not repeated every minute
  ['keep_at', 'INTEGER'],       // last keep-alive SMS
]);
addColumns('telegram_outbox', [['ref', 'TEXT']]); // forwarded SMS: {device, slot, number}, for replies

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const putSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

export function setting(key, fallback = null) {
  const row = getSetting.get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  putSetting.run(key, value == null ? null : String(value));
}

// A random value that is created once and then kept in the database.
export function persistentSecret(key, bytes = 24) {
  let v = setting(key);
  if (!v) {
    v = randomBytes(bytes).toString('base64url');
    setSetting(key, v);
  }
  return v;
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function log(text, { level = 'info', device_id = null, slot = null, ukey = null, ts = Date.now() } = {}) {
  db.prepare('INSERT OR IGNORE INTO logs (ts, device_id, slot, level, text, ukey) VALUES (?, ?, ?, ?, ?, ?)').run(
    ts, device_id, slot, level, String(text).slice(0, 2000), ukey
  );
}
