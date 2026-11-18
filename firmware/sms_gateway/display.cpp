#include "display.h"
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <Wire.h>
#include "cloud.h"
#include "config.h"
#include "events.h"
#include "modem.h"
#include "portal.h"
#include "settings.h"

namespace display {

static Adafruit_SSD1306 oled(128, 64, &Wire, -1);
static bool found = false;
static uint32_t nextDraw = 0, held = 0, noticeUntil = 0;
static String n1, n2;

void begin() {
  Wire.begin(OLED_SDA, OLED_SCL);
  found = oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR, true, false);
  if (!found) {
    Serial.println("OLED not found (SDA GPIO8, SCL GPIO9, address 0x3C): running without it");
    return;
  }
  oled.dim(true);  // it is on 24/7: lower brightness, longer life
  oled.cp437(true);
  oled.setTextColor(SSD1306_WHITE);
  oled.clearDisplay();
  oled.setTextSize(2);
  oled.setCursor(0, 8);
  oled.print("SMS");
  oled.setCursor(0, 28);
  oled.print("GATEWAY");
  oled.setTextSize(1);
  oled.setCursor(0, 54);
  oled.print("starting  v" FW_VERSION);
  oled.display();
}

static int barsFor(int csq) {
  if (csq <= 0 || csq == 99) return 0;
  int dbm = -113 + 2 * csq;
  return dbm >= -73 ? 4 : dbm >= -85 ? 3 : dbm >= -99 ? 2 : 1;
}

static int wifiBars(int rssi) { return rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : 1; }

static void bars(int x, int y, int n) {
  for (int i = 0; i < 4; i++) {
    int h = 2 + i * 2;
    if (i < n) oled.fillRect(x + i * 3, y + 8 - h, 2, h, SSD1306_WHITE);
    else oled.drawPixel(x + i * 3, y + 7, SSD1306_WHITE);
  }
}

static String shortState(const Modem &m) {
  String s = m.stateName();
  if (s == "ready") {
    String op = m.op.length() ? m.op : String("ready");
    return op.length() > 12 ? op.substring(0, 12) : op;
  }
  if (s == "no_sim") return "no SIM card";
  if (s == "off") return "off";
  if (s == "no_answer") return "not answering";
  if (s == "sim_locked") return "SIM PIN on";
  if (s == "low_power") return "low voltage";
  if (s == "denied") return "refused";
  if (s == "searching") return "searching";
  return "starting";
}

static void simLine(int y, const Modem &m) {
  oled.setCursor(0, y);
  oled.print(m.slot);
  oled.print(' ');
  oled.print(shortState(m));
  if (m.ready()) bars(116, y, barsFor(m.csq));
}

static void drawSetup() {
  bool wifiLost = settings.configured();
  oled.setCursor(0, 0);
  oled.print(wifiLost ? "Wi-Fi not found. Join:" : "SETUP: join Wi-Fi");
  oled.setCursor(0, 10);
  oled.print(portal::apName());
  oled.setCursor(0, 20);
  oled.print("pass " AP_PASSWORD);
  oled.setCursor(0, 30);
  oled.print("open 192.168.4.1");
  oled.drawFastHLine(0, 41, 128, SSD1306_WHITE);
  oled.setCursor(0, 45);
  if (wifiLost) {
    oled.print("still retrying:");
    oled.setCursor(0, 55);
    oled.print(settings.ssid.substring(0, 21));
  } else {
    oled.print("Device key:");
    oled.setCursor(0, 55);
    oled.print(settings.keyFormatted());
  }
}

static void drawStatus() {
  oled.setCursor(0, 0);
  oled.print("SMS GATEWAY");
  if (WiFi.isConnected()) bars(116, 0, wifiBars(WiFi.RSSI()));
  oled.drawFastHLine(0, 10, 128, SSD1306_WHITE);

  oled.setCursor(0, 14);
  if (WiFi.isConnected() && cloud::notAdded()) {
    // the server answered but does not know this gateway yet: show the key to add in the panel
    oled.print("Add in panel, key:");
    oled.setCursor(0, 25);
    oled.print(settings.keyFormatted());
    simLine(37, modem1);
    simLine(48, modem2);
    return;
  }
  if (!WiFi.isConnected()) {
    oled.print("Wi-Fi: connecting");
  } else if (cloud::online()) {
    oled.print("Server OK  ");
    oled.print(WiFi.localIP().toString());
  } else {
    String e = cloud::lastError();
    oled.print("Server: ");
    oled.print(e.length() > 13 ? e.substring(0, 13) : e);
  }
  simLine(26, modem1);
  simLine(37, modem2);
  oled.drawFastHLine(0, 49, 128, SSD1306_WHITE);
  oled.setCursor(0, 54);
  oled.printf("in %lu out %lu call %lu", (unsigned long)statIn, (unsigned long)statOut, (unsigned long)statCalls);
}

void loop() {
  if (!found) return;
  uint32_t now = millis();
  if ((int32_t)(now - nextDraw) < 0) return;
  nextDraw = now + (held ? 100 : 1000);
  oled.clearDisplay();
  oled.setTextSize(1);
  if (held) {
    uint32_t left = held >= FACTORY_HOLD_MS ? 0 : (FACTORY_HOLD_MS - held + 999) / 1000;
    oled.setCursor(0, 4);
    oled.print("Factory reset in");
    oled.setTextSize(3);
    oled.setCursor(54, 20);
    oled.print(left);
    oled.setTextSize(1);
    oled.setCursor(0, 54);
    oled.print("release BOOT: cancel");
  } else if ((int32_t)(now - noticeUntil) < 0) {
    oled.setCursor(0, 16);
    oled.print(n1);
    oled.setCursor(0, 32);
    oled.print(n2);
  } else if (portal::active() && !WiFi.isConnected()) {
    drawSetup();
  } else {
    drawStatus();
    if (portal::active()) {  // hotspot open while online (asked from the panel)
      oled.fillRect(0, 50, 128, 14, SSD1306_BLACK);
      oled.setCursor(0, 54);
      oled.print("setup: ");
      oled.print(portal::apName());
    }
  }
  oled.display();
}

void factoryCountdown(uint32_t heldMs) {
  if ((held == 0) != (heldMs == 0)) nextDraw = 0;  // redraw at once
  held = heldMs;
}

void notice(const String &line1, const String &line2, uint32_t ms) {
  n1 = line1;
  n2 = line2;
  noticeUntil = millis() + ms;
  nextDraw = 0;
  loop();
}

}  // namespace display
