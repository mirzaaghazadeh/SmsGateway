#!/usr/bin/env python3
"""
SMS gateway v2 - carrier PCB (the PCB build; v1 is the hand-wired build).

A 100 x 100 mm, 2-layer, all through-hole board that the modules plug into, so no Dupont
wiring is needed:
  ESP32-S3 dev board (YD-ESP32-S3 or DevKitC-1), 2x SIM800L, 2x LM2596 buck module,
  0.96" OLED (4 wires), 12 V screw terminal, 1000 uF caps and the RX level dividers on board.
  The SIM800Ls get a fixed 4.06 V from an LM1084 regulator (U3) behind LM2596 A, so a trimmer
  turned too far (a new LM2596 can give almost 12 V) cannot reach them.

Run:   python3 make_board.py     (needs: pip install shapely matplotlib numpy openpyxl)
Writes, next to this file: gerbers/ + the Gerber zip, the BOM and pick-and-place files, the
assembly drawing, the order specs, the order package zip (everything a factory needs for PCBA),
a KiCad file and renders. Prints a design-rule / connectivity report.
"""
import heapq
import math
import os
import uuid
import zipfile
from itertools import combinations

import numpy as np
import shapely
from shapely import affinity
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = "sms_gateway_v2"

# ----------------------------------------------------------------------------- rules
BW, BH, BR = 100.0, 100.0, 3.0      # board size, corner radius (mm)
CLR = 0.25        # copper clearance the router aims for
CLR_MIN = 0.20    # DRC error below this (JLCPCB/PCBWay can do 0.127)
POUR_CLR = 0.35   # ground pour clearance to other nets
EDGE_CLR = 0.5    # copper to board edge
MASK_EXP = 0.05   # solder mask opening grows past the pad
VIA_D, VIA_DRILL = 0.8, 0.4
SIG_W = 0.4       # signal track width
QS = 8            # arc segments per quarter circle

BOARD = box(BR, BR, BW - BR, BH - BR).buffer(BR, quad_segs=QS)


