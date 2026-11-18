#!/usr/bin/env python3
"""
Complete wiring diagram of the hand-wired build (v1): every wire, pin by pin.

Run:   python3 docs/make_wiring.py      (needs: pip install matplotlib)
Writes docs/wiring_v1.png and docs/wiring_v1.svg. The pins match firmware/sms_gateway/config.h.
"""
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Arc, Circle, FancyBboxPatch, Rectangle  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1800, 1500

# wire colours
C12 = "#d32f2f"   # 12 V
C55 = "#8d4a1f"   # 5.5 V (only with the optional regulator)
C5 = "#c2185b"    # 5 V
C4 = "#ef6c00"    # 4.0 V
GND = "#212121"   # ground
TX = "#1565c0"    # ESP32 sends -> SIM800L
RX = "#2e7d32"    # SIM800L sends -> ESP32
RST = "#7b1fa2"   # reset
I2C = "#00838f"   # OLED data
V33 = "#f2a900"   # 3.3 V
ADJ = "#757575"   # regulator set point
INK = "#1b1b1b"
MUTED = "#5f6368"

fig = plt.figure(figsize=(W / 100, H / 100), dpi=100)
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, W)
ax.set_ylim(H, 0)
ax.axis("off")
fig.patch.set_facecolor("white")


def text(x, y, s, size=11, color=INK, ha="center", va="center", weight="normal", rot=0, z=8):
    ax.text(x, y, s, fontsize=size, color=color, ha=ha, va=va, fontweight=weight, rotation=rot,
            zorder=z, family="DejaVu Sans", linespacing=1.25)


def wire(pts, color, lw=3.4, z=3):
    xs, ys = zip(*pts)
    ax.plot(xs, ys, color=color, lw=lw, solid_capstyle="round", solid_joinstyle="round", zorder=z)


def hop_h(x0, x1, y, hops, color, lw=3.4):
    """Horizontal wire that jumps over vertical wires at the x values in `hops` (not connected)."""
    r = 9
    x = x0
    for hx in sorted(hops):
        wire([(x, y), (hx - r, y)], color, lw)
        ax.add_patch(Arc((hx, y), 2 * r, 2 * r, theta1=180, theta2=360, color=color, lw=lw, zorder=3))
        x = hx + r
    wire([(x, y), (x1, y)], color, lw)


def dot(x, y, color):
    ax.add_patch(Circle((x, y), 6, color=color, zorder=6))


def box(x0, y0, x1, y1, fc="#ffffff", ec="#9e9e9e", lw=1.6, r=10, z=1):
    ax.add_patch(FancyBboxPatch((x0, y0), x1 - x0, y1 - y0, boxstyle=f"round,pad=0,rounding_size={r}",
                                fc=fc, ec=ec, lw=lw, zorder=z))


def pin(x, y, color="#9e9e9e"):
    ax.add_patch(Rectangle((x - 7, y - 7), 14, 14, fc=color, ec="#424242", lw=1.0, zorder=7))


def resistor_h(x0, x1, y, label, color):
    mid = (x0 + x1) / 2
    wire([(x0, y), (mid - 32, y)], color)
    wire([(mid + 32, y), (x1, y)], color)
    ax.add_patch(Rectangle((mid - 32, y - 11), 64, 22, fc="#f5e6c8", ec="#6d4c41", lw=1.6, zorder=5))
    text(mid, y - 24, label, size=10.5, weight="bold", color="#6d4c41")


def resistor_v(x, y0, y1, label, color):
    mid = (y0 + y1) / 2
    wire([(x, y0), (x, mid - 28)], color)
    wire([(x, mid + 28), (x, y1)], color)
    ax.add_patch(Rectangle((x - 11, mid - 28), 22, 56, fc="#f5e6c8", ec="#6d4c41", lw=1.6, zorder=5))
    text(x + 18, mid, label, size=10.5, weight="bold", color="#6d4c41", ha="left")


def capacitor_v(x, y0, y1, label, plus=C4, minus=GND):
    """Electrolytic capacitor, + at the top (y0), - (the stripe) at the bottom (y1)."""
    mid = (y0 + y1) / 2
    wire([(x, y0), (x, mid - 7)], plus)
    wire([(x, mid + 7), (x, y1)], minus)
    ax.plot([x - 22, x + 22], [mid - 7, mid - 7], color=INK, lw=3, zorder=5)
    ax.add_patch(Rectangle((x - 22, mid + 4), 44, 7, fc=INK, ec=INK, zorder=5))
    text(x - 30, mid - 18, "+", size=13, weight="bold")
    text(x + 30, mid, label, size=10, ha="left", color=MUTED)


