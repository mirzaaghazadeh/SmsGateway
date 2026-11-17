# SMS Gateway server and web panel

The server the ESP32 gateway reports to, and the web panel to watch and use it. It is plain Node.js
with no npm packages: the built-in `http`, `crypto` and `node:sqlite` modules, and a vanilla-JS
panel with hand-drawn SVG charts. One container, one SQLite file.

## What it does

- **Panel** (log in with `ADMIN_PASSWORD`):
  - Overview: gateway online/offline, Wi-Fi, both SIM cards (operator, signal, supply voltage), last 24 h.
  - Messages: inbox and outbox, search, and a send form with a character counter.
  - Missed calls.
  - Signal charts: mobile signal, Wi-Fi, SIM800L supply voltage.
  - Analytics: per day, per SIM, top senders and callers.
  - Device: restart the gateway or one SIM800L, an AT command console, the event log.
  - Settings.
- **Gateway link**: the ESP32 posts to `POST /api/device/sync` every 5 s. It sends its status,
  received SMS as raw PDUs, missed calls and job results. It gets back jobs: SMS as ready-made PDUs,
  AT commands, restart, open the setup hotspot. All SMS encoding happens here: GSM-7 and UCS-2
  (Persian, Turkish, emoji), and long SMS split into parts and joined again.
- **Queue**: outgoing SMS wait until a SIM is ready. A failed send is retried 3 times. With "Any SIM",
  the SIM that sent the fewest messages today is used.
- **API** for your own apps and **webhooks** for every event (see below).

## Deploy on Coolify

1. **New resource**: point it at this Git repository.
   - Build pack: **Dockerfile**.
   - **Base directory: `/server`**.
   - Port: **3000**.
2. **Domain**: for example `https://sms.example.com`. Coolify gets the HTTPS certificate. The ESP32
   checks it against the normal public CA list, so a Let's Encrypt certificate just works.
3. **Persistent storage**: add a volume mounted at **`/data`**. The database lives there; without
   the volume every redeploy starts empty.
4. **Environment variables**:

   | Variable | |
   |---|---|
   | `ADMIN_PASSWORD` | Panel password. Set it. If missing, one is generated and printed in the deploy log. |
   | `DEVICE_KEY` | Optional. The key the gateway uses. If missing, one is generated; see it in Settings. |
   | `API_KEY` | Optional. Key for `/api/v1`. If missing, one is generated; Settings can make a new one. |
   | `SESSION_SECRET` | Optional. Signs the login cookie. Generated if missing. |
   | `PORT` | Default `3000`. |
   | `DATA_DIR` | Default `/data`. |

5. **Deploy**, open the domain and log in.
6. Open **Settings → Connect a gateway** and copy the server address and device key into the
   gateway's setup page.

The image has a health check on `GET /health`.

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
| `GET /api/v1/status` | Gateways and SIM cards: online, ready, operator, signal. |

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
| `src/auth.js` | Panel login, device key, API key |
| `src/webhook.js` | Signed webhooks with retries |
| `public/` | The panel: `index.html`, `app.css`, `js/` |
