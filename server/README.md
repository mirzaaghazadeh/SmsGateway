# SMS Gateway server and web panel

The server the ESP32 gateway reports to, and the web panel to watch and use it. It is plain Node.js
with no npm packages: the built-in `http`, `crypto` and `node:sqlite` modules, and a vanilla-JS
panel with hand-drawn SVG charts. One container, one SQLite file.

## What it does

- **Panel** (log in with `ADMIN_PASSWORD`):
  - Overview: gateway online/offline, Wi-Fi, both SIM cards (operator, signal, supply voltage), last 24 h.
  - Messages: inbox and outbox, search, filter by SIM and days, CSV export, one-time codes with a
    copy button, and a send form with a character counter.
  - Missed calls, with the same filters and CSV export.
  - Signal charts: mobile signal, Wi-Fi, SIM800L supply voltage.
  - Analytics: per day, per SIM, top senders and callers.
  - Devices: add a gateway by its key, restart it or one SIM800L, an AT command console, the event log.
    Wi-Fi networks (firmware 1.5.0): the gateway's saved networks (names only); add one (sent to the
    gateway once, then the password is erased from the server) or remove one.
    SIM cards: a name per slot, turn an empty slot off, choose the mobile network (automatic or
    one picked from a search; needs firmware 1.2.0), the balance and a keep-alive SMS (see below).
  - Settings.
- **Balance** (firmware 1.3.0): the balance code of a SIM (USSD, like `*123#`) runs with
  Devices → SIM cards → Check now, or by itself every 1 to 30 days. The answer shows in the panel,
  on the overview, in `/stats` and in the API status; an automatic check also goes to the Telegram
  chats of the SIM. A failed automatic check is tried again after 6 hours.
- **Keep-alive SMS** (any firmware): many operators switch off a prepaid SIM that is not used for
  some months. With a keep-alive, the server sends one SMS from that SIM to a number you choose when
  the SIM sent nothing for 30 to 180 days (any SMS sent from it counts). If it never sent one, the
  first goes out at its next check-in.
- **Roaming mode** (per SIM: Off, While roaming, Always on): for a SIM from another country, where
  hanging up a call or sending an SMS costs money. While it is on, calls ring until the caller gives
  up (still logged as missed calls) and the SIM sends no SMS: an SMS asked for on it fails at once
  with the reason (`409` in the API), "any SIM" uses the other SIM, and keep-alive SMS and
  automatic balance checks wait. "While roaming" follows the network (registration status 5).
  Firmware 1.4.0 handles calls per SIM; older firmware lets calls ring on both SIMs of the gateway
  while one is in roaming mode. `GET /api/v1/status` shows `roaming_mode` per SIM.
- **Pairing**: each gateway makes its own device key (like `K7Q2-M9XD-4TPA-W3HZ`) and shows it on its
  setup page and screen. You add the key under Devices. The server keeps only a hash of it. On the
  gateway's first check-in, the key is tied to that ESP32, so a copied key does not work on another
  board. Removing a gateway stops its key at once.
- **Gateway link**: the ESP32 posts to `POST /api/device/sync` every 5 s. It sends its status,
  received SMS as raw PDUs, missed calls and job results. It gets back jobs: SMS as ready-made PDUs,
  AT commands, restart, open the setup hotspot. All SMS encoding happens here: GSM-7 and UCS-2
  (Persian, Turkish, emoji), and long SMS split into parts and joined again.
- **Queue**: outgoing SMS wait until a SIM is ready. A failed send is retried 3 times. With "Any SIM",
  the SIM that sent the fewest messages today is used.
- **Telegram**: the server sends each received SMS and missed call to Telegram chats you choose per SIM
  (see below).
- **API** for your own apps and **webhooks** for every event (see below).

## Deploy on Coolify

1. **New resource**: point it at this Git repository.
   - Build pack: **Docker Compose**.
   - Base directory: **`/`**.
   - Docker Compose Location: **`/docker-compose.yaml`**.

   Switching an existing Dockerfile resource? Change the base directory from `/server` to `/` as
   well, or Coolify reports "Docker Compose file not found at /server/docker-compose.yaml".
2. **Domain** of the `gateway` service: your address **with the port**, for example
   `https://sms.example.com:3000`. The `:3000` only tells Coolify where the app listens; visitors and
   the gateway use `https://sms.example.com`. Coolify gets the HTTPS certificate. The ESP32 checks it
   against the normal public CA list, so Let's Encrypt (or Cloudflare in front) just works.
3. **Storage** is handled by the compose file: the volume `gateway-data` holds the database at `/data`
   and stays when you redeploy. Back it up from time to time (see below).

   Using the plain Dockerfile build pack (base directory `/server`, port 3000) instead? Then add
   Persistent Storage for **`/data`** yourself. Without it every deploy starts with an empty database:
   added gateways, messages and settings are gone.
