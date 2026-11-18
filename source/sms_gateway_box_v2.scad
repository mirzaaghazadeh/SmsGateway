// =====================================================================
//  SMS / missed-call gateway box  v2 (PCB build)   NO metal screws, NO inserts
//  The v2 carrier PCB (pcb/) clicks onto 4 snap pins; the modules plug into the PCB:
//  ESP32-S3 dev board, 2x SIM800L, 2x LM2596, 1000 uF caps on the PCB, OLED in the lid.
//  (The hand-wired build is v1: source/sms_gateway_box_v1.scad.)
//
//   - PCB: 4 snap pins in its 3.2 mm corner holes + 10 posts under it, clear of every solder
//     joint, so plugging the modules in does not bend it
//   - front wall: 2 SIM card slots, the card goes straight into the SIM800L holder
//   - right wall: one opening for both USB-C plugs of the ESP32 board
//   - left wall: 12 V jack (DC-099 panel jack, 11.2 mm hole), 2 short wires to the screw terminal
//   - back wall: 2 SMA antenna holes (IPEX -> SMA pigtails), ring + pocket as in v1
//   - lid as in v1: 4 snap latches, OLED window (OLED on snap pins, 4 jumpers to the PCB's
//     OLED header), slanted vents over the two LM2596, "SMS GATEWAY" + port names engraved
//
//  part = "base" | "lid" | "lid_text" | "dupont4"            -> print these
//  part = "fit_pin" | "fit_latch" | "fit_ant"                 -> small fit tests
//  part = "closed" | "assembly" | "exploded"                  -> pictures only
//  part = "check"                                             -> collision test (must be empty)
//  Units: mm. Heights of the plugged-in modules are estimated: see the <- CHECK notes.
// =====================================================================

part = "base";

// ---------------- the carrier PCB (pcb/make_board.py) ----------------
// PCB coordinates: x to the right, y from the BACK edge toward the front (SIM card edge),
// the same as the PCB drawings. P() turns them into box inside coordinates.
pcb       = [100, 100];
pcb_t     = 1.6;
pcb_holes = [[4, 4], [96.5, 17], [3.5, 96.5], [96.5, 96.5]];     // 3.2 mm, M3
// posts under the PCB: each is 6+ mm from every solder joint on the underside
pcb_posts = [[25, 47], [72, 47], [70, 18], [50, 20], [88, 22], [30, 30], [50, 78], [84, 80],
             [22, 88], [56, 88]];
gap_l = 8;        // left: room for the 12 V jack, its nut and the 2 wires to the screw terminal
gap_r = 0.4;      // right: the ESP32's USB-C sockets end right at the PCB edge
gap_f = 0.5;      // front: SIM800L card edge = PCB edge
gap_b = 0.5;
pcb_z  = 4;       // PCB underside above the floor (clipped leads, solder joints)
pcb_top = pcb_z + pcb_t;
function P(p) = [gap_l + p[0], gap_f + pcb[1] - p[1]];

// plugged-in modules: 8.5 mm female header on the PCB + 2.5 mm plastic of the module's pins
sock_h = 8.5;
pin_h  = 2.5;
mod_z  = pcb_top + sock_h + pin_h;     // underside of the ESP32 and SIM800L boards   <- CHECK
tall   = 21;                           // tallest part on the PCB: the 1000 uF capacitors

// ---------------- box ----------------
wall    = 2.4;
floor_t = 2.4;
int_w   = gap_l + pcb[0] + gap_r;      // inside X
int_d   = gap_f + pcb[1] + gap_b;      // inside Y
int_h   = pcb_top + tall + 6;          // capacitors + the OLED hanging from the lid above them
lid_t   = 3.2;
r_out   = 5;
out_w   = int_w + 2*wall;
out_d   = int_d + 2*wall;
out_h   = floor_t + int_h;

// ---------------- snap-on lid (same as v1) ----------------
lip_h   = 3;
lip_t   = 1.6;
lip_gap = 0.35;    // clearance lip<->wall: RAISE to 0.45 if too tight, LOWER to 0.25 if loose
latch_w = 12;
latch_L = 13;
latch_t = 1.3;
latch_e = 0.8;     // hook reach into the groove: 0.6 = easier to open, 1.0 = holds harder
latch_he = lip_gap + latch_e;
// one arm per wall: [wall, centre along that wall (inside coords)], clear of every opening
latches = [["front", P([88, 0])[0]], ["back", P([70, 0])[0]],
           ["left", P([0, 70])[1]], ["right", P([0, 70])[1]]];

