# Changelog

Versions are the gateway firmware versions (`FW_VERSION` in `firmware/sms_gateway/config.h`). Each one
is a GitHub release tagged `vX.Y.Z` with the firmware files. Server changes ship with the version they
were made for; the server deploys from `main`.

## Unreleased

- Server: Telegram. Add a bot under Settings → Telegram and choose, for each SIM, the chats that get
  its SMS and missed calls (several chats per SIM are fine). A long SMS arrives as one Telegram
  message, joined from its parts. The server sends them, so the gateway firmware does not change.

## 1.1.2

- Fix: updates over Wi-Fi failed with "download has the wrong size" when the server sits behind
  Cloudflare, which sends the file in chunks without a length. The gateway now accepts chunked
  downloads and still checks the size and the SHA-256.
- **1.1.0 and 1.1.1 cannot update themselves behind Cloudflare: install 1.1.2 once over USB.**
  Later versions then come over Wi-Fi.
- Server: `docker-compose.yml` with a named volume for `/data`, so the database survives redeploys.

## 1.1.1

- Fix: a gateway could stay offline for good after one failed connection (for example right after
  joining the Wi-Fi, or while the server restarts). The ESP32 core lost the certificate list after a
  failed attempt; the gateway now attaches it again before every new connection.
- The gateway waits for an address from the router before it talks to the server.
- New serial command `net`: tests DNS, TCP and HTTPS to the server step by step.

## 1.1.0

- Firmware updates over Wi-Fi: the server watches this repository's GitHub releases, downloads the
  newest firmware and gives it to the gateways. They install it daily at the hour set in the panel,
  or at once with Devices → Update now. The file is checked with SHA-256 before it is used. If a new
  firmware cannot reach the server for 10 minutes, the gateway goes back to the old one by itself.
- Status light colors: each state (all good, SMS/call, no SIM ready, server problem, no Wi-Fi,
  setup, updating) has its own color and pattern. Change them in the panel under Settings → Status light.
- Pairing by device key: each gateway makes its own key and shows it on its setup page and screen.
  You add the key in the panel under Devices. The key is tied to one board.
- A server address saved as `http://` switches to `https://` by itself when the server redirects.

## 1.0.0

- First version: two SIM800L modules, SMS in and out (GSM-7 and Unicode, long SMS), missed calls,
  OLED status, setup hotspot, BOOT held 5 s = factory reset, server sync every 5 s.
