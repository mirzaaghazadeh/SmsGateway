#include "settings.h"
#include <Preferences.h>

Settings settings;

static Preferences prefs;

// letters and digits without 0/O and 1/I, easy to read off the screen
static const char KEY_ALPHABET[] = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

void Settings::load() {
  prefs.begin("gateway", true);
  ssid = prefs.getString("ssid", "");
  pass = prefs.getString("pass", "");
  server = prefs.getString("server", "");
  name = prefs.getString("name", "SMS Gateway");
  insecure = prefs.getBool("insecure", false);
  prefs.end();
  prefs.begin("identity", true);  // separate namespace: survives erase()
  key = prefs.getString("key", "");
  prefs.end();
}

void Settings::save() {
  prefs.begin("gateway", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.putString("server", server);
  prefs.putString("name", name);
  prefs.putBool("insecure", insecure);
  prefs.end();
}

void Settings::erase() {
  prefs.begin("gateway", false);
  prefs.clear();
  prefs.end();
  String k = key;
  *this = Settings();
  key = k;
}

void Settings::newKey() {
  char buf[17];
  for (int i = 0; i < 16; i++) buf[i] = KEY_ALPHABET[esp_random() & 31];  // hardware RNG
  buf[16] = 0;
  key = buf;
  prefs.begin("identity", false);
  prefs.putString("key", key);
  prefs.end();
}

void Settings::ensureKey() {
  if (key.length() != 16) newKey();
}

String Settings::keyFormatted() const {
  if (key.length() != 16) return key;
  return key.substring(0, 4) + "-" + key.substring(4, 8) + "-" + key.substring(8, 12) + "-" + key.substring(12, 16);
}

String deviceId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[13];
  snprintf(buf, sizeof(buf), "%02x%02x%02x%02x%02x%02x", (uint8_t)(mac), (uint8_t)(mac >> 8), (uint8_t)(mac >> 16),
           (uint8_t)(mac >> 24), (uint8_t)(mac >> 32), (uint8_t)(mac >> 40));
  return String(buf);
}
