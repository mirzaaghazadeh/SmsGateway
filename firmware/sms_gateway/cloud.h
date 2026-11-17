#pragma once
#include <Arduino.h>

// Talks to the server: POST /api/device/sync every few seconds with the status and the
// events, and receives jobs (SMS to send, AT commands, restart) plus settings.
namespace cloud {
void begin();
void loop();             // call only while Wi-Fi is connected

bool online();           // last sync worked and is recent
String lastError();      // why the last sync failed ("" when fine)
bool rebootRequested();  // the panel asked for a restart
bool setupRequested();   // the panel asked to open the setup hotspot (cleared when read)
}  // namespace cloud
