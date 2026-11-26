#include "settings.h"
#include <ArduinoJson.h>
#include <Preferences.h>

Settings settings;

static Preferences prefs;

// letters and digits without 0/O and 1/I, easy to read off the screen
static const char KEY_ALPHABET[] = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

void Settings::load() {
  prefs.begin("gateway", true);
  ssid = prefs.getString("ssid", "");
  pass = prefs.getString("pass", "");
  String list = prefs.getString("nets", "");  // firmware 1.5.0: [{"s": ssid, "p": password}, ...]
  server = prefs.getString("server", "");
  name = prefs.getString("name", "SMS Gateway");
  insecure = prefs.getBool("insecure", false);
  prefs.end();
  prefs.begin("identity", true);  // separate namespace: survives erase()
  key = prefs.getString("key", "");
  prefs.end();

  nets.clear();
  JsonDocument d;
  if (list.length() && !deserializeJson(d, list)) {
    for (JsonObject o : d.as<JsonArray>()) {
      String s = o["s"] | "";
      if (s.length() && nets.size() < MAX_NETS) nets.push_back({s, String((const char *)(o["p"] | ""))});
    }
  }
  if (nets.empty() && ssid.length()) nets.push_back({ssid, pass});  // saved by older firmware
  ssid = nets.empty() ? String() : nets[0].ssid;
  pass = nets.empty() ? String() : nets[0].pass;
}

void Settings::save() {
  ssid = nets.empty() ? String() : nets[0].ssid;
  pass = nets.empty() ? String() : nets[0].pass;
  JsonDocument d;
  JsonArray a = d.to<JsonArray>();
  for (const WifiNet &n : nets) {
    JsonObject o = a.add<JsonObject>();
    o["s"] = n.ssid;
    o["p"] = n.pass;
  }
  String list;
  serializeJson(d, list);
  prefs.begin("gateway", false);
  prefs.putString("ssid", ssid);  // older firmware reads only these two
  prefs.putString("pass", pass);
  prefs.putString("nets", list);
  prefs.putString("server", server);
  prefs.putString("name", name);
  prefs.putBool("insecure", insecure);
  prefs.end();
}

const WifiNet *Settings::findNet(const String &s) const {
  for (const WifiNet &n : nets)
    if (n.ssid == s) return &n;
  return nullptr;
}

void Settings::addNet(const String &s, const String &p) {
  String keep = p;
  for (auto it = nets.begin(); it != nets.end(); ++it) {
    if (it->ssid != s) continue;
    if (!keep.length()) keep = it->pass;  // empty: keep the saved password
    nets.erase(it);
    break;
  }
  nets.insert(nets.begin(), {s, keep});
  while (nets.size() > MAX_NETS) nets.pop_back();
}

bool Settings::removeNet(const String &s) {
  for (auto it = nets.begin(); it != nets.end(); ++it) {
    if (it->ssid != s) continue;
    nets.erase(it);
    return true;
  }
  return false;
}

void Settings::useFirst(const String &s) {
  if (nets.empty() || nets[0].ssid == s) return;  // nothing to change: no flash write
  for (size_t i = 1; i < nets.size(); i++) {
    if (nets[i].ssid != s) continue;
    WifiNet n = nets[i];
    nets.erase(nets.begin() + i);
    nets.insert(nets.begin(), n);
    save();
    return;
  }
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
