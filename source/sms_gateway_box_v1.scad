// =====================================================================
//  SMS / missed-call gateway box  v1 (hand-wired build)   NO metal screws, NO inserts
//  ESP32-S3 + 2x SIM800L + 2x LM2596 + 0.96" OLED, wired with Dupont jumpers.
//  (The PCB build is v2: source/sms_gateway_box_v2.scad + pcb/.)
//   - ESP32 sits 20 mm up on 2 posts: Dupont plugs on its downward pins fit underneath, and
//     the gap between the posts lets wires and the SIM1 antenna cable pass under it. The lid's
//     inner rim has a short gap above the USB-C opening
//   - USB-C sockets sit 2 mm back inside a recess (the plug body goes into it), so the metal
//     sockets are not on show
//   - back-wall antenna holes (6.6 mm, for an IPEX -> SMA bulkhead pigtail) have a 2 mm ring
//     on the inside (4.4 mm total) for the 195 mm L antennas
//   - SIM800L sits low (4.5 mm): its 6-pin header points UP, Dupont plugs on top. Its frame has
//     crush ribs, so the board presses in and cannot rattle, and lowered front corners, so the
//     IPEX antenna plug can be pushed on and its cable can leave sideways
//   - SIM card goes in from outside through a 16 x 3.2 mm slot in the front wall
//   - a trough beside each SIM800L for its 1000 uF capacitor (up to 10.5 x 21 mm, hot glue)
//   - LM2596 bays: crush ribs, 2 snap pins in its M3 holes, ledges
//   - 12 V jack hole (DC-099, 11.2 mm) in the right wall's back corner
//   - lid clicks on with 4 snap latches (arms on the lid, grooves inside the walls, nothing
//     shows outside)
//   - lid text: "SMS GATEWAY", big + bold + 1 mm deep (optional 2-colour inlay part)
//   - vents are slanted 45 deg, so you cannot look into the box through them
//   - OLED: the PCB sits on 4 standoffs at its mounting holes with snap pins; the glass
//     touches nothing
//
//  Everything is held by printed features:
//   - lid: friction lip for alignment + 4 snap latches; pull it open at the front finger notch
//   - OLED drops onto 4 pegs on the lid underside; melt the peg tips (soldering iron) to hold it
//   - each board sits in its own rim frame on raised printed pads
//   - ESP32 rests on a central rib so its pins can hang below the board
//
//  part = "base" | "lid" | "fittest"            -> print these
//  part = "fit_esp" | "fit_sim" | "fit_oled"    -> small fit tests
//  part = "closed" | "assembly" | "exploded"    -> pictures only
//  part = "check"                               -> collision test
//  Units: mm. Board sizes are approximate: print "fittest" first.
// =====================================================================

part = "base";

// ---------------- box ----------------
wall    = 2.4;
floor_t = 2.4;
int_w   = 144;     // inside X
int_d   = 92;      // inside Y
int_h   = 30;      // inside height (floor top -> lid underside)
lid_t   = 3.2;
r_out   = 5;
out_w   = int_w + 2*wall;
out_d   = int_d + 2*wall;
out_h   = floor_t + int_h;        // top edge of the base

// ---------------- snap-on lid ----------------
lip_h   = 3;       // how far the lip goes into the tray
lip_t   = 1.6;
lip_gap = 0.35;    // clearance lip<->wall: RAISE to 0.45 if too tight, LOWER to 0.25 if loose
// snap latches: springy arms hang from the lid, their hooks click into grooves cut into the
// inside of the box walls. Hook faces are 45 deg: pressing the lid down clicks it shut, pulling
// at the finger notch opens it. Arms sit where no board is close to the wall.
// one arm per wall: [wall, centre along that wall (inside coords)]. Each spot is clear of the
// boards, the SIM antenna cables (they run along the front wall), the antenna holes, the USB-C
// recess, the DC hole and the OLED plug.
latches = [["front", 116], ["back", 50], ["left", 38], ["right", 60]];   // back: 42 -> 50 (antenna boss)

// 12 V in: panel jack DC-099 (5.5 x 2.1, metal, ~11 mm thread, 14 mm nut) in the right wall,
// back corner: the old spot (y 27, between the two LM2596s) had no room for the jack body.
dc_p = [78, 12];      // [inside y, height above the floor]
dc_d = 11.2;          // DC-099 (the one you have). DC-022B: 8.2. Cable straight through: 9
latch_w = 12;         // arm width
latch_L = 13;         // arm length below the lid: long = soft, little strain on the layers
latch_t = 1.3;        // arm thickness
latch_e = 0.8;        // hook reach into the groove: 0.6 = easier to open, 1.0 = holds harder
latch_he = lip_gap + latch_e;   // hook sticks out this far from the arm

ant_hole_d = 6.6;     // back-wall antenna holes: SMA bulkhead (6.5-6.6 is the usual hole)
ant_x      = [30, 80];   // hole centres, inside x
ant_z      = 16;         // hole centre height above the floor
ant_boss   = [17, 2.0];  // ring on the inside round each hole: diameter, thickness. It stiffens
                         // the wall round the hole for the long antennas
ant_pocket = 10.5;       // ...but the SMA connector body sits in a pocket in the ring, so it clamps
                         // on the plain 2.4 mm wall and enough thread stays outside for the
                         // washer, nut and antenna (pointed top: prints without support)

// 1000 uF capacitor next to each SIM800L: a trough on the floor right of its frame. The
// capacitor's legs are soldered to the VCC / GND pin joints UNDER the board and go out through
// the frame's side gap. Holds up to 10.5 mm diameter x 21 mm; fix it with a drop of hot glue.
cap_trough = [10.8, 22, 6.5];   // groove diameter, length, block height
cap_gap    = 1.0;               // trough <-> SIM frame

// ---------------- boards (MEASURE, then edit) ----------------
// ESP32-S3: YD-ESP32-S3 ("YD-ESP32-23 2022-V1.3", N16R8). 28 mm wide, wider than the
// DevKitC-1 (25.4).
esp_pcb     = [57.0, 28.0];  // PCB only: without antenna and without USB-C overhang   <- MEASURE
esp_t       = 1.6;
esp_ant     = [6.5, 18.5];   // module antenna sticking out past the PCB end (length, width) <- MEASURE
esp_usb_out = 1.0;           // how far the USB-C sockets stick out past the PCB edge     <- MEASURE
esp_usb_dy  = 6.2;           // each USB-C socket centre, measured from the board centre line
esp_usb_h   = 3.3;           // USB-C socket height above the PCB top
esp_lift    = 20;            // PCB underside above the floor: yellow headers (2.5) + Dupont plugs (14)
                             // hang below, ~3.5 mm left for the wires to bend (11 left no room)
