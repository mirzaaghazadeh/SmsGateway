/*
  SIM800L bench test: one YD-ESP32-S3 (N16R8) + one red SIM800L board.

  It resets the SIM800L, runs the basic checks (UART, supply voltage, SIM card, network, signal),
  prints PASS / FAIL with a hint for every failure, and then becomes a small terminal:
    - type any AT command and press Enter (AT+CSQ, AT+COPS?, AT+CCID, ...)
    - !sms +4912345678 hello   sends a text message (number with country code)
    - !test                    runs the checks again
    - !reset                   hardware reset through the RST wire
  Text messages sent to the SIM card show up as  +CMT: "<sender>",...  followed by the text.

  Wiring
    LM2596 OUT+ (set to 4.0 V BEFORE connecting) -> SIM800L VCC
    LM2596 OUT-                                   -> SIM800L GND -> ESP32 GND (common ground)
    470-1000 uF electrolytic right at the SIM800L VCC/GND pins (+ to VCC)
    SIM800L TXD  -> ESP32 GPIO18
    ESP32 GPIO17 -> 1 kOhm -> SIM800L RXD, and 3.3 kOhm from SIM800L RXD to GND (3.3 V -> 2.5 V)
    SIM800L RST  -> ESP32 GPIO5 (optional)
    Antenna on the SIM800L, micro-SIM with the PIN lock turned off.
  Never power the SIM800L from the ESP32's 3V3 or 5V pin.

  Build: board "ESP32S3 Dev Module". Upload and monitor through the USB-C port marked COM,
  115200 baud, line ending "Both NL & CR" (anything except "No line ending" works).
*/

#include <Arduino.h>

// ---- pins: UART1 of the ESP32-S3 (any free GPIOs work) ----
static const int SIM_RX  = 18;  // ESP32 receives here  <- SIM800L TXD
static const int SIM_TX  = 17;  // ESP32 sends here     -> divider -> SIM800L RXD
static const int SIM_RST = 5;   // -> SIM800L RST (active low); -1 if not wired

static const uint32_t REG_TIMEOUT_MS = 90000;  // max wait for the network

HardwareSerial &sim = Serial1;
int fails = 0;
bool underVoltage = false;
String line;  // what you are typing in the serial monitor

// ---------------- helpers ----------------

void watchFor(const String &s) {
  if (s.indexOf("UNDER-VOLTAGE") >= 0) underVoltage = true;
}

// Throw away what the module sent unasked, but note voltage warnings.
void drain() {
  String s;
  while (sim.available()) s += (char)sim.read();
  watchFor(s);
}

// Send an AT command; return the reply once it contains `expect` or ERROR, or at the timeout.
String at(const String &cmd, uint32_t timeoutMs = 2000, const char *expect = "OK") {
  drain();
  sim.print(cmd);
  sim.print('\r');
  String r;
  uint32_t t0 = millis();
  while (millis() - t0 < timeoutMs) {
    while (sim.available()) r += (char)sim.read();
    if (r.indexOf(expect) >= 0 || r.indexOf("ERROR") >= 0) {
      delay(30);
      while (sim.available()) r += (char)sim.read();
      break;
    }
    delay(5);
  }
  watchFor(r);
  r.trim();
  return r;
}

// The text after `prefix` on its line:  field("+CSQ: 18,0\r\nOK", "+CSQ:") -> "18,0"
String field(const String &r, const char *prefix) {
  int i = r.indexOf(prefix);
  if (i < 0) return "";
  i += strlen(prefix);
  int e = r.indexOf('\n', i);
  String s = e < 0 ? r.substring(i) : r.substring(i, e);
  s.trim();
  return s;
}

String firstLine(const String &r) {
  int e = r.indexOf('\n');
  String s = e < 0 ? r : r.substring(0, e);
  s.trim();
  return s;
}

void report(bool ok, const String &what, const String &hint = "") {
  Serial.printf("  [%s] %s\n", ok ? "PASS" : "FAIL", what.c_str());
  if (!ok) {
    fails++;
    if (hint.length()) Serial.printf("         -> %s\n", hint.c_str());
  }
}

void info(const String &what) { Serial.printf("  [INFO] %s\n", what.c_str()); }
void warn(const String &what) { Serial.printf("  [WARN] %s\n", what.c_str()); }

// "AT" until the module answers OK (in auto-baud mode it learns the baud rate from this).
bool sync(int tries) {
  for (int i = 0; i < tries; i++)
    if (at("AT", 500).indexOf("OK") >= 0) return true;
  return false;
}

// Find the module: auto-baud at 9600 first, then fixed rates it may have been set to.
bool connectModule() {
  const uint32_t rates[] = {9600, 115200, 57600, 38400, 19200};
  for (uint32_t b : rates) {
    sim.updateBaudRate(b);
    if (sync(b == 9600 ? 10 : 4)) {
      info("module answers at " + String(b) + " baud");
      return true;
    }
  }
  sim.updateBaudRate(9600);
  return false;
}

