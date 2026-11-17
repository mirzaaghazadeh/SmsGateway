#include "modem.h"
#include "config.h"
#include "events.h"

Modem modem1(1, Serial1, SIM1_RX, SIM1_TX, SIM1_RST);
Modem modem2(2, Serial2, SIM2_RX, SIM2_TX, SIM2_RST);

Modem *modemFor(uint8_t slot) { return slot == 1 ? &modem1 : slot == 2 ? &modem2 : nullptr; }

// After the module answers "AT": echo off, verbose errors, caller ID on, PDU mode, read the IMEI.
static const char *INIT_CMDS[] = {"ATE0", "AT+CMEE=2", "AT+CLIP=1", "AT+CMGF=0", "AT+GSN"};
static const uint8_t INIT_N = sizeof(INIT_CMDS) / sizeof(INIT_CMDS[0]);
// After the SIM is ready: read its ID, keep SMS on the SIM card and announce new ones with +CMTI.
static const char *NET_CMDS[] = {"AT+CCID", "AT+CPMS=\"SM\",\"SM\",\"SM\"", "AT+CNMI=2,1,0,0,0"};
static const uint8_t NET_N = sizeof(NET_CMDS) / sizeof(NET_CMDS[0]);

static String field(const String &resp, const char *prefix) {
  int i = resp.indexOf(prefix);
  if (i < 0) return "";
  i += strlen(prefix);
  int e = resp.indexOf('\n', i);
  String s = e < 0 ? resp.substring(i) : resp.substring(i, e);
  s.trim();
  return s;
}

static String firstLine(const String &resp) {
  int e = resp.indexOf('\n');
  String s = e < 0 ? resp : resp.substring(0, e);
  s.trim();
  return s;
}

Modem::Modem(uint8_t slot, HardwareSerial &port, int rx, int tx, int rst)
    : slot(slot), port_(port), rx_(rx), tx_(tx), rst_(rst) {}

void Modem::begin() {
  port_.setRxBufferSize(4096);  // room for a full SMS listing while the ESP32 talks to the server
  port_.begin(SIM_BAUD, SERIAL_8N1, rx_, tx_);
  if (rst_ >= 0) pinMode(rst_, INPUT);  // released: the SIM800L pulls RST high itself
  setState(St::RESET);
}

void Modem::setState(St s, uint32_t waitMs) {
  st_ = s;
  stUntil_ = millis() + waitMs;
  step_ = 0;
  tries_ = 0;
}

void Modem::requestReset(const char *why) {
  if (why) evLog(slot, String("restarting the SIM800L: ") + why, "warn");
  busy_ = false;
  if (jobActive_ && !jobs_.empty()) {
    if (jobs_.front().type == Job::AT) {
      evAt(jobs_.front().id, false, "module restarted");
      jobs_.pop_front();
      jobActive_ = false;
    } else {
      finishJob(false, "module restarted while sending");
    }
  }
  if (call_) endCall(hangSent_ ? "rejected" : "missed");
  setState(St::RESET);
}

bool Modem::enqueue(const Job &job) {
  if (st_ == St::DEAD || jobs_.size() >= JOB_QUEUE_MAX) return false;
  jobs_.push_back(job);
  return true;
}

void Modem::deleteSms(int idx) {
  for (int d : del_)
    if (d == idx) return;
  del_.push_back(idx);
}

bool Modem::ready() const { return st_ == St::IDLE && (reg == 1 || reg == 5); }

const char *Modem::stateName() const {
  switch (st_) {
    case St::DEAD:
      return lowPower_ ? "low_power" : "no_answer";
    case St::SIM_WAIT:
      if (simStatus == "NOT INSERTED") return "no_sim";
      if (simStatus.startsWith("SIM PIN") || simStatus.startsWith("SIM PUK")) return "sim_locked";
      return "starting";
    case St::IDLE:
      if (reg == 1 || reg == 5) return "ready";
      if (reg == 3) return "denied";
      return "searching";
    default:
      return lowPower_ ? "low_power" : "starting";
  }
}

// ---------------- UART ----------------

