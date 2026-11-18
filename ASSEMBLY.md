# SMS Gateway v1: what goes where, and how to wire it

This is the hand-wired build (v1 case). For the PCB build (v2), where the modules plug into one
board, see [pcb/README.md](pcb/README.md). Read [LESSONS.md](LESSONS.md) first: the mistakes from
the first build, and how to avoid them.

Picture: `case/v1/v1_layout_wiring.png` (top view, lid off; front = bottom of the picture).

## Where everything sits

| Part | Place in the box |
|---|---|
| SIM800L 1 and 2 | front, left and middle, low (4.5 mm), SIM card slots in the front wall |
| 1000 uF capacitors C1, C2 | in the trough right of each SIM800L (hot-glue dot) |
| LM2596 A (set to **4.0 V**) | front right: powers both SIM800Ls |
| LM2596 B (set to **5.0 V**) | behind A: powers the ESP32 |
| ESP32-S3 | back left, 20 mm up on 2 posts, USB-C through the left wall |
| DC-099 jack (12 V in) | right wall, back corner |
| Antennas ANT1, ANT2 | back wall: SMA socket of each IPEX cable, L antenna screwed on outside |
| OLED | in the lid (snap pins), its 4 wires come down into the box |

Both LM2596s have their **IN end toward the right wall** (the jack) and their OUT end toward the boards.

## First: set the voltages (nothing else connected)

Only the 12 V adapter + jack + the two LM2596s. Turn each trimmer with a multimeter on OUT+/OUT-:
**A = 4.0 V** (SIM800L, never above 4.2), **B = 5.0 V** (ESP32). A new LM2596 can output almost 12 V.

- The trimmer turns 15-25 times end to end. If the meter shows 12 V and does not move, keep turning
  anticlockwise: nothing changes until the setting drops below the input voltage.
- When both are right, put a drop of nail polish or hot glue on each trimmer so it cannot move.
- After connecting a SIM800L, measure once more **on the SIM800L's own VCC and GND pins**.

**This matters:** on the first build, LM2596 A ended up at 12 V and both SIM800Ls died at once
(one with a burnt spot on its little yellow capacitor). Unplug the 12 V adapter before you touch a
trimmer or a power wire.

**Optional, recommended: a fixed 4.0 V for the SIM800Ls.** This is what the v2 PCB does. Put an
LM1084IT-ADJ regulator (TO-220) between LM2596 A and the SIM800Ls, set A to **5.5 V**, and no
trimmer can push more than 4.06 V into them:

| LM1084 pin (writing toward you, left to right) | Goes to |
|---|---|
| 1 ADJ | 270 Ω to GND, and 120 Ω to pin 2 |
| 2 OUT (also the metal tab) | SIM1 VCC and SIM2 VCC (with the 1000 uF capacitors), + 100 uF to GND |
| 3 IN | LM2596 A OUT+ (5.5 V) |

The metal tab carries 4.0 V: do not let it touch anything. It runs warm, no heatsink needed.

## Power wiring

| From | To | Note |
|---|---|---|
| Jack + (centre pin) | LM2596 A IN+ and B IN+ | 12 V |
| Jack - | LM2596 A IN- and B IN- | |
| LM2596 A OUT+ | SIM1 VCC and SIM2 VCC | 4.0 V. Two jumpers side by side per module, or 22 AWG wire |
| LM2596 A OUT- | SIM1 GND and SIM2 GND | same |
| LM2596 B OUT+ | ESP32 5V pin | 5.0 V |
| LM2596 B OUT- | ESP32 GND | |
| 1000 uF (+ leg) | SIM VCC solder joint, under the board | stripe = minus leg -> SIM GND joint |

All grounds end up joined (jack -, LM2596 IN-/OUT- are one ground).

## Signal wiring (F-F Dupont jumpers)

| ESP32 pin | | SIM800L / OLED pin | Note |
|---|---|---|---|
| GPIO17 (TX) | -> **1 k** -> | SIM1 RXD | + **3.3 k** from SIM1 RXD to GND (see below) |
| GPIO18 (RX) | <- | SIM1 TXD | direct |
| GPIO5 | -> | SIM1 RST | direct |
| GPIO15 (TX) | -> **1 k** -> | SIM2 RXD | + **3.3 k** from SIM2 RXD to GND |
| GPIO16 (RX) | <- | SIM2 TXD | direct |
| GPIO6 | -> | SIM2 RST | direct |
| GPIO8 | <-> | OLED SDA | |
| GPIO9 | -> | OLED SCL | |
| 3V3 | -> | OLED VCC | |
| GND | -> | OLED GND | |

