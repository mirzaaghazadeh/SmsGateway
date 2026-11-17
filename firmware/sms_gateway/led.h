#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

// The RGB status light. Each state has a color and a pattern; the server sends them (Settings ->
// Status light in the panel) and they are saved, so they also work without Wi-Fi.
namespace led {
enum State : uint8_t { OK, ACTIVITY, SIM, SERVER, WIFI, SETUP, UPDATE, RESET, COUNT };

void begin();                     // load the saved colors
void apply(JsonObjectConst cfg);  // {"b":15,"s":{"ok":"00ff40:solid",...}}; saved when it changed
void show(State s, bool activity);  // call often from loop()
}  // namespace led