void Modem::readPort() {
  while (port_.available()) {
    char c = (char)port_.read();
    if (c == '\n') {
      String l = line_;
      line_ = "";
      l.trim();
      if (l.length()) handleLine(l);
    } else if (c == '\r') {
      continue;
    } else if (c == '>' && busy_ && wantPrompt_ && line_.length() == 0) {
      res_ = Res::PROMPT;  // "> " asks for the SMS PDU
    } else if (line_.length() < 1024) {
      line_ += c;
    }
  }
}

void Modem::handleLine(const String &l) {
  if (debug) Serial.printf("[SIM%u] < %s\n", slot, l.c_str());

  // the line after "+CMGL:" / "+CMGR:" is the SMS PDU
  if (expectPdu_) {
    expectPdu_ = false;
    if (busy_) {
      resp_ += l;
      resp_ += '\n';
    }
    return;
  }

  // ---- unsolicited messages ----
  if (l.startsWith("+CMTI:")) {  // a new SMS was stored on the SIM card
    scanDue_ = true;
    return;
  }
  if (l == "RING") {
    ringing();
    return;
  }
  if (l.startsWith("+CLIP:")) {
    int a = l.indexOf('"');
    int b = l.indexOf('"', a + 1);
    ringing();
    if (call_ && !callNum_.length() && a >= 0 && b > a) callNum_ = l.substring(a + 1, b);
    return;
  }
  if (l == "NO CARRIER" || l == "BUSY" || l == "NO ANSWER") {
    if (call_) endCall(hangSent_ ? "rejected" : "missed");
    return;
  }
  if (l.startsWith("UNDER-VOLTAGE") || l.startsWith("OVER-VOLTAGE")) {
    bool down = l.indexOf("POWER DOWN") >= 0;
    evLog(slot, l + (mv ? " (last reading " + String(mv / 1000.0, 2) + " V)" : String("")), down ? "error" : "warn");
    if (down) {
      lowPower_ = true;
      requestReset(nullptr);
    }
    return;
  }
  if (l == "NORMAL POWER DOWN") {
    requestReset("the module switched itself off");
    return;
  }
  if (l == "RDY" || l == "Call Ready" || l == "SMS Ready") {
    if (l == "SMS Ready") scanDue_ = true;
    if (l == "RDY" && st_ == St::IDLE) {
      evLog(slot, "the SIM800L restarted by itself (power dip?)", "warn");
      setState(St::PROBE);
    }
    return;
  }
  if (l.startsWith("+CPIN:") && !(busy_ && tag_ == T_CPIN)) {
    simStatus = l.substring(6);
    simStatus.trim();
    if (simStatus != "READY" && st_ == St::IDLE) setState(St::SIM_WAIT, 2000);
    return;
  }
  if (l.startsWith("+CFUN:") || l.startsWith("*PSUTTZ") || l.startsWith("+CTZV") || l.startsWith("DST:") ||
      l.startsWith("+CIEV") || l.startsWith("+CPMS:") && !busy_) {
    return;  // network time and similar notices
  }

  // ---- reply to the running command ----
  if (!busy_) return;
  if (l == "OK") {
    res_ = Res::OK;
    return;
  }
  if (l == "ERROR" || l.startsWith("+CME ERROR") || l.startsWith("+CMS ERROR")) {
    resp_ += l;
    res_ = Res::ERR;
    return;
  }
  if (l.startsWith("+CMGL:") || l.startsWith("+CMGR:")) expectPdu_ = true;
  resp_ += l;
  resp_ += '\n';
}

void Modem::send(const String &cmd, Tag tag, uint32_t timeoutMs, bool wantPrompt) {
  resp_ = "";
  res_ = Res::NONE;
  tag_ = tag;
  busy_ = true;
  wantPrompt_ = wantPrompt;
  expectPdu_ = false;
  deadline_ = millis() + timeoutMs;
  port_.print(cmd);
  port_.print('\r');
  if (debug || tag == T_AT_USER || tag == T_CMGS) Serial.printf("[SIM%u] > %s\n", slot, cmd.c_str());
}

// ---------------- main loop ----------------

