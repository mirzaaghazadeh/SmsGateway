#pragma once
#include <Arduino.h>

// Wi-Fi and server settings, kept in flash (NVS) across restarts.
struct Settings {
  String ssid;
  String pass;
  String server;   // e.g. https://sms.example.com
  String name;     // shown in the panel until the owner names it there
  bool insecure = false;  // skip the HTTPS certificate check

  // This gateway's own key, e.g. K7Q2M9XD4TPAW3HZ. Made once, shown on the setup page and the
  // screen; the owner adds it in the panel. Kept when Wi-Fi and server are erased.
  String key;

  bool configured() const { return ssid.length() && server.length(); }
  void load();
  void save();
  void erase();            // forget Wi-Fi and server (BOOT held 5 s); the key stays
  void ensureKey();        // make the key if there is none (call with Wi-Fi on: true random numbers)
  void newKey();           // a new key: the panel must add it again
  String keyFormatted() const;  // K7Q2-M9XD-4TPA-W3HZ
};

extern Settings settings;

String deviceId();  // 12 hex characters, from the chip's MAC address