// ---------------- openings ----------------
// SIM card slots (front wall): card centre under the middle of each SIM800L
sim      = [25, 23];
sim_left = [6, 45];                    // module left edges, PCB x
sim_card = [16.0, 3.6];                // micro-SIM 15 x 12 x 0.76; 0.4 taller than v1 for the header spread
sim_card_z = mod_z - 0.9;              // card centre above the floor (holder under the board)  <- CHECK
sim_gap  = gap_f;
// USB-C (right wall): one rounded opening for both plug bodies; the sockets end at the PCB
// edge, so the plug goes through the wall into them
esp_c_y    = 17.2;                     // ESP32 board centre line, PCB y
esp_usb_dy = 6.2;                      // each USB-C socket from the centre line
usb_plug   = [13.4, 7.4];              // one plug body (USB-C spec max 12.35 x 6.5) + room
usb_extra  = 1.0;                      // extra all round for the estimated socket height
usb_chamfer = 0.6;
usb_zc     = mod_z + 1.6 + 3.3/2;      // socket centre above the floor                        <- CHECK
// 12 V jack (left wall), opposite the screw terminal, above the low parts
dc_y = 27;                             // PCB y
dc_z = pcb_top + 16;                   // above the floor
dc_d = 11.2;                           // DC-099 panel jack. DC-022B: 8.2
// antennas (back wall)
ant_x      = [13, 31];                 // PCB x: above the screw terminal and the diode, clear of the ESP32 antenna
                                       // (18 apart: the two 17 mm rings must not touch)
ant_z      = pcb_top + 15;             // above the floor
ant_hole_d = 6.6;
ant_boss   = [17, 2.0];
ant_pocket = 10.5;

// ---------------- OLED (lid) - same mount as v1 ----------------
oled       = [27.0, 27.7];
oled_t     = 1.2;
oled_hole  = [22.9, 23.3];             // <- MEASURE
oled_stack = 1.9;
oled_gap   = 0.4;
oled_post  = oled_stack + oled_gap;
oled_pin   = [1.9, 2.7, 0.7];
glass      = [26.7, 19.3];
glass_dy   = 4.6;
win        = [24.0, 13.0];
win_dy     = 1.4;
win_bevel  = 2.2;
// over the free strip between the LM2596s and the SIM800Ls; its pins + jumper plugs hang into
// that strip, the OLED body stays above the 1000 uF capacitors
oled_c = P([36, 71]);

// vents over the two LM2596 (PCB rectangles)
bucks = [[2, 35, 45.2, 56], [49.5, 35, 92.7, 56]];
vent_n = 9; vent_pitch = 4.2; vent_w = 1.6;

// PCB snap pins: shaft, barb, slot (3.2 mm holes)
pcb_pin = [2.8, 3.8, 0.9];

$fn = 48;

// ================= helpers (as in v1) =================
module rbox(w, d, h, r) {
    hull() for (x = [r, w - r], y = [r, d - r]) translate([x, y, 0]) cylinder(r = r, h = h);
}
function latch_arm_pts() = let(L = latch_L, he = latch_he, t = latch_t) [
    [-t - 1.0, 0], [0, 0], [0, L - 3.2], [he, L - 3.2 + he], [he, L - 1.2], [0, L], [-t, L], [-t, 1.0]];
function latch_groove_pts() = let(L = latch_L, he = latch_he, a = lip_gap - 0.3, b = he + 0.3) [
    [a, L - 3.2 + 0.1 + a], [b, L - 3.2 + 0.1 + b], [b, L + 0.6], [a, L + 0.6]];