void Modem::loop() {
  readPort();
  uint32_t now = millis();
  if (call_ && now - lastRing_ > 9000) endCall(hangSent_ ? "rejected" : "missed");
  if (busy_) {
    if (res_ == Res::NONE && due(deadline_)) res_ = Res::TIMEOUT;
    if (res_ == Res::NONE) return;
    busy_ = false;
    String resp = resp_;
    onResult(tag_, res_, resp);
    return;
  }
  step(now);
}

void Modem::step(uint32_t now) {
  switch (st_) {
    case St::RESET:
      if (rst_ < 0) {  // no RST wire: just start talking
        setState(St::BOOT_WAIT, 500);
      } else if (!rstLow_) {
        pinMode(rst_, OUTPUT);
        digitalWrite(rst_, LOW);
        rstLow_ = true;
        stUntil_ = now + 300;
      } else if (due(stUntil_)) {
        pinMode(rst_, INPUT);
        rstLow_ = false;
        setState(St::BOOT_WAIT, 4000);
      }
      break;

    case St::BOOT_WAIT:
      if (due(stUntil_)) setState(St::PROBE);
      break;

    case St::PROBE:
      if (!due(stUntil_)) break;
      if (tries_ >= 20) {
        if (++fails_ >= 3) {
          evLog(slot, "the SIM800L does not answer: check its 4.0 V supply and the TX/RX wires", "error");
          setState(St::DEAD, 120000);
        } else {
          setState(St::RESET);
        }
        break;
      }
      tries_++;
      stUntil_ = now + 500;
      send("AT", T_PROBE, 450);
      break;

    case St::DEAD:
      while (!jobs_.empty()) {
        if (jobs_.front().type == Job::AT) {
          evAt(jobs_.front().id, false, "the SIM800L is not answering");
          jobs_.pop_front();
        } else {
          finishJob(false, "the SIM800L is not answering");
        }
      }
      if (due(stUntil_)) {
        fails_ = 0;
        setState(St::RESET);
      }
      break;

    case St::INIT:
      if (!due(stUntil_)) break;
      if (step_ >= INIT_N) {
        setState(St::SIM_WAIT);
        break;
      }
      send(INIT_CMDS[step_], T_INIT, 3000);
      break;

    case St::SIM_WAIT:
      if (!jobs_.empty() && jobs_.front().type == Job::AT) {  // the console still works without a SIM
        startJob();
        break;
      }
      if (due(stUntil_)) send("AT+CPIN?", T_CPIN, 5000);
      break;

    case St::NET_INIT:
      if (!due(stUntil_)) break;
      if (step_ >= NET_N) {
        setState(St::IDLE);
        fails_ = 0;
        lowPower_ = false;
        scanDue_ = true;
        pollStep_ = 0;
        nextPoll_ = now;
        evLog(slot, "SIM800L ready (SIM " + iccid + ")");
        break;
      }
      send(NET_CMDS[step_], T_NET, 5000);
      break;

    case St::IDLE:
      idle(now);
      break;
  }
}

void Modem::idle(uint32_t now) {
  if (call_ && rejectCalls && !hangSent_ && (callNum_.length() || now - callStart_ > 3000)) {
    hangSent_ = true;
    send("ATH", T_ATH, 5000);
    return;
  }
  if (!del_.empty()) {
    send("AT+CMGD=" + String(del_.front()), T_CMGD, 5000);
    return;
  }
  if (scanDue_ || due(nextScan_)) {
    scanDue_ = false;
    nextScan_ = now + 60000;
    send("AT+CMGL=4", T_CMGL, 20000);  // list every SMS on the SIM card (PDU mode)
    return;
  }
  if (!call_ && !jobs_.empty() && (jobs_.front().type == Job::AT || ready())) {
    startJob();
    return;
  }
  if (due(nextPoll_)) {
    static const char *POLL[] = {"AT+CSQ", "AT+CREG?", "AT+COPS?", "AT+CBC", "AT+CPIN?"};
    static const Tag TAGS[] = {T_CSQ, T_CREG, T_COPS, T_CBC, T_CPIN};
    if (pollStep_ >= 5) {
      pollStep_ = 0;
      nextPoll_ = now + 15000;
      return;
    }
    send(POLL[pollStep_], TAGS[pollStep_], 5000);
    pollStep_++;
  }
}

