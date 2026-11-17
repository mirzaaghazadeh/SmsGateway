#pragma once
#include <Arduino.h>

#define FW_VERSION "1.0.0"

// ---- pins (same as ASSEMBLY.md) ----
// SIM800L 1
#define SIM1_RX 18   // ESP32 receives here  <- SIM800L 1 TXD
#define SIM1_TX 17   // ESP32 sends here     -> 1k -> SIM800L 1 RXD (3.3k RXD to GND)
#define SIM1_RST 5   // -> SIM800L 1 RST (-1 if not wired)
// SIM800L 2
#define SIM2_RX 16
#define SIM2_TX 15
#define SIM2_RST 6
// 0.96" SSD1306 OLED (I2C)
#define OLED_SDA 8
#define OLED_SCL 9
#define OLED_ADDR 0x3C
// BOOT button on the ESP32 board: hold 5 s = forget Wi-Fi + server, open the setup hotspot
#define BOOT_PIN 0
#define FACTORY_HOLD_MS 5000
// RGB LED on the YD-ESP32-S3
#define LED_PIN 48

// ---- behaviour ----
#define SIM_BAUD 9600                       // SIM800L UART speed (it adapts to the first "AT")
#define AP_PASSWORD "smsgateway"            // password of the setup hotspot (8+ characters)
#define WIFI_FALLBACK_MS (3UL * 60 * 1000)  // no Wi-Fi for this long: open the setup hotspot as well
#define SYNC_INTERVAL_MS 5000               // check in with the server (the server can change it)
#define JOB_QUEUE_MAX 3                     // SMS / AT jobs waiting per SIM800L

extern uint32_t bootId;
String resetReason();