esp_clr     = 0.3;           // side / end clearance around the PCB
esp_y       = 52;            // board front edge, inside coordinates (USB end against the LEFT wall)
// USB-C: seen from outside there is one rounded recess, usb_recess deep. At its floor each
// socket goes through its own tight hole in a usb_skin thick plate, so you cannot see into the
// box. The plug body (overmold) goes into the recess, so the plug still seats fully.
// Wall + recess + skin do not fit in 2.4 mm, so a small pad on the inside of the wall adds the
// rest; the PCB edge stops against that pad.
usb_recess  = 2.0;           // sockets sit this far back from the outside face
usb_plug    = [13.4, 7.4];   // recess per plug body (USB-C spec max 12.35 x 6.5): RAISE if a fat cable will not click in
usb_chamfer = 0.6;           // 45 deg edge on the recess opening
usb_skin    = 1.0;           // plate at the recess floor; the sockets pass through it
usb_hole    = [9.0, 3.3];    // USB-C socket outline (W x H)
usb_hole_c  = 0.4;           // clearance around each socket
usb_z_adj   = 0.3;           // early fit print: sockets sat 0.3 mm higher than drawn (gap under them)
usb_pcb_gap = 0.2;           // PCB edge <-> end-stop pad
usb_stop    = usb_recess + usb_skin - wall;       // end-stop face, inside coords (+ = into the box)
esp_x0      = usb_stop + usb_pcb_gap;             // PCB USB edge
esp_len     = esp_x0 + esp_pcb[0] + esp_ant[0];   // whole thing, antenna tip included
// SIM800L red board (SIM holder is underneath). 25.5 x 23.5 + 0.5 clearance let the board
// rattle ~1 mm each way; sellers list 25 x 23.  If you have calipers, measure + edit.
sim   = [25.0, 23.0];  sim_t  = 1.0;
sim_clr = 0.3;     // clearance per side to the rigid frame
sim_rib = 0.45;    // crush ribs stick out this far: the PCB edge squashes them -> snug, no play
// 6-pin header (NET VCC RST RXD TXD GND) soldered pointing UP on the right edge, the IPEX side:
// plastic + Dupont plugs on top, only solder points underneath. So the board sits low.
// (Pins pointing down would need it 20 mm up; with pins up there is no room above for that.)
sim_hdr   = [1.9, 5.0, 6];  // hole row from the right edge, first hole from the front edge, pins (photo)
sim_lift  = 4.5;            // board underside above the floor
sim_hdr_up = true;
sim_pad_y = 3.4;            // corner pads stop short of the header plastic
// LM2596 buck module (blue, 43 x 21). Numbers from ~10 maker CAD models + photos, spread about
// 0.5 mm (no maker drawing exists)  <- MEASURE yours once.
// Board frame: IN end at x = 0, the IN- corner at (0,0), parts on top.
buck      = [43.2, 21.0];  buck_t = 1.6;
buck_lift = 5;                              // clip the trimmer's 3 leads underneath to <= 4 mm
buck_pin  = [2.6, 3.7, 0.9];                // snap pins in the M3 holes: shaft, barb, slot
buck_hole = [[6.5, 18.4], [36.7, 2.6]];     // 2 M3 holes, diagonal (by IN+ and by OUT-)
buck_pad  = [[1.8, 19.2], [1.8, 1.8], [41.4, 19.2], [41.4, 1.8]];   // IN+ IN- OUT+ OUT-
buck_clr  = 0.35;
buck_flip = true;   // true: IN end toward the right wall (12 V jack), OUT end toward the other boards
// wires: solder them to the 4 corner pads, or solder single header pins pointing UP and use
// Dupont plugs (the supports underneath stay clear of the corner solder points either way).
// 0.96" I2C OLED (SSD1306, VCC GND SCL SDA). Snap hooks pressing on the glass cracked it, so
// the PCB rests on 4 standoffs at its mounting holes and 4 pegs go through the holes.
// The glass hangs oled_gap below the lid and touches nothing. Melt each peg tip with a
// soldering iron (or a drop of glue) to hold the board. Sizes are from photos  <- MEASURE
// Local OLED coords: (0,0) = centre of the 4 holes, +y = pin edge (toward the box back),
// so the picture is upright for someone reading the lid from the front.
oled       = [27.0, 27.7];  // PCB outline (drawing / clearance only; the pegs locate the board)
oled_t     = 1.2;           // PCB thickness
oled_hole  = [22.9, 23.3];  // mounting holes, centre to centre                  <- MEASURE
oled_stack = 1.9;           // PCB front face -> top of the glass (tape + glass)  <- MEASURE
oled_gap   = 0.4;           // glass top <-> lid underside
oled_post  = oled_stack + oled_gap;   // standoff height under the lid
oled_post_d = 3.4;          // standoff size; cut flat 1 mm from the hole centre on the glass side
oled_peg_d = 1.5;           // pegs in the ~2.1 mm holes (room for hole-spacing error)
oled_peg_up = 1.3;          // peg length past the PCB back, to melt over
oled_snap  = true;          // snap pins that click over the PCB (false = plain pegs to melt)
oled_pin   = [1.9, 2.7, 0.7];   // snap pin: shaft, barb, slot (holes measured ~2.1-2.4)
glass   = [26.7, 19.3];     // glass incl. the chip ledge (ledge at the ribbon edge, -y)
glass_dy = 4.6;             // glass edge from the PCB pin edge
win     = [24.0, 13.0];     // window at its narrowest (the lit area is 21.7 x 10.9)
win_dy  = 1.4;              // window centre from the hole centre, toward the pins  <- CHECK
win_bevel = 2.2;            // 45 deg bevel from the outside face

bay_clr = 0.5;     // clearance around each board inside its frame
bay_rim = 1.2;

// ---------------- layout (inside coordinates, front-left = 0,0) -------------
// SIM card from OUTSIDE: board edge with the card slot sits sim_gap from the front wall,
// so the card goes through a thin slot straight into the holder.
sim_gap   = sim_clr;        // board front edge <-> inside of the front wall (the wall is the front frame)
sim_card  = [16.0, 3.2];    // wall slot: micro-SIM is 15 x 12 x 0.76; 13 x 2.4 was too small for the card
sim_card_z = sim_lift - 0.9;// card centre height above the floor (holder hangs under the board) <- CHECK
sim_card_x = sim[0]/2;      // card centre, from the board's left edge                          <- CHECK
sim1_p  = [6, sim_gap];     // SIM holder edge faces the FRONT wall; IPEX antenna socket on a front corner
sim2_p  = [54, sim_gap];
buck1_p = [98, 6];
buck2_p = [98, 30];
oled_c  = [113.75, 72]; // lives in the lid: centre of the OLED's 4 holes, inside coordinates

$fn = 48;