def polys(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if hasattr(g, "geoms"):
        out = []
        for x in g.geoms:
            out += polys(x)
        return out
    return []


# ----------------------------------------------------------------------------- parts
class Pad:
    def __init__(self, comp, num, x, y, shape, size, drill, net):
        self.comp, self.num, self.x, self.y = comp, num, x, y
        self.shape, self.size, self.drill, self.net = shape, size, drill, net
        # pads with no net are each their own "net" for clearance checks
        self.key = net if net else f"nc:{comp.ref}.{num}@{x:.2f},{y:.2f}"

    def geom(self, grow=0.0):
        w, h = self.size
        if self.shape == "circle":
            return Point(self.x, self.y).buffer(w / 2 + grow, quad_segs=QS)
        if self.shape == "rect":
            g = box(self.x - w / 2, self.y - h / 2, self.x + w / 2, self.y + h / 2)
            return g.buffer(grow, join_style="mitre") if grow else g
        if self.shape == "npth":
            return Point(self.x, self.y).buffer(w / 2 + grow, quad_segs=QS)
        raise ValueError(self.shape)


class Comp:
    def __init__(self, ref, value, fp, x, y, bom=None):
        self.ref, self.value, self.fp, self.x, self.y = ref, value, fp, x, y
        self.bom = bom
        self.pads = []
        self.silk = []      # ('line', [(x,y),...]) | ('circle', cx, cy, r) in board coords

    def pad(self, num, dx, dy, shape, size, drill, net=None):
        p = Pad(self, num, self.x + dx, self.y + dy, shape, size, drill, net)
        self.pads.append(p)
        return p

    def line(self, *pts):
        self.silk.append(("line", list(pts)))

    def rect(self, x0, y0, x1, y1):
        self.line((x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0))

    def circle(self, cx, cy, r):
        self.silk.append(("circle", cx, cy, r))


COMPS = []


def comp(*a, **k):
    c = Comp(*a, **k)
    COMPS.append(c)
    return c


HDR = dict(size=(1.7, 1.7), drill=1.0)

# ---- ESP32-S3 dev board: two 1x22 female headers. USB-C end at the right board edge.
# Row A (J1) carries every signal: 3V3 3V3 RST 4 5 6 7 15 16 17 18 8 3 46 9 10 11 12 13 14 5V G
ESP_X0, ESP_YA = 44.0, 29.9
ESP_YB = ESP_YA - 25.4          # YD-ESP32-S3 / most real boards: rows 1.0" apart
ESP_YB2 = ESP_YA - 22.86        # Espressif drawing: 0.9" -> second hole row for that size
J1_LABELS = ["3V3", "3V3", "RST", "4", "5", "6", "7", "15", "16", "17", "18", "8", "3", "46",
             "9", "10", "11", "12", "13", "14", "5V", "G"]
J1_NETS = ["+3V3", "+3V3", None, None, "S1_RST", "S2_RST", None, "S2_TX", "S2_TXD", "S1_TX",
           "S1_TXD", "SDA", None, None, "SCL", None, None, None, None, None, "+5V_ESP", "GND"]
J1 = comp("J1", "1x22 female header", "PinSocket_1x22_P2.54mm", ESP_X0, ESP_YA,
          bom="Female header 1x22, 2.54 mm (ESP32 row with 3V3 ... 5V G)")
for k in range(22):
    J1.pad(str(k + 1), k * 2.54, 0, "rect" if k == 0 else "circle", net=J1_NETS[k], **HDR)
J2 = comp("J2", "1x22 female header", "PinSocket_1x22_P2.54mm_2rows", ESP_X0, ESP_YB,
          bom="Female header 1x22, 2.54 mm (ESP32 row with G TX RX ... G G)")
for k in range(22):
    net = "GND" if k in (0, 20, 21) else None
    J2.pad(str(k + 1), k * 2.54, 0, "rect" if k == 0 else "circle", net=net, **HDR)
    J2.pad(str(k + 1), k * 2.54, ESP_YB2 - ESP_YB, "circle", net=net, **HDR)

ESP_PCB = (ESP_X0 + 53.34 / 2 - 28.5, ESP_YA - 12.7 - 14.0, ESP_X0 + 53.34 / 2 + 28.5, ESP_YA - 12.7 + 14.0)
J1.rect(*ESP_PCB)
ANT = (ESP_PCB[0] - 6.5, ESP_YA - 12.7 - 9.25, ESP_PCB[0], ESP_YA - 12.7 + 9.25)
J1.rect(*ANT)
ANT_KEEPOUT = box(33.0, 2.0, 43.0, 31.5)   # no copper under the module antenna

# ---- SIM800L x2: 1x6 female header (NET VCC RST RXD TXD GND). The module overhangs to the left,
# SIM-card edge at the bottom board edge so the card can be pushed in.
SIM_W, SIM_D = 25.0, 23.0
SIM_PINS = ["NET", "VCC", "RST", "RXD", "TXD", "GND"]


def sim_socket(ref, mx, nets, label):
    hx = mx + SIM_W - 1.9
    c = comp(ref, "1x6 female header", "PinSocket_1x06_P2.54mm", hx, 95.0,
             bom=f"Female header 1x6, 2.54 mm ({label})")
    for k, nm in enumerate(SIM_PINS):
        c.pad(str(k + 1), 0, -k * 2.54, "rect" if k == 0 else "circle", net=nets[nm], **HDR)
    c.rect(mx, BH - SIM_D, mx + SIM_W, BH)                      # module outline
    c.rect(hx - 1.27, 95.0 + 1.27, hx + 1.27, 95.0 - 5 * 2.54 - 1.27)
    return c, hx


J3, SIM1_X = sim_socket("J3", 6.0, dict(NET=None, VCC="+4V", RST="S1_RST", RXD="S1_RXD",
                                        TXD="S1_TXD", GND="GND"), "SIM800L 1")
J4, SIM2_X = sim_socket("J4", 45.0, dict(NET=None, VCC="+4V", RST="S2_RST", RXD="S2_RXD",
                                         TXD="S2_TXD", GND="GND"), "SIM800L 2")

# ---- LM2596 buck modules (43.2 x 21), corner pads IN+ IN- OUT+ OUT-. Pad positions are the
# case project's estimate; the holes are big enough for single header pins or wire legs.
BUCK = (43.2, 21.0)
BUCK_PAD = dict(size=(2.4, 2.4), drill=1.2)


def buck(ref, ox, oy, outnet, label):
    c = comp(ref, "LM2596 module", "LM2596_module_43x21", ox + 1.8, oy + 1.8,
             bom=f"LM2596 buck module 43 x 21 mm ({label}) on 4 single header pins")
    c.pad("IN+", 0, 0, "rect", net="+12V", **BUCK_PAD)
    c.pad("IN-", 0, 17.4, "circle", net="GND", **BUCK_PAD)
    c.pad("OUT+", 39.6, 0, "rect", net=outnet, **BUCK_PAD)
    c.pad("OUT-", 39.6, 17.4, "circle", net="GND", **BUCK_PAD)
    c.rect(ox, oy, ox + BUCK[0], oy + BUCK[1])
    return c


U1 = buck("U1", 2.0, 35.0, "+5V5", "A, set to 5.5 V")
U2 = buck("U2", 49.5, 35.0, "+5V_BUCK", "B, set to 5.0 V")

# ---- 1000 uF next to each SIM800L VCC
CAP_PAD = dict(size=(2.0, 2.0), drill=1.0)


def bulk_cap(ref, x, y):
    c = comp(ref, "1000uF", "CP_Radial_D10.0mm_P5.00mm", x, y,
             bom="1000 uF 16 V low-ESR electrolytic, D10 mm, 5 mm lead spacing")
    c.pad("1", 0, 0, "rect", net="+4V", **CAP_PAD)
    c.pad("2", 0, -5.0, "circle", net="GND", **CAP_PAD)
    c.circle(x, y - 2.5, 5.1)
    return c


C1 = bulk_cap("C1", 38.5, 91.0)
C2 = bulk_cap("C2", 75.5, 91.0)

# ---- resistors (axial, 10.16 mm)
RES_PAD = dict(size=(1.6, 1.6), drill=0.8)


def resistor(ref, value, x, y, n1, n2, dy=10.16, dx=0.0):
    c = comp(ref, value, "R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm", x, y,
             bom=f"Resistor {value}, 1/4 W, axial")
    c.pad("1", 0, 0, "circle", net=n1, **RES_PAD)
    c.pad("2", dx, dy, "circle", net=n2, **RES_PAD)
    mx, my = x + dx / 2, y + dy / 2
    if dx == 0:
        top, bot = min(y, y + dy), max(y, y + dy)
        c.rect(mx - 1.25, my - 3.15, mx + 1.25, my + 3.15)
        c.line((mx, top + 1.0), (mx, my - 3.15))
        c.line((mx, my + 3.15), (mx, bot - 1.0))
    else:
        l, r = min(x, x + dx), max(x, x + dx)
        c.rect(mx - 3.15, my - 1.25, mx + 3.15, my + 1.25)
        c.line((l + 1.0, my), (mx - 3.15, my))
        c.line((mx + 3.15, my), (r - 1.0, my))
    return c


R1 = resistor("R1", "1k", 24.0, 58.5, "S1_TX", "S1_RXD")
R2 = resistor("R2", "3.3k", 20.0, 68.66, "S1_RXD", "GND", dy=-10.16)
R3 = resistor("R3", "1k", 63.0, 58.5, "S2_TX", "S2_RXD")
R4 = resistor("R4", "3.3k", 59.0, 68.66, "S2_RXD", "GND", dy=-10.16)
R5 = resistor("R5", "4.7k", 8.0, 26.0, "+12V", "LED_A", dy=0.0, dx=10.16)

# ---- U3: fixed 4.06 V for both SIM800Ls. LM2596 A only pre-regulates (5.5 V); whatever its
# trimmer is set to (up to the 12 V input), the SIM800Ls (4.4 V max) never see more than 4.06 V.
# LM1084-ADJ: Vout = 1.25 V x (1 + R6 / R7)... with R7 (ADJ-GND) = 270 and R6 (OUT-ADJ) = 120:
# 1.25 x (1 + 270 / 120) = 4.06 V. R6 also gives the regulator the 10 mA minimum load it needs.
# The TO-220 lies flat toward the SIM800Ls (legs bent 90 deg, plastic face down, metal tab up), so
# it stays under the OLED that hangs from the v2 lid above this strip. Its tab is OUT (+4V).
LDO_X, LDO_Y = 44.76, 61.0
U3 = comp("U3", "LM1084-ADJ", "TO-220-3_Horizontal_TabUp", LDO_X, LDO_Y,
          bom="LM1084IT-ADJ regulator, TO-220, lying flat (fixed 4.06 V for the SIM800Ls)")
TO220_PAD = dict(size=(1.9, 1.9), drill=1.1)
U3.pad("1", 0, 0, "rect", net="ADJ", **TO220_PAD)
U3.pad("2", 2.54, 0, "circle", net="+4V", **TO220_PAD)      # OUT (and the tab)
U3.pad("3", 5.08, 0, "circle", net="+5V5", **TO220_PAD)     # IN
LDO_BODY = (LDO_X - 2.54, LDO_Y + 2.6, LDO_X + 7.62, LDO_Y + 18.3)   # plastic + tab, seen from above
U3.rect(*LDO_BODY)
U3.line((LDO_BODY[0], LDO_Y + 11.8), (LDO_BODY[2], LDO_Y + 11.8))  # end of the plastic, tab beyond
U3.circle(LDO_X + 2.54, LDO_Y + 15.2, 1.8)                          # tab hole
R6 = resistor("R6", "120", 40.4, 64.5, "ADJ", "+4V")
R7 = resistor("R7", "270", 37.4, 64.5, "ADJ", "GND")

C3 = comp("C3", "100uF", "CP_Radial_D6.3mm_P2.50mm", 56.6, 71.5,
          bom="100 uF 16 V electrolytic, D6.3 mm, 2.5 mm lead spacing (U3 output)")
C3.pad("1", 0, 0, "rect", net="+4V", size=(1.6, 1.6), drill=0.8)
C3.pad("2", 0, 2.5, "circle", net="GND", size=(1.6, 1.6), drill=0.8)
C3.circle(56.6, 72.75, 3.3)

# ---- 12 V in: screw terminal -> 1N5822 (reverse polarity) -> both LM2596 inputs
J5 = comp("J5", "12V IN", "TerminalBlock_1x02_P5.08mm", 5.5, 13.0,
          bom="Screw terminal 2-pin, 5.08 mm (KF301-2P / DG301)")
J5.pad("1", 0, 0, "rect", size=(2.6, 2.6), drill=1.3, net="VIN")
J5.pad("2", 0, 5.08, "circle", size=(2.6, 2.6), drill=1.3, net="GND")
J5.rect(1.0, 9.4, 9.4, 21.7)
J5.line((1.0, 11.2), (2.2, 11.2))
J5.line((1.0, 19.9), (2.2, 19.9))

D1 = comp("D1", "1N5822", "D_DO-201AD_P15.24mm_Horizontal", 26.74, 13.0,
          bom="1N5822 Schottky diode 3 A 40 V (DO-201AD)")
D1.pad("1", 0, 0, "rect", size=(3.2, 3.2), drill=1.6, net="+12V")      # cathode
D1.pad("2", -15.24, 0, "circle", size=(3.2, 3.2), drill=1.6, net="VIN")  # anode
D1.rect(14.37, 10.35, 23.87, 15.65)
for xx in (21.9, 22.3, 22.7):
    D1.line((xx, 10.35), (xx, 15.65))
D1.line((13.1, 13.0), (14.37, 13.0))
D1.line((23.87, 13.0), (25.14, 13.0))

D2 = comp("D2", "LED", "LED_D3.0mm", 23.04, 26.0, bom="LED 3 mm, any colour (power light)")
D2.pad("1", 0, 0, "rect", size=(1.8, 1.8), drill=0.9, net="GND")       # cathode
D2.pad("2", -2.54, 0, "circle", size=(1.8, 1.8), drill=0.9, net="LED_A")
D2.circle(21.77, 26.0, 2.0)

# ---- OLED: 1x4 male header, wired to the OLED with 4 F-F jumpers
J6 = comp("J6", "OLED", "PinHeader_1x04_P2.54mm", 84.0, 66.0,
          bom="Male pin header 1x4, 2.54 mm (OLED: 4 F-F jumpers to the display)")
for k, n in enumerate(["SDA", "SCL", "GND", "+3V3"]):
    J6.pad(str(k + 1), k * 2.54, 0, "rect" if k == 0 else "circle", net=n, **HDR)
J6.rect(84.0 - 1.27, 66.0 - 1.27, 84.0 + 3 * 2.54 + 1.27, 66.0 + 1.27)

# ---- JP1: 5 V from LM2596 B to the ESP32. Pull the jumper when the ESP32 is on USB.
JP1 = comp("JP1", "5V ESP", "PinHeader_1x02_P2.54mm", 96.8, 38.0,
           bom="Male pin header 1x2, 2.54 mm + jumper cap")
JP1.pad("1", 0, 0, "rect", net="+5V_ESP", **HDR)
JP1.pad("2", 0, 2.54, "circle", net="+5V_BUCK", **HDR)
JP1.rect(96.8 - 1.27, 38.0 - 1.27, 96.8 + 1.27, 38.0 + 2.54 + 1.27)

# ---- mounting holes (M3)
HOLES = [(4.0, 4.0), (96.5, 17.0), (3.5, 96.5), (96.5, 96.5)]
for i, (x, y) in enumerate(HOLES):
    h = comp(f"H{i + 1}", "M3", "MountingHole_3.2mm_M3", x, y)
    h.pad("", 0, 0, "npth", size=(3.2, 3.2), drill=3.2)
HOLE_KEEPOUT = unary_union([Point(x, y).buffer(3.0, quad_segs=QS) for x, y in HOLES])

ALL_PADS = [p for c in COMPS for p in c.pads]
CU_PADS = [p for p in ALL_PADS if p.shape != "npth"]

# ----------------------------------------------------------------------------- copper
TRACKS = []   # (layer 'F'|'B', [(x,y),...], width, net)
VIAS = []     # (x, y, net)


def track(layer, pts, w, net):
    TRACKS.append((layer, pts, w, net))


# power, routed by hand
track("F", [(5.5, 13.0), (11.5, 13.0)], 1.5, "VIN")
track("F", [(26.74, 13.0), (26.74, 33.0)], 1.5, "+12V")
track("F", [(3.8, 36.8), (3.8, 33.0), (51.3, 33.0), (51.3, 36.8)], 1.5, "+12V")
track("F", [(8.0, 26.0), (8.0, 33.0)], 0.6, "+12V")
track("F", [(18.16, 26.0), (20.5, 26.0)], 0.5, "LED_A")
track("F", [(43.4, 36.8), (47.3, 36.8), (47.3, 57.0), (49.84, 57.0), (49.84, LDO_Y)], 2.0, "+5V5")  # A -> U3 IN
track("F", [(47.3, LDO_Y), (47.3, 97.5)], 2.0, "+4V")                                            # U3 OUT -> SIMs
track("F", [(47.3, 71.5), (56.6, 71.5)], 1.0, "+4V")                                             # C3
track("F", [(40.4, 74.66), (47.3, 74.66)], 0.8, "+4V")                                           # R6
track("F", [(LDO_X, LDO_Y), (LDO_X, 62.6), (37.4, 62.6), (37.4, 64.5)], 0.6, "ADJ")              # U3 ADJ, R7
track("F", [(40.4, 62.6), (40.4, 64.5)], 0.6, "ADJ")                                             # R6
track("F", [(38.5, 91.0), (38.5, 97.5), (75.5, 97.5), (75.5, 91.0)], 2.0, "+4V")
track("F", [(SIM1_X, 92.46), (38.5, 92.46)], 1.5, "+4V")
track("F", [(SIM2_X, 92.46), (75.5, 92.46)], 1.5, "+4V")
track("F", [(90.9, 36.8), (90.9, 40.54), (96.8, 40.54)], 1.0, "+5V_BUCK")
track("F", [(96.8, 38.0), (96.8, 32.5), (94.8, 30.5), (94.8, ESP_YA)], 1.0, "+5V_ESP")


def track_geom(t):
    layer, pts, w, net = t
    return LineString(pts).buffer(w / 2, quad_segs=QS)


def via_geom(v):
    return Point(v[0], v[1]).buffer(VIA_D / 2, quad_segs=QS)


def copper_items(layer):
    """(key, geom) of every copper item on a layer (pads are on both layers)."""
    out = [(p.key, p.geom()) for p in CU_PADS]
    out += [(t[3], track_geom(t)) for t in TRACKS if t[0] == layer]
    out += [(v[2], via_geom(v)) for v in VIAS]
    return out


# ----------------------------------------------------------------------------- router
G = 0.25
NX, NY = int(round(BW / G)) + 1, int(round(BH / G)) + 1
GX, GY = np.meshgrid(np.arange(NX) * G, np.arange(NY) * G)
GXF, GYF = GX.ravel(), GY.ravel()
MARGIN = 0.18     # grid slack: a diagonal step can pass 0.177 mm closer than its end cells


def raster(geom):
    if geom.is_empty:
        return np.zeros((NY, NX), bool)
    shapely.prepare(geom)
    return shapely.contains_xy(geom, GXF, GYF).reshape(NY, NX)


FIXED_KEEPOUT = unary_union([ANT_KEEPOUT, HOLE_KEEPOUT])
SQ2 = math.sqrt(2)
DIRS = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
TURN = {0: 0.0, 1: 0.3, 2: 3.0}


def route_net(net, terms, w, layer_cost=(1.0, 1.6), via_cost=10.0):
    """terms: list of pads. Routes a tree over all of them, adds tracks/vias. Returns True if done."""
    blocked, near = [], []
    other = {}
    for li, layer in enumerate("FB"):
        geoms = [g for k, g in copper_items(layer) if k != net]
        other[layer] = unary_union(geoms)
        obs = other[layer].buffer(CLR + w / 2 + MARGIN, quad_segs=4)
        obs = unary_union([obs, FIXED_KEEPOUT.buffer(w / 2 + MARGIN)])
        b = raster(obs) | ~raster(BOARD.buffer(-(EDGE_CLR + w / 2 + MARGIN)))
        blocked.append(b)
        near.append(raster(other[layer].buffer(CLR + w / 2 + 0.8, quad_segs=4)))
    vobs = unary_union([other["F"], other["B"]]).buffer(CLR + VIA_D / 2 + 0.05, quad_segs=4)
    vobs = unary_union([vobs, FIXED_KEEPOUT.buffer(VIA_D / 2 + 0.05)] +
                       [p.geom(VIA_D / 2 + CLR) for p in CU_PADS])
    vblock = raster(vobs) | ~raster(BOARD.buffer(-(EDGE_CLR + VIA_D / 2)))

    def pad_cells(p):
        m = raster(p.geom(-0.05))
        js, is_ = np.nonzero(m)
        cells = set()
        for j, i in zip(js, is_):
            for li in (0, 1):
                cells.add((li, int(i), int(j)))
        return cells

    tree = {}   # (layer,i,j) -> anchor point (pad centre) or None
    for c in pad_cells(terms[0]):
        tree[c] = (terms[0].x, terms[0].y)
    todo = list(terms[1:])
    while todo:
        tpts = np.array([(i * G, j * G) for (_, i, j) in tree])
        todo.sort(key=lambda p: float(np.min(np.hypot(tpts[:, 0] - p.x, tpts[:, 1] - p.y))))
        tgt = todo.pop(0)
        goals = pad_cells(tgt)
        gi, gj = tgt.x / G, tgt.y / G

        def h(i, j):
            dx, dy = abs(i - gi), abs(j - gj)
            return max(dx, dy) + (SQ2 - 1) * min(dx, dy)

        openh, best, parent, closed = [], {}, {}, set()
        for (l, i, j) in tree:
            key = (l, i, j, 8)
            best[key] = 0.0
            parent[key] = None
            heapq.heappush(openh, (h(i, j), 0.0, key))
        found = None
        while openh:
            f, g, key = heapq.heappop(openh)
            if key in closed:
                continue
            closed.add(key)
            l, i, j, d = key
            if (l, i, j) in goals:
                found = key
                break
            lc = layer_cost[l]
            bl, nr = blocked[l], near[l]
            for nd, (dx, dy) in enumerate(DIRS):
                if d != 8:
                    diff = abs(nd - d) % 8
                    diff = min(diff, 8 - diff)
                    if diff > 2:
                        continue
                    tc = TURN[diff]
                else:
                    tc = 0.0
                ni, nj = i + dx, j + dy
                if ni < 0 or nj < 0 or ni >= NX or nj >= NY or bl[nj, ni]:
                    continue
                step = SQ2 if dx and dy else 1.0
                ng = g + step * lc + tc + (0.4 if nr[nj, ni] else 0.0)
                nkey = (l, ni, nj, nd)
                if ng < best.get(nkey, 1e18):
                    best[nkey] = ng
                    parent[nkey] = key
                    heapq.heappush(openh, (ng + h(ni, nj), ng, nkey))
            if not vblock[j, i]:
                ol = 1 - l
                if not blocked[ol][j, i]:
                    nkey = (ol, i, j, 8)
                    ng = g + via_cost
                    if ng < best.get(nkey, 1e18):
                        best[nkey] = ng
                        parent[nkey] = key
                        heapq.heappush(openh, (ng + h(i, j), ng, nkey))
        if not found:
            print(f"  !! could not route {net} to {tgt.comp.ref}.{tgt.num}")
            return False
        path = []
        k = found
        while k is not None:
            path.append(k[:3])
            k = parent[k]
        path.reverse()
        start_anchor = tree.get(path[0])
        # split into layer runs
        runs, cur = [], [path[0]]
        for s in path[1:]:
            if s[0] != cur[-1][0]:
                runs.append(cur)
                VIAS.append((s[1] * G, s[2] * G, net))
                cur = [s]
            else:
                cur.append(s)
        runs.append(cur)
        for ri, run in enumerate(runs):
            pts = [(i * G, j * G) for (_, i, j) in run]
            if ri == 0 and start_anchor is not None:
                pts.insert(0, start_anchor)
            if ri == len(runs) - 1:
                pts.append((tgt.x, tgt.y))
            # drop duplicate and collinear points
            clean = []
            for p in pts:
                if clean and abs(clean[-1][0] - p[0]) < 1e-9 and abs(clean[-1][1] - p[1]) < 1e-9:
                    continue
                clean.append(p)
            simp = [clean[0]]
            for a in range(1, len(clean) - 1):
                p0, p1, p2 = simp[-1], clean[a], clean[a + 1]
                cross = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0])
                if abs(cross) > 1e-9:
                    simp.append(p1)
            simp.append(clean[-1])
            if len(simp) >= 2:
                track("FB"[run[0][0]], simp, w, net)
        for s in path:
            tree.setdefault(s, None)
        for s in path:
            if any(v for v in VIAS if v[2] == net and abs(v[0] - s[1] * G) < 1e-9 and abs(v[1] - s[2] * G) < 1e-9):
                tree.setdefault((1 - s[0], s[1], s[2]), None)
        for c in goals:
            tree[c] = (tgt.x, tgt.y)
    return True


