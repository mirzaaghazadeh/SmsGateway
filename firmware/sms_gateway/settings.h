#pragma once
#include <Arduino.h>

// Wi-Fi and server settings, kept in flash (NVS) across restarts.
struct Settings {
  String ssid;
  String pass;
  String server;   // e.g. https://sms.example.com
  String key;      // device key from the panel
  String name;     // shown in the panel
  bool insecure = false;  // skip the HTTPS certificate check

  bool configured() const { return ssid.length() && server.length() && key.length(); }
  void load();
  void save();
  void erase();
};

extern Settings settings;

String deviceId();  // 12 hex characters, from the chip's MAC address
