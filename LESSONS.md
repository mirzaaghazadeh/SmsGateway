# Lessons from the first build

The first gateway was built from parts on a desk, step by step, with a lot of trial and error. These
are the mistakes made along the way and what fixed them, so your build goes faster. Each one is:
**what happened**, then **what to do**.

For the symptom table ("not answering", "no SIM card", ...) see
[ASSEMBLY.md → When something does not work](ASSEMBLY.md#when-something-does-not-work).

## Power: the expensive lessons

**A spark, and two dead SIM800Ls.** LM2596 A (the one for the SIM800Ls) ended up at 12 V instead
of 4.0 V. When the 12 V adapter went in there was a spark, and both SIM800Ls died: one had a burnt
spot on its small yellow capacitor ("107C") and a short between VCC and GND. A new LM2596 comes
set to almost its input voltage, and a trimmer can move when you handle the module.
- Set both LM2596s with **nothing connected** to their outputs, and measure again on the SIM800L's
  own VCC and GND pins after connecting it.
- Lock each trimmer with a drop of nail polish or hot glue.
- Unplug the 12 V adapter before you touch a trimmer or a power wire.
- Best: put an LM1084 behind LM2596 A for a fixed 4.0 V (see ASSEMBLY.md). The v2 PCB has it.
- Keep one spare SIM800L.

**"I turn the trimmer and nothing changes."** The trimmer turns 15-25 times end to end. When it is
set above the input voltage, the output just shows the input (12 V) and does not move. Keep
turning anticlockwise; after several full turns the voltage starts to drop.

**A spark at the plug is normal, elsewhere it is not.** The big capacitors charge in an instant
when you plug the adapter in, which can make a tiny spark at the jack. A spark between wires or on
a module means a short: unplug, then look for bare wire ends that touch.

**Bare wire ends.** The 5 V wires for the ESP32 were left loose with bare ends while testing on
USB. Tape every loose end on its own before the adapter goes in.

**USB and the 5 V wire together.** While the ESP32 runs on USB (to read its log), leave the 5 V
wire from LM2596 B off the ESP32's 5Vin pin. Use one or the other, never both.

**Grounds.** The ESP32 and the SIM800Ls must share ground, or they cannot talk. The IN- and OUT-
pads of an LM2596 are already connected inside, so both modules share the adapter's minus.
Check with a multimeter on beep: ESP32 G to SIM800L GND must beep.

**Which jack pin is plus?** On almost every 12 V adapter the centre pin is plus. Do not guess:
plug the adapter in with nothing else connected and measure the two jack pins. An LM2596 has no
protection against reversed polarity.

## Wiring

**Resistors in the wrong place: "not answering".** With the 1 k / 3.3 k divider wired wrong, the
SIM800L never answered. With a plain wire from GPIO17 to RXD it answered at once. The divider is:
1 k **in the middle of** the wire from GPIO17 to RXD, and 3.3 k **from RXD to GND**. With everything
on, RXD measures about 2.5 V. For a short bench test a plain wire is fine (12 V in before USB).

**TX and RX.** SIM800L TXD goes to GPIO18, RXD (through the 1 k) to GPIO17, RST to GPIO5. The
SIM800L's header order is NET VCC RST RXD TXD GND. Nothing goes on NET.

**Find a bad wire by adding one at a time.** Give a SIM800L only VCC and GND (with its capacitor):
its small light should blink about once a second, even without a SIM card. Then add TXD, RXD and
RST one by one and watch the light. That is how a "dead" module turned out to be alive.

**The capacitor.** One 1000 uF capacitor per SIM800L, between its VCC and GND, as close to the
module as you can, stripe (minus) to GND. Two capacitors side by side at one junction also work
for a test, if the wires from there to the modules are short.

**The OLED.** VCC to 3V3 (not 5 V), GND to G, SCL to GPIO9, SDA to GPIO8. The pin order printed on
OLED boards differs between makers, so read yours. Blank screen: swap SDA and SCL first.

## SIM cards

**"SIM not inserted" with a working card.** Twice the card was in the wrong way. The holder takes
a micro-SIM with its gold contacts facing the SIM800L board: once it is in, you should not see the
gold. Turn the PIN request off in a phone first, and put the card in with the power off (the
SIM800L only looks for it when it starts).

**IMEI registration.** Some countries (Turkey, for example) only let registered phones and modules
on the network for long. Buy modules sold as IMEI-registered there.

**Antenna.** It needs one to find the network. The antenna must be SMA male (a pin in the
centre), not RP-SMA, which screws on but does not connect.

## ESP32 and setup

**Flashing: "No serial data received".** The board has two USB-C ports. Flash and read the log
through the one marked **COM**.

**Changing Wi-Fi.** The gateway keeps trying the old network. Hold BOOT for 5 seconds to open the
setup hotspot again (the device key stays). The ESP32 only sees 2.4 GHz Wi-Fi.

**Server address.** Enter it with `https://`. Behind Cloudflare, `http://` gets redirected (the
firmware now follows that by itself).

## Server

**The gateway forgot it was added after every deploy.** The server ran in Coolify without a
persistent volume, so each deploy started with an empty database, and the OLED showed "Add in
panel" again. Deploy with Docker Compose (`docker-compose.yaml` keeps the data in a volume).

**"Docker Compose file not found at /server/docker-compose.yaml".** Coolify still had the base
directory of the old Dockerfile setup. Set Base Directory to `/` and the compose file to
`/docker-compose.yaml`.

**Old firmware behind Cloudflare.** Firmware 1.1.0 and 1.1.1 could not update themselves over
Wi-Fi behind Cloudflare. Install a newer one once over USB; after that, updates come by themselves.

## Small things

- Glue: silicone and hot glue do not conduct. Use a kind that does not smell of vinegar (that one
  corrodes copper), let it dry before power, and keep it off the chips, the SIM holder, the
  antenna socket and the buttons.
- A multimeter is the most useful tool here: voltage before connecting, beep for shorts and
  grounds.
