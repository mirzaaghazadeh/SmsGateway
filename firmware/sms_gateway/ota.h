#pragma once
#include <Arduino.h>

// Firmware updates. The server offers a new version on a check-in (daily at the chosen hour, or after
// "Update now" in the panel). The gateway downloads it from the server, checks its SHA-256, writes it
// to the other app slot and restarts. The new firmware is kept only once it reaches the server;
// if it cannot for 10 minutes (with Wi-Fi up), the gateway goes back to the old one by itself.
namespace ota {
void offer(const String &version, const String &path, uint32_t size, const String &sha256);
void loop(void (*tick)());  // installs a pending update when no SMS is being sent; tick() keeps the rest alive
bool active();               // downloading / installing right now
bool installed();            // a new firmware is written and waits for the restart
bool restartDue();           // installed and 60 s passed (restart even if the server never heard)
void confirm();              // call after a successful server check-in
void watchdog();             // call from loop(): roll back a new firmware that never reaches the server
}  // namespace ota