void hardReset() {
  if (SIM_RST < 0) return;
  pinMode(SIM_RST, OUTPUT);
  digitalWrite(SIM_RST, LOW);
  delay(200);
  pinMode(SIM_RST, INPUT);  // let go: the SIM800L pulls RST high itself
  delay(3000);              // boot time
}

// No echo (this sketch echoes your typing instead), error messages as text.
void basicSetup() {
  at("ATE0");
  at("AT+CMEE=2");
}

// SMS in text mode, and print incoming SMS straight away as +CMT.
void smsSetup() {
  at("AT+CMGF=1");
  at("AT+CSCS=\"GSM\"");
  at("AT+CNMI=2,2,0,0,0");
}

const char *regText(int s) {
  switch (s) {
    case 0: return "not searching";
    case 1: return "registered, home network";
    case 2: return "searching";
    case 3: return "registration DENIED";
    case 5: return "registered, roaming";
    default: return "unknown";
  }
}

void printHelp() {
  Serial.println();
  Serial.println("Terminal: type an AT command and press Enter, or");
  Serial.println("  !sms +4912345678 hello   send a text (number with country code)");
  Serial.println("  !test                    run the checks again");
  Serial.printf ("  !reset                   hardware reset (RST wire on GPIO%d)\n", SIM_RST);
  Serial.println("  AT+CSQ signal | AT+CREG? network | AT+CBC voltage | AT+COPS? operator");
  Serial.println("Texts sent to this SIM appear here as +CMT: ...");
  Serial.println();
}

// ---------------- the checks ----------------

void summary() {
  if (underVoltage)
    report(false, "module reported UNDER-VOLTAGE",
           "the supply sags when it transmits: 4.0-4.1 V, short thick wires, big capacitor at the pins");
  Serial.println();
  if (fails == 0)
    Serial.println("=== ALL CHECKS PASSED. Next: !sms +<your number> hello, then text the SIM from your phone ===");
  else
    Serial.printf("=== %d CHECK(S) FAILED: fix the first one first, then type !test ===\n", fails);
  printHelp();
}

void runChecks() {
  fails = 0;
  underVoltage = false;
  Serial.println("\n=== SIM800L check ===");

  // 1. UART + power
  bool alive = connectModule();
  report(alive, "module answers AT over UART",
         "no reply. Is the SIM800L LED blinking? No: power problem. Yes: check SIM800L TXD -> GPIO18, "
         "GPIO17 -> divider -> RXD, and the common GND");
  if (!alive) { summary(); return; }
  basicSetup();
  info("module: " + firstLine(at("ATI")));

  // 2. supply voltage, as the module measures it
  String cbc = field(at("AT+CBC"), "+CBC:");  // "0,80,4012": the last number is mV
  int mv = cbc.substring(cbc.lastIndexOf(',') + 1).toInt();
  if (mv <= 0)
    warn("could not read the supply voltage (AT+CBC)");
  else
    report(mv >= 3800 && mv <= 4300, "supply " + String(mv) + " mV (want 3800-4300)",
           mv < 3800 ? "too low: set the LM2596 to 4.0-4.1 V, short thick wires, capacitor at the pins"
                     : "too high (max 4400): turn the LM2596 down to 4.0 V");

  // 3. SIM card (can take a few seconds after boot)
  String r;
  for (int i = 0; i < 8; i++) {
    r = at("AT+CPIN?", 5000);
    if (r.indexOf("+CPIN:") >= 0) break;
    delay(1000);
  }
  String pin = field(r, "+CPIN:");
  report(pin == "READY", "SIM card: " + (pin.length() ? pin : firstLine(r)),
         pin == "SIM PIN" ? "the SIM asks for a PIN: put it in a phone and turn the SIM PIN lock off"
                          : "no SIM seen: micro-SIM, contacts facing the board, cut corner as printed, push in fully");
  if (pin != "READY") { summary(); return; }

  // 4. network registration. This is when it starts transmitting: a weak supply shows up here.
  Serial.println("  waiting for the network (SIM800L LED: 1 blink/s = searching, 1 blink/3 s = registered)");
  int stat = -1, last = -2, dropouts = 0;
  bool silent = false;
  uint32_t t0 = millis();
  while (millis() - t0 < REG_TIMEOUT_MS) {
    String f = field(at("AT+CREG?"), "+CREG:");  // "0,1": the second number is the state
    if (f.length() == 0) {                        // no answer: the module probably restarted
      if (!silent) dropouts++;
      silent = true;
      if (sync(6)) basicSetup();
      continue;
    }
    silent = false;
    stat = f.substring(f.indexOf(',') + 1).toInt();
    if (stat != last) {
      Serial.printf("    %3lus  %s\n", (unsigned long)((millis() - t0) / 1000), regText(stat));
      last = stat;
    }
    if (stat == 1 || stat == 5 || stat == 3) break;
    delay(2000);
  }
  if (dropouts > 0)
    report(false, "module stopped answering " + String(dropouts) + "x while joining the network",
           "it restarts when it transmits = supply too weak (needs 2 A peaks): 4.0-4.1 V, "
           "short thick wires (not a breadboard), 1000 uF at the pins");
  bool registered = (stat == 1 || stat == 5);
  report(registered, String("network: ") + regText(stat),
         stat == 3 ? "the network refused the SIM: is it active, with credit? Does the operator still allow 2G?"
                   : "not registered: is there still a 2G (GSM) network here? Antenna attached?");

  // 5. signal: 0-31, 99 = none
  String csq = field(at("AT+CSQ"), "+CSQ:");  // "18,0"
  int rssi = csq.length() ? csq.toInt() : 99;
  if (rssi == 99 || rssi == 0) {
    report(false, "signal: none", "antenna attached (IPEX cable or the spring on NET)? Any 2G network here?");
  } else {
    String s = "signal " + String(rssi) + "/31 (" + String(-113 + 2 * rssi) + " dBm)";
    if (rssi < 10) warn(s + ": weak, SMS may fail. Check the antenna, try near a window");
    else report(true, s);
  }

  // 6. operator name
  if (registered) {
    String ops = field(at("AT+COPS?", 10000), "+COPS:");  // 0,0,"Operator"
    int a = ops.indexOf('"'), b = ops.lastIndexOf('"');
    info("operator: " + (a >= 0 && b > a ? ops.substring(a + 1, b) : ops));
  }

  smsSetup();
  summary();
}

