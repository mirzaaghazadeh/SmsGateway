#include "portal.h"
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>
#include "config.h"
#include "portal_page.h"
#include "settings.h"

namespace portal {

static WebServer server(80);
static DNSServer dns;
static const IPAddress AP_IP(192, 168, 4, 1);
static bool on = false, closeWhenIdle = false, routes = false;
static uint32_t lastVisit = 0, connStart = 0, restartAt = 0;
enum Conn { IDLE, CONNECTING, CONNECTED, FAILED };
static Conn conn = IDLE;

String apName() {
  String id = deviceId();
  id.toUpperCase();
  return "SMS-Gateway-" + id.substring(8);
}

bool active() { return on; }

static void sendJson(JsonDocument &d, int code = 200) {
  String s;
  serializeJson(d, s);
  server.send(code, "application/json", s);
}

static void redirect() {
  server.sendHeader("Location", "http://192.168.4.1/", true);
  server.send(302, "text/plain", "");
}

static void handleRoot() {
  if (server.hostHeader() != "192.168.4.1" && server.hostHeader().length()) return redirect();
  lastVisit = millis();
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "text/html; charset=utf-8", PORTAL_PAGE);
}

static void handleInfo() {
  JsonDocument d;
  d["id"] = deviceId();
  d["fw"] = FW_VERSION;
  d["ssid"] = settings.ssid;
  d["server"] = settings.server;
  d["name"] = settings.name;
  d["insecure"] = settings.insecure;
  d["hasPass"] = settings.pass.length() > 0;  // the Wi-Fi password is never sent back
  d["key"] = settings.keyFormatted();         // the owner copies this into the panel
  sendJson(d);
}

static void handleNewKey() {
  lastVisit = millis();
  settings.newKey();
  Serial.printf("setup: new device key %s\n", settings.keyFormatted().c_str());
  JsonDocument d;
  d["key"] = settings.keyFormatted();
  sendJson(d);
}

static void handleScan() {
  if (server.hasArg("again")) {
    WiFi.scanDelete();
    WiFi.scanNetworks(true);
  }
  JsonDocument d;
  int n = WiFi.scanComplete();
  if (n == WIFI_SCAN_FAILED) {
    WiFi.scanNetworks(true);
    n = WIFI_SCAN_RUNNING;
  }
  if (n == WIFI_SCAN_RUNNING) {
    d["scanning"] = true;
    return sendJson(d);
  }
  JsonArray arr = d["networks"].to<JsonArray>();
  // strongest first, one entry per name
  std::vector<int> order;
  for (int i = 0; i < n; i++) order.push_back(i);
  std::sort(order.begin(), order.end(), [](int a, int b) { return WiFi.RSSI(a) > WiFi.RSSI(b); });
  std::vector<String> seen;
  for (int i : order) {
    String s = WiFi.SSID(i);
    if (!s.length() || std::find(seen.begin(), seen.end(), s) != seen.end()) continue;
    seen.push_back(s);
    JsonObject o = arr.add<JsonObject>();
    o["ssid"] = s;
    o["rssi"] = WiFi.RSSI(i);
    o["lock"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
  }
  sendJson(d);
}

static void fail(const char *why) {
  JsonDocument d;
  d["ok"] = false;
  d["error"] = why;
  sendJson(d, 400);
}

static void handleSave() {
  lastVisit = millis();
  String ssid = server.arg("ssid");
  String srv = server.arg("server");
  String name = server.arg("name");
  ssid.trim();
  srv.trim();
  name.trim();
  if (!ssid.length()) return fail("Choose your Wi-Fi network.");
  if (!srv.startsWith("http://") && !srv.startsWith("https://")) srv = "https://" + srv;  // "sms.example.com" is fine too
  while (srv.endsWith("/")) srv.remove(srv.length() - 1);
  if (srv.length() < 12 || srv.indexOf('.') < 0) return fail("Enter your server address, like https://sms.example.com");

  bool sameNet = ssid == settings.ssid;
  settings.ssid = ssid;
  if (server.arg("pass").length() || !sameNet) settings.pass = server.arg("pass");
  settings.server = srv;
  settings.name = name.length() ? name : String("SMS Gateway");
  settings.insecure = server.arg("insecure") == "1";
  settings.save();
  Serial.printf("setup: saved, joining \"%s\"\n", ssid.c_str());

  conn = CONNECTING;
  connStart = millis();
  WiFi.disconnect(false, false);
  WiFi.begin(settings.ssid.c_str(), settings.pass.c_str());
  JsonDocument d;
  d["ok"] = true;
  sendJson(d);
}

static void handleStatus() {
  lastVisit = millis();
  JsonDocument d;
  d["state"] = conn == CONNECTING ? "connecting" : conn == CONNECTED ? "connected" : conn == FAILED ? "failed" : "idle";
  if (conn == CONNECTED) d["ip"] = WiFi.localIP().toString();
  sendJson(d);
}

void start(bool autoClose) {
  if (on) return;
  WiFi.mode(WIFI_AP_STA);  // station part is needed for scanning (and keeps a saved Wi-Fi alive)
  WiFi.softAPConfig(AP_IP, AP_IP, IPAddress(255, 255, 255, 0));
  WiFi.softAP(apName().c_str(), AP_PASSWORD);
  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", AP_IP);  // every name points here: phones show the page by themselves
  if (!routes) {
    server.on("/", HTTP_GET, handleRoot);
    server.on("/info", HTTP_GET, handleInfo);
    server.on("/scan", HTTP_GET, handleScan);
    server.on("/save", HTTP_POST, handleSave);
    server.on("/newkey", HTTP_POST, handleNewKey);
    server.on("/status", HTTP_GET, handleStatus);
    server.onNotFound(redirect);
    routes = true;
  }
  server.begin();
  WiFi.scanNetworks(true);
  on = true;
  closeWhenIdle = autoClose;
  lastVisit = millis();
  conn = IDLE;
  Serial.printf("setup hotspot \"%s\" (password %s), open http://192.168.4.1\n", apName().c_str(), AP_PASSWORD);
}

void stop() {
  if (!on) return;
  dns.stop();
  server.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  on = false;
  Serial.println("setup hotspot closed");
}

void loop() {
  if (!on) return;
  dns.processNextRequest();
  server.handleClient();
  uint32_t now = millis();
  if (WiFi.softAPgetStationNum() > 0) lastVisit = now;
  if (conn == CONNECTING) {
    if (WiFi.status() == WL_CONNECTED) {
      conn = CONNECTED;
      restartAt = now + 6000;  // time for the phone to read the result
      Serial.printf("setup: connected, address %s; restarting\n", WiFi.localIP().toString().c_str());
    } else if (now - connStart > 25000) {
      conn = FAILED;
      Serial.println("setup: could not join the Wi-Fi");
    }
  }
  if (conn == CONNECTED && (int32_t)(now - restartAt) >= 0) ESP.restart();
  if (closeWhenIdle && conn == IDLE && now - lastVisit > 10UL * 60 * 1000) stop();
}

}  // namespace portal
