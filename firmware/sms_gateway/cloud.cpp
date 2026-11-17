#include "cloud.h"
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "config.h"
#include "events.h"
#include "led.h"
#include "modem.h"
#include "ota.h"
#include "settings.h"

// The ESP-IDF root certificate bundle that ships inside the ESP32 core (Let's Encrypt, Google, ...),
// so any normal HTTPS certificate is checked without pasting a CA certificate here.
extern const uint8_t x509_crt_bundle_start[] asm("_binary_x509_crt_bundle_start");
extern const uint8_t x509_crt_bundle_end[] asm("_binary_x509_crt_bundle_end");

namespace cloud {

static WiFiClientSecure tls;
static WiFiClient plain;
static HTTPClient http;
static String url;
static bool https = false, started = false;
static bool okLast = false, reboot = false, setup = false, notAddedFlag = false;
static String err = "not connected yet";
static uint32_t nextAt = 0, lastOk = 0, lastTry = 0, interval = SYNC_INTERVAL_MS;
static uint8_t fails = 0;

static bool due(uint32_t t) { return (int32_t)(millis() - t) >= 0; }

void begin() {
  String base = settings.server;
  base.trim();
  while (base.endsWith("/")) base.remove(base.length() - 1);
  url = base + "/api/device/sync";
  https = url.startsWith("https://");
  if (https) {
    if (settings.insecure) tls.setInsecure();
    else tls.setCACertBundle(x509_crt_bundle_start, x509_crt_bundle_end - x509_crt_bundle_start);
  }
  http.setReuse(true);  // keep the connection open: one TLS handshake, not one per sync
  http.setTimeout(10000);
  http.setConnectTimeout(8000);
  started = true;
}

static void addEvent(JsonArray arr, const Event &e) {
  JsonObject o = arr.add<JsonObject>();
  o["seq"] = e.seq;
  switch (e.type) {
    case EV_SMS:
      o["t"] = "sms";
      o["slot"] = e.slot;
      o["idx"] = e.idx;
      o["pdu"] = e.a;
      break;
    case EV_CALL:
      o["t"] = "call";
      o["slot"] = e.slot;
      o["num"] = e.a;
      o["action"] = e.b;
      o["ring"] = e.ms;
      break;
    case EV_JOB:
      o["t"] = "job";
      o["job"] = e.job;
      o["ok"] = e.ok;
      o[e.ok ? "ref" : "err"] = e.a;
      break;
    case EV_AT:
      o["t"] = "at";
      o["job"] = e.job;
      o["ok"] = e.ok;
      o["out"] = e.a;
      break;
    case EV_LOG:
      o["t"] = "log";
      o["slot"] = e.slot;
      o["msg"] = e.a;
      o["level"] = e.b;
      break;
    case EV_FW:
      o["t"] = "fw";
      o["ok"] = e.ok;
      o["version"] = e.a;
      o["msg"] = e.b;
      break;
  }
}

static void handleJob(JsonObject j) {
  uint32_t id = j["id"] | 0;
  const char *type = j["type"] | "";
  Modem *m = modemFor(j["slot"] | 0);

  if (!strcmp(type, "sms") || !strcmp(type, "at")) {
    if (!m) {
      evJob(id, false, "no such SIM");
      return;
    }
    Job job;
    job.id = id;
    if (!strcmp(type, "at")) {
      job.type = Job::AT;
      job.cmd = (const char *)(j["cmd"] | "");
    } else {
      job.type = Job::SMS;
      for (JsonObject p : j["parts"].as<JsonArray>()) {
        job.parts.push_back({(uint16_t)(p["len"] | 0), String((const char *)(p["pdu"] | ""))});
      }
    }
    if (!m->enqueue(job)) {
      evJob(id, false, strcmp(m->stateName(), "no_answer") == 0 ? "the SIM800L is not answering" : "the SIM800L is busy, queue full");
    }
  } else if (!strcmp(type, "modem_reset")) {
    if (!m) {
      evJob(id, false, "no such SIM");
      return;
    }
    evJob(id, true, "restarting the module");
    m->requestReset("restart asked from the panel");
  } else if (!strcmp(type, "reboot")) {
    evJob(id, true, "restarting the gateway");
    reboot = true;
  } else if (!strcmp(type, "setup")) {
    evJob(id, true, "setup hotspot opened");
    setup = true;
  } else {
    evJob(id, false, String("unknown job type ") + type);
  }
}

static bool sync() {
  JsonDocument doc;
  doc["id"] = deviceId();
  doc["name"] = settings.name;
  doc["fw"] = FW_VERSION;
  doc["boot"] = bootId;
  doc["uptime"] = millis() / 1000;
  doc["heap"] = ESP.getFreeHeap();
  doc["reset"] = resetReason();
  size_t busiest = max(modem1.queueLen(), modem2.queueLen());
  doc["free"] = busiest >= JOB_QUEUE_MAX ? 0 : JOB_QUEUE_MAX - busiest;

  JsonObject w = doc["wifi"].to<JsonObject>();
  w["ssid"] = WiFi.SSID();
  w["rssi"] = WiFi.RSSI();
  w["ip"] = WiFi.localIP().toString();

  JsonArray sims = doc["sims"].to<JsonArray>();
  for (Modem *m : {&modem1, &modem2}) {
    JsonObject s = sims.add<JsonObject>();
    s["slot"] = m->slot;
    s["state"] = m->stateName();
    s["sim"] = m->simStatus;
    s["imei"] = m->imei;
    s["iccid"] = m->iccid;
    s["op"] = m->op;
    s["csq"] = m->csq;
    s["reg"] = m->reg;
    s["mv"] = m->mv;
    s["queue"] = m->queueLen();
  }

  JsonArray evs = doc["events"].to<JsonArray>();
  size_t n = 0, bytes = 0;
  for (const Event &e : events) {
    if (n >= 15 || bytes > 12000) break;
    addEvent(evs, e);
    bytes += e.a.length() + 64;
    n++;
  }

  String body;
  serializeJson(doc, body);
  bool begun = https ? http.begin(tls, url) : http.begin(plain, url);
  if (!begun) {
    err = "bad server address";
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + settings.key);
  int code = http.POST(body);
  notAddedFlag = false;
  if (code == 301 || code == 302 || code == 307 || code == 308) {
    String loc = http.getLocation();
    http.end();
    // "http://" saved, but the server only speaks https (Cloudflare, Coolify): switch for good
    String host = settings.server.substring(7);
    if (!https && settings.server.startsWith("http://") && loc.startsWith("https://" + host)) {
      settings.server = "https://" + host;
      settings.save();
      Serial.printf("server: it redirects to https, saved %s\n", settings.server.c_str());
      begin();
      err = "switching to https";
    } else {
      err = "server redirects to " + loc.substring(0, 60);
    }
    return false;
  }
  if (code != 200) {
    String reason;
    if (code == 401 || code == 403) {  // the server says why in {"error": ..., "code": ...}
      JsonDocument e;
      if (!deserializeJson(e, http.getString())) reason = (const char *)(e["code"] | "");
    }
    if (reason == "not_added") {
      err = "add key in panel";
      notAddedFlag = true;
    } else if (reason == "key_in_use") err = "key used by another board";
    else if (code == 401 || code == 403) err = "key refused";
    else if (code == 404) err = "wrong server address (404)";
    else if (code < 0) err = HTTPClient::errorToString(code);
    else err = "server error " + String(code);
    http.end();
    return false;
  }
  String resp = http.getString();
  http.end();

  JsonDocument r;
  if (deserializeJson(r, resp)) {
    err = "unexpected answer from the server";
    return false;
  }
  err = "";
  uint32_t ack = r["ack"] | 0;
  while (!events.empty() && events.front().seq <= ack) {
    const Event &e = events.front();
    if (e.type == EV_SMS) {
      Modem *m = modemFor(e.slot);
      if (m) m->deleteSms(e.idx);  // the server has it: free the SIM storage
    }
    events.pop_front();
  }
  JsonObject cfg = r["config"];
  if (!cfg.isNull()) {
    bool reject = strcmp(cfg["calls"] | "reject", "ignore") != 0;
    modem1.rejectCalls = modem2.rejectCalls = reject;
    uint32_t iv = cfg["interval"] | 5;
    interval = constrain(iv, 2u, 60u) * 1000;
    led::apply(cfg["led"]);
  }
  for (JsonObject j : r["jobs"].as<JsonArray>()) handleJob(j);
  JsonObject u = r["update"];
  if (!u.isNull()) {
    ota::offer(String((const char *)(u["version"] | "")), String((const char *)(u["path"] | "")), u["size"] | 0,
               String((const char *)(u["sha256"] | "")));
  }
  ota::confirm();  // the server answered: this firmware works
  return true;
}

void loop() {
  if (!started) begin();
  uint32_t now = millis();
  bool hurry = !events.empty() && fails == 0 && now - lastTry > 700;  // report new events at once
  if (!due(nextAt) && !hurry) return;
  lastTry = now;
  bool firstOk = !okLast;
  if (sync()) {
    if (firstOk) Serial.printf("server: connected (%s)\n", url.c_str());
    okLast = true;
    lastOk = millis();
    fails = 0;
    nextAt = millis() + interval;
  } else {
    if (okLast || fails == 0) {
      Serial.printf("server: %s (%s)\n", err.c_str(), url.c_str());
      if (notAddedFlag) Serial.printf("add this gateway in the panel under Devices, key %s\n", settings.keyFormatted().c_str());
    }
    okLast = false;
    if (notAddedFlag) {
      fails = 1;
      nextAt = millis() + 5000;  // keep asking: it gets in a few seconds after the key is added
    } else {
      if (fails < 5) fails++;
      nextAt = millis() + min<uint32_t>(30000, 1000u << fails);
    }
  }
}

bool online() { return okLast && millis() - lastOk < 3 * interval + 10000; }
bool notAdded() { return notAddedFlag && !okLast; }
String lastError() { return err; }
bool rebootRequested() { return reboot && events.empty(); }  // after the panel has the answer
bool setupRequested() {
  bool s = setup;
  setup = false;
  return s;
}

}  // namespace cloud