4. **Environment variables**:

   | Variable | |
   |---|---|
   | `ADMIN_PASSWORD` | Panel password. Set it. If missing, one is generated and printed in the deploy log. |
   | `API_KEY` | Optional. Key for `/api/v1`. If missing, one is generated; Settings can make a new one. |
   | `SESSION_SECRET` | Optional. Signs the login cookie. Generated if missing. |
   | `FIRMWARE_REPO` | Optional. GitHub repository whose releases carry the firmware, default `mirzaaghazadeh/SmsGateway`. `none` turns update checks off. |
   | `GITHUB_TOKEN` | Optional. Only if GitHub limits the update checks (60 per hour per server IP without it). |
   | `PORT` | Default `3000`. |
   | `DATA_DIR` | Default `/data`. |

5. **Deploy**, open the domain and log in.
6. Connect a gateway:
   1. On its setup page (Wi-Fi `SMS-Gateway-XXXX`), enter this server's address.
   2. Copy the device key the page shows.
   3. In the panel, open **Devices → Add a gateway** and paste the key. The gateway shows up within
      a few seconds.

The image has a health check on `GET /health`.

## Firmware updates and the status light

- **Updates**: every 6 hours (and on Settings → Firmware updates → Check now) the server looks at
  the GitHub releases of `FIRMWARE_REPO`. It downloads the newest `sms_gateway-esp32s3.bin`, checks its
  SHA-256 against the release, and keeps it in `/data/firmware`. Gateways with an older version get it:
  - once a day at the hour set under Settings, in your time zone (automatic updates can be turned off);
  - or at once with Devices → **Update to X.Y.Z**.

  The gateway downloads the file from this server with its device key and checks the SHA-256 again.
  It keeps the new firmware only after it reaches the server; otherwise it goes back to the old one.
- **Status light**: Settings → Status light sets a color and a pattern (steady, breathing, blinks, short
  flash, off) for each gateway state, plus the brightness. The gateway gets them on its next check-in
  and saves them, so they also work while Wi-Fi is down.

## Telegram

The server (not the gateway) sends each SMS a SIM receives, and each missed call, to Telegram. Every
SIM is a "line" with its own list of chats: SIM 1 can go to you, SIM 2 to a team group, or both to
several chats.

1. In Telegram, open **@BotFather**, send `/newbot` and follow the steps. It gives you a token like
   `123456789:AAE…`.
2. In the panel, open **Settings → Telegram** and paste the token.
3. Open your bot in Telegram and press **Start**. For a group, add the bot to the group and write any
   message there.
4. Press **Find chats**, click the box of a SIM line, then click a chat to add it. **Test** sends a
   test message to the chats of that line. **Save**.

- **/stats**: send it to the bot and it answers with every gateway (online, Wi-Fi, firmware), each
  SIM (operator, state, signal, voltage, last balance) and the last 24 hours. Only chats you added
  to a SIM line get an answer; any other chat is told its chat ID, which makes it easy to add.
- **Reply and /send**: reply to a forwarded SMS and the reply goes to its sender, from the same SIM
  of the same gateway. `/send +15551234567 text` sends a new SMS from any ready SIM, `/send 2
  +15551234567 text` from SIM 2 (write the number without spaces). The chat hears when the SMS went
  out (✅) or failed (❌). A sender with a name instead of a number (a bank) cannot get a reply.
  Turn it off with "Send SMS from Telegram".
- **/balance**: runs the balance code of every SIM that sends its messages to this chat; each
  answer comes as its own message.
- **Filters**: per SIM line, forward all SMS or only those with a one-time code. Senders (names or
  numbers; `07700900123` and `+447700900123` count as the same) and words in the lists under the
  table are not forwarded; senders' calls neither. Everything still shows in the panel.
