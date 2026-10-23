"""Vehicles, bolt-on parts and wheels for Motorworks.

Run:  blender -b --factory-startup -P blender/build_vehicles.py
Outputs public/models/car_*.glb, parts.glb, wheels.glb (+ preview renders).

Hinge conventions (exported as glTF extras -> Three.js userData):
  hinge = 'x' | 'y'     rotation axis in the node's local space
  open  = radians       rotation that fully opens the part
Doors pivot at the front pillar, hoods at the cowl, trunks at the rear deck,
wheels hang from Knuckle_* (steer about Y) -> Axle_* (spin about X).
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector, Matrix
from mwlib import *

PAINT = lambda: mat("Paint", (0.55, 0.05, 0.05), 0.4, 0.25)
PAINT2 = lambda: mat("Paint2", (0.08, 0.08, 0.08), 0.4, 0.3)
GLASS = lambda: mat("Glass", (0.12, 0.16, 0.2), 0.0, 0.05, alpha=0.35)
CHROME = lambda: mat("Chrome", (0.9, 0.9, 0.92), 1.0, 0.12)
GRILLE = lambda: mat("Grille", (0.05, 0.05, 0.06), 0.6, 0.5)
HEAD = lambda: mat("Lamp_Head", (1.0, 0.95, 0.8), 0.0, 0.2, emit=(1.0, 0.92, 0.7), emit_strength=2.0)
TAIL = lambda: mat("Lamp_Tail", (0.7, 0.02, 0.02), 0.0, 0.3, emit=(1.0, 0.05, 0.02), emit_strength=1.5)
INTERIOR = lambda: mat("Interior", (0.09, 0.08, 0.08), 0.0, 0.8)
SEAT = lambda: mat("Seat", (0.35, 0.06, 0.05), 0.0, 0.6)
PLATE = lambda: mat("Plate", (0.95, 0.92, 0.75), 0.0, 0.6)
DARK = lambda: mat("Undercarriage", (0.03, 0.03, 0.03), 0.2, 0.9)
SKIN = lambda: mat("Skin", (0.85, 0.62, 0.48), 0.0, 0.7)
GLOVE = lambda: mat("Glove", (0.12, 0.1, 0.09), 0.0, 0.8)


def arch(zc, yc, R, yb, n=9):
    phi0 = math.asin(max(-1.0, min(1.0, (yb - yc) / R)))
    return [(zc + R * math.cos(phi0 + (math.pi - 2 * phi0) * i / n),
             yc + R * math.sin(phi0 + (math.pi - 2 * phi0) * i / n)) for i in range(n + 1)]


def torus_bm(bm, R, r, center, seg=28, rseg=8):
    """Torus in game XY plane (normal +z)."""
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring = []
        for j in range(rseg):
            b = 2 * math.pi * j / rseg
            rr = R + r * math.cos(b)
            ring.append(bm.verts.new(Vector(center) + Vector((rr * math.cos(a), rr * math.sin(a), r * math.sin(b)))))
        rings.append(ring)
    for i in range(seg):
        for j in range(rseg):
            a, b = rings[i], rings[(i + 1) % seg]
            bm.faces.new((a[j], a[(j + 1) % rseg], b[(j + 1) % rseg], b[j]))


# ============================================================================ CARS
SPECS = {
    "muscle": dict(
        label="Classic American Muscle", W=1.90, r=0.36, wx=0.80, af=1.45, ar=-1.45, yb=0.30, R=0.45,
        front=[(2.36, 0.30)], rear=[(-2.32, 0.30), (-2.44, 0.42), (-2.47, 0.80), (-2.32, 0.95), (-1.22, 0.98),
                                    (-0.98, 0.98), (-0.98, 0.46), (0.70, 0.46), (0.70, 0.98), (0.80, 0.98),
                                    (2.36, 0.90), (2.46, 0.66), (2.44, 0.38)],
        glass=[(0.70, 0.97), (0.02, 1.34), (-0.85, 1.34), (-1.22, 0.97)], cw=1.66,
        roof=[(0.08, 1.315), (0.0, 1.37), (-0.86, 1.37), (-0.92, 1.315)],
        pillars=[((0.70, 0.97), (0.02, 1.34), 0.07), ((-1.22, 0.97), (-0.85, 1.34), 0.16)],
        doors=[("Door", 0.70, -0.60, 0.40, 0.985)], quarters=[(-0.60, -0.98, 0.45, 0.98)],
        hood=[(0.81, 0.955), (0.81, 1.005), (2.37, 0.925), (2.37, 0.875)], hood_pivot=(0, 0.99, 0.81),
        trunk=[(-1.23, 0.955), (-1.23, 1.005), (-2.34, 0.975), (-2.34, 0.925)], trunk_pivot=(0, 0.99, -1.23),
        trunk_open=1.05, trunk_name="Trunk",
        bumper_f=(0.40, 2.45), bumper_r=(0.40, -2.47), grille=(0.66, 2.455, 1.1, 0.22),
        heads=[(0.72, 0.70, 2.44, 'round'), (0.52, 0.70, 2.45, 'round')], tails=[(0.55, 0.78, -2.465, 0.55, 0.11)],
        dash_z=0.60, seat_front=-0.15, seat_rear=-0.78, bench_rear=True, driver_x=0.40, floor=0.46, belt=0.98,
        anchor_hood=(0, 0.965, 1.55), anchor_roof=(0, 1.37, -0.40), anchor_rear=(0, 0.985, -2.15),
        anchor_rear_parent="Trunk", anchor_front=(0, 0.40, 2.52), anchor_exhaust=(0, 0.30, -2.42),
        engine=(0, 0.62, 1.55), price=38000),
    "pickup": dict(
        label="Retro V8 Pickup Truck", W=2.00, r=0.42, wx=0.84, af=1.75, ar=-1.65, yb=0.45, R=0.52,
        front=[(2.62, 0.45)], rear=[(-2.62, 0.45), (-2.68, 0.60), (-2.66, 1.00), (-0.72, 1.00), (-0.72, 1.22),
                                    (-0.56, 1.22), (-0.56, 0.62), (0.95, 0.62), (0.95, 1.20), (1.02, 1.20),
                                    (2.60, 1.12), (2.68, 0.86), (2.66, 0.52)],
        glass=[(0.95, 1.19), (0.55, 1.78), (-0.45, 1.78), (-0.56, 1.19)], cw=1.80,
        roof=[(0.58, 1.75), (0.52, 1.82), (-0.47, 1.82), (-0.52, 1.75)],
        pillars=[((0.95, 1.19), (0.55, 1.78), 0.08), ((-0.56, 1.19), (-0.45, 1.78), 0.12)],
        doors=[("Door", 0.95, -0.50, 0.55, 1.205)], quarters=[],
        hood=[(1.03, 1.175), (1.03, 1.225), (2.61, 1.145), (2.61, 1.095)], hood_pivot=(0, 1.21, 1.03),
        trunk=[(-2.62, 0.98), (-2.62, 1.34), (-2.70, 1.34), (-2.70, 0.98)], trunk_pivot=(0, 1.0, -2.66),
        trunk_open=-1.5, trunk_name="Trunk", trunk_hinge_note="tailgate",
        bumper_f=(0.58, 2.70), bumper_r=(0.62, -2.72), grille=(0.95, 2.67, 1.5, 0.35),
        heads=[(0.74, 0.98, 2.68, 'round')], tails=[(0.92, 1.12, -2.71, 0.12, 0.25)],
        dash_z=0.85, seat_front=0.05, seat_rear=None, bench_rear=False, driver_x=0.42, floor=0.62, belt=1.20,
        anchor_hood=(0, 1.19, 1.85), anchor_roof=(0, 1.82, 0.05), anchor_rear=(0, 1.34, -2.50),
        anchor_rear_parent="Body", anchor_front=(0, 0.58, 2.80), anchor_exhaust=(0, 0.45, -2.66),
        engine=(0, 0.85, 1.85), price=34000),
    "coupe": dict(
        label="Modern Street Coupe", W=1.88, r=0.34, wx=0.79, af=1.38, ar=-1.35, yb=0.24, R=0.42,
        front=[(2.20, 0.24)], rear=[(-2.18, 0.24), (-2.28, 0.36), (-2.30, 0.68), (-2.18, 0.88), (-1.05, 0.92),
                                    (-0.90, 0.92), (-0.90, 0.42), (0.62, 0.42), (0.62, 0.88), (0.70, 0.88),
                                    (2.18, 0.64), (2.30, 0.46), (2.30, 0.30)],
        glass=[(0.62, 0.87), (-0.12, 1.22), (-0.62, 1.22), (-1.05, 0.91)], cw=1.62,
        roof=[(-0.08, 1.20), (-0.14, 1.255), (-0.62, 1.255), (-0.70, 1.20)],
        pillars=[((0.62, 0.87), (-0.12, 1.22), 0.06), ((-1.05, 0.91), (-0.62, 1.22), 0.22)],
        doors=[("Door", 0.62, -0.62, 0.34, 0.885)], quarters=[(-0.62, -0.90, 0.41, 0.92)],
        hood=[(0.71, 0.855), (0.71, 0.905), (2.19, 0.665), (2.19, 0.615)], hood_pivot=(0, 0.89, 0.71),
        trunk=[(-1.06, 0.895), (-1.06, 0.945), (-2.19, 0.905), (-2.19, 0.855)], trunk_pivot=(0, 0.93, -1.06),
        trunk_open=1.0, trunk_name="Trunk",
        bumper_f=None, bumper_r=None, grille=(0.36, 2.29, 1.2, 0.14),
        heads=[(0.62, 0.60, 2.21, 'slim')], tails=[(0.0, 0.76, -2.295, 1.6, 0.06)],
        dash_z=0.52, seat_front=-0.20, seat_rear=None, bench_rear=False, driver_x=0.38, floor=0.42, belt=0.88,
        anchor_hood=(0, 0.79, 1.40), anchor_roof=(0, 1.255, -0.38), anchor_rear=(0, 0.92, -2.05),
        anchor_rear_parent="Trunk", anchor_front=(0, 0.28, 2.32), anchor_exhaust=(0, 0.26, -2.28),
        engine=(0, 0.52, 1.45), price=42000),
    "hearse": dict(
        label="Halloween Special: Custom Hot-Rod Hearse", W=2.00, r=0.38, wx=0.84, af=1.80, ar=-1.80, yb=0.32, R=0.47,
        front=[(2.92, 0.32)], rear=[(-2.88, 0.32), (-2.98, 0.45), (-2.96, 0.90), (-1.25, 0.90), (-1.25, 0.62),
                                    (0.95, 0.62), (0.95, 1.00), (1.02, 1.00), (2.88, 0.86), (2.98, 0.62), (2.96, 0.38)],
        glass=[(0.95, 0.99), (0.30, 1.48), (-0.45, 1.48), (-0.45, 0.99)], cw=1.80,
        roof=[(0.36, 1.46), (0.28, 1.54), (-2.92, 1.54), (-2.94, 1.46)], roof_w=1.96,
        pillars=[((0.95, 0.99), (0.30, 1.48), 0.07)],
        doors=[("Door", 0.95, -0.45, 0.40, 1.00)], quarters=[],
        rear_box=(-0.45, -2.90, 0.60, 1.50),
        hood=[(1.03, 0.975), (1.03, 1.025), (2.89, 0.885), (2.89, 0.835)], hood_pivot=(0, 1.01, 1.03),
        trunk=[(-2.90, 0.60), (-2.90, 1.46), (-2.97, 1.46), (-2.97, 0.60)], trunk_pivot=(0, 1.48, -2.935),
        trunk_open=1.3, trunk_name="Trunk",
        bumper_f=(0.42, 3.0), bumper_r=(0.42, -3.0), grille=(0.74, 2.97, 1.0, 0.30),
        heads=[(0.70, 0.80, 2.96, 'round')], tails=[(0.80, 0.80, -2.985, 0.14, 0.30)],
        dash_z=0.85, seat_front=0.05, seat_rear=None, bench_rear=False, driver_x=0.42, floor=0.62, belt=1.00,
        anchor_hood=(0, 0.95, 1.95), anchor_roof=(0, 1.54, -1.40), anchor_rear=(0, 1.54, -2.70),
        anchor_rear_parent="Body", anchor_front=(0, 0.42, 3.08), anchor_exhaust=(0, 0.32, -2.96),
        engine=(0, 0.78, 1.95), price=66600),
    "sedan": dict(
        label="Town Sedan (civilian / police)", W=1.92, r=0.36, wx=0.81, af=1.50, ar=-1.50, yb=0.30, R=0.45,
        front=[(2.42, 0.30)], rear=[(-2.40, 0.30), (-2.52, 0.42), (-2.54, 0.82), (-2.42, 0.98), (-1.50, 1.00),
                                    (-1.02, 1.00), (-1.02, 0.46), (0.95, 0.46), (0.95, 1.00), (1.02, 1.00),
                                    (2.45, 0.88), (2.52, 0.64), (2.50, 0.38)],
        glass=[(0.95, 0.99), (0.30, 1.45), (-0.95, 1.45), (-1.50, 0.99)], cw=1.70,
        roof=[(0.36, 1.42), (0.28, 1.48), (-0.96, 1.48), (-1.03, 1.42)],
        pillars=[((0.95, 0.99), (0.30, 1.45), 0.07), ((-0.25, 0.99), (-0.25, 1.45), 0.08), ((-1.50, 0.99), (-0.95, 1.45), 0.14)],
        doors=[("Door", 0.95, -0.25, 0.40, 0.995), ("DoorRear", -0.25, -1.02, 0.40, 0.995)], quarters=[],
        hood=[(1.03, 0.975), (1.03, 1.025), (2.46, 0.905), (2.46, 0.855)], hood_pivot=(0, 1.01, 1.03),
        trunk=[(-1.51, 0.975), (-1.51, 1.025), (-2.43, 1.005), (-2.43, 0.955)], trunk_pivot=(0, 1.01, -1.51),
        trunk_open=1.05, trunk_name="Trunk",
        bumper_f=(0.40, 2.53), bumper_r=(0.40, -2.55), grille=(0.66, 2.52, 1.0, 0.2),
        heads=[(0.66, 0.70, 2.50, 'rect')], tails=[(0.62, 0.80, -2.545, 0.42, 0.14)],
        dash_z=0.85, seat_front=0.0, seat_rear=-0.78, bench_rear=True, driver_x=0.40, floor=0.46, belt=1.00,
        anchor_hood=(0, 0.96, 1.75), anchor_roof=(0, 1.48, -0.30), anchor_rear=(0, 1.0, -2.25),
        anchor_rear_parent="Trunk", anchor_front=(0, 0.40, 2.60), anchor_exhaust=(0, 0.30, -2.52),
        engine=(0, 0.62, 1.75), price=24000),
}


def build_car(key, s):
    reset_scene()
    W, hw, r = s["W"], s["W"] / 2, s["r"]
    root = empty("Car_" + key, (0, 0, 0), props={
        "archetype": key, "label": s["label"], "W": W, "wheel_radius": r, "wheel_x": s["wx"],
        "axle_f": s["af"], "axle_r": s["ar"], "yb": s["yb"], "price": s["price"]})
    prof = list(s["front"]) + arch(s["af"], r, s["R"], s["yb"]) + arch(s["ar"], r, s["R"], s["yb"]) + list(s["rear"])
    body = profile("Body", prof, -hw, hw, PAINT(), (0, 0, 0), root, bevel=0.045)
    # wheel-well liners hide the see-through arches
    for zc in (s["af"], s["ar"]):
        top = r + s["R"] - 0.02
        box("WheelWell_%s" % ("F" if zc > 0 else "R"), (2 * (s["wx"] - 0.16), top - s["yb"], 2 * s["R"] * 0.92),
            (0, (top + s["yb"]) / 2, zc), DARK(), pivot=(0, 0, 0), parent=body)
    box("Underbody", (W - 0.3, 0.06, abs(s["front"][0][0]) + abs(s["rear"][0][0]) - 0.4),
        (0, s["yb"] + 0.02, (s["front"][0][0] + s["rear"][0][0]) / 2), DARK(), pivot=(0, 0, 0), parent=body)
    cw = s["cw"]
    profile("Cabin_Glass", s["glass"], -cw / 2, cw / 2, GLASS(), (0, 0, 0), body, bevel=0.03)
    rw = s.get("roof_w", cw + 0.03)
    profile("Roof", s["roof"], -rw / 2, rw / 2, PAINT2(), (0, 0, 0), body, bevel=0.02)
    segs = []
    for (a, b, t) in s["pillars"]:
        for sx in (1, -1):
            segs.append(((sx * cw / 2, a[1], a[0]), (sx * cw / 2, b[1], b[0]), t))
    beams("Pillars", segs, 0.07, PAINT2(), (0, 0, 0), body)
    for (z0, z1, y0, y1) in s["quarters"]:
        boxes("Quarters", [((0.05, y1 - y0, z0 - z1), (sx * (hw - 0.02), (y0 + y1) / 2, (z0 + z1) / 2)) for sx in (1, -1)],
              PAINT(), (0, 0, 0), body)
    if "rear_box" in s:  # hearse coach: side walls, curtained windows, landau bars, coffin
        z0, z1, y0, y1 = s["rear_box"]
        boxes("Coach_Walls", [((0.06, y1 - y0, z0 - z1), (sx * (hw - 0.025), (y0 + y1) / 2, (z0 + z1) / 2)) for sx in (1, -1)],
              PAINT(), (0, 0, 0), body)
        boxes("Coach_Curtains", [((0.02, 0.30, 1.0), (sx * (hw + 0.012), 1.25, -1.5)) for sx in (1, -1)],
              mat("Curtain", (0.25, 0.05, 0.35), 0.0, 0.9), (0, 0, 0), body)
        bars = []
        for sx in (1, -1):
            x = sx * (hw + 0.02)
            bars += [((x, 1.35, -2.15), (x, 1.15, -2.35), 0.035), ((x, 1.15, -2.35), (x, 1.0, -2.25), 0.035),
                     ((x, 1.35, -2.15), (x, 1.40, -2.40), 0.03)]
            bars += [((x, 1.06, -1.0), (x, 1.06, -2.0), 0.03), ((x, 1.44, -1.0), (x, 1.44, -2.0), 0.03)]
        beams("Landau_Bars", bars, 0.03, CHROME(), (0, 0, 0), body)
        coffin = box("Coffin", (0.62, 0.30, 1.9), (0, 1.06, -1.95), mat("Wood", (0.22, 0.11, 0.05), 0.0, 0.45), pivot=(0, 0.91, -1.95), parent=body)
        boxes("Coffin_Handles", [((0.03, 0.05, 0.25), (sx * 0.325, 1.06, z)) for sx in (1, -1) for z in (-1.4, -2.4)],
              mat("Brass", (0.8, 0.6, 0.2), 1.0, 0.3), (0, 0.91, -1.95), coffin)
        beams("Tail_Fins", [((sx * (hw - 0.05), 0.90, -2.2), (sx * (hw - 0.05), 1.18, -2.95), 0.07, 0.02) for sx in (1, -1)],
              0.07, PAINT2(), (0, 0, 0), body)
    if key == "pickup":
        boxes("Bed_Walls", [((0.08, 0.36, 1.92), (sx * (hw - 0.035), 1.16, -1.68)) for sx in (1, -1)] +
              [((W - 0.1, 0.36, 0.08), (0, 1.16, -0.76))], PAINT(), (0, 0, 0), body)
        boxes("Bed_Rails", [((0.10, 0.03, 1.92), (sx * (hw - 0.035), 1.355, -1.68)) for sx in (1, -1)], CHROME(), (0, 0, 0), body)
        box("Bed_Liner", (W - 0.2, 0.02, 1.86), (0, 1.005, -1.68), mat("BedLiner", (0.06, 0.06, 0.06), 0.0, 0.95), pivot=(0, 0, 0), parent=body)

    # ---- hinged panels
    hood = profile("Hood", s["hood"], -(hw - 0.07), hw - 0.07, PAINT(), s["hood_pivot"], body, bevel=0.015,
                   props={"hinge": "x", "open": -0.95})
    trunk = profile(s["trunk_name"], s["trunk"], -(hw - 0.07 if key != "pickup" else hw - 0.01),
                    hw - 0.07 if key != "pickup" else hw - 0.01, PAINT(), s["trunk_pivot"], body, bevel=0.015,
                    props={"hinge": "x", "open": s["trunk_open"]})
    if key == "hearse":
        box("Liftgate_Window", (1.2, 0.4, 0.02), (0, 1.18, -2.98), mat("Curtain", (0.25, 0.05, 0.35)), pivot=s["trunk_pivot"], parent=trunk)
    for (nm, zf, zb, y0, y1) in s["doors"]:
        for side, sx in (("L", 1), ("R", -1)):
            x0, x1 = (hw - 0.05, hw + 0.025) if sx > 0 else (-(hw + 0.025), -(hw - 0.05))
            poly = [(zf, y0), (zf, y1), (zb + 0.02, y1), (zb, y1 - 0.05), (zb, y0)]
            d = profile("%s_%s" % (nm, side), poly, x0, x1, PAINT(), (sx * hw, (y0 + y1) / 2, zf), body, bevel=0.012,
                        props={"hinge": "y", "open": -1.1 * sx})
            box("%s_%s_Handle" % (nm, side), (0.02, 0.03, 0.14), (sx * (hw + 0.035), y1 - 0.12, zb + 0.18), CHROME(),
                pivot=(sx * hw, (y0 + y1) / 2, zf), parent=d)
            if nm == "Door":
                mz = zf - 0.12
                boxes("%s_%s_Mirror" % (nm, side), [((0.16, 0.09, 0.1), (sx * (hw + 0.12), y1 + 0.08, mz)),
                                                     ((0.1, 0.03, 0.04), (sx * (hw + 0.05), y1 + 0.03, mz))],
                      PAINT2(), (sx * hw, (y0 + y1) / 2, zf), d)
    # ---- trim, lights
    zf_front = s["front"][0][0]
    if s["bumper_f"]:
        y, z = s["bumper_f"]
        box("Bumper_F", (W + 0.03, 0.16, 0.16), (0, y, z), CHROME(), pivot=(0, 0, 0), parent=body)
        y, z = s["bumper_r"]
        box("Bumper_R", (W + 0.03, 0.16, 0.16), (0, y, z), CHROME(), pivot=(0, 0, 0), parent=body)
        box("Plate_R", (0.32, 0.16, 0.02), (0, y + 0.17, z + (0.03 if z < 0 else -0.03) - 0.02), PLATE(), pivot=(0, 0, 0), parent=body)
    else:
        box("Splitter_Stock", (W - 0.1, 0.06, 0.25), (0, s["yb"] + 0.02, zf_front - 0.02), GRILLE(), pivot=(0, 0, 0), parent=body)
        box("Diffuser", (W - 0.4, 0.12, 0.2), (0, s["yb"] + 0.08, s["rear"][0][0] - 0.03), GRILLE(), pivot=(0, 0, 0), parent=body)
        box("Plate_R", (0.32, 0.16, 0.02), (0, 0.55, -2.31), PLATE(), pivot=(0, 0, 0), parent=body)
    gy, gz, gw, gh = s["grille"]
    box("Grille", (gw, gh, 0.05), (0, gy, gz), GRILLE(), pivot=(0, 0, 0), parent=body)
    if key in ("muscle", "pickup", "hearse"):
        beams("Grille_Bars", [((-gw / 2, gy + dy, gz + 0.03), (gw / 2, gy + dy, gz + 0.03), 0.025) for dy in (-gh / 3, 0, gh / 3)],
              0.025, CHROME(), (0, 0, 0), body)
    hbm = []
    for (hx, hy, hz, kind) in s["heads"]:
        for sx in (1, -1):
            if kind == 'round':
                cyl("Headlight_%s%d" % ("L" if sx > 0 else "R", len(hbm)), 0.09, 0.06, (sx * hx, hy, hz), HEAD(), axis='z', seg=16, pivot=(0, 0, 0), parent=body)
                cyl("Headlight_Ring_%s%d" % ("L" if sx > 0 else "R", len(hbm)), 0.105, 0.04, (sx * hx, hy, hz - 0.015), CHROME(), axis='z', seg=16, pivot=(0, 0, 0), parent=body)
            elif kind == 'slim':
                box("Headlight_%s" % ("L" if sx > 0 else "R"), (0.5, 0.07, 0.06), (sx * hx, hy, hz), HEAD(), pivot=(0, 0, 0), parent=body)
            else:
                box("Headlight_%s" % ("L" if sx > 0 else "R"), (0.32, 0.14, 0.05), (sx * hx, hy, hz), HEAD(), pivot=(0, 0, 0), parent=body)
        hbm.append(1)
    for (tx, ty, tz, tw, th) in s["tails"]:
        if tx == 0:
            box("Taillight_Bar", (tw, th, 0.04), (0, ty, tz), TAIL(), pivot=(0, 0, 0), parent=body)
        else:
            for sx in (1, -1):
                box("Taillight_%s" % ("L" if sx > 0 else "R"), (tw, th, 0.04), (sx * tx, ty, tz), TAIL(), pivot=(0, 0, 0), parent=body)
    # ---- interior
    fl, belt, dz, dx = s["floor"], s["belt"], s["dash_z"], s["driver_x"]
    box("Dashboard", (s["cw"] - 0.05, 0.22, 0.2), (0, belt - 0.13, dz), INTERIOR(), pivot=(0, 0, 0), parent=body)
    box("Floor_Carpet", (W - 0.14, 0.03, 0.9), (0, fl + 0.005, dz - 0.5), INTERIOR(), pivot=(0, 0, 0), parent=body)
    sf = s["seat_front"]
    for sx in (1, -1):
        boxes("Seat_%s" % ("L" if sx > 0 else "R"),
              [((0.5, 0.12, 0.5), (sx * dx, fl + 0.14, sf)),
               ((0.5, 0.56, 0.12), (sx * dx, fl + 0.46, sf - 0.27), Matrix.Rotation(math.radians(-12), 3, 'X'))],
              SEAT(), (sx * dx, fl, sf), body)
    if s["bench_rear"]:
        boxes("Seat_Rear", [((1.4, 0.12, 0.42), (0, fl + 0.14, s["seat_rear"])),
                            ((1.4, 0.5, 0.1), (0, fl + 0.42, s["seat_rear"] - 0.22))], SEAT(), (0, fl, s["seat_rear"]), body)
    col_p = (dx, belt - 0.05, dz - 0.2)
    beams("Steering_Shaft", [((dx, belt - 0.12, dz - 0.05), col_p, 0.05)], 0.05, INTERIOR(), (0, 0, 0), body)
    col = empty("SteeringColumn", col_p, body)
    col.rotation_euler = (-0.45, 0, 0)
    bm = bmesh.new()
    torus_bm(bm, 0.18, 0.022, col_p)
    sw = mesh_from_bm("SteeringWheel", bm, col_p, mat("SteeringRim", (0.08, 0.06, 0.05), 0.0, 0.5), col,
                      props={"hinge": "z", "steer_ratio": 6.0})
    beams("SteeringWheel_Spokes", [((col_p[0], col_p[1], col_p[2]), (col_p[0] + 0.17 * math.cos(a), col_p[1] + 0.17 * math.sin(a), col_p[2]), 0.025)
                                   for a in (math.radians(-90), math.radians(30), math.radians(150))], 0.025, CHROME(), col_p, sw)
    cyl("SteeringWheel_Hub", 0.045, 0.04, col_p, CHROME(), axis='z', seg=12, pivot=col_p, parent=sw)
    for side, hx in (("L", 1), ("R", -1)):
        hp = (col_p[0] + hx * 0.17, col_p[1] + 0.01, col_p[2] - 0.02)
        sphere("FP_Hand_%s" % side, 0.045, hp, GLOVE(), pivot=col_p, parent=sw, scale=(1.0, 1.2, 0.9), seg=10)
        beams("FP_Arm_%s" % side, [(hp, (hp[0] + hx * 0.06, hp[1] - 0.14, hp[2] - 0.3), 0.07)], 0.07,
              mat("Jacket", (0.15, 0.13, 0.12), 0.0, 0.8), col_p, sw)
    empty("FP_Eye", (dx, belt + 0.22 if key != "pickup" else belt + 0.25, sf - 0.12), body)
    empty("Seat_Driver", (dx, fl + 0.2, sf), body)
    # ---- wheels: knuckle (steer, suspension, camber) -> axle (spin)
    for nm, sx, z in (("FL", 1, s["af"]), ("FR", -1, s["af"]), ("RL", 1, s["ar"]), ("RR", -1, s["ar"])):
        k = empty("Knuckle_" + nm, (sx * s["wx"], r, z), root, props={"hinge": "y", "steer": 1 if nm[0] == "F" else 0})
        empty("Axle_" + nm, (sx * s["wx"], r, z), k, props={"hinge": "x"})
    # ---- mod anchors
    empty("Anchor_Hood", s["anchor_hood"], hood)
    empty("Anchor_Roof", s["anchor_roof"], body)
    empty("Anchor_Rear", s["anchor_rear"], trunk if s["anchor_rear_parent"] == "Trunk" else body)
    empty("Anchor_Front", s["anchor_front"], body)
    empty("Anchor_Exhaust", s["anchor_exhaust"], body)
    empty("EngineBay", s["engine"], body)
    export_glb("car_%s.glb" % key)
    # preview with doors/hood/trunk open to prove the hinges
    hood.rotation_euler = (-0.95, 0, 0)
    trunk.rotation_euler = (s["trunk_open"], 0, 0)
    for ob in bpy.data.objects:
        if ob.name.startswith("Door_L") and "Handle" not in ob.name and "Mirror" not in ob.name:
            ob.rotation_euler = (0, 0, -1.1)  # game Y == blender Z
    for nm, sx, z in (("FL", 1, s["af"]), ("FR", -1, s["af"]), ("RL", 1, s["ar"]), ("RR", -1, s["ar"])):
        cyl("PreviewTire_" + nm, r, 0.26, (sx * s["wx"], r, z), mat("Rubber", (0.04, 0.04, 0.045), 0, 0.9), axis='x', seg=24)
    render_preview("blender_car_%s.png" % key, elev=18, azim=40, dist_mul=0.6)


# =========================================================================== PARTS
def build_parts():
    reset_scene()
    root = empty("Parts", (0, 0, 0))
    P, P2, C, G = PAINT(), PAINT2(), CHROME(), GRILLE()
    # Every part's origin is its anchor point. Parts are spread out along x only for the preview.
    def grp(name, x, kind):
        return empty(name, (x, 0, 0), root, props={"slot": kind})

    g = grp("Hood_Cowl", 0, "hood")
    profile("Hood_Cowl_Mesh", [(0.5, -0.01), (0.5, 0.04), (-0.55, 0.12), (-0.62, 0.0)], -0.3, 0.3, P, (0, 0, 0), g, bevel=0.03)
    g = grp("Hood_TwinScoop", 3, "hood")
    for sx in (1, -1):
        profile("Scoop_%d" % sx, [(0.35, -0.01), (0.25, 0.10), (-0.25, 0.13), (-0.3, -0.01)], 3 + sx * 0.32 - 0.13, 3 + sx * 0.32 + 0.13, P, (3, 0, 0), g, bevel=0.02)
        box("Scoop_Mouth_%d" % sx, (0.2, 0.08, 0.02), (3 + sx * 0.32, 0.06, 0.25), G, pivot=(3, 0, 0), parent=g)
    g = grp("Hood_Blower", 6, "hood")
    box("Blower_Case", (0.42, 0.22, 0.75), (6, 0.11, 0), C, pivot=(6, 0, 0), parent=g)
    boxes("Blower_Ribs", [((0.46, 0.03, 0.05), (6, 0.12, z)) for z in (-0.3, -0.15, 0, 0.15, 0.3)], C, (6, 0, 0), g)
    box("Blower_Scoop", (0.38, 0.12, 0.42), (6, 0.28, -0.05), mat("BlowerScoop", (0.1, 0.1, 0.1), 0.7, 0.4), pivot=(6, 0, 0), parent=g)
    for z in (-0.12, 0.08):
        cyl("Blower_Hat_%d" % int(z * 100), 0.09, 0.08, (6, 0.38, z), C, seg=12, pivot=(6, 0, 0), parent=g)
    pul = cyl("Blower_Pulley", 0.11, 0.06, (6, 0.11, 0.42), C, axis='z', seg=18, pivot=(6, 0.11, 0.42), parent=g,
              props={"hinge": "z", "spin": 1})
    boxes("Blower_Pulley_Spokes", [((0.2, 0.025, 0.02), (6, 0.11, 0.455)), ((0.025, 0.2, 0.02), (6, 0.11, 0.455))], G, (6, 0.11, 0.42), pul)
    cyl("Blower_Belt", 0.13, 0.04, (6, 0.0, 0.43), mat("Belt", (0.05, 0.05, 0.05), 0, 0.9), axis='z', seg=18, r2=0.13, pivot=(6, 0, 0.43), parent=g)
    # roof
    g = grp("Roof_Rack", 9, "roof")
    beams("Rack_Rails", [((9 + sx * 0.6, 0.06, 0.55), (9 + sx * 0.6, 0.06, -0.55), 0.04) for sx in (1, -1)] +
          [((8.4, 0.06, z), (9.6, 0.06, z), 0.035) for z in (0.5, 0, -0.5)] +
          [((9 + sx * 0.6, 0.0, z), (9 + sx * 0.6, 0.06, z), 0.04) for sx in (1, -1) for z in (0.5, -0.5)], 0.04, C, (9, 0, 0), g)
    box("Rack_Suitcase", (0.55, 0.22, 0.38), (9.2, 0.19, 0.15), mat("Leather", (0.4, 0.22, 0.1), 0, 0.7), pivot=(9, 0, 0), parent=g)
    box("Rack_Trunk", (0.45, 0.28, 0.32), (8.85, 0.22, -0.25), mat("Leather2", (0.2, 0.25, 0.3), 0, 0.7), pivot=(9, 0, 0), parent=g)
    for i, (px, pz) in enumerate(((8.7, 0.3), (9.35, -0.3))):
        lathe("Rack_Pumpkin_%d" % i, [(0.0, -0.11), (0.1, -0.09), (0.15, 0.0), (0.1, 0.09), (0.0, 0.11)], (px, 0.19, pz),
              mat("Pumpkin", (0.95, 0.42, 0.05), 0, 0.6), axis='y', seg=16, pivot=(9, 0, 0), parent=g, waves=(8, 0.08))
    g = grp("Roof_LightBar", 12, "roof")
    box("LightBar_Base", (1.3, 0.1, 0.18), (12, 0.08, 0), G, pivot=(12, 0, 0), parent=g)
    boxes("LightBar_Lamps", [((0.16, 0.1, 0.04), (12 + x, 0.09, 0.1)) for x in (-0.5, -0.3, -0.1, 0.1, 0.3, 0.5)],
          mat("Lamp_Aux", (1, 0.9, 0.6), 0, 0.2, emit=(1, 0.85, 0.5), emit_strength=3), (12, 0, 0), g)
    g = grp("Roof_PoliceBar", 15, "roof")
    box("PoliceBar_Base", (1.25, 0.06, 0.28), (15, 0.04, 0), G, pivot=(15, 0, 0), parent=g)
    box("PoliceBar_Red", (0.55, 0.12, 0.25), (15.3, 0.13, 0), mat("Lamp_PoliceRed", (0.8, 0.05, 0.05), 0, 0.2, emit=(1, 0.05, 0.05), emit_strength=3), pivot=(15, 0, 0), parent=g)
    box("PoliceBar_Blue", (0.55, 0.12, 0.25), (14.7, 0.13, 0), mat("Lamp_PoliceBlue", (0.05, 0.1, 0.8), 0, 0.2, emit=(0.1, 0.2, 1), emit_strength=3), pivot=(15, 0, 0), parent=g)
    g = grp("Roof_Taxi", 18, "roof")
    profile("Taxi_Sign", [(0.15, 0.0), (0.15, 0.2), (-0.15, 0.2), (-0.15, 0.0)], 17.6, 18.4, mat("Lamp_Taxi", (1, 0.8, 0.1), 0, 0.3, emit=(1, 0.75, 0.1), emit_strength=1.5), (18, 0, 0), g, bevel=0.03)
    text_mesh("Taxi_Text", "TAXI", (18, 0.1, 0.16), 0.14, G, parent=g, depth=0.02)
    g = grp("Roof_Siren", 21, "roof")
    cyl("Siren_Base", 0.14, 0.05, (21, 0.03, 0), C, seg=14, pivot=(21, 0, 0), parent=g)
    sphere("Siren_Dome", 0.13, (21, 0.1, 0), mat("Lamp_PoliceRed", (0.8, 0.05, 0.05)), pivot=(21, 0, 0), parent=g, scale=(1, 1.1, 1))
    # rear spoilers (anchor on trunk / deck)
    g = grp("Spoiler_Lip", 24, "rear")
    profile("Lip_Mesh", [(0.12, 0.0), (0.0, 0.06), (-0.08, 0.08), (-0.1, 0.0)], 23.25, 24.75, P2, (24, 0, 0), g, bevel=0.01)
    g = grp("Spoiler_GT", 27, "rear")
    beams("GT_Posts", [((27 + sx * 0.55, 0.0, 0.0), (27 + sx * 0.55, 0.32, -0.08), 0.05) for sx in (1, -1)], 0.05, G, (27, 0, 0), g)
    profile("GT_Wing", [(0.1, 0.32), (0.08, 0.36), (-0.22, 0.38), (-0.25, 0.33)], 26.1, 27.9, P2, (27, 0, 0), g, bevel=0.01)
    boxes("GT_Endplates", [((0.02, 0.18, 0.4), (27 + sx * 0.91, 0.33, -0.07)) for sx in (1, -1)], P2, (27, 0, 0), g)
    g = grp("Spoiler_Ducktail", 30, "rear")
    profile("Ducktail_Mesh", [(0.3, 0.0), (0.0, 0.06), (-0.22, 0.17), (-0.26, 0.0)], 29.3, 30.7, P, (30, 0, 0), g, bevel=0.03)
    # front
    g = grp("Front_Splitter", 33, "front")
    profile("Splitter_Mesh", [(0.12, -0.18), (0.12, -0.15), (-0.2, -0.13), (-0.2, -0.18)], 32.1, 33.9, mat("Carbon", (0.04, 0.04, 0.05), 0.3, 0.35), (33, 0, 0), g)
    g = grp("Front_Bullbar", 36, "front")
    bb = []
    for sx in (1, -1):
        bb += [((36 + sx * 0.45, -0.25, 0.1), (36 + sx * 0.45, 0.45, 0.12), 0.07), ((36 + sx * 0.45, 0.45, 0.12), (36 + sx * 0.2, 0.55, 0.12), 0.07),
               ((36 + sx * 0.45, -0.05, 0.1), (36 + sx * 0.85, -0.05, 0.02), 0.06), ((36 + sx * 0.45, 0.25, 0.11), (36 + sx * 0.85, 0.2, 0.0), 0.06)]
    bb += [((35.8, 0.55, 0.12), (36.2, 0.55, 0.12), 0.07), ((35.55, 0.1, 0.12), (36.45, 0.1, 0.12), 0.06)]
    beams("Bullbar_Tubes", bb, 0.07, mat("BlackSteel", (0.05, 0.05, 0.05), 0.8, 0.4), (36, 0, 0), g)
    g = grp("Front_PushBumper", 39, "front")
    pb = [((39 + sx * 0.35, -0.2, 0.15), (39 + sx * 0.35, 0.35, 0.18), 0.08) for sx in (1, -1)]
    pb += [((38.6, y, 0.17), (39.4, y, 0.17), 0.07) for y in (-0.1, 0.12, 0.33)]
    beams("PushBumper_Tubes", pb, 0.08, mat("BlackSteel", (0.05, 0.05, 0.05)), (39, 0, 0), g)
    box("PushBumper_Pad", (0.85, 0.5, 0.05), (39, 0.08, 0.22), mat("RubberPad", (0.02, 0.02, 0.02), 0, 0.95), pivot=(39, 0, 0), parent=g)
    # exhausts (anchor at rear-bottom centre)
    g = grp("Exhaust_Stock", 42, "exhaust")
    cyl("Stock_Tip", 0.04, 0.2, (42.55, 0.0, 0.02), C, axis='z', seg=10, pivot=(42, 0, 0), parent=g)
    g = grp("Exhaust_Quad", 45, "exhaust")
    for sx in (1, -1):
        for dx in (0.1, -0.1):
            cyl("Quad_%d_%d" % (sx, int(dx * 10)), 0.05, 0.25, (45 + sx * 0.5 + dx, 0.02, 0.03), C, axis='z', seg=12, pivot=(45, 0, 0), parent=g)
    g = grp("Exhaust_Side", 48, "exhaust_side")
    # side pipes: origin at rear-bottom centre, run along rockers; game code scales x to the car width
    for sx in (1, -1):
        beams("SidePipe_%d" % sx, [((48 + sx * 1.02, 0.05, 0.6), (48 + sx * 1.02, 0.05, 3.2), 0.1)], 0.1, C, (48, 0, 0), g)
        cyl("SidePipe_Tip_%d" % sx, 0.06, 0.15, (48 + sx * 1.02, 0.05, 0.55), C, axis='z', seg=12, pivot=(48, 0, 0), parent=g)
        boxes("SidePipe_Shield_%d" % sx, [((0.05, 0.08, 1.4), (48 + sx * 1.06, 0.06, 1.9))], mat("Perforated", (0.6, 0.6, 0.6), 1, 0.4), (48, 0, 0), g)
    g = grp("Exhaust_Flame", 51, "exhaust")
    for sx in (1, -1):
        cyl("Flame_Tip_%d" % sx, 0.08, 0.3, (51 + sx * 0.45, 0.02, 0.0), C, axis='z', seg=14, r2=0.1, pivot=(51, 0, 0), parent=g)
        cyl("Flame_Cone_%d" % sx, 0.0, 0.7, (51 + sx * 0.45, 0.02, -0.45), mat("Flame", (1, 0.5, 0.1), 0, 0.5, emit=(1, 0.45, 0.05), emit_strength=6), axis='z', seg=10, r2=0.09,
            pivot=(51 + sx * 0.45, 0.02, -0.15), parent=g, props={"fx": "flame"})
    # engines (sit in EngineBay)
    for i, (nm, n_cyl, turbo) in enumerate((("Engine_V6", 3, False), ("Engine_V8", 4, False), ("Engine_TwinTurbo", 4, True))):
        x = 54 + i * 3
        g = grp(nm, x, "engine")
        box(nm + "_Block", (0.62, 0.4, 0.75), (x, 0.0, 0), mat("EngineBlock", (0.35, 0.05, 0.05) if i else (0.15, 0.15, 0.16), 0.6, 0.4), pivot=(x, 0, 0), parent=g)
        for sx in (1, -1):
            boxes(nm + "_Heads_%d" % sx, [((0.2, 0.16, 0.7), (x + sx * 0.25, 0.25, 0), Matrix.Rotation(math.radians(sx * -25), 3, 'Z'))], C, (x, 0, 0), g)
            for k in range(n_cyl):
                beams(nm + "_Header_%d_%d" % (sx, k), [((x + sx * 0.36, 0.1, -0.25 + k * 0.5 / max(1, n_cyl - 1)), (x + sx * 0.5, -0.2, -0.25 + k * 0.17), 0.04)], 0.04, mat("Header", (0.5, 0.4, 0.3), 1, 0.35), (x, 0, 0), g)
        box(nm + "_Intake", (0.3, 0.1, 0.55), (x, 0.28, 0), mat("EngineBlock", (0.35, 0.05, 0.05)), pivot=(x, 0, 0), parent=g)
        if turbo:
            for sx in (1, -1):
                lathe(nm + "_Turbo_%d" % sx, [(0.0, -0.08), (0.12, -0.06), (0.13, 0.0), (0.12, 0.06), (0.0, 0.08)], (x + sx * 0.42, 0.05, 0.3), C, axis='x', seg=14, pivot=(x, 0, 0), parent=g)
    export_glb("parts.glb")
    for i, g in enumerate([o for o in root.children]):  # preview only: lay parts out in a grid
        g.location = g2b(((i % 5) * 2.4, 0, -(i // 5) * 2.4))
    render_preview("blender_parts.png", elev=35, azim=20, dist_mul=0.8)


# ========================================================================== WHEELS
def build_wheels():
    reset_scene()
    root = empty("Wheels", (0, 0, 0))
    RUB = mat("Rubber", (0.04, 0.04, 0.045), 0.0, 0.9)
    C = CHROME()
    R, Wd = 0.36, 0.26  # unit wheel; game scales by archetype radius
    tire_prof = [(R - 0.11, -Wd / 2), (R - 0.03, -Wd / 2 - 0.005), (R - 0.005, -Wd / 2 + 0.03), (R, -Wd / 2 + 0.06),
                 (R, Wd / 2 - 0.06), (R - 0.005, Wd / 2 - 0.03), (R - 0.03, Wd / 2 + 0.005), (R - 0.11, Wd / 2)]

    def wheel(name, x, rim_fn):
        g = empty("Rim_" + name, (x, 0, 0), root, props={"slot": "rim"})
        lathe(name + "_Tire", tire_prof, (x, 0, 0), RUB, axis='x', seg=32, pivot=(x, 0, 0), parent=g, closed=True)
        rim_fn(g, x)
        return g

    def cragar(g, x):
        lathe("Cragar_Barrel", [(0.24, -0.12), (0.25, -0.1), (0.25, 0.1), (0.24, 0.12)], (x, 0, 0), C, axis='x', seg=28, pivot=(x, 0, 0), parent=g, smooth=False)
        cyl("Cragar_Face", 0.24, 0.03, (x + 0.1, 0, 0), mat("RimDark", (0.12, 0.12, 0.13), 0.7, 0.4), axis='x', seg=28, pivot=(x, 0, 0), parent=g)
        sp = [((x + 0.12, 0, 0), (x + 0.12, 0.23 * math.sin(a), 0.23 * math.cos(a)), 0.06) for a in [i * math.pi / 2.5 for i in range(5)]]
        beams("Cragar_Spokes", sp, 0.06, C, (x, 0, 0), g)
        cyl("Cragar_Cap", 0.06, 0.06, (x + 0.13, 0, 0), C, axis='x', seg=12, pivot=(x, 0, 0), parent=g)

    def deepdish(g, x):
        lathe("DeepDish_Lip", [(0.25, 0.13), (0.26, 0.12), (0.25, 0.0), (0.2, -0.02), (0.08, 0.0)], (x, 0, 0), C, axis='x', seg=28, pivot=(x, 0, 0), parent=g, smooth=False)
        sp = [((x + 0.0, 0, 0), (x + 0.02, 0.2 * math.sin(a), 0.2 * math.cos(a)), 0.035) for a in [i * math.pi / 4 for i in range(8)]]
        beams("DeepDish_Spokes", sp, 0.035, mat("Gold", (0.85, 0.65, 0.2), 1, 0.25), (x, 0, 0), g)

    def beadlock(g, x):
        cyl("Beadlock_Face", 0.23, 0.18, (x, 0, 0), mat("RimBlack", (0.03, 0.03, 0.03), 0.4, 0.6), axis='x', seg=24, pivot=(x, 0, 0), parent=g)
        lathe("Beadlock_Ring", [(0.2, 0.1), (0.25, 0.1), (0.25, 0.13), (0.2, 0.13)], (x, 0, 0), mat("BeadRed", (0.6, 0.05, 0.03), 0.6, 0.4), axis='x', seg=24, pivot=(x, 0, 0), parent=g, smooth=False)
        boxes("Beadlock_Bolts", [((0.02, 0.025, 0.025), (x + 0.135, 0.225 * math.sin(a), 0.225 * math.cos(a))) for a in [i * math.pi / 8 for i in range(16)]], C, (x, 0, 0), g)
        boxes("Beadlock_Holes", [((0.02, 0.06, 0.06), (x + 0.095, 0.13 * math.sin(a), 0.13 * math.cos(a))) for a in [i * math.pi / 3 for i in range(6)]], mat("Grille", (0.05, 0.05, 0.06)), (x, 0, 0), g)

    def multispoke(g, x):
        lathe("Multi_Barrel", [(0.24, -0.12), (0.25, 0.11), (0.24, 0.12)], (x, 0, 0), mat("RimGun", (0.25, 0.26, 0.28), 0.9, 0.25), axis='x', seg=28, pivot=(x, 0, 0), parent=g, smooth=False)
        sp = []
        for i in range(10):
            a = i * math.pi / 5
            sp.append(((x + 0.09, 0.05 * math.sin(a), 0.05 * math.cos(a)), (x + 0.07, 0.235 * math.sin(a + 0.12), 0.235 * math.cos(a + 0.12)), 0.03))
            sp.append(((x + 0.09, 0.05 * math.sin(a), 0.05 * math.cos(a)), (x + 0.07, 0.235 * math.sin(a - 0.12), 0.235 * math.cos(a - 0.12)), 0.03))
        beams("Multi_Spokes", sp, 0.03, mat("RimGun", (0.25, 0.26, 0.28)), (x, 0, 0), g)
        cyl("Multi_Hub", 0.06, 0.05, (x + 0.1, 0, 0), C, axis='x', seg=12, pivot=(x, 0, 0), parent=g)

    def sawblade(g, x):
        cyl("Saw_Disc", 0.235, 0.04, (x + 0.08, 0, 0), mat("SawSteel", (0.7, 0.72, 0.75), 1, 0.2), axis='x', seg=32, pivot=(x, 0, 0), parent=g)
        teeth = []
        for i in range(12):
            a = i * math.pi / 6
            teeth.append(((x + 0.1, 0.06 * math.sin(a), 0.06 * math.cos(a)), (x + 0.1, 0.22 * math.sin(a + 0.4), 0.22 * math.cos(a + 0.4)), 0.035))
        beams("Saw_Blades", teeth, 0.035, mat("SawBlack", (0.05, 0.05, 0.05), 0.6, 0.4), (x, 0, 0), g)
        cyl("Saw_Hub", 0.07, 0.06, (x + 0.11, 0, 0), mat("BeadRed", (0.6, 0.05, 0.03)), axis='x', seg=6, pivot=(x, 0, 0), parent=g)

    def pumpkin(g, x):
        lathe("Pumpkin_Rim", [(0.0, -0.1), (0.18, -0.08), (0.24, 0.0), (0.18, 0.1), (0.0, 0.12)], (x, 0, 0),
              mat("Pumpkin", (0.95, 0.42, 0.05), 0, 0.6), axis='x', seg=24, pivot=(x, 0, 0), parent=g, waves=(10, 0.06))
        glow = mat("Lamp_Pumpkin", (1, 0.6, 0.1), 0, 0.3, emit=(1, 0.55, 0.05), emit_strength=5)
        boxes("Pumpkin_Face", [((0.03, 0.06, 0.06), (x + 0.125, 0.06, 0.07), Matrix.Rotation(math.radians(45), 3, 'X')),
                               ((0.03, 0.06, 0.06), (x + 0.125, 0.06, -0.07), Matrix.Rotation(math.radians(45), 3, 'X')),
                               ((0.03, 0.04, 0.17), (x + 0.12, -0.07, 0.0))], glow, (x, 0, 0), g)
        cyl("Pumpkin_Stem", 0.025, 0.06, (x + 0.15, 0, 0), mat("Stem", (0.2, 0.3, 0.1), 0, 0.8), axis='x', seg=6, pivot=(x, 0, 0), parent=g)

    for i, (nm, fn) in enumerate((("Cragar", cragar), ("DeepDish", deepdish), ("Beadlock", beadlock),
                                  ("MultiSpoke", multispoke), ("Sawblade", sawblade), ("Pumpkin", pumpkin))):
        wheel(nm, i * 0.9, fn)
    # brake hardware: rotor spins with the axle, caliper is fixed to the knuckle
    rot = empty("Brake_Rotor", (6.0, 0, 0), root, props={"slot": "rotor"})
    cyl("Rotor_Disc", 0.2, 0.025, (6.0, 0, 0), mat("Rotor", (0.45, 0.45, 0.47), 1, 0.35), axis='x', seg=24, pivot=(6.0, 0, 0), parent=rot)
    cal = empty("Brake_Caliper", (6.9, 0, 0), root, props={"slot": "caliper"})
    boxes("Caliper_Body", [((0.08, 0.16, 0.1), (6.9, 0.14, -0.1), Matrix.Rotation(math.radians(30), 3, 'X'))],
          mat("Caliper", (0.8, 0.05, 0.03), 0.3, 0.4), (6.9, 0, 0), cal)
    export_glb("wheels.glb")
    for i, g in enumerate([o for o in root.children]):
        g.location = g2b((0, (i // 4) * 0.85, -(i % 4) * 0.85))
    render_preview("blender_wheels.png", elev=8, azim=75, dist_mul=0.75)


if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for k, s in SPECS.items():
        if not only or k in only:
            build_car(k, s)
    if not only or "parts" in only:
        build_parts()
    if not only or "wheels" in only:
        build_wheels()
    write_report("vehicles")
    print("VEHICLES_DONE")
