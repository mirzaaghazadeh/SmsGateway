# Gateway firmware (ESP32-S3 + 2x SIM800L)

The program for the YD-ESP32-S3 inside the box. It:
- runs both SIM800L modules;
- shows the status on the OLED and the RGB LED;
- talks to the server in `server/`, which does all the SMS work and has the panel.

## Upload it (Arduino IDE 2)

1. **Boards Manager**: install "esp32" by Espressif. Tested with 3.0.7; newer 3.x versions should work too.
2. **Library Manager**: install **ArduinoJson** (7.x) and **Adafruit SSD1306**. Accept the extra
   libraries it asks for (Adafruit GFX, Adafruit BusIO).
3. Open `sms_gateway.ino`. The other files in this folder open as tabs.
4. **Tools** menu:

   | Setting | Value |
   |---|---|
   | Board | ESP32S3 Dev Module |
   | Flash Size | 16MB (128Mb) |
   | Partition Scheme | 16M Flash (3MB APP/9.9MB FATFS) |
   | PSRAM | OPI PSRAM |
   | USB CDC On Boot | Disabled |
   | Port | the USB-C port marked **COM** (`/dev/cu.wchusbserial…` on a Mac) |

5. Upload. Open the Serial Monitor at 115200 to watch it start. Type `help` for the commands.

## First setup

1. Power it. The OLED shows the hotspot name (`SMS-Gateway-XXXX`), the password `smsgateway` and
   the gateway's **device key**. The LED blinks blue.
   - The gateway made the key itself on its first start, for example `K7Q2-M9XD-4TPA-W3HZ`.
2. Join that Wi-Fi with your phone. The setup page opens by itself; if not, open `http://192.168.4.1`.
3. Fill in the page:
   - Choose your Wi-Fi (2.4 GHz only) and type its password.
   - Enter your **server address**, for example `https://sms.example.com`.
   - Press **Copy** next to the device key at the top of the page.
4. Press **Save and connect**. The page shows the address it got, then the gateway restarts.
5. In the panel, open **Devices → Add a gateway** and paste the key. Until you do, the OLED says
   "Add in panel" with the key. A few seconds after you add it, the gateway shows up online.

## Change the Wi-Fi or server later

- **Hold BOOT for 5 seconds** (the button next to RST on the ESP32). The OLED counts down; let go
  to cancel. It erases Wi-Fi and server settings and opens the setup hotspot again. The device key
  stays, so you don't have to add the gateway again.
  - Giving the gateway to someone else? On the setup page, Advanced → **Make a new device key**.
  - The RST button only restarts the chip; the program never sees it.
  - Holding BOOT *while pressing* RST puts the ESP32 into USB flash mode instead.
- **From the panel**: Devices → Open Wi-Fi setup. The hotspot opens while the gateway stays online.
  It closes by itself after 10 minutes without visitors.
- **Wi-Fi gone**: if the saved Wi-Fi is missing for 3 minutes (new router, moved house), the hotspot
  opens by itself. The gateway keeps retrying the old network in the meantime.

## What the lights and screen mean

Default status light colors (change them in the panel: Settings → Status light):

| LED | Meaning |
|---|---|
| steady green | all good |
| white flash | an SMS or call just came in or went out |
| slow orange blink | online, but no SIM card is ready |
| slow red blink | Wi-Fi works but the server does not let it in yet. The OLED says why: "Add in panel" with the key, wrong address, ... |
| yellow blink | looking for the Wi-Fi |
| blue blink | setup hotspot open, waiting for you |
| fast purple blink | installing a firmware update |
| fast red blink | BOOT is held: factory reset countdown (not changeable) |

OLED lines:
1. Wi-Fi and server state.
2. One line per SIM: operator and signal bars, or what is wrong ("no SIM card", "not answering",
   "SIM PIN on", "low voltage").
3. Counters since start.

## Updates over Wi-Fi

Once a gateway is set up, you never need the USB cable again for new firmware:

1. New versions are published as [GitHub releases](../../releases). A GitHub Action builds them.
2. Your server downloads the newest one by itself.
3. The gateway installs it daily at the hour set in the panel, or at once when you press
   Devices → **Update to X.Y.Z**.

During the update the light blinks purple, the OLED shows the progress, and the gateway restarts
(about 30 s without SMS). The download is checked with SHA-256. If the new firmware cannot reach the
server for 10 minutes, the gateway goes back to the old one.

**First install without Arduino IDE**: download `sms_gateway-esp32s3-full.bin` from the newest
release and flash it at address 0x0 over the COM port:
`esptool.py --chip esp32s3 write_flash 0x0 sms_gateway-esp32s3-full.bin`.

## How it works

- **Each SIM800L** runs in PDU mode. New SMS stay on the SIM card until the server confirms it has
  them, then the gateway deletes them. Nothing is lost if Wi-Fi or the server is down; the SIM holds
  about 20-30 messages.
- **Incoming calls**: the caller number is logged. By default the gateway hangs up after the first
  ring. Settings in the panel can let it ring instead; nobody ever answers.
- **Status**: every 15 s it reads the signal (`AT+CSQ`), the network (`AT+CREG?`, `AT+COPS?`), the
  supply voltage (`AT+CBC`) and the SIM state (`AT+CPIN?`).
- **Power trouble**: an `UNDER-VOLTAGE` warning goes to the event log. If the module switches off,
  it is restarted through its RST wire. A module that never answers is retried every 2 minutes.
- **Server link**: an HTTPS POST every 5 s, and at once when something happens. The certificate is
  checked against the ESP32's built-in list of public CAs. Only for a self-signed certificate, tick
  "Skip the HTTPS certificate check" under Advanced on the setup page.

## Testing on the bench with one SIM800L

It works with one module: the missing one shows "not answering" and SMS go out through the other.
Wire it as in `ASSEMBLY.md` (SIM1: TX GPIO17, RX GPIO18, RST GPIO5).

**Without the 1 k + 3.3 k resistors yet**: put a single 330 Ω resistor in the GPIO17 → RXD wire for
short tests. Use the proper divider for 24/7 use.

Useful serial commands:
- `status`
- `at1 AT+CSQ` (any AT command, to SIM 1)
- `debug1` (shows everything SIM 1 sends)
- `setup`
- `factory-reset`

The older `firmware/sim800_test` sketch is still there for a plain one-module check without Wi-Fi.

## Files

| File | |
|---|---|
| `sms_gateway.ino` | setup/loop, BOOT button, Wi-Fi watch, LED, serial commands |
| `config.h` | pins and timings (change pins here) |
| `modem.*` | SIM800L driver: AT command queue, SMS listing, sending PDUs, calls |
| `cloud.*` | sync with the server, jobs |
| `portal.*`, `portal_page.h` | setup hotspot and its page |
| `display.*` | OLED screens |
| `events.*` | queue of events waiting for the server |
| `settings.*` | Wi-Fi and server settings and the device key, in flash |
| `ota.*` | firmware updates over Wi-Fi: download, SHA-256 check, install, rollback |
| `led.*` | status light: one color and pattern per state, set from the panel |
