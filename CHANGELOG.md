# Changelog

Versions are the gateway firmware versions (`FW_VERSION` in `firmware/sms_gateway/config.h`). Each one
is a GitHub release tagged `vX.Y.Z` with the firmware files. Server changes ship with the version they
were made for; the server deploys from `main`.

## Unreleased

- Server: after a deploy the panel shows the new version at once. Its scripts and styles now load
  from a versioned path; before, Cloudflare kept them for up to 4 hours, so the browser ran the old
  panel code.
- Signal page: a very strong Wi-Fi signal (a phone hotspot next to the gateway) widens the scale
  instead of running off the chart, and the signal of 0 a SIM800L reports while it starts is no
  longer drawn as -113 dBm.

## 1.2.0

- Telegram: add a bot under Settings → Telegram and choose, for each SIM, the chats that get its
  SMS and missed calls (several chats per SIM are fine). A long SMS arrives as one Telegram
  message, joined from its parts. The server sends them, so this works with every firmware.
- SIM cards (Devices → SIM cards): give each slot a name ("Work") that shows across the panel and
  in Telegram; turn a slot off when it has no module or SIM (the gateway stops trying it, the panel
  hides it); choose the mobile network: automatic, or one picked from a network search (the module
  falls back to automatic if that network is gone). On/off and the network need this firmware.
- Firmware: a SIM800L without a SIM card (or with the card in the wrong way) now shows "no SIM
  card" on the OLED and in the panel. Before, it showed "starting" and the module was restarted
  over and over.
- Signal page: a reading of 0 (no Wi-Fi yet, SIM800L not answering) no longer pulls the lines to
  the bottom or the top; lines stay inside the chart; times are on full hours and show AM/PM where
  your browser uses it.
- Hardware v2: a carrier PCB (`pcb/`) that the ESP32, both SIM800Ls, both LM2596s and the OLED
  plug into, so there is no loose wiring, and a case for it (`case/v2/`). Everything needed to
  order bare or assembled boards (PCBA) is in `pcb/`.
- The v2 PCB gives the SIM800Ls a fixed 4.0 V from an LM1084 regulator. LM2596 A only feeds that
  regulator (set it to 5.5 V), so a trimmer turned too far can no longer reach the SIM800Ls: on
  the first hand-wired build, an LM2596 at 12 V killed both modules. The 1000 uF capacitors are
  now 16 V parts.
- The hand-wired build is now called v1 (`case/v1/`, `source/sms_gateway_box_v1.scad`). The case
  itself has not changed.
- Docs: a "When something does not work" guide in ASSEMBLY.md (no answer, no SIM card, no light,
  sparks), the same 4.0 V protection as an option for v1, and LESSONS.md with the mistakes from
  the first build and how to avoid them.

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
