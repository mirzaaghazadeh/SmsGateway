# Notes for agents working on this repository

An open-source SMS / missed-call gateway: an ESP32-S3 with two SIM800L modules in a 3D-printed case,
and a server with a web panel. People print, build and run it themselves, so everything here must
work for a stranger who clones the repo.

## Layout

| Path | What |
|---|---|
| `firmware/sms_gateway/` | Gateway firmware (Arduino, ESP32-S3). Version in `config.h` (`FW_VERSION`). |
| `firmware/sim800_test/` | Bench test sketch for one SIM800L. |
| `server/` | Node.js 24+ server and web panel, no npm dependencies. Docker image for Coolify. |
| `source/`, `case/v1/`, `case/v2/` | OpenSCAD source and print files of the two cases: v1 = hand-wired build, v2 = PCB build. |
| `pcb/` | v2 carrier PCB. `make_board.py` generates everything in the folder (Gerbers, BOM, pick-and-place, assembly drawing, order package, KiCad file, renders); edit the script, not the outputs. |
| `.github/workflows/firmware-release.yml` | Builds the firmware and publishes a GitHub release for a `vX.Y.Z` tag. |
| `CHANGELOG.md` | What changed in each version. |

## Rules

- **The repository is public.** Never commit personal details: names beyond the LICENSE, e-mail
  addresses, phone numbers, home or server addresses, domains of real deployments, Wi-Fi names, device
  keys, passwords or tokens. Use `example.com` and fictional numbers like `+15551234567`.
- Commit with the GitHub noreply address, not a personal one:
  `git -c user.email=7956983+mirzaaghazadeh@users.noreply.github.com commit ...`
- **A push to `main` deploys the server** (Coolify watches the branch). Push only when `npm test` in
  `server/` passes and the firmware compiles.
- **Keep older firmware working.** Gateways update late (daily window, or never if switched off), so the
  server must keep accepting the sync format of every released firmware. Add fields, do not rename or
  remove them.
- Write user-facing text (panel, setup page, OLED, docs) in plain English for people who are not engineers.

## Every important change gets a release with a version

Any change a gateway owner would notice (a new feature, a fix, a protocol change) is released:

1. Bump `FW_VERSION` in `firmware/sms_gateway/config.h` (semver: patch = fix, minor = feature,
   major = needs a server or hardware change).
2. Add a `## X.Y.Z` section at the top of `CHANGELOG.md` with short, plain bullet points. The
   release workflow copies this section into the GitHub release notes.
3. Run the checks below, commit, push `main`.
4. Tag and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow fails if the tag and
   `FW_VERSION` differ. It publishes `sms_gateway-esp32s3.bin` (for updates over Wi-Fi) and
   `sms_gateway-esp32s3-full.bin` (first install over USB at 0x0), each with a `.sha256`.
5. Check the run: `gh run list --workflow firmware-release.yml --limit 1`.

Server-only changes ship with the next firmware version in `CHANGELOG.md`; if one is important on its
own, release a patch version.

How updates reach gateways: each server looks at the releases of `FIRMWARE_REPO` (default
`mirzaaghazadeh/SmsGateway`) every 6 hours, downloads the newest `sms_gateway-esp32s3.bin`, checks its
SHA-256 and offers it to gateways with an older `FW_VERSION`: daily at the hour set in the panel, or
at once after Devices → Update now. A gateway keeps a new firmware only after it reaches the server;
otherwise it rolls back after 10 minutes.

## Checks

```sh
cd server && npm test                       # unit + end-to-end tests (a fake ESP32 and a fake GitHub)
arduino-cli compile --fqbn "esp32:esp32:esp32s3:FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,PSRAM=opi" firmware/sms_gateway
```

Tested with the esp32 Arduino core 3.0.7, ArduinoJson 7.4.3, Adafruit SSD1306 2.5.17.
Flash over the USB-C port marked COM (`arduino-cli upload -p <port> --fqbn ... firmware/sms_gateway`).
