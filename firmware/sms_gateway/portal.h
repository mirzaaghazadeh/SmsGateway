#pragma once
#include <Arduino.h>

// Setup hotspot "SMS-Gateway-XXXX" with a captive page: pick Wi-Fi, server address, device key.
namespace portal {
void start(bool autoClose);  // autoClose: close after 10 min without visitors (gateway already set up)
void stop();
void loop();
bool active();
String apName();
}  // namespace portal