// ---------------- SMS + terminal ----------------

void sendSms(const String &number, const String &text) {
  Serial.printf("sending SMS to %s ...\n", number.c_str());
  smsSetup();
  drain();
  sim.print("AT+CMGS=\"" + number + "\"\r");
  String r;
  uint32_t t0 = millis();
  while (millis() - t0 < 5000 && r.indexOf('>') < 0 && r.indexOf("ERROR") < 0) {
    while (sim.available()) r += (char)sim.read();
    delay(5);
  }
  if (r.indexOf('>') < 0) {
    r.trim();
    Serial.println("  [FAIL] the module did not ask for the text: " + r + "  (run !test)");
    return;
  }
  sim.print(text);
  sim.write(0x1A);  // Ctrl+Z = send
  r = "";
  t0 = millis();
  while (millis() - t0 < 60000 && r.indexOf("+CMGS:") < 0 && r.indexOf("ERROR") < 0) {
    while (sim.available()) r += (char)sim.read();
    delay(5);
  }
  delay(50);
  while (sim.available()) r += (char)sim.read();
  watchFor(r);
  r.trim();
  if (r.indexOf("+CMGS:") >= 0)
    Serial.println("  [PASS] SMS sent (" + field(r, "+CMGS:") + ")");
  else if (r.length() == 0)
    Serial.println("  [FAIL] no answer in 60 s: the module probably restarted while sending (power supply)");
  else
    Serial.println("  [FAIL] " + r);
}

void handleLine(String l) {
  l.trim();
  if (l == "!test") { runChecks(); return; }
  if (l == "!help") { printHelp(); return; }
  if (l == "!reset") {
    Serial.println("resetting the SIM800L ...");
    hardReset();
    if (connectModule()) { basicSetup(); smsSetup(); }
    else Serial.println("  [FAIL] no answer after the reset");
    return;
  }
  if (l.startsWith("!sms ")) {
    String rest = l.substring(5);
    rest.trim();
    int sp = rest.indexOf(' ');
    if (sp < 0) { Serial.println("usage: !sms +4912345678 your text"); return; }
    sendSms(rest.substring(0, sp), rest.substring(sp + 1));
    return;
  }
  sim.print(l);  // anything else goes to the module as an AT command
  sim.print('\r');
}

void setup() {
  Serial.begin(115200);
  delay(2000);  // time to open the serial monitor
  sim.begin(9600, SERIAL_8N1, SIM_RX, SIM_TX);
  Serial.println("\nSIM800L bench test (YD-ESP32-S3)");
  if (SIM_RST >= 0) {
    Serial.println("resetting the SIM800L ...");
    hardReset();
  }
  runChecks();
}

void loop() {
  while (sim.available()) Serial.write(sim.read());  // module -> monitor (replies, incoming SMS)

  while (Serial.available()) {                       // monitor -> module, one line at a time
    char c = Serial.read();
    if (c == '\r' || c == '\n') {
      if (line.length()) {
        Serial.println();
        handleLine(line);
      }
      line = "";
    } else if (c == 8 || c == 127) {                 // backspace in a raw terminal
      if (line.length()) {
        line.remove(line.length() - 1);
        Serial.print("\b \b");
      }
    } else {
      line += c;
      Serial.print(c);                               // echo what you type
    }
  }
}
