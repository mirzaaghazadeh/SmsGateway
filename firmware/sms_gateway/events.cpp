#include "events.h"

std::deque<Event> events;
uint32_t statIn = 0, statOut = 0, statFail = 0, statCalls = 0;
uint32_t lastActivityMs = 0;

static uint32_t nextSeq = 1;
static const size_t MAX_EVENTS = 80;

static void push(Event e) {
  e.seq = nextSeq++;
  if (events.size() >= MAX_EVENTS) {
    // drop the oldest log line first; an SMS stays on the SIM card and is read again later
    auto it = events.begin();
    for (; it != events.end(); ++it)
      if (it->type == EV_LOG) break;
    events.erase(it == events.end() ? events.begin() : it);
  }
  events.push_back(e);
}

void evSms(uint8_t slot, int idx, const String &pdu) {
  Event e{};
  e.type = EV_SMS;
  e.slot = slot;
  e.idx = idx;
  e.a = pdu;
  push(e);
  statIn++;
  lastActivityMs = millis();
  Serial.printf("[SIM%u] SMS received (storage #%d, %u chars PDU)\n", slot, idx, pdu.length());
}

void evCall(uint8_t slot, const String &number, const char *action, uint32_t ringMs) {
  Event e{};
  e.type = EV_CALL;
  e.slot = slot;
  e.a = number;
  e.b = action;
  e.ms = ringMs;
  push(e);
  statCalls++;
  lastActivityMs = millis();
  Serial.printf("[SIM%u] call from %s, %s after %lu ms\n", slot, number.c_str(), action, (unsigned long)ringMs);
}

void evJob(uint32_t job, bool ok, const String &info) {
  Event e{};
  e.type = EV_JOB;
  e.job = job;
  e.ok = ok;
  e.a = info;
  push(e);
  Serial.printf("job %lu %s: %s\n", (unsigned long)job, ok ? "done" : "FAILED", info.c_str());
}

void evAt(uint32_t job, bool ok, const String &out) {
  Event e{};
  e.type = EV_AT;
  e.job = job;
  e.ok = ok;
  e.a = out.length() > 1500 ? out.substring(0, 1500) : out;
  if (job) push(e);  // job 0 = typed in the serial monitor, only printed
  Serial.printf("AT result (%s):\n%s\n", ok ? "OK" : "error", out.c_str());
}

void evFw(bool ok, const String &version, const String &msg) {
  Event e{};
  e.type = EV_FW;
  e.ok = ok;
  e.a = version;
  e.b = msg;
  push(e);
}

void evLog(uint8_t slot, const String &msg, const char *level) {
  Event e{};
  e.type = EV_LOG;
  e.slot = slot;
  e.a = msg;
  e.b = level;
  push(e);
  if (slot) Serial.printf("[SIM%u] %s\n", slot, msg.c_str());
  else Serial.printf("%s\n", msg.c_str());
}
