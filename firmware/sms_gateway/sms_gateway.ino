/*
  SMS Gateway: YD-ESP32-S3 (N16R8) + 2x SIM800L + 0.96" OLED.

  First start: the gateway opens the Wi-Fi hotspot "SMS-Gateway-XXXX" (password: smsgateway).
  Join it with a phone, the setup page opens (or go to http://192.168.4.1): choose your Wi-Fi and
  enter the server address. The page (and the OLED) shows this gateway's device key: add that key
  in the panel under Devices. The gateway made the key itself on its first start.

  Then it checks in with the server every 5 s: status of both SIMs, received SMS (raw PDU),
  missed calls; it gets back SMS to send and commands. All SMS encoding happens on the server.

  Once set up, the hotspot never opens by itself (1.5.0), so nobody nearby can change the settings:
  - press BOOT briefly: the settings page opens for 10 minutes, at the gateway's address on its
    Wi-Fi if Wi-Fi works, else as the hotspot;
  - the panel (Devices → Open settings page) opens it on the Wi-Fi address only;
  - hold BOOT for 5 s: Wi-Fi and server settings are erased and the setup hotspot opens again; the
    device key stays. (RST only restarts; BOOT held while pressing RST starts the USB flash mode.)
  It remembers up to 5 Wi-Fi networks (1.5.0) and joins whichever is in range.

  Arduino IDE: board "ESP32S3 Dev Module", Flash Size 16MB, Partition Scheme
  "16M Flash (3MB APP/9.9MB FATFS)", PSRAM "OPI PSRAM". Upload through the USB-C port marked COM.
  Libraries (Library Manager): ArduinoJson 7, Adafruit SSD1306 (+ Adafruit GFX).
  Serial monitor 115200: type "help".
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "cloud.h"
#include "config.h"
#include "display.h"
#include "events.h"
#include "led.h"
#include "modem.h"
#include "ota.h"
#include "portal.h"
#include "settings.h"

uint32_t bootId = 0;

static uint32_t wifiLostSince = 0;
static uint32_t wifiOkSince = 0;
static bool factoryHeld = false;
static String serialLine;

String resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power on";
    case ESP_RST_SW: return "software restart";
    case ESP_RST_PANIC: return "crash";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_BROWNOUT: return "brownout (supply dip)";
    case ESP_RST_EXT: return "reset button";
    case ESP_RST_DEEPSLEEP: return "deep sleep";
    default: return "unknown";
  }
}

// ---------------- BOOT button: hold 5 s = factory reset ----------------

static bool wifiUp();

// Open the setup page by hand: on the Wi-Fi address if Wi-Fi works, else the hotspot (10 minutes).
static void openSetup() {
  if (wifiUp()) portal::startLan();
  else portal::start(true);
}

static void checkBootButton() {
  static uint32_t pressedAt = 0;
  static uint32_t lastHeld = 0;
  if (digitalRead(BOOT_PIN) == LOW) {
    if (!pressedAt) pressedAt = millis();
    uint32_t held = millis() - pressedAt;
    lastHeld = held;
    factoryHeld = true;
    display::factoryCountdown(held ? held : 1);
    if (held >= FACTORY_HOLD_MS) {
      Serial.println("BOOT held 5 s: erasing Wi-Fi and server settings");
      settings.erase();
      display::factoryCountdown(0);
      display::notice("Settings erased.", "Restarting...", 3000);
      rgbLedWrite(LED_PIN, 40, 0, 0);
      delay(1500);
      ESP.restart();
    }
  } else if (pressedAt) {
    pressedAt = 0;
    factoryHeld = false;
    display::factoryCountdown(0);
    // pressed briefly (1.5.0): open the setup page. This is how to reach it once the gateway is set
    // up: it never opens the hotspot by itself, so nobody nearby can change its settings.
    if (lastHeld >= 50 && lastHeld < SETUP_PRESS_MS && settings.configured()) openSetup();
  }
}

// ---------------- Wi-Fi: join whichever saved network is in range ----------------

static const uint32_t WIFI_TRY_MS = 20000;  // time for one join attempt before scanning again
static uint32_t wifiTryAt = 0;
static size_t wifiNext = 0;     // none of the saved networks seen: try them in turn (hidden networks)
static bool wifiScanning = false;
static uint32_t wifiScanAt = 0;  // join attempt stopped: the scan starts a moment later

static void joinNet(const WifiNet &n) {
  wifiTryAt = millis();
  WiFi.disconnect(false, false);
  WiFi.begin(n.ssid.c_str(), n.pass.c_str());
  Serial.printf("Wi-Fi: joining \"%s\"\n", n.ssid.c_str());
}

static void startWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("sms-gateway");
  // findWifi() reconnects (to the best saved network). The core's own retries would keep the radio
  // "connecting" to a network that is gone, and the ESP32 cannot scan meanwhile.
  WiFi.setAutoReconnect(false);
  WiFi.setSleep(false);  // faster answers; the gateway is mains powered anyway
  joinNet(settings.nets[0]);  // the one that worked last
}

// Joined the Wi-Fi AND got an address from the router. WiFi.isConnected() turns true a moment
// before DHCP answers; a server sync in that moment fails its DNS lookup.
static bool wifiUp() { return WiFi.isConnected() && WiFi.localIP() != IPAddress(0, 0, 0, 0); }

// Not connected: give each attempt 20 s, then scan and join the strongest saved network in range.
// A join attempt blocks the ESP32's network scan, so while someone uses the setup page the gateway
// leaves the radio to it.
static void findWifi(uint32_t now) {
  if (portal::busy()) {
    wifiScanning = false;
    wifiScanAt = 0;
    return;
  }
  if (!wifiScanning) {
    if (now - wifiTryAt < WIFI_TRY_MS) return;
    if (!wifiScanAt) {
      WiFi.disconnect(false, false);  // stop retrying: a scan fails while a join attempt runs
      wifiScanAt = now + 1500;
      return;
    }
    if ((int32_t)(now - wifiScanAt) < 0) return;
    wifiScanAt = 0;
    wifiScanning = WiFi.scanNetworks(true) != WIFI_SCAN_FAILED;
    if (wifiScanning) return;
  }
  int n = wifiScanning ? WiFi.scanComplete() : WIFI_SCAN_FAILED;
  if (n == WIFI_SCAN_RUNNING) return;
  wifiScanning = false;
  const WifiNet *best = nullptr;
  int bestRssi = -1000;
  for (int i = 0; i < n; i++) {
    const WifiNet *k = settings.findNet(WiFi.SSID(i));
    if (k && WiFi.RSSI(i) > bestRssi) {
      best = k;
      bestRssi = WiFi.RSSI(i);
    }
  }
  if (n >= 0) WiFi.scanDelete();
  if (best) {
    Serial.printf("Wi-Fi: \"%s\" is in range (%d dBm)\n", best->ssid.c_str(), bestRssi);
    joinNet(*best);
  } else {
    joinNet(settings.nets[wifiNext++ % settings.nets.size()]);  // maybe hidden: try anyway
  }
}

static void watchWifi() {
  uint32_t now = millis();
  if (wifiUp()) {
    if (!wifiOkSince) {
      Serial.printf("Wi-Fi: connected to \"%s\", address %s\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
      settings.useFirst(WiFi.SSID());  // try this one first after a restart
    }
    wifiLostSince = 0;
    wifiScanning = false;
    if (!wifiOkSince) wifiOkSince = now;
    // the hotspot was opened because Wi-Fi was gone: close it again once Wi-Fi is back and nobody uses it
    if (portal::active() && WiFi.softAPgetStationNum() == 0 && now - wifiOkSince > 60000) portal::stop();
    return;
  }
  wifiOkSince = 0;
  if (!wifiLostSince) wifiLostSince = now;
  findWifi(now);
  // Once set up, the hotspot never opens by itself (1.5.0): anyone nearby could change the settings.
  // Press BOOT briefly to open it.
  static uint32_t hinted = 0;
  if (now - wifiLostSince > WIFI_FALLBACK_MS && now - hinted > WIFI_FALLBACK_MS) {
    hinted = now;
    Serial.println("Wi-Fi: no saved network found. Press BOOT briefly to open the setup hotspot.");
  }
}

// ---------------- RGB status light (colors and patterns set in the panel) ----------------

static void ledLoop() {
  led::State s;
  if (factoryHeld) s = led::RESET;
  else if (ota::active()) s = led::UPDATE;
  else if (!settings.configured() || (portal::active() && !WiFi.isConnected())) s = led::SETUP;
  else if (!WiFi.isConnected()) s = led::WIFI;
  else if (!cloud::online()) s = led::SERVER;
  else if (!modem1.ready() && !modem2.ready()) s = led::SIM;
  else s = led::OK;
  led::show(s, lastActivityMs && millis() - lastActivityMs < 150);
}

// Called during a firmware download, which blocks loop() for a few seconds.
static void updateTick() {
  modem1.loop();
  modem2.loop();
  ledLoop();
}

// The Arduino core keeps a new firmware only if this returns false; we confirm it ourselves once
// the server answers (ota::confirm), so a broken update rolls back to the old firmware.
bool verifyRollbackLater() { return true; }

// ---------------- serial console (bench testing) ----------------

static void printStatus() {
  Serial.printf("SMS Gateway %s, id %s, key %s, up %lu s, free heap %u\n", FW_VERSION, deviceId().c_str(),
                settings.keyFormatted().c_str(), (unsigned long)(millis() / 1000), ESP.getFreeHeap());
  Serial.printf("Wi-Fi: %s %s, server %s: %s\n", WiFi.isConnected() ? WiFi.SSID().c_str() : "",
                WiFi.isConnected() ? WiFi.localIP().toString().c_str() : "(not connected)", settings.server.c_str(),
                cloud::online() ? "online" : cloud::lastError().c_str());
  Serial.print("saved Wi-Fi networks:");
  for (const WifiNet &n : settings.nets) Serial.printf(" \"%s\"", n.ssid.c_str());
  Serial.println();
  if (cloud::notAdded()) Serial.printf("-> add this gateway in the panel under Devices with key %s\n", settings.keyFormatted().c_str());
  for (Modem *m : {&modem1, &modem2}) {
    Serial.printf("SIM%u: %s, SIM %s, operator %s, CSQ %d, reg %d, %d mV, IMEI %s, queue %u\n", m->slot,
                  m->stateName(), m->simStatus.c_str(), m->op.c_str(), m->csq, m->reg, m->mv, m->imei.c_str(),
                  (unsigned)m->queueLen());
  }
  Serial.printf("events waiting for the server: %u\n", (unsigned)events.size());
}

// "net": find out why the server cannot be reached, step by step (DNS, TCP, TLS).
static void netCheck() {
  String host = settings.server;
  int p = host.indexOf("://");
  if (p >= 0) host = host.substring(p + 3);
  int slash = host.indexOf('/');
  if (slash >= 0) host = host.substring(0, slash);
  bool https = settings.server.startsWith("https://");
  uint16_t port = https ? 443 : 80;
  int colon = host.indexOf(':');
  if (colon >= 0) {
    port = host.substring(colon + 1).toInt();
    host = host.substring(0, colon);
  }
  Serial.printf("net: Wi-Fi %s, IP %s, gateway %s, DNS %s\n", WiFi.isConnected() ? "up" : "DOWN", WiFi.localIP().toString().c_str(),
                WiFi.gatewayIP().toString().c_str(), WiFi.dnsIP().toString().c_str());
  IPAddress ip;
  if (!WiFi.hostByName(host.c_str(), ip)) {
    Serial.printf("net: DNS lookup of %s FAILED\n", host.c_str());
    return;
  }
  Serial.printf("net: %s -> %s\n", host.c_str(), ip.toString().c_str());
  WiFiClient tcp;
  uint32_t t0 = millis();
  bool ok = tcp.connect(ip, port, 8000);
  Serial.printf("net: TCP %s:%u %s (%lu ms)\n", ip.toString().c_str(), port, ok ? "ok" : "FAILED", (unsigned long)(millis() - t0));
  tcp.stop();
  if (!ok || !https) return;
  extern const uint8_t x509_crt_bundle_start[] asm("_binary_x509_crt_bundle_start");
  extern const uint8_t x509_crt_bundle_end[] asm("_binary_x509_crt_bundle_end");
  WiFiClientSecure tls;
  if (settings.insecure) tls.setInsecure();
  else tls.setCACertBundle(x509_crt_bundle_start, x509_crt_bundle_end - x509_crt_bundle_start);
  t0 = millis();
  ok = tls.connect(host.c_str(), port, 10000);
  char err[120] = "";
  if (!ok) tls.lastError(err, sizeof(err));
  Serial.printf("net: TLS %s (%lu ms) %s, free heap %u\n", ok ? "ok" : "FAILED", (unsigned long)(millis() - t0), err, ESP.getFreeHeap());
  tls.stop();
}

static void serialCommand(String cmd) {
  cmd.trim();
  if (!cmd.length()) return;
  String lower = cmd;
  lower.toLowerCase();
  if (lower == "help") {
    Serial.println("status | net | at1 <cmd> | at2 <cmd> | debug1 | debug2 | setup | restart | factory-reset");
  } else if (lower == "status") {
    printStatus();
  } else if (lower == "net") {
    netCheck();
  } else if (lower.startsWith("at1 ") || lower.startsWith("at2 ")) {
    Job j;
    j.type = Job::AT;
    j.id = 0;  // 0: only printed here, not sent to the server
    j.cmd = cmd.substring(4);
    Modem *m = modemFor(cmd[2] - '0');
    if (!m->enqueue(j)) Serial.println("that SIM800L is not answering or busy");
  } else if (lower == "debug1" || lower == "debug2") {
    Modem *m = modemFor(cmd[5] - '0');
    m->debug = !m->debug;
    Serial.printf("SIM%u raw output %s\n", m->slot, m->debug ? "on" : "off");
  } else if (lower == "setup") {
    portal::start(settings.configured());
  } else if (lower == "restart") {
    ESP.restart();
  } else if (lower == "factory-reset") {
    settings.erase();
    Serial.println("settings erased, restarting");
    delay(300);
    ESP.restart();
  } else {
    Serial.println("unknown command, type help");
  }
}

static void readSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      serialCommand(serialLine);
      serialLine = "";
    } else if (serialLine.length() < 200) {
      serialLine += c;
    }
  }
}

// ---------------- setup / loop ----------------

void setup() {
  Serial.begin(115200);
  delay(300);
  bootId = esp_random();
  pinMode(BOOT_PIN, INPUT_PULLUP);
  rgbLedWrite(LED_PIN, 0, 0, 10);
  settings.load();
  led::begin();
  Serial.printf("\nSMS Gateway %s, id %s, last restart: %s\n", FW_VERSION, deviceId().c_str(), resetReason().c_str());
  display::begin();
  modem1.begin();
  modem2.begin();
  if (settings.configured()) {
    startWifi();
  } else {
    Serial.println("not set up yet");
    portal::start(false);
  }
  settings.ensureKey();  // after Wi-Fi is on: the radio makes the random numbers truly random
  Serial.printf("device key %s (add it in the panel under Devices)\n", settings.keyFormatted().c_str());
}

void loop() {
  checkBootButton();
  readSerial();
  modem1.loop();
  modem2.loop();
  portal::loop();
  if (settings.configured()) {
    watchWifi();
    if (wifiUp()) cloud::loop();
    if (cloud::setupRequested()) portal::startLan();  // from the panel: only on the gateway's Wi-Fi
    if (cloud::rebootRequested()) {
      Serial.println("restart asked from the panel");
      delay(200);
      ESP.restart();
    }
    ota::loop(updateTick);
    ota::watchdog();
    if (ota::installed() && (events.empty() || ota::restartDue())) {  // the panel knows, or 60 s passed
      Serial.println("restarting into the new firmware");
      delay(200);
      ESP.restart();
    }
  }
  display::loop();
  ledLoop();
  delay(2);
}
