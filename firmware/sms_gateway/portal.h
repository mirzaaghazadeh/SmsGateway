#pragma once
#include <Arduino.h>

// The setup page: pick Wi-Fi networks, server address, device key. Two ways in:
// - the hotspot "SMS-Gateway-XXXX" with a captive page: first setup, or opened by hand (BOOT
//   pressed briefly, or "setup" on the USB console). Never opened by itself once the gateway is set up.
// - firmware 1.5.0: the same page at the gateway's address on its Wi-Fi, for 10 minutes, opened from
//   the panel (or BOOT while Wi-Fi works). Only devices on that Wi-Fi reach it; it does not show the
//   device key and cannot make a new one.
namespace portal {
void start(bool autoClose);  // hotspot; autoClose: close after 10 min without visitors
void startLan();             // the page on the Wi-Fi address (needs Wi-Fi), closes after 10 min without visitors
bool lanMode();
void stop();
void loop();
bool active();
bool busy();  // someone is using the setup page now: the gateway does not start Wi-Fi joins meanwhile
String apName();
}  // namespace portal