SIM800L header order: NET VCC RST RXD TXD GND (NET is for a spring antenna: leave it empty).
SIM1 pins match `firmware/sim800_test` (TX 17, RX 18, RST 5).
All the ESP32 pins above are on the same header row (the one with 3V3, RST, 4-18 and 5V).

**Dividers** (one per SIM800L): solder the **3.3 k** flat under the SIM800L between the RXD and GND
solder joints (pins 4 and 6), not touching TXD (pin 5) in between. Put the **1 k** in the GPIO TX
jumper: cut the jumper, solder the resistor between the halves, insulate with tape or heat-shrink.
Check: with everything on, RXD measures about **2.5 V** to GND. 0.8 V means the 1 k and the 3.3 k
are swapped; 0 V means the 1 k path is open.

For a quick bench test without the resistors, a plain wire from GPIO17 to RXD works. Plug in the
12 V before the USB cable and unplug it after, so the ESP32 never drives a SIM800L that has no power.

## Antennas

1. Plug the IPEX end onto the SIM800L's IPEX socket **before** pressing the board into its frame;
   the cable leaves sideways over the lowered corner.
2. SMA end through the back-wall hole from inside (SIM1 -> ANT1 left, SIM2 -> ANT2 right). The
   connector body sits in the round pocket of the ring inside, against the 2.4 mm wall. Washer +
   nut on the OUTSIDE, tighten (hold the body so the cable does not twist).
3. Screw the L antenna onto the thread that is left outside, fold it up to 90 deg.
4. SIM1's cable runs back under the ESP32, through the gap between its 2 posts.

## Putting it together

1. Print `case/v1/bambu/1_fit_tests_X2D.3mf`, check every part fits (antenna test: SMA connector +
   antenna screw on all the way), then the box and the lid.
2. Set the two LM2596 voltages (above).
3. Solder: capacitor + 3.3 k under each SIM800L; 1 k into the two TX jumpers; power wires to the
   LM2596 corner pads.
4. Into the box: DC jack, the two SMA sockets, LM2596 A and B (they click onto their pins),
   SIM800Ls (antenna plugged first, capacitor into its trough), then the ESP32: plug its jumpers
   on first, then set it on its posts.
5. OLED onto the lid's pins (they click), plug holder onto its 4 pins. Use 20 cm jumpers so the
   lid can open next to the box.
6. Route: power wires along the front and right side, signal wires under the ESP32, the OLED
   wires along the back wall up to the lid.
7. Test with `firmware/sim800_test` (one SIM800L at a time), then close the lid: the 4 latches click.

## SIM cards

- **Micro-SIM** size. A nano-SIM needs an adapter, and it must not sit loose or upside down in it.
- The gold contacts face the SIM800L board. Once the card is in, you should not see the gold.
  The cut corner goes the way the drawing next to the holder shows.
- Turn the PIN request off in a phone first.
- Put the card in with the power off. The SIM800L only looks for the card when it starts.

## When something does not work

The small light on each SIM800L tells you a lot, even without a SIM card or antenna:

| Light | Means |
|---|---|
| blinks about once a second | running, looking for the network |
| blinks every 3 seconds | on the network |
| off | no power, or the module is dead (see below) |
| blinks, then starts over again and again | the voltage drops when it transmits: capacitor, wires |

What the OLED (and the panel) shows for a SIM, with the usual causes:

| Shows | Check |
|---|---|
| **not answering** | Its light is off: no 4 V at its pins. Its light blinks: TXD goes to GPIO18 (16), RXD to GPIO17 (15) through the 1 k; swapped TX/RX is the classic mistake. Measure RXD (about 2.5 V, see Dividers). |
| **no SIM card** | Card upside down, wrong size or loose in an adapter (see SIM cards). Try a card that works in a phone. If no card is ever seen, the module's SIM holder may be damaged. |
| **SIM PIN on** | Turn the PIN request off in a phone. |
| **searching** for a long time | Antenna: the IPEX plug clicked on, the SMA antenna screwed on. 2G must exist where you are. |
| **low voltage** | Under 3.5 V at the module: set A to 4.0 V, shorter and thicker power wires. |

Testing a SIM800L on its own: connect only VCC and GND (with its capacitor) to 4.0 V, nothing
else. If the light blinks, the module lives; then add TXD, RXD and RST one at a time and watch the
light after each. If it stops, that wire is on the wrong pin.

A dead module: with the power off, a multimeter on beep between VCC and GND beeps without
stopping (a capacitor beeps only for a moment). A burnt spot on the little yellow capacitor
("107C") means it saw too much voltage. Sometimes removing that capacitor brings the module back;
the 1000 uF capacitor does its job anyway.

A small spark at the 12 V plug when you plug it in is normal (the capacitors charge). A spark
anywhere else is a short: unplug and look for bare wire ends touching.