module latch_frame() { multmatrix([[0, 0, 1, 0], [-1, 0, 0, 0], [0, -1, 0, 0], [0, 0, 0, 1]]) children(); }
module latch_place(side, p) {
    if (side == "front") translate([wall + p, 0, 0]) children();
    else if (side == "back") translate([wall + p, out_d, 0]) mirror([0, 1, 0]) children();
    else if (side == "left") translate([0, wall + p, 0])
        multmatrix([[0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) children();
    else if (side == "right") translate([out_w, wall + p, 0])
        multmatrix([[0, -1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) children();
}
module latch_arms() {
    for (l = latches) latch_place(l[0], l[1])
        translate([-latch_w/2, wall + lip_gap, 0]) latch_frame() linear_extrude(latch_w) polygon(latch_arm_pts());
}
module latch_grooves() {
    for (l = latches) latch_place(l[0], l[1])
        translate([-(latch_w + 1)/2, wall + lip_gap, out_h]) latch_frame() linear_extrude(latch_w + 1) polygon(latch_groove_pts());
}
module latch_lip_gaps() {
    for (l = latches) latch_place(l[0], l[1])
        translate([-latch_w/2 - 0.8, wall - 0.5, -lip_h - 1]) cube([latch_w + 1.6, lip_gap + lip_t + 1, lip_h + 1.01]);
}
module ant_ring() {
    translate([0, 0.01, 0]) rotate([90, 0, 0]) hull() {
        cylinder(d = ant_boss[0], h = ant_boss[1] + 0.01);
        translate([0, -(ant_boss[0]/2 + ant_boss[1]), 0]) cylinder(d = 0.1, h = 0.01);
    }
}
module ant_cut() {
    translate([0, -ant_boss[1] - 0.1, 0]) rotate([-90, 0, 0]) cylinder(d = ant_hole_d, h = wall + ant_boss[1] + 0.2);
    translate([0, 0.01, 0]) rotate([90, 0, 0]) hull() {
        cylinder(d = ant_pocket, h = ant_boss[1] + 0.2);
        translate([0, ant_pocket/2*sqrt(2), 0]) cylinder(d = 0.1, h = ant_boss[1] + 0.2);
    }
}
module snap_pin(shaft, barb, rest, pcb, slot, slot_from = 0.3, lip = 0.4, tip = 1.0) {
    zb = rest + pcb + 0.1;
    difference() {
        union() {
            cylinder(d = shaft, h = zb + 0.01);
            translate([0, 0, zb]) cylinder(d = barb, h = lip + 0.01);
            translate([0, 0, zb + lip]) cylinder(d1 = barb, d2 = shaft - 0.4, h = tip);
        }
        translate([-slot/2, -barb, slot_from]) cube([slot, 2*barb, zb + lip + tip]);
    }
}
module stadium_x(w, h, len) {
    rr = h/2;
    hull() for (sy = [-1, 1])
        translate([0, sy*(w/2 - rr), 0]) rotate([0, 90, 0]) cylinder(r = rr, h = len);
}

// ================= PCB holders =================
// boss with a ring gap round a snap pin (the prongs can bend inside the boss); the PCB rests on
// the ring and the barb clicks over its top. Squeeze the two prong tips to take the PCB out.
module pcb_boss() {
    difference() {
        cylinder(d = 7, h = pcb_z);
        translate([0, 0, 0.6]) cylinder(d = pcb_pin[0] + 1.2, h = pcb_z);
    }
    translate([0, 0, 0.59]) snap_pin(pcb_pin[0], pcb_pin[1], pcb_z - 0.59, pcb_t, pcb_pin[2],
                                     slot_from = 0.4, lip = 0.45, tip = 1.2);
}
module pcb_supports() {
    for (h = pcb_holes) translate([P(h)[0], P(h)[1], 0]) pcb_boss();
    for (s = pcb_posts) translate([P(s)[0], P(s)[1], 0]) cylinder(d = 5, h = pcb_z);
}

// ================= wall cuts =================
// SIM slot, local: x = 0 card centre, y = 0 inside face of the front wall, z = 0 floor (as v1)
module sim_cut() {
    translate([-sim_card[0]/2, -wall - 0.1, sim_card_z - sim_card[1]/2])
        cube([sim_card[0], wall + sim_gap + 2, sim_card[1]]);
    sd = 1.4; ex = 2.8;
    hull() {
        translate([-sim_card[0]/2 - ex, -wall - 0.1, sim_card_z - sim_card[1]/2 - 1.8])
            cube([sim_card[0] + 2*ex, 0.11, sim_card[1] + 1.8 + sd]);
        translate([-sim_card[0]/2, -wall + sd, sim_card_z - sim_card[1]/2]) cube([sim_card[0], 0.01, sim_card[1]]);
    }
}
// USB-C: one rounded opening through the right wall for both plug bodies, 45 deg edge outside
module usb_cut() {
    rw = 2*esp_usb_dy + usb_plug[0] + usb_extra;
    rh = usb_plug[1] + usb_extra;
    translate([out_w - wall - 0.1, wall + P([0, esp_c_y])[1], floor_t + usb_zc]) {
        stadium_x(rw, rh, wall + 0.2);
        hull() {
            translate([wall + 0.1 - usb_chamfer, 0, 0]) stadium_x(rw, rh, 0.01);
            translate([wall + 0.19, 0, 0]) stadium_x(rw + 2*usb_chamfer, rh + 2*usb_chamfer, 0.01);
        }
    }
}

// ================= BASE =================
module base() {
    difference() {
        union() {
            difference() {
                rbox(out_w, out_d, out_h, r_out);
                translate([wall, wall, floor_t]) cube([int_w, int_d, int_h + 1]);
            }
            translate([wall, wall, floor_t - 0.01]) pcb_supports();
            for (x = ant_x) translate([wall + P([x, 0])[0], out_d - wall, floor_t + ant_z]) ant_ring();
        }
        latch_grooves();
        // finger notch under the lid edge (front)
        translate([wall + P([88, 0])[0] - 30, -0.1, out_h - 1.2]) cube([16, wall + 0.2, 1.3]);
        // SIM card slots, front wall
        for (sx = sim_left) translate([wall + P([sx + sim[0]/2, 0])[0], wall, floor_t]) sim_cut();
        // USB-C, right wall
        usb_cut();
        // 12 V jack, left wall
        translate([-0.1, wall + P([0, dc_y])[1], floor_t + dc_z]) rotate([0, 90, 0]) cylinder(d = dc_d, h = wall + 0.2);
        // antennas, back wall
        for (x = ant_x) translate([wall + P([x, 0])[0], out_d - wall, floor_t + ant_z]) ant_cut();
        // name under the floor (reads from below)
        translate([out_w/2, out_d/2, -0.01]) linear_extrude(0.6) mirror([1, 0, 0])
            text("SMS GATEWAY v2", size = 7, font = "Liberation Sans:style=Bold", halign = "center", valign = "center");
    }
}

// ================= LID =================
title_d = 1.0;
// engraved text on the lid top: [text, x, y (inside coords), size, angle]
lid_words = [["SMS",      83.5, 29, 7, 0],        // right of the OLED, "GATEWAY" ~43 mm long
             ["GATEWAY",  83.5, 18, 7, 0],
             ["SIM 1",    P([18.5, 0])[0], 5, 4, 0],
             ["SIM 2",    P([57.5, 0])[0], 5, 4, 0],
             ["USB",      int_w - 4, P([0, esp_c_y])[1], 4, 90],
             ["12V",      4, P([0, dc_y])[1], 4, -90],
             ["ANT",      (P([ant_x[0], 0])[0] + P([ant_x[1], 0])[0])/2, int_d - 4, 4, 0]];
module lid_text_2d() {
    for (w = lid_words) translate([wall + w[1], wall + w[2]]) rotate(w[4])
        text(w[0], size = w[3], font = "Liberation Sans:style=Bold", halign = "center", valign = "center");
}
module vents() {
    for (i = [0 : vent_n - 1]) translate([i*vent_pitch, 0, 0])
        multmatrix([[1, 0, 1, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
            translate([0, 0, -0.1]) cube([vent_w, 17, lid_t + 0.2]);
}
module oled_mount() {
    hx = oled_hole[0]/2; hy = oled_hole[1]/2;
    zp = -oled_post;
    for (sx = [-1, 1], sy = [-1, 1]) translate([sx*hx, sy*hy, 0]) {
        mirror([0, sy > 0 ? 0 : 1, 0]) translate([-1.8, 1.25, zp]) cube([3.6, 1.6, oled_post + 0.01]);
        mirror([0, 0, 1]) snap_pin(oled_pin[0], oled_pin[1], oled_post, oled_t, oled_pin[2], lip = 0.35, tip = 0.9);
    }
}
module oled_window() {
    translate([0, win_dy, 0]) hull() {
        translate([-win[0]/2, -win[1]/2, -0.1]) cube([win[0], win[1], lid_t - win_bevel + 0.1]);
        translate([-win[0]/2 - win_bevel - 0.1, -win[1]/2 - win_bevel - 0.1, lid_t + 0.09])
            cube([win[0] + 2*win_bevel + 0.2, win[1] + 2*win_bevel + 0.2, 0.01]);
    }
}
module oled_label() {
    translate([0, oled_hole[1]/2 - 1.2, -0.1]) linear_extrude(0.5) mirror([0, 1, 0])
        text("PINS", size = 3.5, font = "Liberation Sans:style=Bold", halign = "center", valign = "center");
}
module lid() {
    difference() {
        rbox(out_w, out_d, lid_t, r_out);
        translate([wall + oled_c[0], wall + oled_c[1], 0]) { oled_window(); oled_label(); }
        for (b = bucks) translate([wall + P([b[0], 0])[0] + 2.5, wall + P([0, b[3]])[1] + 2, 0]) vents();
        translate([0, 0, lid_t - title_d]) linear_extrude(title_d + 0.1) lid_text_2d();
    }
    difference() {
        translate([wall + lip_gap, wall + lip_gap, -lip_h])
            difference() {
                cube([int_w - 2*lip_gap, int_d - 2*lip_gap, lip_h + 0.01]);
                translate([lip_t, lip_t, -1]) cube([int_w - 2*lip_gap - 2*lip_t, int_d - 2*lip_gap - 2*lip_t, lip_h + 2]);
            }
        latch_lip_gaps();
    }
    latch_arms();
    translate([wall + oled_c[0], wall + oled_c[1], 0]) oled_mount();
}
module lid_text() {
    translate([0, 0, lid_t - title_d]) linear_extrude(title_d) lid_text_2d();
}

// ================= Dupont holder for the OLED's 4 jumpers (as v1) =================
dp_pitch = 2.54; dp_plug = 2.54; dp_fit = 0.25; dp_len = 13; dp_wall = 1.0; dp_lip = 0.8;
module dupont_holder(n = 4) {
    iw = n*dp_pitch + dp_fit;  id = dp_plug + dp_fit;
    ow = iw + 2*dp_wall;       od = id + 2*dp_wall;
    difference() {
        translate([-ow/2, -od/2, 0]) cube([ow, od, dp_lip + dp_len]);
        translate([-iw/2, -id/2, dp_lip]) cube([iw, id, dp_len + 1]);
        for (i = [0 : n - 1])
            translate([(i - (n - 1)/2)*dp_pitch, 0, -0.1]) cylinder(d = 1.4, h = dp_lip + 0.2, $fn = 16);
        translate([-ow/2, od/2, (dp_lip + dp_len)/2]) rotate([0, 0, 45]) cube([1.4, 1.4, dp_lip + dp_len + 2], center = true);
    }
}

// ================= fit tests =================
// one PCB boss + snap pin on a small plate: the PCB's corner hole must click over it
module fit_pin() {
    difference() {
        translate([-8, -8, 0]) cube([16, 16, 1.6]);
        translate([0, -5.6, 1.0]) linear_extrude(1) text("PCB", size = 2.6, font = "Liberation Sans:style=Bold",
                                                         halign = "center", valign = "center");
    }
    translate([0, 0, 1.59]) pcb_boss();
}
module fit_latch() {
    sw = latch_w + 14;  h = latch_L + 4;  ld = 14;
    difference() {
        union() { cube([sw, wall, h]); cube([sw, wall + 8, 1.6]); }
        translate([sw/2 - (latch_w + 1)/2, wall + lip_gap, h])
            latch_frame() linear_extrude(latch_w + 1) polygon(latch_groove_pts());
    }
    translate([0, 14 + ld, lid_t]) rotate([180, 0, 0]) {
        cube([sw, ld, lid_t]);
        for (x = [[0, sw/2 - latch_w/2 - 0.8], [sw/2 + latch_w/2 + 0.8, sw]])
            translate([x[0], wall + lip_gap, -lip_h]) cube([x[1] - x[0], lip_t, lip_h + 0.01]);
        translate([sw/2 - latch_w/2, wall + lip_gap, 0])
            latch_frame() linear_extrude(latch_w) polygon(latch_arm_pts());
    }
}
module fit_ant() {
    w = 30; h = 24; zc = 12; fd = 14;
    difference() {
        union() {
            cube([w, wall, h]);
            translate([0, -fd, 0]) cube([w, fd + 0.01, 1.6]);
            translate([w/2, 0, zc]) ant_ring();
        }
        translate([w/2, 0, zc]) ant_cut();
    }
}

// ================= models (pictures + collision check) =================
// at(p, z): PCB point p, height z above the floor, in base coordinates
module at(p, z = 0) { translate([wall + P(p)[0], wall + P(p)[1], floor_t + z]) children(); }
// PCB rectangle [x0, y0, x1, y1] (PCB coords) as a block from z to z + h
module pblock(r, z, h) {
    translate([wall + P([r[0], r[3]])[0], wall + P([r[0], r[3]])[1], floor_t + z]) cube([r[2] - r[0], r[3] - r[1], h]);
}
module m_pcb() {
    color("#1d5a32") difference() {
        pblock([0, 0, 100, 100], pcb_z, pcb_t);
        for (h = pcb_holes) at(h, pcb_z - 1) cylinder(d = 3.2, h = pcb_t + 2);
    }
}
module m_esp() {
    color("#222") pblock([42.17, 3.2, 99.17, 31.2], mod_z, 1.6);                              // dev board
    color("silver") pblock([42.17, 8.2, 67.67, 26.2], mod_z + 1.6, 3.1);                      // module
    color("#111") pblock([35.67, 7.95, 42.17, 26.45], mod_z + 1.6, 0.8);                      // antenna
    color("silver") for (dy = [-esp_usb_dy, esp_usb_dy])                                       // USB-C
        pblock([92.67, esp_c_y + dy - 4.5, 100.17, esp_c_y + dy + 4.5], mod_z + 1.6, 3.3);
    for (y = [4.5, 29.9]) {
        color("#111") pblock([42.73, y - 1.27, 98.61, y + 1.27], pcb_top, sock_h);           // sockets
        color("#333") pblock([42.73, y - 1.27, 98.61, y + 1.27], pcb_top + sock_h, pin_h);   // pin plastic
    }
}
module m_sim(x0) {
    color("#b01818") pblock([x0, 77, x0 + sim[0], 100], mod_z, 1.0);
    color("#333") pblock([x0 + 5, 82, x0 + 20, 96], mod_z + 1.0, 0.9);                        // chip
    color("silver") pblock([x0 + 5, 81, x0 + 20, 96], mod_z - 1.8, 1.8);                     // SIM holder
    color("silver") pblock([x0 + 22.1, 96.95, x0 + 24.7, 99.55], mod_z + 1.0, 2.4);          // IPEX
    hx = x0 + sim[0] - 1.9;
    color("#111") pblock([hx - 1.27, 82.3 - 1.27, hx + 1.27, 95 + 1.27], pcb_top, sock_h);
    color("#333") pblock([hx - 1.27, 82.3 - 1.27, hx + 1.27, 95 + 1.27], pcb_top + sock_h, pin_h);
}
module m_buck(r) {
    z = pcb_top + 2.5;
    color("#1f5fa8") pblock(r, z, 1.6);
    color("#222") for (x = [r[0] + 5, r[2] - 5]) at([x, (r[1] + r[3])/2], z + 1.6) cylinder(d = 8, h = 11);
    color("#444") pblock([r[0] + 15.6, r[1] + 7, r[0] + 27.6, r[1] + 19], z + 1.6, 7.6);       // inductor
    color("#5aa0ff") pblock([r[0] + 24, r[1] + 1.7, r[0] + 33.5, r[1] + 6.5], z + 1.6, 11.5);  // trimmer
    color("#111") for (x = [r[0] + 1.8, r[2] - 1.8], y = [r[1] + 1.8, r[3] - 1.8])
        pblock([x - 1.25, y - 1.25, x + 1.25, y + 1.25], pcb_top, 2.5);                         // pin plastic
}
module m_parts() {
    color("#202a36") for (c = [[38.5, 88.5], [75.5, 88.5]]) at(c, pcb_top) cylinder(d = 10, h = tall);   // 1000 uF
    color("#2a6db0") pblock([1.0, 9.4, 9.4, 21.7], pcb_top, 10.5);                                       // terminal
    color("#222") at([19.12, 13], pcb_top + 2.65) rotate([0, 90, 0]) translate([0, 0, -4.75]) cylinder(d = 5.3, h = 9.5);
    color("#111") pblock([82.73, 64.73, 92.89, 67.27], pcb_top, 2.5);                                    // OLED header
    color("#333") pblock([82.73, 64.73, 92.89, 67.27], pcb_top + 2.5, 14);                               // + jumpers
    color("#111") pblock([95.53, 36.73, 98.07, 41.81], pcb_top, 8.5);                                    // JP1 + cap
    // U3: LM1084 (fixed 4.0 V for the SIM800Ls), TO-220 lying flat, plastic down, metal tab up; it
    // has to stay under the OLED that hangs from the lid. Pins at (44.76, 61.0), 2.54 apart.
    color("#222") pblock([42.22, 63.6, 52.38, 72.8], pcb_top, 4.5);                                     // plastic
    color("silver") pblock([42.22, 72.8, 52.38, 79.3], pcb_top + 3.2, 1.3);                              // tab
    color("#1a3a8a") at([56.6, 72.75], pcb_top) cylinder(d = 6.3, h = 11.5);                             // C3 100 uF
    color("#c8a26a") for (x = [37.4, 40.4]) at([x, 69.58], pcb_top + 1.25) rotate([90, 0, 0])          // R6, R7
        cylinder(d = 2.5, h = 6.3, center = true);
    // DC-099 jack: nut against the wall, body + solder lugs
    color("silver") translate([wall, wall + P([0, dc_y])[1], floor_t + dc_z]) rotate([0, 90, 0]) {
        cylinder(d = 16, h = 2.5, $fn = 6);
        cylinder(d = 9, h = 14);
    }
    // SMA bulkheads: body in the pocket + crimp + cable start
    color("gold") for (x = ant_x) translate([wall + P([x, 0])[0], out_d - wall - ant_boss[1], floor_t + ant_z])
        rotate([90, 0, 0]) cylinder(d = 6.5, h = 12);
}
module models() { m_pcb(); m_esp(); for (x = sim_left) m_sim(x); for (b = bucks) m_buck(b); m_parts(); }

module m_oled_local() {
    zp = -oled_post;
    color("#1a6fb0") difference() {
        translate([-oled[0]/2, -oled[1]/2, zp - oled_t]) cube([oled[0], oled[1], oled_t]);
        for (sx = [-1, 1], sy = [-1, 1])
            translate([sx*oled_hole[0]/2, sy*oled_hole[1]/2, zp - oled_t - 1]) cylinder(d = 2.1, h = oled_t + 2);
    }
    color("#06142e") translate([-glass[0]/2, oled[1]/2 - glass_dy - glass[1], zp]) cube([glass[0], glass[1], oled_stack]);
    color("#111") translate([-5.08, oled[1]/2 - 3.2, zp - oled_t - 2.5]) cube([10.16, 2.5, 2.5]);
    translate([0, oled[1]/2 - 1.95, zp - oled_t - 2.5]) rotate([180, 0, 0]) {
        color("#e0c060") dupont_holder(4);
        color("#333") translate([-2*dp_pitch, -dp_plug/2, dp_lip]) cube([4*dp_pitch, dp_plug, 14]);
    }
}
module m_oled() { translate([wall + oled_c[0], wall + oled_c[1], 0]) m_oled_local(); }

module base_c() { color("#3b4048") base(); }
module lid_c(a = 1) { color([0.95, 0.95, 0.97, a]) lid(); }

if (part == "base") base();
else if (part == "lid") translate([0, out_d, lid_t]) rotate([180, 0, 0]) lid();           // printed face-down
else if (part == "lid_text") translate([0, out_d, lid_t]) rotate([180, 0, 0]) lid_text(); // 2-colour letters
else if (part == "dupont4") dupont_holder(4);
else if (part == "fit_pin") fit_pin();
else if (part == "fit_latch") fit_latch();
else if (part == "fit_ant") fit_ant();
else if (part == "closed") { base_c(); translate([0, 0, out_h]) lid_c(1); }
else if (part == "assembly") { base_c(); models(); translate([0, 0, out_h]) { lid_c(0.22); m_oled(); } }
else if (part == "exploded") { base_c(); models(); translate([0, 0, out_h + 45]) { lid_c(1); m_oled(); } }
else if (part == "inside") { base_c(); models(); }
else if (part == "check") {
    intersection() {                                  // boards, parts, OLED against box and lid
        union() { models(); translate([0, 0, out_h]) m_oled(); }
        union() { base(); translate([0, 0, out_h]) lid(); }
    }
    intersection() { models(); translate([0, 0, out_h]) m_oled(); }   // OLED against the boards
}
