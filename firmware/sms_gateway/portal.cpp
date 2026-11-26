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
static bool lan = false;  // open on the Wi-Fi address instead of the hotspot
static uint32_t lastVisit = 0, connStart = 0, restartAt = 0;
enum Conn { IDLE, CONNECTING, CONNECTED, FAILED };
static Conn conn = IDLE;

String apName() {
  String id = deviceId();
  id.toUpperCase();
  return "SMS-Gateway-" + id.substring(8);
}

bool active() { return on; }
bool lanMode() { return on && lan; }
bool busy() { return on && !lan && (WiFi.softAPgetStationNum() > 0 || millis() - lastVisit < 60000 || conn == CONNECTING); }

// The ESP32 cannot scan while it tries to join a network that is not in range (the scan fails
// over and over, and the page showed "Searching for networks" forever). Stop that first; the scan
// starts a moment later (loop), once the join attempt has really stopped.
static uint32_t scanAt = 0;
static void startScan() {
  WiFi.scanDelete();
  if (WiFi.isConnected()) {
    WiFi.scanNetworks(true);
    return;
  }
  WiFi.setAutoReconnect(false);  // or the core starts a new join attempt at once
  WiFi.disconnect(false, false);
  scanAt = millis() + 1000;
}

static void sendJson(JsonDocument &d, int code = 200) {
  String s;
  serializeJson(d, s);
  server.send(code, "application/json", s);
}

static void fail(const char *why);

static void redirect() {
  if (lan) return server.send(404, "text/plain", "Not found");
  server.sendHeader("Location", "http://192.168.4.1/", true);
  server.send(302, "text/plain", "");
}

static void handleRoot() {
  if (!lan && server.hostHeader() != "192.168.4.1" && server.hostHeader().length()) return redirect();
  lastVisit = millis();
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "text/html; charset=utf-8", PORTAL_PAGE);
}

static void handleInfo() {
  JsonDocument d;
  d["id"] = deviceId();
  d["fw"] = FW_VERSION;
  d["ssid"] = WiFi.isConnected() ? WiFi.SSID() : settings.ssid;  // in use now, or tried first
  d["connected"] = WiFi.isConnected();
  JsonArray nets = d["nets"].to<JsonArray>();  // saved networks: names only, passwords never leave
  for (const WifiNet &n : settings.nets) nets.add(n.ssid);
  d["server"] = settings.server;
  d["name"] = settings.name;
  d["insecure"] = settings.insecure;
  d["hasPass"] = settings.pass.length() > 0;
  d["mode"] = lan ? "lan" : "hotspot";
  // the owner copies the key into the panel; on the Wi-Fi others could read it, so only its end
  d["key"] = lan ? String("…") + settings.key.substring(12) : settings.keyFormatted();
  sendJson(d);
}

static void handleNewKey() {
  if (lan) return fail("A new device key can only be made on the gateway's own hotspot.");
  lastVisit = millis();
  settings.newKey();
  Serial.printf("setup: new device key %s\n", settings.keyFormatted().c_str());
  JsonDocument d;
  d["key"] = settings.keyFormatted();
  sendJson(d);
}

static void handleScan() {
  lastVisit = millis();
  if (server.hasArg("again")) startScan();
  JsonDocument d;
  int n = scanAt ? WIFI_SCAN_RUNNING : WiFi.scanComplete();
  if (n == WIFI_SCAN_FAILED) {
    startScan();
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

  String pass = server.arg("pass");
  if (ssid.length() > 32) return fail("A Wi-Fi name has at most 32 characters.");
  if (pass.length() > 63 || (pass.length() && pass.length() < 8)) return fail("A Wi-Fi password has 8 to 63 characters.");

  // the network joins the saved ones (an empty password keeps the saved one) and is tried first
  settings.addNet(ssid, pass);
  settings.server = srv;
  settings.name = name.length() ? name : String("SMS Gateway");
  settings.insecure = server.arg("insecure") == "1";
  if (lan) {  // opened on the Wi-Fi: keep this connection, the new network is used when it is in range
    if (WiFi.isConnected() && WiFi.SSID() != ssid) settings.useFirst(WiFi.SSID());
    settings.save();
    Serial.printf("settings page: saved, \"%s\" added\n", ssid.c_str());
    JsonDocument d;
    d["ok"] = true;
    d["kept"] = true;
    return sendJson(d);
  }
  settings.save();
  Serial.printf("setup: saved, joining \"%s\"\n", ssid.c_str());

  conn = CONNECTING;
  connStart = millis();
  WiFi.disconnect(false, false);
  WiFi.begin(settings.nets[0].ssid.c_str(), settings.nets[0].pass.c_str());
  JsonDocument d;
  d["ok"] = true;
  sendJson(d);
}

// Forget a saved network. The last one stays: without any, the gateway could never come back.
static void handleForget() {
  lastVisit = millis();
  String ssid = server.arg("ssid");
  if (settings.nets.size() <= 1 && settings.findNet(ssid)) return fail("Keep at least one Wi-Fi network.");
  if (WiFi.isConnected() && WiFi.SSID() == ssid) return fail("The gateway is using this Wi-Fi right now.");
  if (!settings.removeNet(ssid)) return fail("This network is not saved.");
  settings.save();
  Serial.printf("setup: forgot \"%s\"\n", ssid.c_str());
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

static void addRoutes() {
  if (routes) return;
  server.on("/", HTTP_GET, handleRoot);
  server.on("/info", HTTP_GET, handleInfo);
  server.on("/scan", HTTP_GET, handleScan);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/forget", HTTP_POST, handleForget);
  server.on("/newkey", HTTP_POST, handleNewKey);
  server.on("/status", HTTP_GET, handleStatus);
  server.onNotFound(redirect);
  routes = true;
}

void start(bool autoClose) {
  if (on && lan) stop();  // the hotspot replaces the page on the Wi-Fi
  if (on) return;
  WiFi.mode(WIFI_AP_STA);  // station part is needed for scanning (and keeps a saved Wi-Fi alive)
  WiFi.softAPConfig(AP_IP, AP_IP, IPAddress(255, 255, 255, 0));
  WiFi.softAP(apName().c_str(), AP_PASSWORD);
  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", AP_IP);  // every name points here: phones show the page by themselves
  addRoutes();
  server.begin();
  on = true;
  lan = false;
  lastVisit = millis();
  startScan();
  closeWhenIdle = autoClose;
  conn = IDLE;
  Serial.printf("setup hotspot \"%s\" (password %s), open http://192.168.4.1\n", apName().c_str(), AP_PASSWORD);
}

void startLan() {
  if (on || !WiFi.isConnected()) return;
  addRoutes();
  server.begin();
  on = true;
  lan = true;
  closeWhenIdle = true;
  lastVisit = millis();
  conn = IDLE;
  Serial.printf("settings page open at http://%s for 10 minutes (only on this Wi-Fi)\n", WiFi.localIP().toString().c_str());
}

void stop() {
  if (!on) return;
  server.stop();
  on = false;
  if (lan) {
    lan = false;
    Serial.println("settings page closed");
    return;
  }
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  Serial.println("setup hotspot closed");
}

void loop() {
  if (!on) return;
  if (!lan) dns.processNextRequest();
  server.handleClient();
  uint32_t now = millis();
  if (scanAt && (int32_t)(now - scanAt) >= 0) {
    scanAt = 0;
    if (WiFi.scanNetworks(true) == WIFI_SCAN_FAILED) scanAt = now + 2000;  // try again shortly
  }
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
  if (lan && !WiFi.isConnected()) stop();  // the Wi-Fi is gone: so is the page on it
}

}  // namespace portal
