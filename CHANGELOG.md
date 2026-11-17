# Changelog

Versions are the gateway firmware versions (`FW_VERSION` in `firmware/sms_gateway/config.h`). Each one
is a GitHub release tagged `vX.Y.Z` with the firmware files. Server changes ship with the version they
were made for; the server deploys from `main`.

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