def pads_of(net):
    return [p for p in CU_PADS if p.net == net]


ROUTES = [
    ("S1_TX", SIG_W), ("S1_TXD", SIG_W), ("S1_RST", SIG_W), ("S1_RXD", SIG_W),
    ("S2_TX", SIG_W), ("S2_TXD", SIG_W), ("S2_RST", SIG_W), ("S2_RXD", SIG_W),
    ("SDA", SIG_W), ("SCL", SIG_W), ("+3V3", 0.5),
]

# ----------------------------------------------------------------------------- ground pour
POUR = {}
STITCH = []


def build_pour():
    gnd_pads = pads_of("GND")
    area = BOARD.buffer(-EDGE_CLR).difference(FIXED_KEEPOUT)
    body = {}
    for layer in "FB":
        foreign = unary_union([g for k, g in copper_items(layer) if k != "GND"])
        raw = area.difference(foreign.buffer(POUR_CLR, quad_segs=QS))
        antis, spokes = [], []
        for p in gnd_pads:
            antis.append(p.geom(POUR_CLR))
            L = max(p.size) / 2 + POUR_CLR + 0.8
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                spokes.append(LineString([(p.x, p.y), (p.x + dx * L, p.y + dy * L)]).buffer(0.25, cap_style="flat"))
        b = raw.difference(unary_union(antis)).union(unary_union(spokes).intersection(raw))
        b = b.buffer(-0.13, quad_segs=QS).buffer(0.13, quad_segs=QS)   # no slivers < 0.26 mm
        body[layer] = b
    # stitching vias where both layers have pour
    inner = {l: body[l].buffer(-(VIA_D / 2 + 0.05)) for l in "FB"}
    both = inner["F"].intersection(inner["B"])
    shapely.prepare(both)
    taken = [Point(p.x, p.y) for p in CU_PADS] + [Point(v[0], v[1]) for v in VIAS]
    no_via = unary_union([text_geom(*t) for t in TEXTS]).buffer(1.0)   # keep vias off the lettering
    for row, y in enumerate(np.arange(5.0, BH - 2, 9.0)):
        for x in np.arange(5.0 + (4.5 if row % 2 else 0.0), BW - 2, 9.0):
            pt = Point(x, y)
            if both.contains(pt) and not no_via.contains(pt) and all(pt.distance(t) > 2.5 for t in taken):
                STITCH.append((float(x), float(y), "GND"))
                taken.append(pt)
    # keep only pour islands that reach a GND pad (directly or through stitching vias)
    nodes = [(l, poly) for l in "FB" for poly in polys(body[l])]
    parent = list(range(len(nodes)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for (x, y, _) in STITCH:
        idx = [n for n, (l, poly) in enumerate(nodes) if poly.contains(Point(x, y))]
        for a, b in zip(idx, idx[1:]):
            parent[find(a)] = find(b)
    anchored = set()
    for n, (l, poly) in enumerate(nodes):
        if any(poly.intersects(p.geom()) for p in gnd_pads):
            anchored.add(find(n))
    keep = {l: [] for l in "FB"}
    for n, (l, poly) in enumerate(nodes):
        if find(n) in anchored:
            keep[l].append(poly)
    for l in "FB":
        POUR[l] = unary_union(keep[l])
    kept = []
    for v in STITCH:
        if POUR["F"].contains(Point(v[0], v[1])) and POUR["B"].contains(Point(v[0], v[1])):
            kept.append(v)
    STITCH[:] = kept
    VIAS.extend(STITCH)


def layer_copper(layer):
    """net-key -> geometry, pour included."""
    d = {}
    for k, g in copper_items(layer):
        d.setdefault(k, []).append(g)
    d.setdefault("GND", []).append(POUR.get(layer, Polygon()))
    return {k: unary_union(v) for k, v in d.items()}


# ----------------------------------------------------------------------------- text
from matplotlib.font_manager import FontProperties  # noqa: E402
from matplotlib.textpath import TextPath  # noqa: E402

FONT = FontProperties(family="DejaVu Sans", weight="bold")
TEXTS = []   # (text, x, y, h, layer, anchor, rot)


def text(s, x, y, h=1.0, layer="F", anchor="c", rot=0):
    TEXTS.append((s, x, y, h, layer, anchor, rot))


def text_geom(s, x, y, h, layer, anchor, rot):
    tp = TextPath((0, 0), s, size=h / 0.729, prop=FONT)
    acc = Polygon()
    for ring in tp.to_polygons():
        if len(ring) >= 3:
            acc = acc.symmetric_difference(Polygon(ring).buffer(0))
    if acc.is_empty:
        return acc
    minx, _, maxx, _ = acc.bounds
    ax = {"l": minx, "c": (minx + maxx) / 2, "r": maxx}[anchor]
    g = affinity.translate(acc, -ax, -h / 2)
    g = affinity.scale(g, 1, -1, origin=(0, 0))          # y down on the board
    if layer == "B":
        g = affinity.scale(g, -1, 1, origin=(0, 0))      # reads right from below
    g = affinity.rotate(g, -rot, origin=(0, 0))
    return affinity.translate(g, x, y)


def silk_items():
    out = []
    for c in COMPS:
        for it in c.silk:
            if it[0] == "line":
                out.append(LineString(it[1]).buffer(0.075, quad_segs=2))
            else:
                _, cx, cy, r = it
                out.append(Point(cx, cy).buffer(r + 0.075, quad_segs=QS).difference(
                    Point(cx, cy).buffer(r - 0.075, quad_segs=QS)))
    return out


# ----------------------------------------------------------------------------- labels
def labels():
    # ESP32
    text("ESP32-S3 dev board", 70.0, 13.6, 1.8)
    text("YD-ESP32-S3 / DevKitC-1, USB-C this end  >>", 68.0, 17.2, 1.0)
    text("outer row: 25.4 mm boards   inner row: 22.86 mm boards", 70.0, 10.2, 0.85)
    text("ANTENNA", ANT[0] + 3.2, ESP_YA - 12.7, 1.0, rot=90)
    for k, lab in enumerate(J1_LABELS):
        text(lab, ESP_X0 + k * 2.54, ESP_YA - 1.6, 0.85, anchor="l", rot=90)
    # SIM800L
    for hx, name in ((SIM1_X, "SIM800L 1"), (SIM2_X, "SIM800L 2")):
        cx = hx + 1.9 - SIM_W / 2
        text(name, cx - 3.0, 86.0, 1.5)
        text("chip up, pins down", cx - 3.0, 88.6, 0.9)
        text("SIM card in here  v", cx - 3.0, 98.5, 1.0)
        for k, nm in enumerate(SIM_PINS):
            text(nm, hx - 1.9, 95.0 - k * 2.54, 0.9, anchor="r")
    # bucks
    for c, nm, v in ((U1, "LM2596 A", "set 5.5 V (U3 makes 4.0 V for the SIM800Ls)"),
                     (U2, "LM2596 B", "set 5.0 V before plugging in the ESP32")):
        cx = c.x - 1.8 + BUCK[0] / 2
        text(nm, cx, 43.6, 1.8)
        text(v, cx, 47.0, 1.0)
        text("IN+", c.x + 1.8, c.y, 1.0, anchor="l")
        text("IN-", c.x + 1.8, c.y + 17.4, 1.0, anchor="l")
        text("OUT+", c.x + 39.6 - 1.8, c.y, 1.0, anchor="r")
        text("OUT-", c.x + 39.6 - 1.8, c.y + 17.4, 1.0, anchor="r")
    # power in
    text("12V IN", 5.2, 23.4, 1.3)
    text("+", 2.4, 13.0, 1.4)
    text("-", 2.4, 18.08, 1.4)
    text("1N5822", 18.2, 13.0, 1.1)
    text("D1", 19.1, 8.9, 1.0)
    text("R5 4.7k", 13.1, 23.7, 0.9)
    text("PWR", 21.8, 28.6, 0.9)
    # dividers + caps
    text("R1 1k", 25.9, 63.6, 0.9, rot=90)
    text("R2 3.3k", 18.1, 63.6, 0.9, rot=90)
    text("R3 1k", 64.9, 63.6, 0.9, rot=90)
    text("R4 3.3k", 57.1, 63.6, 0.9, rot=90)
    for c in (C1, C2):
        text("+", c.x - 2.3, c.y + 1.2, 1.4)
        text(f"{c.ref} 1000uF", c.x, c.y - 9.0, 0.9)
    # U3: fixed 4.0 V for the SIM800Ls
    text("U3 LM1084", 47.3, 67.0, 1.1)
    text("fixed 4.0 V", 47.3, 68.8, 0.9)
    text("lies flat", 47.3, 70.4, 0.8)
    text("R7", 37.4, 76.6, 0.8)
    text("270", 37.4, 77.8, 0.7)
    text("R6", 40.4, 76.6, 0.8)
    text("120", 40.4, 77.8, 0.7)
    text("+", 58.6, 71.4, 1.1)
    text("C3", 61.6, 72.4, 0.8)
    text("100uF", 61.6, 73.7, 0.7)
    # OLED + JP1
    text("OLED", 87.8, 62.9, 1.3)
    for k, lab in enumerate(["SDA", "SCL", "GND", "3V3"]):
        text(lab, 84.0 + k * 2.54, 71.3, 0.85, anchor="l", rot=90)
    text("JP1 5V", 94.2, 39.3, 0.9, rot=90)
    # title
    text("SMS GATEWAY", 90.0, 75.0, 1.6)
    text("v2 carrier PCB", 90.0, 77.6, 1.0)
    text("JP1 off = ESP32", 90.0, 80.0, 0.85)
    text("on USB only", 90.0, 81.5, 0.85)
    # back side
    text("SMS GATEWAY v2", 50.0, 73.0, 3.0, layer="B")
    text("carrier PCB - github.com/mirzaaghazadeh/SmsGateway", 50.0, 77.0, 1.5, layer="B")
    text("2 layers  1.6 mm  all through-hole", 50.0, 79.6, 1.2, layer="B")


# ----------------------------------------------------------------------------- outputs
def gerber_open(path, func):
    f = open(path, "w")
    f.write("G04 SMS gateway v2 carrier PCB - generated by make_board.py*\n")
    f.write(f"%TF.FileFunction,{func}*%\n%TF.FilePolarity,Positive*%\n")
    f.write("%FSLAX46Y46*%\n%MOMM*%\n%LPD*%\n%ADD10C,0.100000*%\nD10*\n")
    return f


def gc(x, y):
    return f"X{int(round(x * 1e6))}Y{int(round((BH - y) * 1e6))}"


def gerber_regions(f, geom):
    ps = sorted(polys(geom), key=lambda p: -Polygon(p.exterior).area)
    pol = "D"
    for p in ps:
        if pol != "D":
            f.write("%LPD*%\n")
            pol = "D"
        rings = [(p.exterior, "D")] + [(r, "C") for r in p.interiors]
        for ring, rp in rings:
            if rp != pol:
                f.write(f"%LP{rp}*%\n")
                pol = rp
            cs = list(ring.coords)
            f.write("G36*\n")
            f.write(gc(*cs[0]) + "D02*\n")
            for c in cs[1:]:
                f.write(gc(*c) + "D01*\n")
            f.write("G37*\n")
    if pol != "D":
        f.write("%LPD*%\n")


def write_outputs():
    gdir = os.path.join(HERE, "gerbers")
    os.makedirs(gdir, exist_ok=True)
    files = []
    mask = unary_union([p.geom(MASK_EXP) for p in ALL_PADS])
    silk_cut = mask.buffer(0.1)
    silk_area = BOARD.buffer(-0.3)
    silk_f = unary_union(silk_items() + [text_geom(*t) for t in TEXTS if t[4] == "F"])
    silk_b = unary_union([text_geom(*t) for t in TEXTS if t[4] == "B"])
    silk_f = silk_f.intersection(silk_area).difference(silk_cut)
    silk_b = silk_b.intersection(silk_area).difference(silk_cut)
    cu = {l: unary_union(list(layer_copper(l).values())) for l in "FB"}
    layers = [
        ("F_Cu.gtl", "Copper,L1,Top", cu["F"]),
        ("B_Cu.gbl", "Copper,L2,Bot", cu["B"]),
        ("F_Mask.gts", "Soldermask,Top", mask),
        ("B_Mask.gbs", "Soldermask,Bot", mask),
        ("F_Silkscreen.gto", "Legend,Top", silk_f),
        ("B_Silkscreen.gbo", "Legend,Bot", silk_b),
    ]
    for fn, func, g in layers:
        path = os.path.join(gdir, f"{NAME}-{fn}")
        f = gerber_open(path, func)
        gerber_regions(f, g)
        f.write("M02*\n")
        f.close()
        files.append(path)
    # outline
    path = os.path.join(gdir, f"{NAME}-Edge_Cuts.gm1")
    f = gerber_open(path, "Profile,NP")
    cs = list(BOARD.exterior.coords)
    f.write(gc(*cs[0]) + "D02*\n")
    for c in cs[1:]:
        f.write(gc(*c) + "D01*\n")
    f.write("M02*\n")
    f.close()
    files.append(path)
    # drills
    for kind, sel in (("PTH", lambda p: p.shape != "npth"), ("NPTH", lambda p: p.shape == "npth")):
        holes = [(p.drill, p.x, p.y) for p in ALL_PADS if sel(p)]
        if kind == "PTH":
            holes += [(VIA_DRILL, v[0], v[1]) for v in VIAS]
        sizes = sorted({round(h[0], 3) for h in holes})
        path = os.path.join(gdir, f"{NAME}-{kind}.drl")
        with open(path, "w") as f:
            f.write("M48\n; SMS gateway v2 carrier PCB\n")
            f.write(f"; #@! TF.FileFunction,{'Plated' if kind == 'PTH' else 'NonPlated'},1,2,{kind}\n")
            f.write("FMAT,2\nMETRIC\n")
            for i, s in enumerate(sizes):
                f.write(f"T{i + 1}C{s:.3f}\n")
            f.write("%\nG90\nG05\n")
            for i, s in enumerate(sizes):
                f.write(f"T{i + 1}\n")
                for d, x, y in holes:
                    if round(d, 3) == s:
                        f.write(f"X{x:.3f}Y{BH - y:.3f}\n")
            f.write("M30\n")
        files.append(path)
    zp = os.path.join(HERE, f"{NAME}_gerbers.zip")
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, os.path.basename(p))
    return dict(cu=cu, mask=mask, silk_f=silk_f, silk_b=silk_b)


ASSEMBLY = {
    # ref: (value, footprint, rotation, description, place it?)
    "J1": ("1x22 female header", "PinSocket_1x22_P2.54mm", 90,
           "Female pin header 1x22, 2.54 mm, 8.5 mm tall, straight", True),
    "J2": ("1x22 female header", "PinSocket_1x22_P2.54mm", 90,
           "Female pin header 1x22, 2.54 mm, 8.5 mm tall, straight - OUTER hole row only", True),
    "J3": ("1x6 female header", "PinSocket_1x06_P2.54mm", 180,
           "Female pin header 1x6, 2.54 mm, 8.5 mm tall, straight", True),
    "J4": ("1x6 female header", "PinSocket_1x06_P2.54mm", 180,
           "Female pin header 1x6, 2.54 mm, 8.5 mm tall, straight", True),
    "J5": ("KF301-2P", "TerminalBlock_1x02_P5.08mm", 270,
           "Screw terminal 2-pin, 5.08 mm, wire entry toward the board edge", True),
    "J6": ("1x4 male header", "PinHeader_1x04_P2.54mm", 90, "Male pin header 1x4, 2.54 mm, straight", True),
    "JP1": ("1x2 male header + jumper", "PinHeader_1x02_P2.54mm", 0,
            "Male pin header 1x2, 2.54 mm, straight, with a jumper cap fitted", True),
    "D1": ("1N5822", "D_DO-201AD_P15.24mm_Horizontal", 180,
           "Schottky diode 3 A 40 V, DO-201AD, band (cathode) on the square pad", True),
    "D2": ("LED 3mm", "LED_D3.0mm", 180, "LED 3 mm, any colour, short leg (cathode) in the square pad", True),
    "C1": ("1000uF 16V", "CP_Radial_D10.0mm_P5.00mm", 90,
           "Electrolytic 1000 uF 16 V low-ESR, D10 mm, 5 mm pitch, + leg in the square pad", True),
    "C2": ("1000uF 16V", "CP_Radial_D10.0mm_P5.00mm", 90,
           "Electrolytic 1000 uF 16 V low-ESR, D10 mm, 5 mm pitch, + leg in the square pad", True),
    "C3": ("100uF 16V", "CP_Radial_D6.3mm_P2.50mm", 270,
           "Electrolytic 100 uF 16 V, D6.3 mm, 2.5 mm pitch, + leg in the square pad", True),
    "U3": ("LM1084IT-ADJ", "TO-220-3_Horizontal_TabUp", 0,
           "LDO regulator, TO-220 lying flat (legs bent 90 deg), plastic face down, metal tab up, pin 1 (ADJ) in the square pad", True),
    "R6": ("120", "R_Axial_DIN0207_P10.16mm", 270, "Resistor 120 Ohm 1/4 W 1 % axial", True),
    "R7": ("270", "R_Axial_DIN0207_P10.16mm", 270, "Resistor 270 Ohm 1/4 W 1 % axial", True),
    "R1": ("1k", "R_Axial_DIN0207_P10.16mm", 270, "Resistor 1 kOhm 1/4 W 1 % axial", True),
    "R3": ("1k", "R_Axial_DIN0207_P10.16mm", 270, "Resistor 1 kOhm 1/4 W 1 % axial", True),
    "R2": ("3.3k", "R_Axial_DIN0207_P10.16mm", 90, "Resistor 3.3 kOhm 1/4 W 1 % axial", True),
    "R4": ("3.3k", "R_Axial_DIN0207_P10.16mm", 90, "Resistor 3.3 kOhm 1/4 W 1 % axial", True),
    "R5": ("4.7k", "R_Axial_DIN0207_P10.16mm", 0, "Resistor 4.7 kOhm 1/4 W 1 % axial", True),
    "U1": ("LM2596 module", "LM2596_module_43x21", 0, "DO NOT PLACE - customer fits own module", False),
    "U2": ("LM2596 module", "LM2596_module_43x21", 0, "DO NOT PLACE - customer fits own module", False),
}


def write_assembly():
    """pick-and-place (centroid) CSV for the assembly service (origin = board bottom-left, y up)."""
    with open(os.path.join(HERE, f"{NAME}_pick_and_place.csv"), "w") as f:
        f.write("Designator,Mid X(mm),Mid Y(mm),Layer,Rotation,Comment\n")
        for c in COMPS:
            if c.ref not in ASSEMBLY or not ASSEMBLY[c.ref][4]:
                continue
            ps = c.pads
            if c.ref == "J2":                      # outer row only
                ps = [p for p in ps if abs(p.y - ESP_YB) < 1e-6]
            if c.ref in ("C1", "C2"):
                mx, my = c.x, c.y - 2.5            # body centre
            else:
                xs, ys = [p.x for p in ps], [p.y for p in ps]
                mx, my = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            f.write(f"{c.ref},{mx:.3f},{BH - my:.3f},Top,{ASSEMBLY[c.ref][2]},\"{ASSEMBLY[c.ref][0]}\"\n")


# ----------------------------------------------------------------------------- KiCad file
def write_kicad():
    names = ["", "GND"] + sorted({p.net for p in CU_PADS if p.net and p.net != "GND"})
    nid = {n: i for i, n in enumerate(names)}

    def U():
        return f'(uuid "{uuid.uuid4()}")'

    def q(s):
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'

    def n(v):
        return f"{v:.4f}".rstrip("0").rstrip(".")

    L = ['(kicad_pcb', '\t(version 20240108)', '\t(generator "smsgw_make_board")',
         '\t(generator_version "8.0")', '\t(general (thickness 1.6) (legacy_teardrops no))',
         '\t(paper "A4")', '\t(layers']
    for num, nm, typ in [(0, "F.Cu", "signal"), (31, "B.Cu", "signal"), (34, "B.Paste", "user"),
                         (35, "F.Paste", "user"), (36, "B.SilkS", "user"), (37, "F.SilkS", "user"),
                         (38, "B.Mask", "user"), (39, "F.Mask", "user"), (40, "Dwgs.User", "user"),
                         (41, "Cmts.User", "user"), (44, "Edge.Cuts", "user"), (45, "Margin", "user"),
                         (46, "B.CrtYd", "user"), (47, "F.CrtYd", "user"), (48, "B.Fab", "user"),
                         (49, "F.Fab", "user")]:
        L.append(f'\t\t({num} "{nm}" {typ})')
    L.append('\t)')
    L.append('\t(setup (pad_to_mask_clearance 0.05))')
    for nm in names:
        L.append(f'\t(net {nid[nm]} {q(nm)})')
    for c in COMPS:
        L.append(f'\t(footprint {q("SMSGW:" + c.fp)} (layer "F.Cu") {U()} (at {n(c.x)} {n(c.y)})')
        L.append(f'\t\t(property "Reference" {q(c.ref)} (at 0 -2 0) (layer "F.Fab") {U()} '
                 f'(effects (font (size 1 1) (thickness 0.15))))')
        L.append(f'\t\t(property "Value" {q(c.value)} (at 0 2 0) (layer "F.Fab") {U()} '
                 f'(effects (font (size 1 1) (thickness 0.15))))')
        L.append('\t\t(attr through_hole)')
        for it in c.silk:
            if it[0] == "line":
                for a, b in zip(it[1], it[1][1:]):
                    L.append(f'\t\t(fp_line (start {n(a[0] - c.x)} {n(a[1] - c.y)}) (end {n(b[0] - c.x)} {n(b[1] - c.y)}) '
                             f'(stroke (width 0.15) (type solid)) (layer "F.SilkS") {U()})')
            else:
                _, cx, cy, r = it
                L.append(f'\t\t(fp_circle (center {n(cx - c.x)} {n(cy - c.y)}) (end {n(cx - c.x + r)} {n(cy - c.y)}) '
                         f'(stroke (width 0.15) (type solid)) (fill none) (layer "F.SilkS") {U()})')
        for p in c.pads:
            at = f'(at {n(p.x - c.x)} {n(p.y - c.y)})'
            if p.shape == "npth":
                L.append(f'\t\t(pad "" np_thru_hole circle {at} (size {n(p.size[0])} {n(p.size[1])}) '
                         f'(drill {n(p.drill)}) (layers "*.Cu" "*.Mask") {U()})')
                continue
            shape = "rect" if p.shape == "rect" else "circle"
            net = f' (net {nid[p.net]} {q(p.net)})' if p.net else ""
            L.append(f'\t\t(pad {q(p.num)} thru_hole {shape} {at} (size {n(p.size[0])} {n(p.size[1])}) '
                     f'(drill {n(p.drill)}) (layers "*.Cu" "*.Mask"){net} {U()})')
        L.append('\t)')
    # outline: 4 lines + 4 arcs
    r = BR
    for (a, b) in [((r, 0), (BW - r, 0)), ((BW, r), (BW, BH - r)), ((BW - r, BH), (r, BH)), ((0, BH - r), (0, r))]:
        L.append(f'\t(gr_line (start {n(a[0])} {n(a[1])}) (end {n(b[0])} {n(b[1])}) '
                 f'(stroke (width 0.1) (type default)) (layer "Edge.Cuts") {U()})')
    k = r * (1 - math.sqrt(0.5))
    for (s, m, e) in [((0, r), (k, k), (r, 0)), ((BW - r, 0), (BW - k, k), (BW, r)),
                      ((BW, BH - r), (BW - k, BH - k), (BW - r, BH)), ((r, BH), (k, BH - k), (0, BH - r))]:
        L.append(f'\t(gr_arc (start {n(s[0])} {n(s[1])}) (mid {n(m[0])} {n(m[1])}) (end {n(e[0])} {n(e[1])}) '
                 f'(stroke (width 0.1) (type default)) (layer "Edge.Cuts") {U()})')
    for (s, x, y, h, layer, anchor, rot) in TEXTS:
        lay = "F.SilkS" if layer == "F" else "B.SilkS"
        just = {"l": "left", "c": "", "r": "right"}[anchor]
        if layer == "B":
            just = (just + " mirror").strip()
        js = f" (justify {just})" if just else ""
        th = max(0.15, h * 0.15)
        L.append(f'\t(gr_text {q(s)} (at {n(x)} {n(y)} {rot}) (layer "{lay}") {U()} '
                 f'(effects (font (size {n(h)} {n(h)}) (thickness {n(th)})){js}))')
    for (layer, pts, w, net) in TRACKS:
        lay = "F.Cu" if layer == "F" else "B.Cu"
        for a, b in zip(pts, pts[1:]):
            L.append(f'\t(segment (start {n(a[0])} {n(a[1])}) (end {n(b[0])} {n(b[1])}) (width {n(w)}) '
                     f'(layer "{lay}") (net {nid[net]}) {U()})')
    for (x, y, net) in VIAS:
        L.append(f'\t(via (at {n(x)} {n(y)}) (size {n(VIA_D)}) (drill {n(VIA_DRILL)}) (layers "F.Cu" "B.Cu") '
                 f'(net {nid[net]}) {U()})')
    inset = 0.5
    pts = " ".join(f"(xy {n(x)} {n(y)})" for x, y in
                   [(inset, inset), (BW - inset, inset), (BW - inset, BH - inset), (inset, BH - inset)])
    L.append(f'\t(zone (net {nid["GND"]}) (net_name "GND") (layers "F.Cu" "B.Cu") {U()} (name "GND") '
             f'(hatch edge 0.5) (connect_pads (clearance {POUR_CLR})) (min_thickness 0.25) '
             f'(filled_areas_thickness no) (fill yes (thermal_gap {POUR_CLR}) (thermal_bridge_width 0.5)) '
             f'(polygon (pts {pts})))')
    x0, y0, x1, y1 = ANT_KEEPOUT.bounds
    pts = " ".join(f"(xy {n(x)} {n(y)})" for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    L.append(f'\t(zone (net 0) (net_name "") (layers "F.Cu" "B.Cu") {U()} (name "ESP32 antenna") '
             f'(hatch edge 0.5) (connect_pads (clearance 0)) (min_thickness 0.25) (filled_areas_thickness no) '
             f'(keepout (tracks not_allowed) (vias not_allowed) (pads allowed) (copperpour not_allowed) '
             f'(footprints allowed)) (fill (thermal_gap 0.5) (thermal_bridge_width 0.5)) (polygon (pts {pts})))')
    L.append(')')
    src = "\n".join(L) + "\n"
    depth = 0
    for ch in src:
        depth += (ch == "(") - (ch == ")")
        assert depth >= 0
    assert depth == 0, "unbalanced s-expression"
    with open(os.path.join(HERE, f"{NAME}.kicad_pcb"), "w") as f:
        f.write(src)


# ----------------------------------------------------------------------------- checks
STATS = {}


def drc():
    errs, warns = [], []
    for layer in "FB":
        cu = layer_copper(layer)
        items = [(k, g) for k, g in cu.items() if not g.is_empty]
        for (k1, g1), (k2, g2) in combinations(items, 2):
            if not g1.buffer(CLR).intersects(g2):
                continue
            d = g1.distance(g2)
            STATS["min_clearance"] = min(STATS.get("min_clearance", CLR), d)
            if d < CLR_MIN - 1e-6:
                errs.append(f"{layer}.Cu clearance {d:.3f} mm between {k1} and {k2}")
            elif d < CLR - 0.011:
                warns.append(f"{layer}.Cu clearance {d:.3f} mm between {k1} and {k2}")
        allcu = unary_union([g for _, g in items])
        if not BOARD.buffer(-0.3).contains(allcu):
            errs.append(f"{layer}.Cu copper closer than 0.3 mm to the board edge")
        if allcu.intersection(ANT_KEEPOUT).area > 1e-4:
            bad = [k for k, g in items if g.intersection(ANT_KEEPOUT).area > 1e-4]
            errs.append(f"{layer}.Cu copper under the ESP32 antenna: {bad}")
    holes = [(p.x, p.y, p.drill) for p in ALL_PADS] + [(v[0], v[1], VIA_DRILL) for v in VIAS]
    for (x1, y1, d1), (x2, y2, d2) in combinations(holes, 2):
        gap = math.hypot(x1 - x2, y1 - y2) - (d1 + d2) / 2
        if gap < 0.25:
            errs.append(f"holes too close ({gap:.2f} mm) at ({x1:.2f},{y1:.2f}) / ({x2:.2f},{y2:.2f})")
    # connectivity
    nets = sorted({p.net for p in CU_PADS if p.net})
    open_nets = []
    for net in nets:
        nodes = []
        for layer in "FB":
            g = [g for k, g in copper_items(layer) if k == net]
            if net == "GND":
                g.append(POUR[layer])
            for poly in polys(unary_union(g)):
                nodes.append((layer, poly))
        par = list(range(len(nodes)))

        def find(a):
            while par[a] != a:
                par[a] = par[par[a]]
                a = par[a]
            return a

        joints = [Point(p.x, p.y) for p in CU_PADS if p.net == net] + \
                 [Point(v[0], v[1]) for v in VIAS if v[2] == net]
        for pt in joints:
            idx = [i for i, (_, poly) in enumerate(nodes) if poly.intersects(pt)]
            for a, b in zip(idx, idx[1:]):
                par[find(a)] = find(b)
        comps_ = set()
        for p in CU_PADS:
            if p.net == net:
                idx = [i for i, (l, poly) in enumerate(nodes) if l == "F" and poly.intersects(Point(p.x, p.y))]
                comps_.add(find(idx[0]) if idx else ("lost", p.comp.ref, p.num))
        if len(comps_) != 1:
            open_nets.append(net)
    if open_nets:
        errs.append(f"not fully connected: {open_nets}")
    return errs, warns, nets


# ----------------------------------------------------------------------------- render
def render(out, view="top", modules=False):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import PathPatch
    from matplotlib.path import Path

    mir = view == "bottom"

    def draw(ax, g, color, z, alpha=1.0):
        for p in polys(g):
            p = orient(p, 1.0)
            verts, codes = [], []
            for ring in [p.exterior] + list(p.interiors):
                cs = np.asarray(ring.coords, float)
                if mir:
                    cs[:, 0] = BW - cs[:, 0]
                verts += cs.tolist()
                codes += [Path.MOVETO] + [Path.LINETO] * (len(cs) - 2) + [Path.CLOSEPOLY]
            ax.add_patch(PathPatch(Path(verts, codes), fc=color, ec="none", zorder=z, alpha=alpha))

    side = "B" if mir else "F"
    fig = plt.figure(figsize=(9, 9), dpi=150)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(-3, BW + 3)
    ax.set_ylim(BH + 3, -3)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.patch.set_facecolor("#20242a")
    draw(ax, BOARD, "#1d5a32", 1)
    cu = R["cu"][side]
    draw(ax, cu, "#2f8048", 2)
    draw(ax, cu.intersection(R["mask"]), "#c9c9c4", 3)
    draw(ax, R["silk_b" if mir else "silk_f"], "#f4f4f0", 4)
    holes = unary_union([Point(p.x, p.y).buffer(p.drill / 2) for p in ALL_PADS] +
                        [Point(v[0], v[1]).buffer(VIA_DRILL / 2) for v in VIAS])
    draw(ax, holes, "#15171a", 5)
    if modules and not mir:
        mods = [
            (box(*ESP_PCB).union(box(*ANT)), "#3a3f47", "ESP32-S3"),
            (box(SIM1_X + 1.9 - SIM_W, BH - SIM_D, SIM1_X + 1.9, BH), "#b3262b", "SIM800L 1"),
            (box(SIM2_X + 1.9 - SIM_W, BH - SIM_D, SIM2_X + 1.9, BH), "#b3262b", "SIM800L 2"),
            (box(2.0, 35.0, 45.2, 56.0), "#1f4fa3", "LM2596 A  5.5 V"),
            (box(49.5, 35.0, 92.7, 56.0), "#1f4fa3", "LM2596 B  5.0 V"),
        ]
        for g, col, lab in mods:
            draw(ax, g, col, 6, alpha=0.78)
            c = g.centroid
            ax.text(c.x, c.y, lab, color="white", ha="center", va="center", fontsize=11,
                    fontweight="bold", zorder=7)
        for c in (C1, C2):
            draw(ax, Point(c.x, c.y - 2.5).buffer(5.0), "#222a33", 6, alpha=0.9)
            ax.text(c.x, c.y - 2.5, "1000uF", color="white", ha="center", va="center", fontsize=7, zorder=7)
    fig.savefig(out, facecolor=fig.get_facecolor())
    plt.close(fig)


def render_nets(out):
    """Every net in its own colour (solid = top layer, faded = bottom layer), for checking routes."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    nets = sorted({t[3] for t in TRACKS} | {p.net for p in CU_PADS if p.net})
    cmap = plt.get_cmap("tab20")
    col = {n: cmap(i % 20) for i, n in enumerate(nets)}
    col["GND"] = (0.45, 0.45, 0.45, 1)
    fig = plt.figure(figsize=(11, 9), dpi=140)
    ax = fig.add_axes([0, 0, 0.8, 1])
    ax.set_xlim(-2, BW + 2)
    ax.set_ylim(BH + 2, -2)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.plot(*BOARD.exterior.xy, color="black", lw=1)
    for layer, pts, w, net in TRACKS:
        xs, ys = zip(*pts)
        lw = w * 72 / 25.4 * 9 / (BW + 4) * 0.8 * 11
        ax.plot(xs, ys, color=col[net], lw=max(lw, 1.0), alpha=1.0 if layer == "F" else 0.45,
                solid_capstyle="round", ls="-" if layer == "F" else (0, (2, 1)))
    for x, y, net in VIAS:
        if net != "GND":
            ax.plot(x, y, "o", ms=4, mfc="white", mec=col[net])
    for p in CU_PADS:
        ax.add_patch(plt.Circle((p.x, p.y), max(p.size) / 2, fc=col.get(p.net, (0.85, 0.85, 0.85, 1)),
                                ec="black", lw=0.4))
    for c in COMPS:
        if c.pads and c.pads[0].shape != "npth":
            ax.text(c.pads[0].x + 1.2, c.pads[0].y - 1.2, c.ref, fontsize=6, color="black")
    handles = [plt.Line2D([], [], color=col[n], lw=4, label=n) for n in nets]
    handles.append(plt.Line2D([], [], color="black", lw=2, ls=(0, (2, 1)), alpha=0.45, label="(bottom layer)"))
    fig.legend(handles=handles, loc="center right", fontsize=8, frameon=False)
    fig.savefig(out, facecolor="white")
    plt.close(fig)


# ----------------------------------------------------------------------------- quote package
QUOTE_QTY = "10 pcs (please also give the 20 pcs price)"

BOM_ROWS = [
    # designators, value, description, package, suggested part, place, note
    ("J1,J2", "Female header 1x22", "2.54 mm pitch, single row, straight, 8.5 mm high", "THT 1x22 P2.54",
     "Any brand", "Yes", "J2: solder into the OUTER hole row only (row at the board edge). Inner row stays empty."),
    ("J3,J4", "Female header 1x6", "2.54 mm pitch, single row, straight, 8.5 mm high", "THT 1x6 P2.54",
     "Any brand", "Yes", ""),
    ("J6", "Male pin header 1x4", "2.54 mm pitch, single row, straight", "THT 1x4 P2.54", "Any brand", "Yes", ""),
    ("JP1", "Male pin header 1x2 + jumper cap", "2.54 mm pitch, straight", "THT 1x2 P2.54", "Any brand", "Yes",
     "Fit the jumper cap on JP1."),
    ("J5", "Screw terminal 2-pin", "5.0 / 5.08 mm pitch, wire entry toward the left board edge", "THT P5.08",
     "KF301-5.0-2P or DG301-5.0-02P", "Yes", ""),
    ("D1", "1N5822", "Schottky diode 3 A 40 V", "DO-201AD, 15.24 mm lead spacing", "1N5822 (any brand)", "Yes",
     "Polarity: band (cathode) on the SQUARE pad."),
    ("D2", "LED 3 mm red", "3 mm LED, diffused", "THT 3 mm, 2.54 mm leads", "Any brand", "Yes",
     "Polarity: short leg (cathode, flat side) in the SQUARE pad."),
    ("C1,C2", "1000 uF 16 V", "Aluminium electrolytic, low ESR, 105 C, D10 mm x 16-20 mm",
     "Radial D10, 5.0 mm lead spacing", "Any brand, low ESR", "Yes", "Polarity: + leg in the SQUARE pad (marked +)."),
    ("C3", "100 uF 16 V", "Aluminium electrolytic, 105 C, D6.3 mm", "Radial D6.3, 2.5 mm lead spacing",
     "Any brand", "Yes", "Polarity: + leg in the SQUARE pad (marked +)."),
    ("U3", "LM1084IT-ADJ", "Adjustable low-dropout regulator 5 A", "TO-220-3, lying flat (horizontal)",
     "LM1084IT-ADJ, LD1084V or LM1085IT-ADJ (pins ADJ-OUT-IN)", "Yes",
     "Lies flat in its outline: legs bent 90 deg, plastic face down, metal tab up. Pin 1 (ADJ) in the SQUARE pad. No heatsink, no screw."),
    ("R6", "120 Ohm", "Resistor 1/4 W 1 % metal film", "Axial, 10.16 mm lead spacing", "Any brand", "Yes",
     "With R7 sets U3 to 4.06 V. Use 1 % parts."),
    ("R7", "270 Ohm", "Resistor 1/4 W 1 % metal film", "Axial, 10.16 mm lead spacing", "Any brand", "Yes", ""),
    ("R1,R3", "1 kOhm", "Resistor 1/4 W 1 % metal film", "Axial, 10.16 mm lead spacing", "Any brand", "Yes", ""),
    ("R2,R4", "3.3 kOhm", "Resistor 1/4 W 1 % metal film", "Axial, 10.16 mm lead spacing", "Any brand", "Yes", ""),
    ("R5", "4.7 kOhm", "Resistor 1/4 W 1 % metal film", "Axial, 10.16 mm lead spacing", "Any brand", "Yes", ""),
    ("U1,U2", "LM2596 buck module", "Blue DC-DC module 43 x 21 mm", "4 corner pads", "-", "NO (DNP)",
     "Do not place. Optional extra quote: supply and solder 2 modules on 4 straight header pins each."),
]


def joints_per_board():
    n = 0
    for c in COMPS:
        if c.ref in ASSEMBLY and ASSEMBLY[c.ref][4]:
            ps = [p for p in c.pads if p.shape != "npth"]
            if c.ref == "J2":
                ps = [p for p in ps if abs(p.y - ESP_YB) < 1e-6]
            n += len(ps)
    return n


def write_xlsx(path, title, header, rows, widths, notes=()):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    wb = Workbook()
    ws = wb.active
    ws.title = title
    thin = Side(style="thin", color="999999")
    ws.append(header)
    for r in rows:
        ws.append(list(r))
    for cell in ws[1]:
        cell.font = Font(name="Arial", bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="2F5496")
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
        for cell in row:
            cell.font = Font(name="Arial")
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    for row in ws.iter_rows(min_row=1, max_row=ws.max_row):
        for cell in row:
            cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)
    for i, w in enumerate(widths):
        ws.column_dimensions[chr(65 + i)].width = w
    ws.freeze_panes = "A2"
    r0 = ws.max_row + 2
    for i, n in enumerate(notes):
        c = ws.cell(row=r0 + i, column=1, value=n)
        c.font = Font(name="Arial", italic=i > 0, bold=i == 0)
    wb.save(path)


def write_assembly_pdf(path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages
    from matplotlib.patches import PathPatch, Rectangle
    from matplotlib.path import Path
    import matplotlib.image as mpimg
    matplotlib.rcParams["pdf.fonttype"] = 42

    def draw(ax, g, fc, ec="none", lw=0.0, z=1, alpha=1.0, hatch=None):
        for p in polys(g):
            p = orient(p, 1.0)
            verts, codes = [], []
            for ring in [p.exterior] + list(p.interiors):
                cs = np.asarray(ring.coords, float)
                verts += cs.tolist()
                codes += [Path.MOVETO] + [Path.LINETO] * (len(cs) - 2) + [Path.CLOSEPOLY]
            ax.add_patch(PathPatch(Path(verts, codes), fc=fc, ec=ec, lw=lw, zorder=z, alpha=alpha, hatch=hatch))

    with PdfPages(path) as pdf:
        # ---- page 1: assembly drawing
        fig = plt.figure(figsize=(11.69, 8.27))
        ax = fig.add_axes([0.02, 0.06, 0.62, 0.88])
        ax.set_xlim(-4, BW + 4)
        ax.set_ylim(BH + 4, -4)
        ax.set_aspect("equal")
        ax.axis("off")
        draw(ax, BOARD, "white", ec="black", lw=1.2, z=1)
        draw(ax, R["silk_f"], "#9a9a9a", z=2)
        for p in CU_PADS:
            fc = "#d9d9d9"
            if p.comp.ref == "J2" and abs(p.y - ESP_YB2) < 1e-6:
                fc = "white"
            draw(ax, p.geom(), fc, ec="black", lw=0.4, z=3)
        for x, y in HOLES:
            ax.add_patch(plt.Circle((x, y), 1.6, fc="white", ec="black", lw=0.6, zorder=3))
        # DNP modules
        for c in (U1, U2):
            g = box(c.x - 1.8, c.y - 1.8, c.x - 1.8 + BUCK[0], c.y - 1.8 + BUCK[1])
            draw(ax, g, "none", ec="#c00000", lw=1.0, z=4, hatch="//")
            ax.text(c.x - 1.8 + BUCK[0] / 2, c.y + 8.5, f"{c.ref}: DNP\n(do not place)", ha="center",
                    va="center", color="#c00000", fontsize=10, fontweight="bold", zorder=6,
                    bbox=dict(fc="white", ec="#c00000", lw=0.6))
        # plug-in modules, not supplied
        for g, lab in ((box(*ESP_PCB), "ESP32-S3 board: plug-in, NOT supplied"),
                       (box(SIM1_X + 1.9 - SIM_W, BH - SIM_D, SIM1_X + 1.9, BH), "SIM800L\nNOT supplied"),
                       (box(SIM2_X + 1.9 - SIM_W, BH - SIM_D, SIM2_X + 1.9, BH), "SIM800L\nNOT supplied")):
            x0, y0, x1, y1 = g.bounds
            ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, fc="none", ec="#2f5496", lw=0.8, ls="--", zorder=4))
        ax.text(70.0, 21.5, "ESP32 board plugs in here (not supplied)", ha="center", color="#2f5496",
                fontsize=7, zorder=6, bbox=dict(fc="white", ec="none", alpha=0.85))
        # reference designators
        refpos = {"J1": (ESP_X0 - 3.0, ESP_YA), "J2": (ESP_X0 - 3.0, ESP_YB + 1.27), "J3": (SIM1_X + 2.6, 80.0),
                  "J4": (SIM2_X + 2.6, 80.0), "J5": (5.5, 7.6), "J6": (95.6, 66.0), "JP1": (99.3, 35.2),
                  "D1": (19.1, 17.6), "D2": (21.8, 30.0), "C1": (38.5, 95.4), "C2": (75.5, 95.4),
                  "R1": (26.4, 63.6), "R2": (17.6, 63.6), "R3": (65.4, 63.6), "R4": (56.6, 63.6), "R5": (13.1, 29.0),
                  "U3": (47.3, 75.5), "R6": (41.6, 80.6), "R7": (36.2, 80.6), "C3": (61.6, 76.0)}
        for ref, (x, y) in refpos.items():
            ax.text(x, y, ref, ha="center", va="center", fontsize=9, fontweight="bold", color="#1f3c88", zorder=7,
                    bbox=dict(fc="#e8eefc", ec="#1f3c88", lw=0.5, boxstyle="round,pad=0.15"))
        # polarity call-outs
        red = dict(color="#c00000", fontsize=7.5, fontweight="bold", zorder=8)
        arrow = dict(arrowstyle="->", color="#c00000", lw=1.0)
        ax.annotate("+ leg = square pad", xy=(C1.x, C1.y), xytext=(10.0, 73.2), arrowprops=arrow, **red)
        ax.annotate("+ leg =\nsquare pad", xy=(C2.x, C2.y), xytext=(83.0, 89.0), arrowprops=arrow, **red)
        ax.annotate("band (cathode) = square pad", xy=(26.74, 13.0), xytext=(14.0, 3.2), arrowprops=arrow, **red)
        ax.annotate("short leg (cathode)\n= square pad", xy=(23.04, 26.0), xytext=(27.5, 23.6), arrowprops=arrow, **red)
        ax.annotate("+ leg = square pad", xy=(C3.x, C3.y), xytext=(65.5, 70.8), arrowprops=arrow, **red)
        ax.annotate("U3 lies flat (legs bent 90 deg),\nmetal tab up, pin 1 = square pad",
                    xy=(LDO_X, LDO_Y), xytext=(66.0, 59.6), arrowprops=arrow, **red)
        ax.annotate("solder J2 in this OUTER row", xy=(60.0, ESP_YB), xytext=(52.0, -2.2), arrowprops=arrow, **red)
        ax.annotate("inner row: leave EMPTY", xy=(80.0, ESP_YB2), xytext=(80.0, -2.2), arrowprops=arrow, **red)
        ax.annotate("jumper cap ON", xy=(96.8, 39.27), xytext=(86.5, 32.4), arrowprops=arrow, **red)
        ax.annotate("wire entry\nthis side", xy=(1.2, 15.5), xytext=(-3.6, 33.0), arrowprops=arrow, **red)
        ax.text(0, BH + 2.6, "TOP side - all parts on top, all through-hole. Origin (0,0) = bottom-left corner. "
                "Board 100 x 100 mm.", fontsize=7.5)
        # notes column
        tx = fig.add_axes([0.66, 0.06, 0.32, 0.88])
        tx.axis("off")
        notes = [
            ("SMS gateway v2 carrier PCB - ASSEMBLY DRAWING", True),
            ("", False),
            ("1.  All parts are through-hole (THT), top side only. No SMD, no stencil.", False),
            (f"2.  {joints_per_board()} THT solder joints per board.", False),
            ("3.  Headers (J1-J4, J6, JP1) straight up, flat on the board.", False),
            ("4.  J2: solder into the OUTER hole row only.\n     The inner row (white circles) stays empty.", False),
            ("5.  Polarity:\n     C1, C2, C3: + leg in the square pad\n     D1: band (cathode) at the square pad\n"
             "     D2: short leg / flat side in the square pad\n"
             "     U3: lies flat in its outline (bend the legs 90 deg),\n"
             "     plastic face down, metal tab up, pin 1 (ADJ) in\n     the square pad. No heatsink, no screw.", False),
            ("6.  JP1: fit the jumper cap.", False),
            ("7.  U1, U2 (LM2596 modules): DNP - do not place.\n     Optional extra quote: supply + solder 2\n"
             "     modules on 4 straight header pins each.", False),
            ("8.  ESP32 board and SIM800L modules plug into the\n     sockets later. They are NOT supplied.", False),
            ("9.  Lead-free solder OK. No-clean flux OK.\n     No functional test needed, visual check only.", False),
            ("10. Please send a photo of the first assembled\n     board before shipping.", False),
            ("", False),
            ("Files: Gerber + drill (zip), BOM (xlsx), pick and\nplace / centroid (xlsx + csv), this drawing.", False),
        ]
        y = 0.99
        for t, bold in notes:
            tx.text(0, y, t, fontsize=12 if bold else 9.2, fontweight="bold" if bold else "normal", va="top",
                    transform=tx.transAxes, wrap=True)
            y -= 0.024 * (t.count("\n") + 1) + (0.03 if bold else 0.022)
        pdf.savefig(fig)
        plt.close(fig)
        # ---- page 2: renders
        fig = plt.figure(figsize=(11.69, 8.27))
        for i, (fn, lab) in enumerate((("render_top.png", "Top side"), ("render_bottom.png", "Bottom side"))):
            a = fig.add_axes([0.02 + i * 0.49, 0.08, 0.47, 0.8])
            a.imshow(mpimg.imread(os.path.join(HERE, fn)))
            a.axis("off")
            a.set_title(lab, fontsize=13, fontweight="bold")
        fig.text(0.5, 0.95, "SMS gateway v2 carrier PCB - renders (modules not shown)", ha="center",
                 fontsize=14, fontweight="bold")
        pdf.savefig(fig)
        plt.close(fig)


def write_order_package():
    """Everything a factory needs to quote and build the boards (PCB + PCBA), as single files in
    this folder and as one zip to send."""
    # BOM
    rows = []
    for i, (refs, val, desc, pkg, sugg, place, note) in enumerate(BOM_ROWS):
        qty = len(refs.split(","))
        rows.append((i + 1, refs, qty, val, desc, pkg, "THT", sugg, place, note))
    bom_head = ["Item", "Designator", "Qty per board", "Value", "Description", "Package", "Mounting",
                "Suggested part (equivalent OK)", "Place", "Notes"]
    write_xlsx(os.path.join(HERE, f"{NAME}_BOM.xlsx"), "BOM", bom_head,
               rows, [6, 12, 8, 22, 36, 26, 9, 26, 10, 46],
               notes=["SMS gateway v2 carrier PCB - bill of materials (per board)",
                      "All parts through-hole, top side. Supplier sources all parts (turnkey). "
                      "U1/U2 are DNP. ESP32 and SIM800L modules are NOT part of this order."])
    with open(os.path.join(HERE, f"{NAME}_BOM.csv"), "w") as f:
        f.write(",".join(bom_head) + "\n")
        for r in rows:
            f.write(",".join(f'"{v}"' if isinstance(v, str) else str(v) for v in r) + "\n")
    # pick and place
    pnp = []
    with open(os.path.join(HERE, f"{NAME}_pick_and_place.csv")) as f:
        next(f)
        for line in f:
            d, x, y, layer, rot, com = line.rstrip("\n").split(",", 5)
            pnp.append((d, float(x), float(y), layer, int(rot), com.strip('"')))
    write_xlsx(os.path.join(HERE, f"{NAME}_pick_and_place.xlsx"), "Centroid",
               ["Designator", "Mid X (mm)", "Mid Y (mm)", "Layer", "Rotation (deg)", "Comment"],
               pnp, [12, 12, 12, 8, 14, 30],
               notes=["Origin (0,0) = bottom-left corner of the board, same as the Gerber files. Units: mm.",
                      "All parts THT on the top side. U1/U2 are DNP and not listed."])
    write_assembly_pdf(os.path.join(HERE, f"{NAME}_assembly_drawing.pdf"))
    n_pth = len([p for p in CU_PADS]) + len(VIAS)
    min_clr = math.floor(STATS.get("min_clearance", CLR) * 100 + 1e-6) / 100
    spec = f"""SMS GATEWAY v2 CARRIER PCB - REQUEST FOR QUOTATION
==================================================

Please quote (1) PCB only and (2) PCB + assembly (turnkey), for {QUOTE_QTY}.
Please include the lead time and the shipping cost to: ______________________

PCB FABRICATION
---------------
Layers ............... 2
Material ............. FR-4, TG130-140
Board size ........... 100.0 x 100.0 mm, rounded corners R3 (single board; panelize as you like)
Thickness ............ 1.6 mm
Copper ............... 1 oz (35 um) both sides
Surface finish ....... HASL lead-free (HASL with lead is also OK if cheaper)
Solder mask .......... green, both sides. Vias tented
Silkscreen ........... white, both sides
Min track / space .... 0.40 mm / {min_clr:.2f} mm
Min hole ............. 0.40 mm (vias). {n_pth} plated holes, 4 non-plated 3.2 mm holes
Impedance control .... no.   Gold fingers / castellated holes: no
Electrical test ...... yes (flying probe)
Files ................ {NAME}_gerbers.zip (RS-274X Gerber + Excellon drill, PTH and NPTH separate)

PCB ASSEMBLY (PCBA)
-------------------
Type ................. turnkey: you source every part in the BOM (equivalent brands OK)
Parts ................ all through-hole (THT), top side only. No SMD, no stencil needed
Part lines ........... {len([r for r in BOM_ROWS if r[5] == 'Yes'])} BOM lines, {sum(len(r[0].split(',')) for r in BOM_ROWS if r[5] == 'Yes')} parts, {joints_per_board()} THT solder joints per board
Do not place ......... U1, U2 (LM2596 modules)
Optional, separate price: supply and solder 2x LM2596 buck module (blue, 43 x 21 mm)
                       per board on 4 straight header pins each (do not adjust the voltage)
Not supplied ......... ESP32-S3 dev board, SIM800L modules (plugged in later by the customer)
Important ............ J2 goes into the OUTER hole row only; mind polarity of C1, C2, C3, D1, D2
                       and U3 (lies flat, legs bent 90 deg, metal tab up, pin 1 in the square pad);
                       jumper cap on JP1. See {NAME}_assembly_drawing.pdf
Solder ............... lead-free OK, no-clean flux OK
Test ................. visual inspection only (no functional test)
Approval ............. please send a photo of the first assembled board before shipping
Packing .............. ESD bags

FILES IN THIS PACKAGE
---------------------
{NAME}_gerbers.zip                   Gerber + drill files
{NAME}_BOM.xlsx (.csv)               bill of materials
{NAME}_pick_and_place.xlsx (.csv)    centroid file, origin bottom-left, mm
{NAME}_assembly_drawing.pdf          assembly drawing with polarity and DNP notes
render_top.png, render_bottom.png    pictures of the board
"""
    with open(os.path.join(HERE, f"{NAME}_order_specs.txt"), "w") as f:
        f.write(spec)
    files = [f"{NAME}_order_specs.txt", f"{NAME}_gerbers.zip", f"{NAME}_BOM.xlsx", f"{NAME}_BOM.csv",
             f"{NAME}_pick_and_place.xlsx", f"{NAME}_pick_and_place.csv", f"{NAME}_assembly_drawing.pdf",
             "render_top.png", "render_bottom.png"]
    with zipfile.ZipFile(os.path.join(HERE, f"{NAME}_order_package.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        for fn in files:
            z.write(os.path.join(HERE, fn), fn)


# ----------------------------------------------------------------------------- main
if __name__ == "__main__":
    print("routing ...")
    for net, w in ROUTES:
        ok = route_net(net, pads_of(net), w)
        print(f"  {net:8s} {'ok' if ok else 'FAILED'}")
    print("ground pour ...")
    labels()
    build_pour()
    errs, warns, nets = drc()
    R = write_outputs()
    write_assembly()
    write_kicad()
    render(os.path.join(HERE, "render_top.png"), "top")
    render(os.path.join(HERE, "render_bottom.png"), "bottom")
    render(os.path.join(HERE, "render_assembled.png"), "top", modules=True)
    render_nets(os.path.join(HERE, "render_nets.png"))
    write_order_package()
    n_seg = sum(len(t[1]) - 1 for t in TRACKS)
    print(f"\nnets: {len(nets)}  pads: {len(CU_PADS)}  track segments: {n_seg}  vias: {len(VIAS)} "
          f"({len(STITCH)} ground stitching)")
    print(f"DRC: {len(errs)} errors, {len(warns)} warnings")
    for e in errs:
        print("  ERROR", e)
    for w in warns[:20]:
        print("  warn ", w)
