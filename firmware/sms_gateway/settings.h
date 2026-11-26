#pragma once
#include <Arduino.h>
#include <vector>

// A Wi-Fi network the gateway knows.
struct WifiNet {
  String ssid;
  String pass;
};

static const size_t MAX_NETS = 5;

// Wi-Fi and server settings, kept in flash (NVS) across restarts.
struct Settings {
  // Known Wi-Fi networks (firmware 1.5.0), the one used last first. The gateway joins whichever of
  // them is in range. ssid / pass mirror nets[0], so older firmware (after a rollback) still finds it.
  std::vector<WifiNet> nets;
  String ssid;
  String pass;
  String server;   // e.g. https://sms.example.com
  String name;     // shown in the panel until the owner names it there
  bool insecure = false;  // skip the HTTPS certificate check

  // This gateway's own key, e.g. K7Q2M9XD4TPAW3HZ. Made once, shown on the setup page and the
  // screen; the owner adds it in the panel. Kept when Wi-Fi and server are erased.
  String key;

  bool configured() const { return !nets.empty() && server.length(); }
  void load();
  void save();
  void erase();            // forget Wi-Fi and server (BOOT held 5 s); the key stays
  void ensureKey();        // make the key if there is none (call with Wi-Fi on: true random numbers)
  void newKey();           // a new key: the panel must add it again
  String keyFormatted() const;  // K7Q2-M9XD-4TPA-W3HZ

  const WifiNet *findNet(const String &ssid) const;
  // Add a network, or change its password (an empty password keeps the saved one), and put it
  // first. With more than MAX_NETS, the one used longest ago is dropped. Call save() after.
  void addNet(const String &ssid, const String &pass);
  bool removeNet(const String &ssid);  // false if unknown; call save() after
  void useFirst(const String &ssid);   // this one worked: try it first next time (saves if changed)
};

extern Settings settings;

String deviceId();  // 12 hex characters, from the chip's MAC address