- **One-time codes**: a code in the SMS gets its own line, in a box that copies it with one tap.
- **Alerts** (switch each on or off): a gateway that stops checking in for 90 s and comes back
  (to every chat of its SIMs), and a SIM that has had no network for a set number of minutes and
  gets it back (to that SIM's chats). Short drops send nothing.
- The server reads the bot's messages itself (long polling), so no webhook or public address is
  needed. Do not use the same bot in another program at the same time.
- A long SMS comes in as several parts. The server waits for all of them and sends one Telegram
  message with the whole text. If a part never arrives, the rest goes out after 30 minutes, marked
  with how many parts are missing.
- Text longer than one Telegram message (4096 characters) is split, and each piece is numbered.
- Messages wait on the server until Telegram takes them, so they are not lost when Telegram or the
  server is down for a while (kept up to 24 hours).
- **Auto-delete**: "Delete the bot's messages after" (1 hour to 2 days) removes everything the bot
  sent from the chats once it is that old; the panel keeps it all. Telegram lets a bot delete a
  message only during the first 48 hours, so 2 days is the most. For a week or a month, set the
  chat's own Auto-Delete timer in Telegram (chat or group info → menu → Auto-Delete); the bot
  cannot set that timer itself.
- Chat IDs are numbers: people have positive ones, groups negative ones like `-1001234567890`. A
  public channel can also be given as `@name`; add the bot as an admin of the channel.
- Telegram sees the text of the messages you forward. Leave a SIM line empty to keep its SMS off
  Telegram.

## Run it locally

Node.js 24 or newer:

```bash
cd server
ADMIN_PASSWORD=secret npm start
```

Open `http://localhost:3000`. The data goes to `server/data/`. To try the gateway against your
laptop, use `http://<laptop-ip>:3000` as the server address in the gateway setup; plain HTTP works
on a local network.

Run the tests with `npm test`. They cover PDU encoding and decoding, and an end-to-end run where the
test plays the ESP32.

## API

Send `Authorization: Bearer <API_KEY>` with every call. The key is in the panel under Settings.

| Call | |
|---|---|
| `POST /api/v1/sms` | Body `{"to": "+15551234567", "text": "...", "sim": 0}`. `sim`: 0 = any, 1, 2. Answers `201` with the message, status `queued`. |
| `GET /api/v1/sms/:id` | One message. `status` is `queued`, `sending`, `sent` or `failed` (with `error`). |
| `GET /api/v1/messages?direction=in&since_id=0` | Received (`in`) or sent (`out`) messages. With `since_id` they come oldest first, so poll with the last id you saw. `limit` max 200. |
| `GET /api/v1/calls?since_id=0` | Missed calls, same paging. |
| `GET /api/v1/messages.csv`, `GET /api/v1/calls.csv` | The same as a CSV file (UTF-8, up to 100 000 rows, newest first). `tz=Europe/Istanbul` sets the time zone of the times; default UTC. |
| `GET /api/v1/status` | Gateways and SIM cards: online, ready, operator, signal, last balance (`balance`, `balance_at`). |

Filters for the lists and the CSV files: `sim` (1 or 2), `device` (gateway ID), `since` and
`until` (milliseconds since 1970, or a date like `2026-11-18T00:00:00Z`; `until` is not included),
`q` (part of the number or text); for messages also `direction` and `status`.

```bash
curl -X POST https://sms.example.com/api/v1/sms \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"to": "+15551234567", "text": "Your code is 4321"}'
```

A text can be up to 10 SMS long:
- GSM-7 (plain Latin text): 160 characters in one SMS, 153 per part when longer.
- UCS-2 (any other script or emoji): 70 characters, 67 per part.

## Webhooks

Set a URL in Settings. The server POSTs JSON to it for each event:

- `sms.received`, `sms.sent`, `sms.failed`
- `call.missed`
- `device.offline` (no check-in for 90 s), `device.online`

```json
{ "event": "sms.received", "time": "2026-11-17T12:00:00.000Z",
  "data": { "id": 42, "device": "f412fa6c81b4", "sim": 1, "from": "+15551234567", "text": "Hello", "parts": 1 } }
```

Each request carries `X-Gateway-Event` and `X-Gateway-Signature: sha256=<hex>`. The signature is the
HMAC-SHA256 of the raw body with the signing secret shown in Settings. A failed delivery is retried
after 5 s, 30 s and 2 min.

## Data kept

| Data | Kept for |
|---|---|
| Messages and calls | Forever |
| Signal samples (one per minute) | 30 days |
| Event log | 30 days |

Back up `/data/gateway.db`. It is SQLite in WAL mode; copy it with `sqlite3 gateway.db ".backup b.db"`,
or stop the container first.

## Files

| File | |
|---|---|
| `src/server.js` | HTTP server, static files, maintenance timer |
| `src/routes.js` | All endpoints: device, panel, public API |
| `src/gateway.js` | Device sync, SMS queue, retries, multipart assembly, maintenance |
| `src/pdu.js` | SMS PDU encode and decode |
| `src/shared/gsm.js` | GSM-7 alphabet and SMS length rules; the panel uses it too |
| `src/db.js` | SQLite schema and settings |
| `src/auth.js` | Panel login, gateway keys (add, check, tie to one board), API key |
| `src/webhook.js` | Signed webhooks with retries |
| `src/telegram.js` | Telegram bot: lines and their chats, the send queue, finding chat IDs |
| `src/tgformat.js` | Telegram message text: layout, escaping, splitting long text |
| `public/` | The panel: `index.html`, `app.css`, `js/` |
