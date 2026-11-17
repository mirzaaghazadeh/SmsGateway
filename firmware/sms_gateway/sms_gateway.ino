/*
  SMS Gateway: YD-ESP32-S3 (N16R8) + 2x SIM800L + 0.96" OLED.

  First start: the gateway opens the Wi-Fi hotspot "SMS-Gateway-XXXX" (password: smsgateway).
  Join it with a phone, the setup page opens (or go to http://192.168.4.1): choose your Wi-Fi and
  enter the server address. The page (and the OLED) shows this gateway's device key: add that key
  in the panel under Devices. The gateway made the key itself on its first start.

  Then it checks in with the server every 5 s: status of both SIMs, received SMS (raw PDU),
  missed calls; it gets back SMS to send and commands. All SMS encoding happens on the server.

  Hold the BOOT button for 5 s at any time: Wi-Fi and server settings are erased and the setup
  hotspot opens again; the device key stays. (RST only restarts; BOOT held while pressing RST
  starts the USB flash mode.)
  If the saved Wi-Fi is gone for 3 minutes, the hotspot opens as well, and keeps retrying.

  Arduino IDE: board "ESP32S3 Dev Module", Flash Size 16MB, Partition Scheme
  "16M Flash (3MB APP/9.9MB FATFS)", PSRAM "OPI PSRAM". Upload through the USB-C port marked COM.
  Libraries (Library Manager): ArduinoJson 7, Adafruit SSD1306 (+ Adafruit GFX).
  Serial monitor 115200: type "help".
*/

#include <WiFi.h>
#include "cloud.h"
#include "config.h"
#include "display.h"
#include "events.h"
#include "modem.h"
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

static void checkBootButton() {
  static uint32_t pressedAt = 0;
  if (digitalRead(BOOT_PIN) == LOW) {
    if (!pressedAt) pressedAt = millis();
    uint32_t held = millis() - pressedAt;
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
  }
}

// ---------------- Wi-Fi ----------------

static void startWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("sms-gateway");
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);  // faster answers; the gateway is mains powered anyway
  WiFi.begin(settings.ssid.c_str(), settings.pass.c_str());
  Serial.printf("Wi-Fi: joining \"%s\"\n", settings.ssid.c_str());
}

static void watchWifi() {
  uint32_t now = millis();
  if (WiFi.isConnected()) {
    if (wifiLostSince) Serial.printf("Wi-Fi: connected, address %s\n", WiFi.localIP().toString().c_str());
    wifiLostSince = 0;
    if (!wifiOkSince) wifiOkSince = now;
    // the hotspot was opened because Wi-Fi was gone: close it again once Wi-Fi is back and nobody uses it
    if (portal::active() && WiFi.softAPgetStationNum() == 0 && now - wifiOkSince > 60000) portal::stop();
    return;
  }
  wifiOkSince = 0;
  if (!wifiLostSince) wifiLostSince = now;
  if (!portal::active() && now - wifiLostSince > WIFI_FALLBACK_MS) {
    Serial.println("Wi-Fi: not found for 3 minutes, opening the setup hotspot too");
    portal::start(false);
  }
}

// ---------------- RGB LED ----------------

static void ledLoop() {
  static uint32_t last = 0;
  static uint32_t lastColor = 0xffffffff;
  uint32_t now = millis();
  if (now - last < 40) return;
  last = now;
  bool blink = (now / 500) % 2;
  uint8_t r = 0, g = 0, b = 0;
  if (factoryHeld) r = (now / 100) % 2 ? 40 : 0;                                  // fast red: reset countdown
  else if (portal::active() && !WiFi.isConnected()) b = blink ? 30 : 0;           // blue blink: setup hotspot
  else if (!WiFi.isConnected()) r = blink ? 25 : 0, g = blink ? 12 : 0;           // yellow blink: no Wi-Fi
  else if (!cloud::online()) r = (now / 1000) % 2 ? 30 : 0;                       // slow red: server problem
  else if (now - lastActivityMs < 150) r = g = b = 40;                            // white flash: SMS / call
  else g = 6;                                                                     // dim green: all good
  uint32_t color = (r << 16) | (g << 8) | b;
  if (color != lastColor) {
    lastColor = color;
    rgbLedWrite(LED_PIN, r, g, b);
  }
}

// ---------------- serial console (bench testing) ----------------

static void printStatus() {
  Serial.printf("SMS Gateway %s, id %s, key %s, up %lu s, free heap %u\n", FW_VERSION, deviceId().c_str(),
                settings.keyFormatted().c_str(), (unsigned long)(millis() / 1000), ESP.getFreeHeap());
  Serial.printf("Wi-Fi: %s %s, server %s: %s\n", settings.ssid.c_str(),
                WiFi.isConnected() ? WiFi.localIP().toString().c_str() : "(not connected)", settings.server.c_str(),
                cloud::online() ? "online" : cloud::lastError().c_str());
  if (cloud::notAdded()) Serial.printf("-> add this gateway in the panel under Devices with key %s\n", settings.keyFormatted().c_str());
  for (Modem *m : {&modem1, &modem2}) {
    Serial.printf("SIM%u: %s, SIM %s, operator %s, CSQ %d, reg %d, %d mV, IMEI %s, queue %u\n", m->slot,
                  m->stateName(), m->simStatus.c_str(), m->op.c_str(), m->csq, m->reg, m->mv, m->imei.c_str(),
                  (unsigned)m->queueLen());
  }
  Serial.printf("events waiting for the server: %u\n", (unsigned)events.size());
}

static void serialCommand(String cmd) {
  cmd.trim();
  if (!cmd.length()) return;
  String lower = cmd;
  lower.toLowerCase();
  if (lower == "help") {
    Serial.println("status | at1 <cmd> | at2 <cmd> | debug1 | debug2 | setup | restart | factory-reset");
  } else if (lower == "status") {
    printStatus();
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
    if (WiFi.isConnected()) cloud::loop();
    if (cloud::setupRequested()) portal::start(true);
    if (cloud::rebootRequested()) {
      Serial.println("restart asked from the panel");
      delay(200);
      ESP.restart();
    }
  }
  display::loop();
  ledLoop();
  delay(2);
}