void Modem::onResult(Tag tag, Res res, const String &resp) {
  uint32_t now = millis();
  bool ok = res == Res::OK;
  switch (tag) {
    case T_PROBE:
      if (ok) setState(St::INIT);
      break;

    case T_INIT:
      if (ok) {
        if (strcmp(INIT_CMDS[step_], "AT+GSN") == 0) imei = firstLine(resp);
        step_++;
        tries_ = 0;
      } else if (++tries_ > 3) {
        evLog(slot, String(INIT_CMDS[step_]) + " failed: " + resp, "warn");
        requestReset(nullptr);
      } else {
        stUntil_ = now + 1000;
      }
      break;

    case T_CPIN: {
      String s = field(resp, "+CPIN:");
      String prev = simStatus;
      if (ok && s == "READY") {
        simStatus = "READY";
        if (st_ == St::SIM_WAIT) setState(St::NET_INIT);
        break;
      }
      if (s.length()) simStatus = s;  // SIM PIN, SIM PUK, NOT READY
      else if (resp.indexOf("not inserted") >= 0 || resp.indexOf("NOT INSERTED") >= 0) simStatus = "NOT INSERTED";
      else if (resp.indexOf("busy") >= 0 || resp.indexOf("not ready") >= 0) simStatus = "BUSY";
      else simStatus = res == Res::TIMEOUT ? "NO ANSWER" : "ERROR";
      if (prev != simStatus && simStatus != "BUSY") {
        evLog(slot, "SIM card: " + simStatus, simStatus == "NOT INSERTED" || simStatus.startsWith("SIM P") ? "warn" : "info");
      }
      if (st_ == St::IDLE) setState(St::SIM_WAIT, 1000);  // the SIM went away while running
      else stUntil_ = now + (simStatus == "BUSY" ? 2000 : 10000);
      break;
    }

    case T_NET:
      if (ok) {
        if (step_ == 0) {
          iccid = firstLine(resp);
          if (iccid.startsWith("+CCID:")) iccid = iccid.substring(6);
          iccid.trim();
        }
        step_++;
        tries_ = 0;
      } else if (++tries_ > 15) {  // "SMS not ready yet" can take ~20 s after power on
        evLog(slot, String(NET_CMDS[step_]) + " failed: " + resp, "warn");
        step_++;
        tries_ = 0;
      } else {
        stUntil_ = now + 2000;
      }
      break;

    case T_CSQ:
      if (ok) {
        String s = field(resp, "+CSQ:");
        csq = s.length() ? s.toInt() : 99;
      }
      break;

    case T_CREG:
      if (ok) {
        String s = field(resp, "+CREG:");
        int c = s.indexOf(',');
        reg = c >= 0 ? s.substring(c + 1).toInt() : 0;
      }
      break;

    case T_COPS:
      if (ok) {
        String s = field(resp, "+COPS:");
        int a = s.indexOf('"');
        int b = s.lastIndexOf('"');
        op = (a >= 0 && b > a) ? s.substring(a + 1, b) : "";
      }
      break;

    case T_CBC:
      if (ok) {
        String s = field(resp, "+CBC:");
        int c = s.lastIndexOf(',');
        if (c >= 0) mv = s.substring(c + 1).toInt();
      }
      break;

    case T_CMGL:
      if (ok) parseList(resp);
      else nextScan_ = now + 10000;
      break;

    case T_CMGD:
      if (!del_.empty()) {
        int idx = del_.front();
        del_.pop_front();
        for (auto it = flight_.begin(); it != flight_.end(); ++it) {
          if (it->idx == idx) {
            flight_.erase(it);
            break;
          }
        }
      }
      break;

    case T_CMGS:
      if (res == Res::PROMPT) {
        const SmsPart &p = jobs_.front().parts[part_];
        port_.print(p.pdu);
        port_.write(0x1A);  // Ctrl-Z: send it
        busy_ = true;
        tag_ = T_CMGS_BODY;
        res_ = Res::NONE;
        resp_ = "";
        wantPrompt_ = false;
        deadline_ = now + 60000;
      } else {
        port_.write(0x1B);  // Esc: leave the prompt if it came late
        finishJob(false, resp.length() ? resp : String("the module did not ask for the SMS text"));
      }
      break;

    case T_CMGS_BODY:
      if (ok) {
        if (refs_.length()) refs_ += ',';
        refs_ += field(resp, "+CMGS:");
        part_++;
        if (part_ < jobs_.front().parts.size()) sendPart();
        else finishJob(true, refs_);
      } else {
        finishJob(false, res == Res::TIMEOUT ? String("no answer from the network (timeout)") : resp);
      }
      break;

    case T_AT_USER: {
      String out = resp;
      out.trim();
      if (ok) out += out.length() ? "\nOK" : "OK";
      else if (res == Res::TIMEOUT) out += out.length() ? "\n(no answer)" : "(no answer)";
      if (!jobs_.empty()) {
        evAt(jobs_.front().id, ok, out);
        jobs_.pop_front();
      }
      jobActive_ = false;
      break;
    }

    case T_ATH:
      endCall("rejected");
      break;
  }
}

