#include "ota.h"
#include <HTTPClient.h>
#include <Update.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "config.h"
#include "display.h"
#include "esp_ota_ops.h"
#include "events.h"
#include "mbedtls/sha256.h"
#include "modem.h"
#include "settings.h"

extern const uint8_t x509_crt_bundle_start[] asm("_binary_x509_crt_bundle_start");
extern const uint8_t x509_crt_bundle_end[] asm("_binary_x509_crt_bundle_end");

namespace ota {

static String version, path, sha;
static uint32_t size = 0;
static bool pending = false, running = false, confirmed = false;
static uint32_t restartAt = 0;

void offer(const String &v, const String &p, uint32_t s, const String &h) {
  if (running || v == FW_VERSION || !p.startsWith("/") || !s) return;
  version = v;
  path = p;
  size = s;
  sha = h;
  sha.toLowerCase();
  pending = true;
  Serial.printf("update: firmware %s offered (%u bytes)\n", v.c_str(), (unsigned)s);
}

bool active() { return running; }
bool installed() { return restartAt != 0; }
bool restartDue() { return restartAt && (int32_t)(millis() - restartAt) >= 0; }

static bool install(String &err, void (*tick)()) {
  String base = settings.server;
  while (base.endsWith("/")) base.remove(base.length() - 1);
  String url = base + path + "&id=" + deviceId();
  bool https = url.startsWith("https://");
  WiFiClientSecure tls;
  WiFiClient plain;
  if (https) {
    if (settings.insecure) tls.setInsecure();
    else tls.setCACertBundle(x509_crt_bundle_start, x509_crt_bundle_end - x509_crt_bundle_start);
  }
  HTTPClient http;
  http.setTimeout(20000);
  http.setConnectTimeout(10000);
  if (!(https ? http.begin(tls, url) : http.begin(plain, url))) {
    err = "bad server address";
    return false;
  }
  http.addHeader("Authorization", "Bearer " + settings.key);
  int code = http.GET();
  if (code != 200) {
    err = "download answered " + String(code);
    http.end();
    return false;
  }
  if (http.getSize() != (int)size) {
    err = "download has the wrong size";
    http.end();
    return false;
  }
  if (!Update.begin(size, U_FLASH)) {
    err = String("cannot start: ") + Update.errorString();
    http.end();
    return false;
  }

  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0);
  NetworkClient *stream = http.getStreamPtr();
  static uint8_t buf[2048];
  uint32_t got = 0, lastData = millis();
  int shown = -1;
  while (got < size) {
    size_t avail = stream->available();
    if (avail) {
      int n = stream->read(buf, min(avail, sizeof(buf)));
      if (n > 0) {
        mbedtls_sha256_update(&ctx, buf, n);
        if (Update.write(buf, n) != (size_t)n) {
          err = String("write failed: ") + Update.errorString();
          break;
        }
        got += n;
        lastData = millis();
      }
    } else if (!stream->connected()) {
      err = "connection closed";
      break;
    } else if (millis() - lastData > 20000) {
      err = "download stalled";
      break;
    } else {
      delay(2);
    }
    int pct = got * 100 / size;
    if (pct / 5 != shown) {
      shown = pct / 5;
      display::notice("Updating to " + version, String(pct) + "%  keep it powered", 5000);
    }
    tick();  // SIM800L UARTs, status light
  }
  http.end();
  uint8_t hash[32];
  mbedtls_sha256_finish(&ctx, hash);
  mbedtls_sha256_free(&ctx);
  if (!err.length() && sha.length()) {
    char hex[65];
    for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", hash[i]);
    if (sha != hex) err = "checksum does not match";
  }
  if (err.length()) {
    Update.abort();
    return false;
  }
  if (!Update.end(true)) {
    err = String("cannot finish: ") + Update.errorString();
    return false;
  }
  return true;
}

void loop(void (*tick)()) {
  if (!pending || running || !WiFi.isConnected()) return;
  if (modem1.queueLen() || modem2.queueLen()) return;  // let queued SMS go out first
  pending = false;
  running = true;
  Serial.printf("update: installing %s\n", version.c_str());
  String err;
  bool ok = install(err, tick);
  running = false;
  if (ok) {
    Serial.printf("update: %s installed, restarting\n", version.c_str());
    display::notice("Update installed", "restarting...", 60000);
    evFw(true, version, "");
    restartAt = millis() + 60000;  // or earlier, once the server has the event
  } else {
    Serial.printf("update: %s failed: %s\n", version.c_str(), err.c_str());
    display::notice("Update failed", err.substring(0, 21), 8000);
    evFw(false, version, err);
  }
}

static bool pendingVerify() {
  esp_ota_img_states_t st;
  return esp_ota_get_state_partition(esp_ota_get_running_partition(), &st) == ESP_OK && st == ESP_OTA_IMG_PENDING_VERIFY;
}

void confirm() {
  if (confirmed) return;
  confirmed = true;
  if (pendingVerify()) {
    esp_ota_mark_app_valid_cancel_rollback();
    evLog(0, "firmware " FW_VERSION " works: kept");
  }
}

void watchdog() {
  static uint32_t wifiMs = 0, last = 0;
  static int8_t check = -1;
  uint32_t now = millis();
  uint32_t dt = now - last;
  last = now;
  if (confirmed) return;
  if (check < 0) check = pendingVerify() ? 1 : 0;
  if (!check) return;
  if (WiFi.isConnected()) wifiMs += dt;
  if (wifiMs > 10UL * 60 * 1000) {
    Serial.println("update: the new firmware never reached the server, going back to the old one");
    esp_ota_mark_app_invalid_rollback_and_reboot();
  }
}

}  // namespace ota
