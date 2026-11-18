#pragma once
#include <Arduino.h>
#include <deque>
#include <vector>

struct SmsPart {
  uint16_t len;  // for AT+CMGS=<len>
  String pdu;
};

struct Job {
  enum Type : uint8_t { SMS, AT } type = SMS;
  uint32_t id = 0;
  String cmd;                  // AT
  std::vector<SmsPart> parts;  // SMS
};

// One SIM800L. Never blocks: loop() reads the UART, runs one AT command at a time and
// handles unsolicited messages (new SMS, ring, caller ID, voltage warnings).
class Modem {
 public:
  Modem(uint8_t slot, HardwareSerial &port, int rx, int tx, int rst);
  void begin();
  void loop();

  void requestReset(const char *why);
  bool enqueue(const Job &job);   // false when the queue is full
  void deleteSms(int idx);        // after the server has stored it
  size_t queueLen() const { return jobs_.size(); }  // includes the job running now
  bool ready() const;
  const char *stateName() const;

  bool rejectCalls = true;  // set from the server config
  // From the server config (firmware 1.2.0): the owner turned this slot off, or chose its network.
  void setEnabled(bool on);
  void setNetwork(const char *want);  // "auto" or a network code like "28601"
  bool enabled() const { return st_ != St::OFF; }

  // last known status
  const uint8_t slot;
  String imei, iccid, op, simStatus;
  int csq = 99, reg = 0, mv = 0;

 private:
  enum class St : uint8_t { RESET, BOOT_WAIT, PROBE, INIT, SIM_WAIT, NET_INIT, IDLE, DEAD, OFF };
  enum class Res : uint8_t { NONE, OK, ERR, TIMEOUT, PROMPT };
  enum Tag : uint8_t { T_PROBE, T_INIT, T_CPIN, T_NET, T_CSQ, T_CREG, T_COPS, T_CBC, T_CMGL, T_CMGD, T_CMGS, T_CMGS_BODY, T_AT_USER, T_ATH, T_COPS_SET };

  void readPort();
  void handleLine(const String &l);
  void send(const String &cmd, Tag tag, uint32_t timeoutMs, bool wantPrompt = false);
  void onResult(Tag tag, Res res, const String &resp);
  void step(uint32_t now);
  void idle(uint32_t now);
  void startJob();
  void sendPart();
  void finishJob(bool ok, const String &info);
  void parseList(const String &resp);
  bool inFlight(int idx, uint32_t now);
  void ringing();
  void endCall(const char *action);
  void setState(St s, uint32_t waitMs = 0);
  static bool due(uint32_t t) { return (int32_t)(millis() - t) >= 0; }

  HardwareSerial &port_;
  int rx_, tx_, rst_;
  St st_ = St::RESET;
  uint32_t stUntil_ = 0;
  bool rstLow_ = false;
  uint8_t tries_ = 0, fails_ = 0, step_ = 0;

  bool busy_ = false;
  bool wantPrompt_ = false;
  Res res_ = Res::NONE;
  Tag tag_ = T_PROBE;
  uint32_t deadline_ = 0;
  String resp_, line_;
  bool expectPdu_ = false;

  uint32_t nextPoll_ = 0, nextScan_ = 0;
  uint8_t pollStep_ = 0;
  bool scanDue_ = false;
  bool lowPower_ = false;
  bool registeredLogged_ = false;

  // network choice: what the server wants, what was set since the module started, what is being sent
  String netWant_, netDone_, netSent_;
  int copsMode_ = -1;        // from AT+COPS?: 0 automatic, 1 manual, 4 manual with fallback, -1 unknown
  uint32_t netNext_ = 0;     // a failed choice is tried again after this

  struct Flight { int16_t idx; uint32_t since; };
  std::vector<Flight> flight_;
  std::deque<int> del_;

  std::deque<Job> jobs_;
  bool jobActive_ = false;
  size_t part_ = 0;
  String refs_;

  bool call_ = false, hangSent_ = false;
  String callNum_;
  uint32_t callStart_ = 0, lastRing_ = 0, callEnded_ = 0;

 public:
  bool debug = false;  // print every line from the module on Serial
};

extern Modem modem1, modem2;
Modem *modemFor(uint8_t slot);