// ---------------- SMS ----------------

void Modem::parseList(const String &resp) {
  uint32_t now = millis();
  int pos = 0;
  int emitted = 0;
  bool more = false;
  int n = resp.length();
  while (pos < n) {
    int e = resp.indexOf('\n', pos);
    if (e < 0) e = n;
    String l = resp.substring(pos, e);
    pos = e + 1;
    if (!l.startsWith("+CMGL:")) continue;
    // +CMGL: <index>,<stat>,,<length>   stat 0/1 = received unread/read, 2/3 = stored outgoing
    int idx = l.substring(6).toInt();
    int c = l.indexOf(',');
    int stat = c >= 0 ? l.substring(c + 1).toInt() : 0;
    int e2 = resp.indexOf('\n', pos);
    if (e2 < 0) e2 = n;
    String pdu = resp.substring(pos, e2);
    pdu.trim();
    pos = e2 + 1;
    if (stat > 1) {
      deleteSms(idx);  // not ours to keep
      continue;
    }
    if (!pdu.length() || inFlight(idx, now)) continue;
    if (emitted >= 6) {
      more = true;
      continue;
    }
    flight_.push_back({(int16_t)idx, now});
    evSms(slot, idx, pdu);
    emitted++;
  }
  if (more) nextScan_ = now + 5000;
}

bool Modem::inFlight(int idx, uint32_t now) {
  for (auto it = flight_.begin(); it != flight_.end(); ++it) {
    if (it->idx != idx) continue;
    if (now - it->since > 300000) {  // the server never confirmed it: send it again
      flight_.erase(it);
      return false;
    }
    return true;
  }
  return false;
}

void Modem::startJob() {
  Job &j = jobs_.front();
  jobActive_ = true;
  if (j.type == Job::AT) {
    send(j.cmd, T_AT_USER, 30000);
    return;
  }
  if (j.parts.empty()) {
    finishJob(false, "empty SMS");
    return;
  }
  part_ = 0;
  refs_ = "";
  sendPart();
}

void Modem::sendPart() {
  send("AT+CMGS=" + String(jobs_.front().parts[part_].len), T_CMGS, 10000, true);
}

void Modem::finishJob(bool ok, const String &info) {
  jobActive_ = false;
  if (jobs_.empty()) return;
  uint32_t id = jobs_.front().id;
  jobs_.pop_front();
  if (ok) statOut++;
  else statFail++;
  lastActivityMs = millis();
  evJob(id, ok, info);
}

// ---------------- calls ----------------

void Modem::ringing() {
  uint32_t now = millis();
  if (!call_) {
    if (now - callEnded_ < 4000) return;  // a late RING from the call that just ended
    call_ = true;
    hangSent_ = false;
    callNum_ = "";
    callStart_ = now;
  }
  lastRing_ = now;
}

void Modem::endCall(const char *action) {
  if (!call_) return;
  call_ = false;
  callEnded_ = millis();
  evCall(slot, callNum_.length() ? callNum_ : String("unknown"), action, callEnded_ - callStart_);
}
