#include "settings.h"
#include <Preferences.h>

Settings settings;

static Preferences prefs;

void Settings::load() {
  prefs.begin("gateway", true);
  ssid = prefs.getString("ssid", "");
  pass = prefs.getString("pass", "");
  server = prefs.getString("server", "");
  key = prefs.getString("key", "");
  name = prefs.getString("name", "SMS Gateway");
  insecure = prefs.getBool("insecure", false);
  prefs.end();
}

void Settings::save() {
  prefs.begin("gateway", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.putString("server", server);
  prefs.putString("key", key);
  prefs.putString("name", name);
  prefs.putBool("insecure", insecure);
  prefs.end();
}

void Settings::erase() {
  prefs.begin("gateway", false);
  prefs.clear();
  prefs.end();
  *this = Settings();
}

String deviceId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[13];
  snprintf(buf, sizeof(buf), "%02x%02x%02x%02x%02x%02x", (uint8_t)(mac), (uint8_t)(mac >> 8), (uint8_t)(mac >> 16),
           (uint8_t)(mac >> 24), (uint8_t)(mac >> 32), (uint8_t)(mac >> 40));
  return String(buf);
}