def panel(x0, y0, x1, y1, number, title):
    box(x0, y0, x1, y1, fc="#fafafa", ec="#d0d0d0", lw=1.4, r=14, z=0)
    tx = x0 + 22
    if number:
        ax.add_patch(Circle((x0 + 30, y0 + 30), 15, color="#263238", zorder=2))
        text(x0 + 30, y0 + 30, str(number), size=13, color="white", weight="bold")
        tx = x0 + 56
    text(tx, y0 + 30, title, size=15, weight="bold", ha="left")


def label(x, y, s, color, ha="left", size=11):
    text(x, y, s, size=size, color=color, ha=ha, weight="bold")


# ------------------------------------------------------------------ title and legend
text(30, 32, "SMS Gateway v1 (hand-wired): complete wiring", size=22, weight="bold", ha="left")
lx = 32
for name, col in [("12 V", C12), ("5 V", C5), ("4.0 V", C4), ("GND", GND), ("ESP32 → SIM800L", TX),
                  ("SIM800L → ESP32", RX), ("reset", RST), ("OLED data", I2C), ("3.3 V", V33)]:
    ax.plot([lx, lx + 30], [66, 66], color=col, lw=5, solid_capstyle="round", zorder=5)
    text(lx + 38, 66, name, size=11, ha="left")
    lx += 62 + len(name) * 8.4
text(1770, 66, "Every wire of the build, with the pin names printed on the boards.", size=11, ha="right",
     color=MUTED)

# ------------------------------------------------------------------ the ESP32 pin row
panel(30, 90, 1770, 425, None, "ESP32-S3 (YD-ESP32-S3) seen from above: the pin row with 3V3 ... 5Vin G")
box(232, 140, 1730, 262, fc="#263238", ec="#263238", r=12, z=2)
for yy in (156, 218):
    box(198, yy, 238, yy + 32, fc="#b0bec5", ec="#78909c", r=6, z=3)
text(118, 200, "USB-C end\n\nflash and\nread the log\nthrough the\nport marked\nCOM", size=9.5, color=MUTED)
text(1712, 154, "antenna end", size=9.5, color="#b0bec5", ha="right", va="top")
text(980, 180, "YD-ESP32-S3", size=16, color="#eceff1", weight="bold")
ROW = ["G", "5Vin", "14", "13", "12", "11", "10", "9", "46", "3", "8", "18", "17", "16", "15", "7", "6", "5",
       "4", "RST", "3V3", "3V3"]
USED = {
    0: ("GND (B OUT−)", GND), 1: ("5 V (B OUT+)", C5), 7: ("OLED SCL", I2C), 10: ("OLED SDA", I2C),
    11: ("SIM 1 TXD", RX), 12: ("1k → SIM 1 RXD", TX), 13: ("SIM 2 TXD", RX), 14: ("1k → SIM 2 RXD", TX),
    16: ("SIM 2 RST", RST), 17: ("SIM 1 RST", RST), 20: ("OLED VCC", V33),
}
for i, nm in enumerate(ROW):
    x = 282 + i * 66
    use = USED.get(i)
    text(x, 242, nm, size=10, color="#eceff1", weight="bold")
    pin(x, 262, use[1] if use else "#9e9e9e")
    if use:
        wire([(x, 270), (x, 288)], use[1], lw=3)
        text(x, 294, use[0], size=10, color=use[1], rot=90, va="top", weight="bold")
text(1770 - 22, 120, "Unused pins stay free. The other pin row is not used (it has more G pins if you need one).",
     size=9.5, color=MUTED, ha="right")

# ------------------------------------------------------------------ 1 power
P = 445
panel(30, P, 880, P + 495, 1, "Power: 12 V adapter and the two LM2596")
box(70, P + 115, 190, P + 335, fc="#eceff1", ec="#78909c")
text(130, P + 200, "12 V 2 A\nadapter\n+ DC jack", size=12, weight="bold")
pin(190, P + 155, C12)
text(178, P + 137, "+ centre", size=10, ha="right", color=C12, weight="bold")
pin(190, P + 315, GND)
text(178, P + 297, "− sleeve", size=10, ha="right", color=GND, weight="bold")

yB, yA = P + 85, P + 260
box(340, yB - 25, 560, yB + 75, fc="#e3f2fd", ec="#1e5aa8")
text(450, yB + 17, "LM2596 B", size=13, weight="bold")
text(450, yB + 43, "set 5.0 V", size=11, color=C5, weight="bold")
box(340, yA - 25, 560, yA + 80, fc="#e3f2fd", ec="#1e5aa8")
text(450, yA + 17, "LM2596 A", size=13, weight="bold")
text(450, yA + 43, "set 4.0 V", size=11, color=C4, weight="bold")
pins_ = ((340, yB, "IN+", C12), (340, yB + 50, "IN−", GND), (560, yB, "OUT+", C5), (560, yB + 50, "OUT−", GND),
         (340, yA, "IN+", C12), (340, yA + 55, "IN−", GND), (560, yA, "OUT+", C4), (560, yA + 55, "OUT−", GND))
