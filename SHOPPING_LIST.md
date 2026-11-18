# SMS Gateway: parts list

Parts for both builds: v1 (hand-wired) and v2 (carrier PCB). Prices are rough USD (AliExpress
low end, Amazon / local shop high end), researched November 2026.

> **First check that your mobile operator still runs 2G (GSM).** The SIM800L is 2G only. See
> [2G shutdowns](#6-caution-2g-shutdowns) at the end.

## Parts

| # | Item | Search for | Qty | ~USD |
|---|---|---|---|---|
| 1 | ESP32-S3 dev board, 2x USB-C | `YD-ESP32-S3` (the case is sized for its 28 mm width) | 1 | 6-12 |
| 2 | SIM800L module with IPEX socket (+1 spare: a mis-set LM2596 kills it at once) | `SIM800L GSM module`. Where the law asks for it (Turkey), buy IMEI-registered modules | 2 (+1) | 3-6 each |
| 3 | LM2596 buck module, 43 x 21 mm | `LM2596 DC-DC step down` | 2 (+1 spare) | 1-2 each |
| 4 | 0.96" OLED, SSD1306, I2C, 4 pins | `0.96 inch OLED SSD1306 I2C 128x64 4pin` (pin order VCC GND SCL SDA; some have GND VCC) | 1 | 2-4 |
| 5 | 1000 uF low-ESR electrolytic, 16 V, max 10.5 x 21 mm | `1000uF 16V low ESR 105C` | 2 | 2-5 / pack |
| 6 | Resistors 1 k and 3.3 k, 1/4 W | or a resistor kit | 2 + 2 | <1 |
| 6b | Fixed 4.0 V for the SIM800Ls (v1: optional, recommended; v2: on the PCB): LM1084IT-ADJ (TO-220) + resistors 120 Ω and 270 Ω + 100 uF 16 V | `LM1084IT-ADJ` (or LD1084V, LM1085IT-ADJ) | 1 + 1 + 1 + 1 | 1-3 |
| 7 | IPEX (u.FL) to SMA-female bulkhead cable, 12-15 cm | `IPEX u.FL to SMA female bulkhead pigtail 1.13` (RG178 or 1.13 mm) | 2 | 1-4 each |
| 8 | GSM antenna, SMA **male** (pin in the centre), 850/900/1800/1900 | `GSM antenna SMA male 3dBi`, straight or 90 deg L-type. **Not RP-SMA** | 2 | 1-6 each |
| 9 | DC-099 panel jack, 5.5 x 2.1 mm | `DC-099 5.5x2.1 panel jack` (11 mm hole). A DC-022B also works: set `dc_d = 8.2` | 1 | 1-3 |
| 10 | 12 V 2 A wall adapter, 5.5 x 2.1 mm plug, centre positive | `12V 2A power adapter 5.5x2.1` | 1 | 6-12 |
| 11 | Female-female Dupont jumpers, 20 cm (v2 needs only 4, for the OLED) | `Dupont jumper female female 40pin 20cm` | 1 strip | 2-4 |
| 12 | 22 AWG silicone wire, red + black (v1 power runs, v2 jack to terminal) | `22AWG silicone wire` | 1-2 m each | 4-8 |
| 13 | Heat-shrink assortment | `heat shrink tubing assortment 2:1` | 1 | 4-8 |
| 14 | Micro-SIM: voice + SMS, works on 2G, PIN lock off | from your operator | 2 | plan |
| 15 | PLA filament (a second colour for the lid letters is optional) | | ~150 g | |

Item 6 (the resistors) is for v1 only: on v2 they are part of the PCB.

### Extra for v2 (carrier PCB)

Either order the boards assembled (see [pcb/README.md](pcb/README.md), everything is ready to
send to a factory), or order bare boards and solder these yourself. The full list is
`pcb/sms_gateway_v2_BOM.csv`.

| Item | Search for | Qty |
|---|---|---|
| The PCB | upload `pcb/sms_gateway_v2_gerbers.zip` to JLCPCB, PCBWay, ... | 1 (min. order 5) |
| Female header 1x22, 2.54 mm, 8.5 mm high | `2.54mm female header 1x22` (or cut from 1x40) | 2 |
| Female header 1x6, 2.54 mm | `2.54mm female header 1x6` | 2 |
| Male pin header 2.54 mm (OLED 1x4, JP1 1x2, 8 single pins for the LM2596s) + 1 jumper cap | `2.54mm male pin header 1x40` | 1 strip |
| Screw terminal 2-pin, 5.0/5.08 mm | `KF301-2P` | 1 |
| 1N5822 Schottky diode (DO-201AD) | `1N5822` | 1 |
| LM1084IT-ADJ regulator, TO-220 (or LD1084V, LM1085IT-ADJ) | `LM1084IT-ADJ` | 1 |
| Resistors 1 k (2), 3.3 k (2), 4.7 k (1), 120 Ω (1), 270 Ω (1), 1/4 W 1 % | resistor kit | 7 |
| 100 uF 16 V electrolytic, D6.3 mm, 2.5 mm pitch | `100uF 16V 6.3x11` | 1 |
| LED 3 mm | | 1 |

The SIM800L's 6-pin header must be soldered pointing **down** (on the SIM-holder side) for v2.

Optional: 100 nF ceramic capacitors next to each 1000 uF (`100nF 104 ceramic 50V X7R`), an
SS34 / 1N5822 diode for reverse-polarity protection on the 12 V input, a u.FL puller (u.FL lasts
only ~30 plug/unplug cycles).

Tools: multimeter (the LM2596 must be set before anything is connected), soldering iron, hot glue,
a USB-C **data** cable.

## 1. Antennas (one per SIM800L)

| Option | Why | Spec / search terms |
|---|---|---|
| **u.FL to SMA-female bulkhead cable + SMA-male antenna** (what the case is built for) | Takes the signal out through the back wall | Thread 1/4"-36 (6.35 mm), 8 mm hex nut, 6.6 mm hole in the case. Examples: [Adafruit 851](https://www.adafruit.com/product/851) (cable, RG178, 15 cm), [Adafruit 1859](https://www.adafruit.com/product/1859) (antenna, 2 dBi, 61 mm) |
| Internal FPC antenna with IPEX lead | Sticks inside the case, nothing outside; PLA lets the signal through | `GSM FPC antenna IPEX u.FL` or `4G LTE FPC antenna IPEX 1.13mm 10cm`. ~40 x 10 to 45 x 25 mm, real gain ~0-2 dBi. Keep it 2-3 cm away from the LM2596 coils, the ESP32 and power wires |

Pitfalls
- **SMA vs RP-SMA**: same thread, swapped centre pin. The bulkhead (female) has a hole in the
  centre, the antenna (male) must show a **pin** in the listing photo. RP-SMA (WiFi) antennas screw
  on but do not connect.
- **IPEX-1 / MHF1 = u.FL**. IPEX-4 / MHF4 (laptops, M.2) is smaller and does not fit.
- Never power a SIM800L without an antenna on it. Use the IPEX antenna OR a spring antenna on the
  NET pad, not both.
- Weak signal check: `AT+CSQ` below ~10 or the module keeps losing registration.

## 2. Power

- **12 V 2 A** adapter: the LM2596 needs ~1.5-2 V headroom, so 5 V in is too low for a stable
  4.0 V during 2 A bursts. 9 V 2 A also works. Stay well under 40 V.
- **Panel jack**: the case has an 11.2 mm hole for a DC-099 (`dc_d`). For a DC-022B (~M8 thread,
  measure yours) set `dc_d = 8.2`; to pass the adapter cable straight through, 9.
- Power budget: each SIM800L bursts up to 2 A (~0.6 ms every 4.6 ms). Both at once ~4 A at 4 V; a
  cheap LM2596 is ~2 A continuous. So: a 1000 uF capacitor at each module, or one buck per module.
- **Set the LM2596 to 4.0-4.1 V before connecting a SIM800L.** A new module can output almost its
  input voltage and 12 V kills the SIM800L. SIM800L: warns <= 3.5 V, shuts down below 3.4 V and
  above 4.4 V. Lock the trimmer with a drop of nail polish. Better still, put the LM1084 (item 6b)
  behind it: then the SIM800Ls get a fixed 4.06 V whatever the trimmer does (set the LM2596 to
  5.5 V for it). The v2 PCB has it built in.
- Check whether your ESP32-S3 board isolates USB power from its 5V pin; if not sure, unplug the
  12 V supply before plugging in USB-C.

## 3. SIM800L support parts

- 1000 uF low-ESR electrolytic per module (SIMCom asks >= 100 uF low-ESR; 470-1000 uF is common).
  Solder it right at VCC/GND. Stripe = negative leg.
- 100 nF ceramic next to it (optional).
- Divider on RXD only: ESP32 TX -> 1 k -> SIM800L RXD -> 3.3 k -> GND gives ~2.53 V (SIM800L
  input-high is 2.1-3.1 V). SIM800L TXD (2.8 V) goes straight to the ESP32 RX pin.
- Optional 5.1 V zener (1N4733A) as in SIMCom's reference circuit: it does **not** save the module
  from a mis-set buck.

## 4. Wiring

- Dupont jumpers are fine for signals (UART, OLED I2C, RST). For the SIM800L **power** leads,
  Dupont crimps and 26-28 AWG wire can dip at 2 A: use two jumpers side by side per lead with the
  1000 uF capacitor at the module, or short 22 AWG silicone wire, soldered.
- Cable ties or a dot of hot glue as strain relief.

## 5. SIM cards

- **Micro-SIM** (3FF, 15 x 12 mm); a "triple-cut" SIM works. Voice + SMS plan (data-only IoT SIMs
  will not do calls/SMS).
- Turn the PIN lock off in a phone first (or `AT+CLCK="SC",0,"<PIN>"`).
- Test in a phone forced to 2G-only at the gateway's location: register, call, SMS.
- Avoid nano-to-micro adapters: they snag in the slide-in holder.
- Prepaid SIMs can expire without top-ups; some countries require ID registration.
- Some countries only let **IMEI-registered** devices on the network (Turkey, for example). There,
  buy SIM800L modules that are sold as IMEI-registered: an unregistered module can be cut off
  from the network after a while.

## 6. Caution: 2G shutdowns

Status as of November 2026. Sources disagree on some dates: confirm with your operator.

- **Already off**: USA (T-Mobile ended Aug 2026), Canada, Australia, Singapore, Taiwan, South Korea,
  Japan, New Zealand (One NZ), Hong Kong, Vietnam (Sep 2026), Switzerland, Netherlands (Odido),
  Norway (Telia), Sweden (Tele2/Telenor/Tre), Gibraltar, UAE (one source), parts of Latin America.
- **Late 2026-2027**: France (SFR 15 Nov 2026, others by end 2026), Netherlands (VodafoneZiggo end
  2026, KPN Dec 2027), Luxembourg (POST), Thailand (~Q3 2026, conflicting), Spain Movistar 2027,
  Norway Telenor / Sweden Telia Dec 2027, South Africa end 2027.
- **2028-2030+**: Germany 2028, Austria A1 May 2028, Belgium 2028-29, Italy 2028-2030, UK 2029-2033.
- **No date announced** (per these sources): India, Turkey (licences to 2029), Saudi Arabia (stc
  keeps 2G), Nigeria and much of Africa, much of Eastern Europe, Argentina, Telcel Mexico.

How to check: operator site ("<operator> 2G switch off"), the national regulator, trackers
(iot.cards, Wireless Logic), a phone in 2G-only mode, and on the SIM800L `AT+CREG?` (want `0,1` or
`0,5`), `AT+COPS=?`, `AT+CSQ` (>= ~10).

**If there is no 2G**: 4G LTE Cat-1 modules (not drop-in: bigger boards, often nano-SIM, own buck,
case changes):
- SIMCom **A7670E** (Europe/Asia/Africa, LTE + GSM 900/1800 fallback): 24 x 24 mm module,
  3.4-4.2 V, **2.8 A peaks**, 1.8 V UART on the bare module (buy a breakout with level shifting).
  Boards: Crowtail 35 x 50 mm, Waveshare HAT 65 x 30.5 mm (~$30).
- A7670SA / A7670G (Americas / global), A7672E / A7682E (19.6 mm module), SIM7600E-H / G-H (Cat-4,
  3 A supply, 2-3 antennas).
- Missed calls on 4G-only networks need **VoLTE** support from module firmware AND operator. Test
  one module with your SIM before buying two. Avoid variants marked "no voice/SMS" (e.g.
  A7670E-LNXY-UBL).

## 7. Notes

- PLA softens at ~55-60 C: no sun, no radiator. Use PETG if the gateway sits somewhere warm.
- ESP32 on its own buck, short star grounding, so SIM800L bursts do not reset it.

Sources: [Adafruit 1991](https://www.adafruit.com/product/1991), [Adafruit 1859](https://www.adafruit.com/product/1859), [Adafruit 851](https://www.adafruit.com/product/851), [Taoglas FXP07](https://www.taoglas.com/datasheets/FXP07.B.07.0100A.pdf), [TEJTE SMA hole guide](https://tejte.com/?p=38093), [SIM800L hardware design](https://www.electrokit.com/upload/product/41018/41018214/SIM800L-SIMCom.pdf), [A7670 hardware design](https://www.elecrow.com/download/product/CRT01260S/A7670_Series_Hardware_Design_V1.00.pdf), [SIMCom A7682E](https://simcom.com/product/A7682E.htm), [LILYGO model notes](https://wiki.lilygo.cc/products/t-sim-series/sim.html), [Tinytronics DC-099](https://www.tinytronics.nl/en/cables-and-connectors/connectors/dc-jack/dc-jack-metal-5.5mm-female-dc-099), [iot.cards 2G sunset](https://iot.cards/en/resources/guides/sunset-2g), [Thingsdata Oct 2026](https://thingsdata.com/news/2g-3g-network-sunset-update-october-2026/), [Wireless Logic closures](https://wirelesslogic.com/iot-sim/global-network-closures), [MacRumors T-Mobile 2G](https://macrumors.com/2026/08/06/t-mobile-2g-network-disabled/), [Vietnamnet 2G](https://vietnamnet.vn/en/vietnam-says-goodbye-to-2g-after-a-30-year-mobile-revolution-2555265.html)
