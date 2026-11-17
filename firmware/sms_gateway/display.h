#pragma once
#include <Arduino.h>

// 0.96" SSD1306 OLED: setup instructions, Wi-Fi / server state, both SIMs, counters.
namespace display {
void begin();
void loop();
void factoryCountdown(uint32_t heldMs);  // 0 = not held
void notice(const String &line1, const String &line2, uint32_t ms = 3000);
}  // namespace display