for x, y, nm, col in pins_:
    pin(x, y, col)
    text(x + (14 if x == 340 else -14), y, nm, size=9, ha="left" if x == 340 else "right", color=MUTED)

wire([(190, P + 155), (270, P + 155)], C12)
wire([(270, yB), (270, yA)], C12)
wire([(270, yB), (340, yB)], C12)
dot(270, P + 155, C12)
wire([(190, P + 315), (340, P + 315)], GND)
wire([(300, yB + 50), (300, P + 315)], GND)
wire([(300, yB + 50), (340, yB + 50)], GND)
dot(300, P + 315, GND)
hop_h(270, 340, yA, [300], C12)  # crosses the ground wire without touching it

wire([(560, yB), (610, yB)], C5)
label(618, yB, "5.0 V → ESP32 5Vin", C5)
wire([(560, yB + 50), (610, yB + 50)], GND)
label(618, yB + 50, "GND → ESP32 G", GND)
wire([(560, yA), (610, yA)], C4)
label(618, yA - 9, "4.0 V → VCC of", C4)
label(618, yA + 9, "SIM800L 1 and 2", C4)
wire([(560, yA + 55), (610, yA + 55)], GND)
label(618, yA + 46, "GND → GND of", GND)
label(618, yA + 64, "SIM800L 1 and 2", GND)
text(52, P + 480,
     "• Set the trimmers with nothing on the outputs: A = 4.0 V, B = 5.0 V. A new LM2596 gives almost\n"
     "   12 V, which kills a SIM800L at once. Then lock both trimmers with a drop of nail polish.\n"
     "• IN− and OUT− of an LM2596 are joined inside: all black wires are one ground.\n"
     "• ESP32 on a USB cable? Then take B's 5 V wire off 5Vin: never both at once.",
     size=10.5, ha="left", va="bottom")

# ------------------------------------------------------------------ 2 OLED
O = 445
panel(920, O, 1770, O + 240, 2, "OLED 0.96\" (I2C), in the lid")
box(960, O + 52, 1120, O + 190, fc="#eceff1", ec="#78909c")
text(1005, O + 121, "ESP32", size=13, weight="bold")
box(1450, O + 52, 1640, O + 190, fc="#102027", ec="#102027")
text(1590, O + 121, "OLED", size=13, weight="bold", color="#80deea")
for k, (epin, opin, col) in enumerate((("3V3", "VCC", V33), ("G", "GND", GND), ("9", "SCL", I2C), ("8", "SDA", I2C))):
    y = O + 70 + k * 34
    pin(1120, y, col)
    text(1108, y, epin, size=10, ha="right", weight="bold")
    pin(1450, y, col)
    text(1464, y, opin, size=10, ha="left", weight="bold", color="#e0f7fa")
    wire([(1120, y), (1450, y)], col)
text(942, O + 228, "Match the names: makers print the OLED pins in different orders. VCC to 3V3, never 5 V.\n"
     "Any G pin works. A blank screen: swap SDA and SCL first.", size=9.5, color=MUTED, ha="left", va="bottom")

# ------------------------------------------------------------------ 3 optional fixed 4.0 V
R = 705
panel(920, R, 1770, R + 235, 3, "Better: a fixed 4.0 V for the SIM800Ls (optional; the v2 PCB has it)")
text(942, R + 58, "LM1084 pins with the writing toward you, left to right: 1 ADJ, 2 OUT (also the metal tab), 3 IN.",
     size=9.5, color=MUTED, ha="left")
yw = R + 110
lx0, lx1, lxa = 1230, 1370, 1300  # LM1084: IN, OUT, ADJ
box(lx0, yw - 18, lx1, yw + 48, fc="#eceff1", ec="#78909c")
text(lxa, yw + 4, "LM1084", size=12, weight="bold")
text(lxa, yw + 26, "-ADJ", size=10, color=MUTED)
pin(lx0, yw, C55)
text(lx0 - 12, yw + 18, "3 IN", size=9.5, ha="right", color=MUTED)
pin(lx1, yw, C4)
text(lx1 + 12, yw + 18, "2 OUT", size=9.5, ha="left", color=MUTED)
pin(lxa, yw + 48, ADJ)
text(lxa + 12, yw + 62, "1 ADJ", size=9.5, ha="left", color=MUTED)
wire([(960, yw), (lx0, yw)], C55)
label(960, yw - 16, "LM2596 A OUT+ at 5.5 V", C55)
wire([(lx1, yw), (1740, yw)], C4)
label(1740, yw - 16, "4.06 V → SIM800L VCC", C4, ha="right")
yb = R + 205
dot(1460, yw, C4)
resistor_v(1460, yw, yb, "120 Ω", C4)
wire([(1460, yb), (lxa, yb)], ADJ)
wire([(lxa, yw + 48), (lxa, yb)], ADJ)
dot(lxa, yb, ADJ)
resistor_h(lxa, 1100, yb, "270 Ω", ADJ)
wire([(1100, yb), (1030, yb)], GND)
label(1022, yb, "GND", GND, ha="right")
dot(1630, yw, C4)
capacitor_v(1630, yw, yb, "100 µF", plus=C4, minus=GND)
label(1630, yb + 18, "GND", GND, ha="center", size=9.5)


