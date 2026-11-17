#include "led.h"
#include <Preferences.h>
#include "config.h"

namespace led {

enum Mode : uint8_t { SOLID, PULSE, SLOW, BLINK, FAST, FLASH, OFF };
static const char *MODES[] = {"solid", "pulse", "slow", "blink", "fast", "flash", "off"};
static const char *NAMES[] = {"ok", "activity", "sim", "server", "wifi", "setup", "update"};  // RESET is fixed

struct Style {
  uint32_t rgb;
  Mode mode;
};

// defaults, the same as the server's
static Style styles[COUNT] = {
    {0x00ff40, SOLID},  // OK: everything works
    {0xffffff, FLASH},  // ACTIVITY: SMS or call
    {0xff8000, SLOW},   // SIM: no SIM card ready
    {0xff0000, SLOW},   // SERVER: Wi-Fi fine, server does not let it in
    {0xffc000, BLINK},  // WIFI: looking for Wi-Fi
    {0x0060ff, BLINK},  // SETUP: setup hotspot open
    {0xa000ff, FAST},   // UPDATE: installing firmware
    {0xff0000, FAST},   // RESET: BOOT held, factory reset countdown
};
static uint8_t brightness = 15;  // percent
static String saved;
static uint32_t lastColor = 0xffffffff, lastWrite = 0;

static bool parse(JsonObjectConst cfg) {
  if (cfg.isNull()) return false;
  brightness = constrain((int)(cfg["b"] | (int)brightness), 0, 100);
  JsonObjectConst s = cfg["s"];
  for (int i = 0; i < 7; i++) {
    const char *v = s[NAMES[i]] | "";  // "rrggbb:mode"
    if (strlen(v) < 8 || v[6] != ':') continue;
    char hex[7];
    memcpy(hex, v, 6);
    hex[6] = 0;
    styles[i].rgb = strtoul(hex, nullptr, 16);
    for (int m = 0; m < 7; m++)
      if (!strcmp(v + 7, MODES[m])) styles[i].mode = (Mode)m;
  }
  return true;
}

void begin() {
  Preferences p;
  p.begin("led", true);
  saved = p.getString("cfg", "");
  p.end();
  if (saved.length()) {
    JsonDocument d;
    if (!deserializeJson(d, saved)) parse(d.as<JsonObjectConst>());
  }
}

void apply(JsonObjectConst cfg) {
  if (cfg.isNull()) return;
  String s;
  serializeJson(cfg, s);
  if (s == saved) return;
  if (!parse(cfg)) return;
  saved = s;
  Preferences p;
  p.begin("led", false);
  p.putString("cfg", s);
  p.end();
  Serial.println("status light colors updated from the panel");
}

// 0..1000: how bright the pattern is at this moment
static uint16_t level(Mode m, uint32_t now) {
  switch (m) {
    case SOLID: return 1000;
    case OFF: return 0;
    case BLINK: return (now % 1000) < 500 ? 1000 : 0;
    case SLOW: return (now % 2000) < 1000 ? 1000 : 0;
    case FAST: return (now % 200) < 100 ? 1000 : 0;
    case FLASH: return (now % 2000) < 120 ? 1000 : 0;
    case PULSE: {  // breathing: 10% .. 100% and back in 2 s
      uint32_t t = now % 2000;
      uint32_t tri = t < 1000 ? t : 2000 - t;
      return 100 + tri * 9 / 10;
    }
  }
  return 0;
}

void show(State s, bool activity) {
  uint32_t now = millis();
  if (now - lastWrite < 20) return;
  lastWrite = now;
  Style st = styles[s];
  uint16_t lv = level(st.mode, now);
  if (activity && styles[ACTIVITY].mode != OFF && s != RESET) {
    st = styles[ACTIVITY];
    lv = 1000;
  }
  uint32_t scale = (uint32_t)lv * brightness;  // 0 .. 100000
  uint8_t r = ((st.rgb >> 16) & 0xff) * scale / 100000;
  uint8_t g = ((st.rgb >> 8) & 0xff) * scale / 100000;
  uint8_t b = (st.rgb & 0xff) * scale / 100000;
  uint32_t color = ((uint32_t)r << 16) | (g << 8) | b;
  if (color == lastColor) return;
  lastColor = color;
  rgbLedWrite(LED_PIN, r, g, b);
}

}  // namespace led
