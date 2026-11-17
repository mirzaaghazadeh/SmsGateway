#pragma once
#include <Arduino.h>
#include <deque>

// Things that happened and must reach the server. Kept in RAM until the server confirms them.
enum EvType : uint8_t { EV_SMS, EV_CALL, EV_JOB, EV_AT, EV_LOG, EV_FW };

struct Event {
  uint32_t seq;
  EvType type;
  uint8_t slot;    // SIM 1 / 2, 0 = gateway
  int16_t idx;     // SMS: index in the SIM card storage (deleted after the server has it)
  uint32_t job;    // job id for EV_JOB / EV_AT
  uint32_t ms;     // call ring time
  bool ok;
  String a;        // SMS PDU, caller number, job result, log text
  String b;        // call action, log level
};

extern std::deque<Event> events;

void evSms(uint8_t slot, int idx, const String &pdu);
void evCall(uint8_t slot, const String &number, const char *action, uint32_t ringMs);
void evJob(uint32_t job, bool ok, const String &info);
void evAt(uint32_t job, bool ok, const String &out);
void evLog(uint8_t slot, const String &msg, const char *level = "info");
void evFw(bool ok, const String &version, const String &msg);  // firmware update result

// counters since boot, for the OLED
extern uint32_t statIn, statOut, statFail, statCalls;
extern uint32_t lastActivityMs;