# ------------------------------------------------------------------ 4 and 5 the SIM800Ls
def sim_panel(x0, n, gp_rst, gp_tx, gp_rx, number):
    y0 = 960
    panel(x0, y0, x0 + 850, y0 + 515, number, f"SIM800L {n}")
    box(x0 + 30, y0 + 165, x0 + 190, y0 + 315, fc="#eceff1", ec="#78909c")
    text(x0 + 75, y0 + 240, "ESP32", size=13, weight="bold")
    hx = x0 + 500  # the SIM800L's 6-pin header
    rows = {"NET": y0 + 90, "VCC": y0 + 140, "RST": y0 + 190, "RXD": y0 + 240, "TXD": y0 + 290, "GND": y0 + 340}
    for y, gpio, col in ((rows["RST"], f"GPIO{gp_rst}", RST), (rows["RXD"], f"GPIO{gp_tx} (TX)", TX),
                         (rows["TXD"], f"GPIO{gp_rx} (RX)", RX)):
        pin(x0 + 190, y, col)
        text(x0 + 180, y - 14, gpio, size=9.5, ha="right", color=col, weight="bold")
    box(hx - 14, y0 + 62, x0 + 828, y0 + 380, fc="#fdecea", ec="#b71c1c", lw=1.8)
    text(x0 + 816, y0 + 90, f"SIM800L {n}", size=14, weight="bold", color="#b71c1c", ha="right")
    for nm, y in rows.items():
        col = {"VCC": C4, "GND": GND, "RST": RST, "RXD": TX, "TXD": RX}.get(nm, "#9e9e9e")
        pin(hx, y, col)
        text(hx - 14, y - 14, nm, size=10, ha="right", weight="bold")
    text(hx - 14, rows["NET"] + 13, "nothing on NET", size=9, ha="right", color=MUTED)
    wire([(x0 + 190, rows["RST"]), (hx, rows["RST"])], RST)
    resistor_h(x0 + 190, hx, rows["RXD"], "1 kΩ", TX)
    wire([(hx, rows["TXD"]), (x0 + 190, rows["TXD"])], RX)
    wire([(x0 + 40, rows["VCC"]), (hx, rows["VCC"])], C4)
    label(x0 + 40, rows["VCC"] - 16, "4.0 V from LM2596 A OUT+", C4)
    wire([(x0 + 40, rows["GND"]), (hx, rows["GND"])], GND)
    label(x0 + 40, rows["GND"] + 18, "GND from LM2596 A OUT−", GND)
    # soldered right at the header pins: 3.3 k from RXD to GND, the capacitor from VCC to GND
    rx_, cx = hx + 70, hx + 150
    wire([(hx, rows["RXD"]), (rx_, rows["RXD"])], TX)
    resistor_v(rx_, rows["RXD"], rows["GND"], "3.3 kΩ", GND)
    wire([(hx, rows["VCC"]), (cx, rows["VCC"])], C4)
    wire([(hx, rows["GND"]), (cx, rows["GND"])], GND)
    dot(rx_, rows["GND"], GND)
    capacitor_v(cx, rows["VCC"], rows["GND"], "1000 µF")
    text(hx + 6, y0 + 366, "solder these two right at the pins", size=9, color=MUTED, ha="left")
    text(x0 + 778, y0 + 130, f"IPEX\nsocket:\nantenna\ncable\n(ANT {n})", size=9, color=MUTED, va="top")
    text(x0 + 778, y0 + 245, "micro-SIM:\ngold side\nto the\nboard,\nPIN off", size=9, color=MUTED, va="top")
    text(x0 + 30, y0 + 405,
         "RXD gets the ESP32's signal through the 1 kΩ, and 3.3 kΩ goes from RXD to GND: about 2.5 V at RXD.\n"
         "TXD and RST go straight. The capacitor's stripe (−) goes to GND.\n"
         "Test a module with only VCC + GND first: its small light blinks about once a second.",
         size=10.5, ha="left", va="top")


sim_panel(30, 1, 5, 17, 18, 4)
sim_panel(920, 2, 6, 15, 16, 5)

for ext in ("png", "svg"):
    fig.savefig(os.path.join(HERE, f"wiring_v1.{ext}"), dpi=110 if ext == "png" else 100, facecolor="white")
print("wrote docs/wiring_v1.png and docs/wiring_v1.svg")