// ================= helpers =================
module rbox(w, d, h, r) {
    hull() for (x = [r, w - r], y = [r, d - r]) translate([x, y, 0]) cylinder(r = r, h = h);
}

// ---------------- snap latches ----------------
// 2D profiles in (u, v): u = toward the wall (u = 0 is the arm's outer face; the wall's inner
// face is at u = lip_gap), v = down from the lid underside = down from the box top edge.
// Arm with a small fillet at its root, hook at its end: 45 deg holding face, 45 deg lead-in.
function latch_arm_pts() = let(L = latch_L, he = latch_he, t = latch_t) [
    [-t - 1.0, 0], [0, 0], [0, L - 3.2], [he, L - 3.2 + he], [he, L - 1.2], [0, L], [-t, L], [-t, 1.0]];
// groove in the wall: same 45 deg face but 0.1 lower, so the hook pulls the lid down tight
function latch_groove_pts() = let(L = latch_L, he = latch_he, a = lip_gap - 0.3, b = he + 0.3) [
    [a, L - 3.2 + 0.1 + a], [b, L - 3.2 + 0.1 + b], [b, L + 0.6], [a, L + 0.6]];
// (u, v, along-wall) -> (-y, -z, +x)
module latch_frame() { multmatrix([[0, 0, 1, 0], [-1, 0, 0, 0], [0, -1, 0, 0], [0, 0, 0, 1]]) children(); }
// children are drawn for the FRONT wall (outer face y = 0, inner face y = wall) with x = 0 at the
// latch centre; this moves them onto the chosen wall
module latch_place(side, p) {
    if (side == "front") translate([wall + p, 0, 0]) children();
    else if (side == "back") translate([wall + p, out_d, 0]) mirror([0, 1, 0]) children();
    else if (side == "left") translate([0, wall + p, 0])
        multmatrix([[0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) children();
    else if (side == "right") translate([out_w, wall + p, 0])
        multmatrix([[0, -1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) children();
}
// the arms, in lid coordinates (underside z = 0)
module latch_arms() {
    for (l = latches) latch_place(l[0], l[1])
        translate([-latch_w/2, wall + lip_gap, 0]) latch_frame() linear_extrude(latch_w) polygon(latch_arm_pts());
}
// the matching grooves, in base coordinates
module latch_grooves() {
    for (l = latches) latch_place(l[0], l[1])
        translate([-(latch_w + 1)/2, wall + lip_gap, out_h]) latch_frame() linear_extrude(latch_w + 1) polygon(latch_groove_pts());
}
// gaps in the friction lip so the arms can flex
module latch_lip_gaps() {
    for (l = latches) latch_place(l[0], l[1])
        translate([-latch_w/2 - 0.8, wall - 0.5, -lip_h - 1]) cube([latch_w + 1.6, lip_gap + lip_t + 1, lip_h + 1.01]);
}

// antenna hole in a wall. Local: origin = hole centre on the wall's INNER face, the wall runs
// from y = 0 to y = wall (outside), the box inside is -y.
// Ring on the inner face with a 45 deg slope underneath (grows out of the wall, nothing printed
// in the air):
module ant_ring() {
    translate([0, 0.01, 0]) rotate([90, 0, 0]) hull() {
        cylinder(d = ant_boss[0], h = ant_boss[1] + 0.01);
        translate([0, -(ant_boss[0]/2 + ant_boss[1]), 0]) cylinder(d = 0.1, h = 0.01);
    }
}
// SMA hole through wall + ring, and the pocket for the connector body (pointed top, 45 deg)
module ant_cut() {
    translate([0, -ant_boss[1] - 0.1, 0]) rotate([-90, 0, 0]) cylinder(d = ant_hole_d, h = wall + ant_boss[1] + 0.2);
    translate([0, 0.01, 0]) rotate([90, 0, 0]) hull() {
        cylinder(d = ant_pocket, h = ant_boss[1] + 0.2);
        translate([0, ant_pocket/2*sqrt(2), 0]) cylinder(d = 0.1, h = ant_boss[1] + 0.2);
    }
}
// antenna fit test: a piece of the back wall (upright, as in the box) with one hole, its ring and
// pocket, on a foot. Fit the real SMA connector (body in the pocket, washer + nut outside) and
// screw the antenna on: it must go on all the way.
module fit_ant() {
    w = 30; h = 24; zc = 12; fd = 14;
    difference() {
        union() {
            translate([0, 0, 0]) cube([w, wall, h]);            // wall: inner face y = 0, outside +y
            translate([0, -fd, 0]) cube([w, fd + 0.01, 1.6]);   // foot on the inside
            translate([w/2, 0, zc]) ant_ring();
        }
        translate([w/2, 0, zc]) ant_cut();
        translate([w/2, -fd/2 - 2, 1.0]) linear_extrude(1)
            text("SMA", size = 3.5, font = "Liberation Sans:style=Bold", halign = "center", valign = "center");
    }
}

// capacitor trough, lower-left corner at the origin: a block with a round groove along y
module cap_trough() {
    d = cap_trough[0]; l = cap_trough[1]; h = cap_trough[2];
    difference() {
        cube([d + 2.4, l, h]);
        translate([d/2 + 1.2, -1, h]) rotate([-90, 0, 0]) cylinder(d = d, h = l + 2);
    }
}

// SIM800L frame: corner pads short of the header's solder points underneath, deep notches so
// wires can leave sideways, lowered front corners for the IPEX plug
module sim_bay(p) {
    bay(p, sim, sim_lift, sim_t, notch_z = 1, clr = sim_clr, rib = sim_rib, low_front = true, pad_y = sim_pad_y);
}

// vertical crush rib on a face (face = the x axis, rib sticks out +y by e). The top is tapered
// over `lead` mm so the PCB edge can be pressed down past it; below that it is full size.
module crush_rib(e, h, b = 1.4, lead = 1.2) {
    hull() {
        linear_extrude(h - lead) polygon([[-b/2, -0.01], [b/2, -0.01], [0, e]]);
        translate([-b/2, -0.01, h - 0.01]) cube([b, 0.02, 0.01]);
    }
}

// rim frame around a board, local coords: board lower-left at p. Pads raise the board.
// rib > 0: one crush rib in the middle of every rim piece (2 per side, 8 in all).
// low_front: the side rim pieces at the front corners only reach the board top, so an IPEX
// antenna plug on a front corner can be pushed on and its cable can leave sideways.
module bay(p, s, lift, t, pads = true, notch_z = -1, clr = bay_clr, rib = 0, low_front = false, pad_y = 5) {
    c = clr; r = bay_rim;
    nz = (notch_z < 0) ? lift : notch_z;       // deep notches let wires / antenna pass low
    h  = lift + t + 1.5;
    hl = lift + t;                             // lowered rim height (= board top)
    ow = s[0] + 2*(c + r);
    od = s[1] + 2*(c + r);
    fy = od/2 - 5;                             // front side pieces end where the side notch starts
    translate([p[0] - c - r, p[1] - c - r, 0]) {
        difference() {
            cube([ow, od, h]);
            translate([r, r, -1]) cube([s[0] + 2*c, s[1] + 2*c, h + 2]);
            // finger / wire notches at the middle of each side
            translate([ow/2 - 5, -1, nz + 0.01]) cube([10, od + 2, h]);
            translate([-1, od/2 - 5, nz + 0.01]) cube([ow + 2, 10, h]);
            if (low_front)
                for (x = [-1, ow - r - 0.01]) translate([x, -1, hl]) cube([r + 1.01, fy + 1.01, h]);
        }
        if (pads)
            for (x = [r, ow - r - 5], y = [r, od - r - pad_y])
                translate([x, y, 0]) cube([5, pad_y, lift]);
        if (rib > 0) {
            ax = (ow/2 - 5)/2;  ay = fy/2;              // middle of each rim piece
            for (x = [ax, ow - ax]) {
                translate([x, r, 0])                            crush_rib(rib, h);   // front
                translate([x, od - r, 0]) rotate([0, 0, 180])  crush_rib(rib, h);   // back
            }
            for (y = [ay, od - ay]) {
                fh = (low_front && y < od/2) ? hl : h;          // lowered front pieces
                fl = (low_front && y < od/2) ? 0.4 : 1.2;
                translate([r, y, 0])      rotate([0, 0, -90])  crush_rib(rib, fh, lead = fl);   // left
                translate([ow - r, y, 0]) rotate([0, 0, 90])   crush_rib(rib, fh, lead = fl);   // right
            }
        }
    }
}

// ---------------- OLED (in the lid) ----------------
// local coords: (0,0) = centre of the 4 holes, z = 0 the lid underside, the board hangs below.
// 4 standoffs touch only the PCB corners round the holes (flat on the glass side), 4 pegs go
// through the holes. Nothing presses on the glass, and no force is needed to fit the board.
// split snap pin pointing +z, root at z = 0. The board's underside rests at z = rest (on a support
// beside the pin), its top at rest + pcb; the flat barb clicks over the board top. The slot
// (across x) splits it into two prongs that bend toward each other; the tip is a lead-in cone.
// To take the board off: squeeze the two prong tips together and lift.
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

module oled_mount() {
    hx = oled_hole[0]/2; hy = oled_hole[1]/2;
    zp = -oled_post;                                     // PCB front face
    if (oled_snap) for (sx = [-1, 1], sy = [-1, 1]) translate([sx*hx, sy*hy, 0]) {
        // support pad on the outer side of the hole (away from the glass), clear of the pin
        mirror([0, sy > 0 ? 0 : 1, 0]) translate([-1.8, 1.25, zp]) cube([3.6, 1.6, oled_post + 0.01]);
        mirror([0, 0, 1]) snap_pin(oled_pin[0], oled_pin[1], oled_post, oled_t, oled_pin[2], lip = 0.35, tip = 0.9);
    }
    else for (sx = [-1, 1], sy = [-1, 1]) translate([sx*hx, sy*hy, 0]) {
        intersection() {
            translate([0, 0, zp]) cylinder(d = oled_post_d, h = oled_post + 0.01);
            translate([-3, sy > 0 ? -1.0 : -5, zp - 1]) cube([6, 6, oled_post + 2]);   // flat toward the glass
        }
        // peg with a pointed tip (points up when printed, so it needs no support)
        translate([0, 0, zp - oled_t - oled_peg_up]) {
            translate([0, 0, 0.5]) cylinder(d = oled_peg_d, h = oled_t + oled_peg_up - 0.5 + 0.01);
            cylinder(d1 = oled_peg_d - 0.6, d2 = oled_peg_d, h = 0.5 + 0.01);
        }
    }
}
// window through the lid: oled_win wide at the underside, 45 deg bevel out to the top face
module oled_window() {
    translate([0, win_dy, 0]) hull() {
        translate([-win[0]/2, -win[1]/2, -0.1]) cube([win[0], win[1], lid_t - win_bevel + 0.1]);
        translate([-win[0]/2 - win_bevel - 0.1, -win[1]/2 - win_bevel - 0.1, lid_t + 0.09])
            cube([win[0] + 2*win_bevel + 0.2, win[1] + 2*win_bevel + 0.2, 0.01]);
    }
}
// "PINS" engraved in the lid underside next to where the header edge goes (reads when the lid
// is turned over front-to-back)
module oled_label() {
    translate([0, oled_hole[1]/2 - 1.2, -0.1]) linear_extrude(0.5) mirror([0, 1, 0])
        text("PINS", size = 3.5, font = "Liberation Sans:style=Bold", halign = "center", valign = "center");
}

// ---------------- Dupont jumper holder (for the OLED's 4 pins) ----------------
// Holds n single female Dupont jumper plugs side by side as ONE n-pin plug, so they push on
// together and cannot wiggle off one by one. Push each plug in from the open end until it stops
// at the lip (the lip has a hole per pin), then push the whole thing onto the header: the lip
// ends up between the header plastic and the plugs. The chamfered corner marks pin 1 (VCC).
// Printed lip-down, no support.
dp_pitch = 2.54;
dp_plug  = 2.54;    // one Dupont plug is 2.54 x 2.54 x 14
dp_fit   = 0.25;    // clearance in the pocket, each direction: RAISE if the plugs do not go in
dp_len   = 13;      // pocket depth: the 14 mm plugs stick out ~1 mm at the wire end
dp_wall  = 1.0;
dp_lip   = 0.8;
module dupont_holder(n = 4) {
    iw = n*dp_pitch + dp_fit;  id = dp_plug + dp_fit;
    ow = iw + 2*dp_wall;       od = id + 2*dp_wall;
    difference() {
        translate([-ow/2, -od/2, 0]) cube([ow, od, dp_lip + dp_len]);
        translate([-iw/2, -id/2, dp_lip]) cube([iw, id, dp_len + 1]);
        for (i = [0 : n - 1])
            translate([(i - (n - 1)/2)*dp_pitch, 0, -0.1]) cylinder(d = 1.4, h = dp_lip + 0.2, $fn = 16);
        // pin-1 mark: 45 deg chamfer on the outer corner at the first plug
        translate([-ow/2, od/2, (dp_lip + dp_len)/2]) rotate([0, 0, 45]) cube([1.4, 1.4, dp_lip + dp_len + 2], center = true);
    }
}

// ---------------- LM2596 holder ----------------
// board frame (see buck_*): two bosses with locating pegs at the M3 holes, plus two low ledges
// along the long edges. All of it stays clear of the solder stubs of the 4 corner pins and of
// the trimmer's 3 leads under the board (x 24-34, y 15-21).
module buck_supports() {
    // bosses with a ring gap round a snap pin, so the prongs can bend inside the boss too
    for (h = buck_hole) translate([h[0], h[1], 0]) {
        difference() {
            cylinder(d = 6, h = buck_lift);
            translate([0, 0, 0.6]) cylinder(d = buck_pin[0] + 1.2, h = buck_lift);
        }
        translate([0, 0, 0.59]) snap_pin(buck_pin[0], buck_pin[1], buck_lift - 0.59, buck_t, buck_pin[2],
                                         slot_from = 0.4, lip = 0.45, tip = 1.2);
    }
    translate([10, -buck_clr - 0.01, 0]) cube([23, 1.8 + buck_clr, buck_lift]);              // IN- / OUT- edge
    translate([10, buck[1] - 1.8, 0]) cube([13, 1.8 + buck_clr + 0.01, buck_lift]);          // IN+ edge, stops before the trimmer
}
module buck_frame() {
    if (buck_flip) translate([buck[0], buck[1], 0]) rotate([0, 0, 180]) children();
    else children();
}
// frame with crush ribs (no corner pads: the pin stubs are there) + the supports above
module buck_bay(p) {
    bay(p, buck, buck_lift, buck_t, pads = false, clr = buck_clr, rib = sim_rib);
    translate([p[0], p[1], 0]) buck_frame() buck_supports();
}

// ---------------- ESP32 holder ----------------
// local coords: x = 0 is the inside face of the left wall, y = 0 the PCB front edge, z = 0 the floor.
// The board rests on 2 posts between its pin rows (the pins + Dupont plugs hang either side of
// them) and is located by 4 corner posts. The 27 mm gap between the 2 posts is for wires and the
// SIM1 antenna cable. The antenna overhang has nothing around it and stays inside the box.
esp_post_l = 12;                 // length of each support post along the board
module esp_holder() {
    c = esp_clr; r = 2.0; L = esp_pcb[0]; W = esp_pcb[1];
    ph = esp_lift + esp_t + 2;          // post height: 2 mm above the PCB top
    xe = esp_x0 + L;                    // far PCB edge (antenna starts here)
    // 2 support posts under the middle of the board (between the pin rows)
    for (x = [esp_x0 + 3, xe - 3 - esp_post_l])
        translate([x, (W - 16)/2, 0]) cube([esp_post_l, 16, esp_lift]);
    // end-stop pad on the inside of the wall: thickens the wall behind the USB-C recess,
    // the sockets pass through it and the PCB edge stops against it
    if (usb_stop > 0) {
        pw = 2*esp_usb_dy + usb_plug[0] + 2*usb_chamfer + 3;     // recess + 1.5 mm all round
        pz = usb_zc() + usb_plug[1]/2 + usb_chamfer + 1.5;
        translate([-0.01, W/2 - pw/2, 0]) cube([usb_stop + 0.01, pw, pz]);
    }
    for (s = [0, 1]) {
        ys = s == 0 ? -c - r : W + c;  // outside the PCB side edge
        // USB-end side posts, joined to the wall
        x0 = min(esp_x0, 0) - 0.01;
        translate([x0, ys, 0]) cube([esp_x0 + 7 - x0, r, ph]);
        // far-end corner posts: side piece + end piece beside the antenna
        translate([xe - 7, ys, 0]) cube([7 + c + r, r, ph]);
        ye = s == 0 ? -c - r : W - 4;
        translate([xe + c, ye, 0]) cube([r, 4 + c + r, ph]);
    }
}
// USB-C socket centre height above the floor
function usb_zc() = esp_lift + esp_t + esp_usb_h/2 + usb_z_adj;

// rounded slot running along +x from x = 0, centred on y = z = 0
module stadium_x(w, h, len) {
    rr = h/2;
    hull() for (sy = [-1, 1])
        translate([0, sy*(w/2 - rr), 0]) rotate([0, 90, 0]) cylinder(r = rr, h = len);
}

// USB-C cut (same translate as esp_holder): one recess for both plug bodies from the outside,
// then one tight hole per socket through the skin (+ end-stop pad)
module usb_cut() {
    c = esp_clr; W = esp_pcb[1];
    xf = -wall + usb_recess;                      // recess floor
    rw = 2*esp_usb_dy + usb_plug[0];              // recess width (both plugs side by side)
    rh = usb_plug[1];
    hw = usb_hole[0] + 2*usb_hole_c; hh = usb_hole[1] + 2*usb_hole_c;
    translate([0, W/2, usb_zc()]) {
        translate([-wall - 0.1, 0, 0]) stadium_x(rw, rh, usb_recess + 0.1);
        hull() {                                  // 45 deg edge round the opening
            translate([-wall - 0.1, 0, 0])
                stadium_x(rw + 2*(usb_chamfer + 0.1), rh + 2*(usb_chamfer + 0.1), 0.01);
            translate([-wall + usb_chamfer, 0, 0]) stadium_x(rw, rh, 0.01);
        }
        for (dy = [-esp_usb_dy, esp_usb_dy])
            translate([xf - 0.1, dy, 0]) stadium_x(hw, hh, max(usb_stop, 0) - xf + 0.2);
    }
    // only if the recess is shallow: thin the wall from inside so the PCB edge can go into it
    if (usb_stop < 0)
        translate([usb_stop, -c, esp_lift - 3]) cube([-usb_stop + 0.1, W + 2*c, 3 + esp_t + esp_usb_h + 0.6]);
}

// SIM slot, local coords: x = 0 card centre, y = 0 inside face of the front wall, z = 0 floor.
// Thin slot through the wall + frame rim, and a shallow round scoop on the outside so a
// fingernail can push the card in and catch its edge to pull it out.
module sim_cut() {
    translate([-sim_card[0]/2, -wall - 0.1, sim_card_z - sim_card[1]/2])
        cube([sim_card[0], wall + sim_gap + 2, sim_card[1]]);
    // finger bevel round the slot, 1.4 mm deep. A round scoop's top hung in the air on the tall
    // box wall (slicer: "floating cantilever"); 45 deg on top prints clean
    sd = 1.4; ex = 2.8;
    hull() {
        translate([-sim_card[0]/2 - ex, -wall - 0.1, sim_card_z - sim_card[1]/2 - 1.8])
            cube([sim_card[0] + 2*ex, 0.11, sim_card[1] + 1.8 + sd]);
        translate([-sim_card[0]/2, -wall + sd, sim_card_z - sim_card[1]/2]) cube([sim_card[0], 0.01, sim_card[1]]);
    }
}

screw_free = true;   // no screws anywhere

// ================= BASE =================
module base() {
    difference() {
        union() {
            difference() {
                rbox(out_w, out_d, out_h, r_out);
                translate([wall, wall, floor_t]) cube([int_w, int_d, int_h + 1]);
            }
            translate([wall, wall, floor_t - 0.01]) {
                sim_bay(sim1_p);
                sim_bay(sim2_p);
                buck_bay(buck1_p);
                buck_bay(buck2_p);
                for (p = [sim1_p, sim2_p]) translate([p[0] + sim[0] + sim_clr + bay_rim + cap_gap, 3, 0]) cap_trough();
            }
            translate([wall, wall + esp_y, floor_t - 0.01]) esp_holder();
            // rings on the inside of the back wall round the antenna holes
            for (ax = ant_x) translate([wall + ax, out_d - wall, floor_t + ant_z]) ant_ring();
        }

        // --- grooves for the lid's snap latches, inside the front + back walls ---
        latch_grooves();

        // --- finger notch under the lid edge (front centre) ---
        translate([out_w/2 - 8, -0.1, out_h - 1.2]) cube([16, wall + 0.2, 1.3]);

        // --- SIM card slots + fingernail scoops, front wall ---
        for (p = [sim1_p, sim2_p])
            translate([wall + p[0] + sim_card_x, wall, floor_t]) sim_cut();

        // --- ESP32 USB-C opening, left wall (both ports, plug bodies go in) ---
        translate([wall, wall + esp_y, floor_t]) usb_cut();

        // --- 12 V jack hole, right wall, back corner (clear of the LM2596s) ---
        translate([out_w - wall - 0.1, wall + dc_p[0], floor_t + dc_p[1]])
            rotate([0, 90, 0]) cylinder(d = dc_d, h = wall + 0.2);

        // --- two antenna holes, back wall: sized for the SMA-female bulkhead of an
        //     IPEX -> SMA pigtail (1/4"-36 thread, 8 mm nut) ---
        for (ax = ant_x) translate([wall + ax, out_d - wall, floor_t + ant_z]) ant_cut();
    }
}

// ================= LID =================
// title: only "SMS GATEWAY", big and bold. Engraved title_d deep into the top face; the face is
// printed on the bed, so the letters come out sharp. For a 2-colour lid print part = "lid_text"
// too and load it together with the lid as one object (second filament for the letters).
title      = "SMS GATEWAY";
title_size = 9;               // letters ~9 mm tall, line ~89 mm long
title_c    = [52, 48.4];      // centre, outer coordinates (left of the vents and the OLED)
title_d    = 1.0;
module title_2d() {
    text(title, size = title_size, font = "Liberation Sans:style=Bold",
         halign = "center", valign = "center");
}
// vents over the two converters: slots slanted 45 deg through the lid. The top of each slot is
// 3.2 mm to the side of its bottom and the slot is only 1.6 wide, so you cannot see inside.
vent_p     = [102, 8];        // first slot, inside coordinates
vent_n     = 8;
vent_pitch = 4.2;
vent_w     = 1.6;
vent_len   = 42;
module vents() {
    for (i = [0 : vent_n - 1]) translate([i*vent_pitch, 0, 0])
        multmatrix([[1, 0, 1, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
            translate([0, 0, -0.1]) cube([vent_w, vent_len, lid_t + 0.2]);
}
module lid() {
    difference() {
        rbox(out_w, out_d, lid_t, r_out);
        translate([wall + oled_c[0], wall + oled_c[1], 0]) { oled_window(); oled_label(); }
        translate([wall + vent_p[0], wall + vent_p[1], 0]) vents();
        translate([title_c[0], title_c[1], lid_t - title_d]) linear_extrude(title_d + 0.1) title_2d();
    }
    // friction lip for alignment, with gaps where the latch arms are
    difference() {
        translate([wall + lip_gap, wall + lip_gap, -lip_h])
            difference() {
                cube([int_w - 2*lip_gap, int_d - 2*lip_gap, lip_h + 0.01]);
                translate([lip_t, lip_t, -1]) cube([int_w - 2*lip_gap - 2*lip_t, int_d - 2*lip_gap - 2*lip_t, lip_h + 2]);
            }
        latch_lip_gaps();
        // gap above the USB-C opening: the end-stop pad behind it now reaches up into the lip zone
        translate([wall - 0.5, wall + esp_y - 2, -lip_h - 1]) cube([lip_gap + lip_t + 1, esp_pcb[1] + 4, lip_h + 1.01]);
    }
    latch_arms();
    // OLED standoffs + pegs
    translate([wall + oled_c[0], wall + oled_c[1], 0]) oled_mount();
}
// latch fit test: a piece of the box wall with the groove (standing up, as the box prints) and a
// piece of the lid with one arm and the lip either side (face down, as the lid prints).
// Press the lid piece onto the wall piece: it must click in, hold, and pull off at the edge.
module fit_latch() {
    sw = latch_w + 14;  h = latch_L + 4;  ld = 14;
    difference() {
        union() {
            cube([sw, wall, h]);                       // wall, outer face at y = 0
            cube([sw, wall + 8, 1.6]);                 // foot
        }
        translate([sw/2 - (latch_w + 1)/2, wall + lip_gap, h])
            latch_frame() linear_extrude(latch_w + 1) polygon(latch_groove_pts());
    }
    translate([0, 14 + ld, lid_t]) rotate([180, 0, 0]) {        // lid piece, flipped: face on the bed
        cube([sw, ld, lid_t]);
        for (x = [[0, sw/2 - latch_w/2 - 0.8], [sw/2 + latch_w/2 + 0.8, sw]])
            translate([x[0], wall + lip_gap, -lip_h]) cube([x[1] - x[0], lip_t, lip_h + 0.01]);
        translate([sw/2 - latch_w/2, wall + lip_gap, 0])
            latch_frame() linear_extrude(latch_w) polygon(latch_arm_pts());
    }
}

// the letters alone (2-colour option), same place as in lid()
module lid_text() {
    translate([title_c[0], title_c[1], lid_t - title_d]) linear_extrude(title_d) title_2d();
}

// ================= FIT TEST (print this first, ~25 min) =================
module fittest() {
    pt = 1.6;                                   // plate thickness
    wh = pt + esp_lift + esp_t + esp_usb_h + 5; // wall piece height
    difference() {
        union() {
            cube([102, 73, pt]);
            // piece of the real left wall, with the real USB-C opening
            cube([wall, esp_pcb[1] + 9, wh]);
            // piece of the real front wall, with the SIM slot + scoop
            translate([2, 45.7 - sim_gap - wall, 0]) cube([33, wall, pt + sim_lift + 5]);
            // ESP32 holder exactly as in the box (antenna end is open); inside the cut so
            // the socket holes also go through its end-stop pad
            translate([wall, 4, pt - 0.01]) esp_holder();
        }
        translate([wall, 4, pt]) usb_cut();
        translate([5.7 + sim_card_x, 45.7 - sim_gap, pt]) sim_cut();
    }
    translate([0, 0, pt - 0.01]) {
        sim_bay([5.7, 45.7]);
        buck_bay([40, 46]);
    }
    // lid coupon with the OLED window, standoffs and pegs (window face on the bed)
    translate([66, 2, 0]) fit_oled();
}

// OLED only: piece of the lid with the window, standoffs and pegs. Lid orientation first
// (underside z = 0), fit_oled() turns it over so the window face is on the bed and pegs point up.
oled_cp = [34, 34];
module oled_coupon() {
    difference() {
        translate([-oled_cp[0]/2, -oled_cp[1]/2, 0]) cube([oled_cp[0], oled_cp[1], lid_t]);
        oled_window();
        oled_label();
    }
    oled_mount();
}
// LM2596 only: the real bay (frame, crush ribs, 2 snap pins, ledges) on a plate.
// "IN >" on the floor shows which way it goes.
module fit_buck() {
    pt = 1.6; c = buck_clr + bay_rim;
    p  = [c + 2, c + 2];
    pw = buck[0] + 2*c + 4;
    difference() {
        cube([pw, buck[1] + 2*c + 4, pt]);
        translate([p[0] + buck[0]/2, p[1] + buck[1]/2, pt - 0.6]) linear_extrude(1)
            text(buck_flip ? "LM2596   IN >" : "< IN   LM2596", size = 3.5,
                 font = "Liberation Sans:style=Bold", halign = "center", valign = "center");
    }
    translate([0, 0, pt - 0.01]) buck_bay(p);
}

module fit_oled() {
    translate([oled_cp[0]/2, oled_cp[1]/2, lid_t]) rotate([180, 0, 0]) oled_coupon();
}

// ================= small separate fit tests =================
// ESP32 only: holder + piece of the left wall with the USB-C holes
module fit_esp() {
    pt = 1.6;
    wh = pt + esp_lift + esp_t + esp_usb_h + 5;
    W = esp_pcb[1] + 2*(esp_clr + 2.0);                       // holder width incl. posts
    Lx = wall + esp_x0 + esp_pcb[0] + esp_clr + 2.0 + 2;      // to just past the far posts
    difference() {
        union() {
            cube([Lx, W + 4, pt]);
            cube([wall, W + 4, wh]);
            translate([wall, 2 + esp_clr + 2.0, pt - 0.01]) esp_holder();
        }
        translate([wall, 2 + esp_clr + 2.0, pt]) usb_cut();
        // name engraved in the floor between the two support posts
        translate([wall + esp_x0 + esp_pcb[0]/2, 2 + esp_clr + 2.0 + esp_pcb[1]/2, pt - 0.6])
            linear_extrude(1) {
                translate([0, 2.6]) text("YD-ESP32-S3", size = 3.5, font = "Liberation Sans:style=Bold",
                                         halign = "center", valign = "center");
                translate([0, -3.4]) text("< USB-C", size = 3.5, font = "Liberation Sans:style=Bold",
                                          halign = "center", valign = "center");
            }
    }
}
// SIM800L only: bay + piece of the front wall with the SIM slot and scoop
module fit_sim() {
    pt = 1.6; c = sim_clr + bay_rim;
    px = c + 2;                                   // board left edge
    w  = sim[0] + 2*c + 4;
    difference() {
        union() {
            cube([w, wall + sim_gap + sim[1] + c + 2, pt]);
            cube([w, wall, pt + sim_lift + 5]);
        }
        translate([px + sim_card_x, wall, pt]) sim_cut();
        // name engraved in the floor inside the bay
        translate([px + sim[0]/2, wall + sim_gap + sim[1]/2, pt - 0.6]) linear_extrude(1) {
            translate([0, 2.5]) text("SIM800L", size = 4.2, font = "Liberation Sans:style=Bold",
                                     halign = "center", valign = "center");
            translate([0, -3.6]) text("v SLOT", size = 3.5, font = "Liberation Sans:style=Bold",
                                      halign = "center", valign = "center");
        }
    }
    translate([0, 0, pt - 0.01])
        sim_bay([px, wall + sim_gap]);
}

// ================= component models (pictures + collision check) ============
module in_base() { translate([wall, wall, floor_t]) children(); }

module m_esp() {
    L = esp_pcb[0]; W = esp_pcb[1];
    translate([esp_x0, esp_y, esp_lift]) {
        color("#222") cube([L, W, esp_t]);
        color("silver") translate([L - 25.5, (W - 18)/2, esp_t]) cube([25.5, 18, 3.1]);          // module
        color("#111") translate([L, (W - esp_ant[1])/2, esp_t]) cube([esp_ant[0], esp_ant[1], 0.8]); // antenna
        color("silver") for (dy = [-esp_usb_dy, esp_usb_dy])                                      // 2x USB-C
            hull() for (sy = [-1, 1])
                translate([-esp_usb_out, W/2 + dy + sy*(usb_hole[0] - usb_hole[1])/2, esp_t + esp_usb_h/2])
                    rotate([0, 90, 0]) cylinder(d = usb_hole[1], h = 7.5);
        color("gold") for (y = [0, W - 2.54]) translate([1.5, y, -8.5]) cube([54, 2.54, 8.5]);   // headers + pins
        color("#333") for (y = [0, W - 2.54]) translate([1.5, y, -2.5 - 14]) cube([54, 2.54, 14]); // Dupont plugs, every pin
    }
}
module m_sim(p) {
    translate([p[0], p[1], sim_lift]) {
        color("#b01818") cube([sim[0], sim[1], sim_t]);
        color("#333") translate([5, 4, sim_t]) cube([15, 14, 0.9]);
        color("silver") translate([5, 4, -1.8]) cube([15, 15, 1.8]);                             // SIM holder underneath
        // IPEX socket on the front-right corner (photo: 1.6 mm from the right edge, 1.75 from the
        // front edge), U.FL plug on it, cable leaving to the right over the lowered frame corner.
        // Toward the wall, the capacitor and the header holes there is no room for the cable.
        translate([sim[0] - 1.6, 1.75, sim_t]) {
            color("silver") translate([-1.3, -1.3, 0]) cube([2.6, 2.6, 1.25]);
            color("#ddd") cylinder(d = 2.2, h = 2.4);
            color("#222") translate([0, 0, 1.7]) rotate([0, 90, 0]) cylinder(d = 1.37, h = 18);
        }
        color("#c8a040") translate([sim[0] - 3.5 - 6.0, 0.4, sim_t]) cube([6.0, 3.2, 2.5]);   // tantalum cap
        // 6-pin header pointing UP (plastic on top) + one Dupont plug on each pin; solder points
        // + clipped pin ends underneath
        hx = sim[0] - sim_hdr[0]; n = sim_hdr[2];
        color("#111") translate([hx - 1.25, sim_hdr[1] - 1.27, sim_t]) cube([2.5, n*2.54, 2.5]);
        color("#333") translate([hx - 1.27, sim_hdr[1] - 1.27, sim_t + 2.5]) cube([2.54, n*2.54, 14]);
        color("silver") for (i = [0 : n - 1]) translate([hx - 0.6, sim_hdr[1] + i*2.54 - 0.6, -1.5]) cube([1.2, 1.2, 1.5]);
    }
}
module m_buck_local() {   // board frame (see buck_*), PCB underside at z = 0
    color("#1f5fa8") difference() {
        cube([buck[0], buck[1], buck_t]);
        for (h = buck_hole) translate([h[0], h[1], -1]) cylinder(d = 3.1, h = buck_t + 2);
    }
    color("#222") for (c = [[5, 10.5], [38.2, 10.5]]) translate([c[0], c[1], buck_t]) cylinder(d = 8, h = 11);  // caps
    color("#444") translate([21, 1.3, buck_t]) cube([12, 12, 7.6]);                // inductor
    color("#5aa0ff") translate([24, 14.5, buck_t]) cube([9.5, 4.8, 11.5]);         // trimmer
    color("silver") translate([26, 16.9, -3]) cube([6, 0.9, 3]);                   // trimmer leads underneath (clipped)
    for (q = buck_pad) translate([q[0], q[1], 0]) {
        color("silver") translate([-0.6, -0.6, -2]) cube([1.2, 1.2, 2]);         // pin stub + solder underneath
        color("#111") translate([-1.25, -1.25, buck_t]) cube([2.5, 2.5, 2.5]);   // header plastic (pin points up)
        color("#333") translate([-1.27, -1.27, buck_t + 2.5]) cube([2.54, 2.54, 14]);   // Dupont plug
    }
}
module m_buck(p) {
    translate([p[0], p[1], buck_lift]) buck_frame() m_buck_local();
}
module m_oled_local() {   // OLED local coords (see oled_mount), glass at its thickest
    zp = -oled_post;
    color("#1a6fb0") difference() {                                                    // PCB
        translate([-oled[0]/2, -oled[1]/2, zp - oled_t]) cube([oled[0], oled[1], oled_t]);
        for (sx = [-1, 1], sy = [-1, 1])
            translate([sx*oled_hole[0]/2, sy*oled_hole[1]/2, zp - oled_t - 1]) cylinder(d = 2.1, h = oled_t + 2);
    }
    color("#06142e") translate([-glass[0]/2, oled[1]/2 - glass_dy - glass[1], zp]) cube([glass[0], glass[1], oled_stack]);
    color("#111") translate([-5.08, oled[1]/2 - 3.2, zp - oled_t - 2.5]) cube([10.16, 2.5, 2.5]);  // header, on the back
    // Dupont holder + 4 jumper plugs pushed onto the header
    translate([0, oled[1]/2 - 1.95, zp - oled_t - 2.5]) rotate([180, 0, 0]) {
        color("#e0c060") dupont_holder(4);
        color("#333") translate([-2*dp_pitch, -dp_plug/2, dp_lip]) cube([4*dp_pitch, dp_plug, 14]);
    }
}
module m_oled() {   // hangs from the lid, lid underside = z 0
    translate([wall + oled_c[0], wall + oled_c[1], 0]) m_oled_local();
}
module models() {
    in_base() { m_esp(); m_sim(sim1_p); m_sim(sim2_p); m_buck(buck1_p); m_buck(buck2_p); }
}

module base_c() { color("#3b4048") base(); }
module lid_c(a = 1) { color([0.95, 0.95, 0.97, a]) lid(); }

if (part == "base") base();
else if (part == "lid") translate([0, out_d, lid_t]) rotate([180, 0, 0]) lid();   // printed face-down
else if (part == "lid_text") translate([0, out_d, lid_t]) rotate([180, 0, 0]) lid_text();   // 2-colour letters
else if (part == "fit_latch") fit_latch();
else if (part == "fit_ant") fit_ant();
else if (part == "fit_buck") fit_buck();
else if (part == "buck_check")   // LM2596 model (pins, plugs, holders) against its bay: must be empty
    intersection() { buck_bay([0, 0]); translate([0, 0, buck_lift]) buck_frame() m_buck_local(); }
else if (part == "fittest") fittest();
else if (part == "fit_esp") fit_esp();
else if (part == "fit_sim") fit_sim();
else if (part == "fit_oled") fit_oled();
else if (part == "dupont4") dupont_holder(4);   // OLED plug holder
else if (part == "oled_check")   // OLED model against the coupon: must be empty
    intersection() { oled_coupon(); m_oled_local(); }
else if (part == "closed") { base_c(); translate([0, 0, out_h]) lid_c(1); }
else if (part == "assembly") {
    base_c(); models();
    translate([0, 0, out_h]) { lid_c(0.22); m_oled(); }
}
else if (part == "exploded") {
    base_c(); models();
    translate([0, 0, out_h + 45]) { lid_c(1); m_oled(); }
}
else if (part == "check2") {      // board against board
    in_base() {
        intersection() { m_sim(sim1_p); m_sim(sim2_p); }
        intersection() { m_sim(sim2_p); m_buck(buck1_p); }
        intersection() { m_sim(sim2_p); m_buck(buck2_p); }
        intersection() { m_buck(buck1_p); m_buck(buck2_p); }
        intersection() { m_esp(); m_buck(buck2_p); }
        intersection() { m_esp(); m_buck(buck1_p); }
        intersection() { m_esp(); m_sim(sim1_p); }
        intersection() { m_esp(); m_sim(sim2_p); }
    }
}
else if (part == "check2") {      // board against board
    in_base() {
        intersection() { m_sim(sim1_p); m_sim(sim2_p); }
        intersection() { m_sim(sim2_p); m_buck(buck1_p); }
        intersection() { m_sim(sim2_p); m_buck(buck2_p); }
        intersection() { m_buck(buck1_p); m_buck(buck2_p); }
        intersection() { m_esp(); m_buck(buck2_p); }
        intersection() { m_esp(); m_buck(buck1_p); }
        intersection() { m_esp(); m_sim(sim1_p); }
        intersection() { m_esp(); m_sim(sim2_p); }
    }
}
else if (part == "check") {
    intersection() {
        union() { models(); translate([0, 0, out_h]) m_oled(); }
        union() { base(); translate([0, 0, out_h]) lid(); }
    }
}
