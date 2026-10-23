"""World assets: factory machines (articulated), buildings (with COL_ colliders), Halloween props.

Run: blender -b --factory-startup -P blender/build_world.py [-- name ...]
Joint conventions (glTF extras):  joint = 'x'|'y'|'z' rotation axis, 'ty' = translation along y,
hinge/open as for vehicles.  Nodes named COL_* are invisible box colliders (game turns them into
static physics boxes and hides them).
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector, Matrix
from mwlib import *
from mwlib import _bm_profile

random.seed(1031)
ROBOT = lambda: mat("Robot", (1.0, 0.42, 0.02), 0.3, 0.45)
JOINT = lambda: mat("RobotJoint", (0.12, 0.12, 0.13), 0.7, 0.35)
STEEL = lambda: mat("Steel", (0.45, 0.47, 0.5), 0.85, 0.35)
YELLOW = lambda: mat("SafetyYellow", (0.95, 0.75, 0.05), 0.1, 0.5)
BRICK = lambda: mat("Brick", (0.5, 0.2, 0.13), 0.0, 0.9)
CONCRETE = lambda: mat("Concrete", (0.5, 0.5, 0.48), 0.0, 0.95)
STONE = lambda: mat("Stone", (0.42, 0.42, 0.44), 0.0, 0.95)
MOSS = lambda: mat("MossStone", (0.3, 0.34, 0.28), 0.0, 1.0)
IRON = lambda: mat("Iron", (0.05, 0.05, 0.06), 0.7, 0.5)
WOOD = lambda: mat("Wood", (0.35, 0.2, 0.1), 0.0, 0.8)
WINDOW = lambda: mat("Window_Lit", (1.0, 0.75, 0.4), 0.0, 0.3, emit=(1.0, 0.65, 0.3), emit_strength=1.6)
WINDOW_D = lambda: mat("Window_Dark", (0.08, 0.1, 0.14), 0.3, 0.1)
ROOF = lambda: mat("Roof", (0.18, 0.16, 0.17), 0.0, 0.85)
TRIM = lambda: mat("Trim", (0.92, 0.9, 0.85), 0.0, 0.6)
SIDING = lambda: mat("Siding", (0.55, 0.6, 0.55), 0.0, 0.8)
COLM = lambda: mat("COL", (1, 0, 1), 0, 1)
PUMPKIN = lambda: mat("Pumpkin", (0.95, 0.42, 0.05), 0.0, 0.6)
GLOW = lambda: mat("Lamp_Pumpkin", (1, 0.6, 0.1), 0, 0.3, emit=(1, 0.55, 0.05), emit_strength=5)
LAMP = lambda: mat("Lamp_Street", (1, 0.85, 0.55), 0, 0.3, emit=(1, 0.75, 0.4), emit_strength=4)


def col(name, size, center, parent):
    return box("COL_" + name, size, center, COLM(), pivot=center, parent=parent)


def wall(name, a, b, h, t, mtl, parent, openings=(), y0=0.0, collide=True):
    """Axis-aligned wall from a=(x,z) to b=(x,z) with door/window openings [(s0,s1,top[,sill])] measured along the wall.
    Doors leave the gap open to the floor; windows (with a sill height) keep a sill piece below them."""
    ax = 'x' if abs(b[0] - a[0]) > abs(b[1] - a[1]) else 'z'
    L = abs((b[0] - a[0]) if ax == 'x' else (b[1] - a[1]))
    start = min(a[0], b[0]) if ax == 'x' else min(a[1], b[1])
    fixed = a[1] if ax == 'x' else a[0]
    cuts = sorted(openings)
    pieces = []
    cur = 0.0
    for cut in cuts:
        s0, s1, top = cut[0], cut[1], cut[2]
        if s0 > cur:
            pieces.append((cur, s0, y0, h))
        pieces.append((s0, s1, top, h))  # lintel
        if len(cut) > 3:
            pieces.append((s0, s1, y0, cut[3]))  # window sill
        cur = s1
    if cur < L:
        pieces.append((cur, L, y0, h))
    specs = []
    for (u0, u1, v0, v1) in pieces:
        if v1 - v0 < 0.01:
            continue
        c_u = start + (u0 + u1) / 2
        if ax == 'x':
            sz, ct = (u1 - u0, v1 - v0, t), (c_u, (v0 + v1) / 2, fixed)
        else:
            sz, ct = (t, v1 - v0, u1 - u0), (fixed, (v0 + v1) / 2, c_u)
        specs.append((sz, ct))
    ob = boxes(name, specs, mtl, (0, 0, 0), parent, uv_scale=0.5)
    if collide:
        for i, (sz, ct) in enumerate(specs):
            col("%s_%d" % (name, i), sz, ct, parent)
    return ob


def gable_roof(name, w, d, y, rise, overhang, mtl, parent, axis='x', pivot=(0, 0, 0), cx=0, cz=0):
    """Gable roof whose ridge runs along `axis`."""
    if axis == 'x':
        prof = [(cz + d / 2 + overhang, y), (cz, y + rise), (cz - d / 2 - overhang, y),
                (cz - d / 2 - overhang, y - 0.15), (cz, y + rise - 0.2), (cz + d / 2 + overhang, y - 0.15)]
        return profile(name, prof, cx - w / 2 - overhang, cx + w / 2 + overhang, mtl, pivot, parent)
    bm = bmesh.new()
    prof = [(cx + w / 2 + overhang, y), (cx, y + rise), (cx - w / 2 - overhang, y),
            (cx - w / 2 - overhang, y - 0.15), (cx, y + rise - 0.2), (cx + w / 2 + overhang, y - 0.15)]
    _bm_profile(bm, prof, cz - d / 2 - overhang, cz + d / 2 + overhang)
    # rotate profile so it runs along z: swap x<->z
    for v in bm.verts:
        v.co = Vector((v.co.z, v.co.y, v.co.x))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm, pivot, mtl, parent)


def gable_ends(name, w, d, y, rise, mtl, parent, axis='x', cx=0, cz=0):
    """Triangular wall infill under a gable roof."""
    bm = bmesh.new()
    for s in (1, -1):
        if axis == 'x':
            x = cx + s * (w / 2 - 0.1)
            vs = [bm.verts.new((x, y, cz + d / 2)), bm.verts.new((x, y + rise - 0.1, cz)), bm.verts.new((x, y, cz - d / 2))]
        else:
            z = cz + s * (d / 2 - 0.1)
            vs = [bm.verts.new((cx + w / 2, y, z)), bm.verts.new((cx, y + rise - 0.1, z)), bm.verts.new((cx - w / 2, y, z))]
        bm.faces.new(vs)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.2)
    return mesh_from_bm(name, bm, (0, 0, 0), mtl, parent)


def windows_row(name, xs, y, z, w, h, parent, facing='z', lit=True, frame=True, depth=0.06):
    specs, fr = [], []
    for x in xs:
        if facing == 'z':
            specs.append(((w, h, depth), (x, y, z)))
            if frame:
                fr += [((w + 0.16, 0.1, depth + 0.04), (x, y - h / 2 - 0.05, z)), ((w + 0.16, 0.1, depth + 0.04), (x, y + h / 2 + 0.05, z)),
                       ((0.08, h, depth + 0.04), (x - w / 2 - 0.04, y, z)), ((0.08, h, depth + 0.04), (x + w / 2 + 0.04, y, z)),
                       ((0.05, h, depth + 0.02), (x, y, z))]
        else:
            specs.append(((depth, h, w), (z, y, x)))
            if frame:
                fr += [((depth + 0.04, 0.1, w + 0.16), (z, y - h / 2 - 0.05, x)), ((depth + 0.04, 0.1, w + 0.16), (z, y + h / 2 + 0.05, x)),
                       ((depth + 0.04, h, 0.08), (z, y, x - w / 2 - 0.04)), ((depth + 0.04, h, 0.08), (z, y, x + w / 2 + 0.04))]
    m = WINDOW() if lit else WINDOW_D()
    boxes(name, specs, m, (0, 0, 0), parent)
    if frame:
        boxes(name + "_Frames", fr, TRIM(), (0, 0, 0), parent)


# ================================================================ ENTERABLE INTERIOR KIT
# Naming contract with the game (src/world/buildings.js):
#   Pane_*            glazing (pulled into one instanced, shootable, lit/unlit glass mesh)
#   Door_* (hinge y)  hinged doors; their COL_Door_* child collider follows the swing
#   Switch_* / SwitchLever_*  wall light switches;  Fixture_* (Lamp_Interior) + LightIn_*  interior lights
#   Doorbell, Breaker_Box / BreakerLever, Phone   house interactions
#   Loot_<Kind>_<n>, Shop_<Item>  spawn points for stealable loot and buyable items (custom prop "yaw")
#   Spot_*            navigation / NPC anchor points (doorways inside + outside, rooms)
PANE = lambda: mat("PaneGlass", (0.55, 0.68, 0.75), 0.2, 0.08, alpha=0.4)
WALLPAPER = lambda: mat("Wallpaper", (0.78, 0.7, 0.58), 0, 0.85)
LAMP_IN = lambda: mat("Lamp_Interior", (1, 0.92, 0.75), 0, 0.3, emit=(1, 0.8, 0.5), emit_strength=3)
FLOORWOOD = lambda: mat("FloorWood", (0.42, 0.26, 0.14), 0, 0.55)
CEILING = lambda: mat("Ceiling", (0.86, 0.84, 0.8), 0, 0.9)
FABRIC = lambda: mat("Fabric", (0.35, 0.18, 0.12), 0, 0.95)
VINYL = lambda: mat("VinylRed", (0.7, 0.04, 0.06), 0.1, 0.35)
CHROME = lambda: mat("Chrome", (0.9, 0.9, 0.92), 1.0, 0.12)
DARKM = lambda: mat("DarkMetal", (0.08, 0.08, 0.09), 0.6, 0.4)


def openwall(name, a, b, h, t, mtl, parent, doors=(), windows=(), passthrough=(), y0=0.0, skin=None, frame=True, collide=True):
    """Wall from a to b (x,z) with doors [(c, width, height)], glazed windows [(c, width, sill, top)] and unglazed
    pass-throughs [(c, width, sill, top)]. Centres are absolute coordinates along the wall axis, heights absolute.
    skin=(material, sign) adds an interior finish on the +sign side of the wall."""
    ax = 'x' if abs(b[0] - a[0]) > abs(b[1] - a[1]) else 'z'
    start = min(a[0], b[0]) if ax == 'x' else min(a[1], b[1])
    fixed = a[1] if ax == 'x' else a[0]
    ops = [(c - w / 2 - start, c + w / 2 - start, y0 + hh) for (c, w, hh) in doors]
    ops += [(c - w / 2 - start, c + w / 2 - start, top, sill) for (c, w, sill, top) in list(windows) + list(passthrough)]
    wall(name, a, b, h, t, mtl, parent, ops, y0, collide=collide)
    if skin:
        off = skin[1] * (t / 2 + 0.012)
        a2 = (a[0], a[1] + off) if ax == 'x' else (a[0] + off, a[1])
        b2 = (b[0], b[1] + off) if ax == 'x' else (b[0] + off, b[1])
        wall(name + "_Skin", a2, b2, h, 0.02, skin[0], parent, ops, y0, collide=False)
    fr = []
    for i, (c, w, sill, top) in enumerate(list(windows) + list(passthrough)):
        glazed = i < len(windows)
        if ax == 'x':
            if glazed:
                box("Pane_%s_%d" % (name, i), (w, top - sill, 0.03), (c, (sill + top) / 2, fixed), PANE(), pivot=(c, (sill + top) / 2, fixed), parent=parent)
            if frame:
                fr += [((w + 0.12, 0.08, t + 0.06), (c, sill - 0.02, fixed)), ((w + 0.12, 0.08, t + 0.06), (c, top + 0.02, fixed)),
                       ((0.07, top - sill, t + 0.06), (c - w / 2 - 0.02, (sill + top) / 2, fixed)), ((0.07, top - sill, t + 0.06), (c + w / 2 + 0.02, (sill + top) / 2, fixed))]
                if glazed:
                    fr.append(((0.04, top - sill, 0.05), (c, (sill + top) / 2, fixed)))
        else:
            if glazed:
                box("Pane_%s_%d" % (name, i), (0.03, top - sill, w), (fixed, (sill + top) / 2, c), PANE(), pivot=(fixed, (sill + top) / 2, c), parent=parent)
            if frame:
                fr += [((t + 0.06, 0.08, w + 0.12), (fixed, sill - 0.02, c)), ((t + 0.06, 0.08, w + 0.12), (fixed, top + 0.02, c)),
                       ((t + 0.06, top - sill, 0.07), (fixed, (sill + top) / 2, c - w / 2 - 0.02)), ((t + 0.06, top - sill, 0.07), (fixed, (sill + top) / 2, c + w / 2 + 0.02))]
                if glazed:
                    fr.append(((0.05, top - sill, 0.04), (fixed, (sill + top) / 2, c)))
    for (c, w, hh) in doors:
        if frame and ax == 'x':
            fr += [((0.1, hh + 0.05, t + 0.08), (c - w / 2 - 0.05, y0 + hh / 2, fixed)), ((0.1, hh + 0.05, t + 0.08), (c + w / 2 + 0.05, y0 + hh / 2, fixed)),
                   ((w + 0.2, 0.1, t + 0.08), (c, y0 + hh + 0.05, fixed))]
        elif frame:
            fr += [((t + 0.08, hh + 0.05, 0.1), (fixed, y0 + hh / 2, c - w / 2 - 0.05)), ((t + 0.08, hh + 0.05, 0.1), (fixed, y0 + hh / 2, c + w / 2 + 0.05)),
                   ((t + 0.08, 0.1, w + 0.2), (fixed, y0 + hh + 0.05, c))]
    if fr:
        boxes(name + "_Trim", fr, TRIM(), (0, 0, 0), parent)
    return ax, fixed


def hinged_door(name, ax, fixed, c, w, hh, y0, inward, parent, mtl, glass=False, open_angle=1.45, knob=True):
    """Door hung on a vertical hinge at the low end of its opening; swings toward `inward` (x, z)."""
    if ax == 'x':
        hinge, size, ctr, mid = (c - w / 2, y0, fixed), (w - 0.04, hh - 0.03, 0.06), (c, y0 + hh / 2, fixed), (w / 2, 0.0)
    else:
        hinge, size, ctr, mid = (fixed, y0, c - w / 2), (0.06, hh - 0.03, w - 0.04), (fixed, y0 + hh / 2, c), (0.0, w / 2)
    th = open_angle
    rx = mid[0] * math.cos(th) + mid[1] * math.sin(th)
    rz = -mid[0] * math.sin(th) + mid[1] * math.cos(th)
    if (rx - mid[0]) * inward[0] + (rz - mid[1]) * inward[1] < 0:
        th = -th
    piv = empty(name, hinge, parent, props={"hinge": "y", "open": th})
    if glass:
        fr = [((size[0], 0.08, size[2] + 0.01), (ctr[0], y0 + 0.05, ctr[2])), ((size[0], 0.08, size[2] + 0.01), (ctr[0], y0 + hh - 0.06, ctr[2]))] if ax == 'x' else \
             [((size[0] + 0.01, 0.08, size[2]), (ctr[0], y0 + 0.05, ctr[2])), ((size[0] + 0.01, 0.08, size[2]), (ctr[0], y0 + hh - 0.06, ctr[2]))]
        boxes(name + "_Frame", fr, STEEL(), hinge, piv)
        box(name + "_Glass", (size[0] * (0.9 if ax == 'x' else 1), size[1] - 0.16, size[2] * (0.9 if ax != 'x' else 1)), ctr, PANE(), pivot=hinge, parent=piv)
    else:
        box(name + "_Panel", size, ctr, mtl, pivot=hinge, parent=piv)
        if ax == 'x':
            boxes(name + "_Insets", [((size[0] * 0.7, size[1] * 0.32, size[2] + 0.02), (ctr[0], y0 + hh * f, ctr[2])) for f in (0.3, 0.7)], TRIM(), hinge, piv)
        else:
            boxes(name + "_Insets", [((size[0] + 0.02, size[1] * 0.32, size[2] * 0.7), (ctr[0], y0 + hh * f, ctr[2])) for f in (0.3, 0.7)], TRIM(), hinge, piv)
    if knob:
        kp = (c + w / 2 - 0.12, y0 + 1.0, fixed) if ax == 'x' else (fixed, y0 + 1.0, c + w / 2 - 0.12)
        sphere(name + "_Knob", 0.04, kp, mat("Brass", (0.8, 0.6, 0.2), 1, 0.3), pivot=hinge, parent=piv, seg=8)
    col(name, size, ctr, piv)
    return piv


def light_switch(name, pos, facing, parent):
    """Wall switch plate + flippable lever. facing: direction the plate faces ('z', '-z', 'x', '-x')."""
    sw = empty("Switch_" + name, pos, parent, props={"facing": facing})
    n = {'z': (0, 0, 1), '-z': (0, 0, -1), 'x': (1, 0, 0), '-x': (-1, 0, 0)}[facing]
    if facing in ('z', '-z'):
        box("SwitchPlate_" + name, (0.09, 0.13, 0.015), pos, TRIM(), pivot=pos, parent=sw)
        lever = box("SwitchLever_" + name, (0.025, 0.05, 0.02), (pos[0], pos[1] + 0.012, pos[2] + n[2] * 0.012), mat("Bakelite", (0.9, 0.86, 0.75), 0, 0.4),
                    pivot=(pos[0], pos[1], pos[2] + n[2] * 0.01), parent=sw, props={"hinge": "x", "open": 0.7 * n[2]})
    else:
        box("SwitchPlate_" + name, (0.015, 0.13, 0.09), pos, TRIM(), pivot=pos, parent=sw)
        lever = box("SwitchLever_" + name, (0.02, 0.05, 0.025), (pos[0] + n[0] * 0.012, pos[1] + 0.012, pos[2]), mat("Bakelite", (0.9, 0.86, 0.75), 0, 0.4),
                    pivot=(pos[0] + n[0] * 0.01, pos[1], pos[2]), parent=sw, props={"hinge": "z", "open": -0.7 * n[0]})
    return sw


def fixture(name, pos, parent, pendant=False, color=None):
    m = LAMP_IN()
    if pendant:
        beams("FixtureCord_" + name, [((pos[0], pos[1] + 0.9, pos[2]), (pos[0], pos[1] + 0.12, pos[2]), 0.015)], 0.015, DARKM(), (0, 0, 0), parent)
        cyl("FixtureShade_" + name, 0.06, 0.22, (pos[0], pos[1], pos[2]), CHROME(), seg=14, r2=0.26, pivot=pos, parent=parent)
        sphere("Fixture_" + name, 0.09, (pos[0], pos[1] - 0.1, pos[2]), m, pivot=pos, parent=parent, seg=10)
    else:
        cyl("FixtureRim_" + name, 0.28, 0.03, (pos[0], pos[1] + 0.03, pos[2]), STEEL(), seg=16, pivot=pos, parent=parent)
        cyl("Fixture_" + name, 0.24, 0.06, pos, m, seg=16, pivot=pos, parent=parent)
    empty("LightIn_" + name, (pos[0], pos[1] - 0.35, pos[2]), parent, props={"color": color or "#ffc98a"})


def furn(name, size, center, mtl, parent, collide=True, rot=None):
    ob = box(name, size, center, mtl, pivot=center, parent=parent, rot=rot)
    if collide:
        col(name, size, center, parent)
    return ob


def tiles(name, x0, x1, z0, z1, y, s, mtl_a, mtl_b, parent):
    """Checkerboard of flat quads (two meshes, one per colour)."""
    bma, bmb = bmesh.new(), bmesh.new()
    nx, nz = int(round((x1 - x0) / s)), int(round((z1 - z0) / s))
    for i in range(nx):
        for j in range(nz):
            bm = bma if (i + j) % 2 == 0 else bmb
            xa, za = x0 + i * s, z0 + j * s
            bm.faces.new([bm.verts.new((xa, y, za)), bm.verts.new((xa, y, za + s)), bm.verts.new((xa + s, y, za + s)), bm.verts.new((xa + s, y, za))])
    mesh_from_bm(name + "_A", bma, (0, 0, 0), mtl_a, parent)
    mesh_from_bm(name + "_B", bmb, (0, 0, 0), mtl_b, parent)


def half_cyl(name, r, h, base, sx, mtl, parent, seg=16):
    """Vertical half-cylinder bulging toward +x (sx=1) or -x (sx=-1) from the plane x=base.x."""
    bm = bmesh.new()
    rings = []
    for y in (base[1], base[1] + h):
        rings.append([bm.verts.new((base[0] + sx * r * math.cos(a), y, base[2] + r * math.sin(a)))
                      for a in [-math.pi / 2 + math.pi * i / seg for i in range(seg + 1)]])
    lo, hi = rings
    for i in range(seg):
        bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))
    bm.faces.new(lo)
    bm.faces.new(list(reversed(hi)))
    bm.faces.new((lo[0], hi[0], hi[-1], lo[-1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm, (0, 0, 0), mtl, parent, smooth=True)


def spot(name, pos, parent, **props):
    return empty("Spot_" + name, pos, parent, props=props or None)


def loot(kind, n, pos, parent, yaw=0.0):
    return empty("Loot_%s_%d" % (kind, n), pos, parent, props={"yaw": yaw})


def shop(item, pos, parent, yaw=0.0, price=0):
    return empty("Shop_" + item, pos, parent, props={"yaw": yaw, "price": price})


def steps(name, x, z0, width, top, n, run, parent, direction=1, mtl=None):
    """Straight stair (rising along z when direction=+1 from z0) built from n boxes, each with its own collider."""
    rise = top / n
    for k in range(n):
        h = rise * (k + 1)
        zc = z0 + direction * (n - 1 - k + 0.5) * run
        furn("%s_%d" % (name, k), (width, h, run), (x, h / 2, zc), mtl or CONCRETE(), parent)


# ======================================================================= MACHINES
def build_robot_arm():
    reset_scene()
    root = empty("RobotArm", (0, 0, 0))
    base = cyl("Base", 0.55, 0.5, (0, 0.25, 0), JOINT(), seg=20, pivot=(0, 0, 0), parent=root, props={"joint": "y"})
    cyl("Base_Turret", 0.42, 0.45, (0, 0.72, 0), ROBOT(), seg=18, pivot=(0, 0, 0), parent=base)
    sh = cyl("Shoulder", 0.22, 0.6, (0, 0.95, 0), JOINT(), axis='x', seg=16, pivot=(0, 0.95, 0), parent=base, props={"joint": "x"})
    boxes("UpperArm", [((0.34, 1.5, 0.34), (0, 1.7, 0)), ((0.4, 0.3, 0.45), (0, 1.0, -0.1))], ROBOT(), (0, 0.95, 0), sh)
    el = cyl("Elbow", 0.18, 0.5, (0, 2.45, 0), JOINT(), axis='x', seg=16, pivot=(0, 2.45, 0), parent=sh, props={"joint": "x"})
    boxes("Forearm", [((0.26, 0.26, 1.35), (0, 2.45, 0.7)), ((0.3, 0.3, 0.3), (0, 2.45, -0.15))], ROBOT(), (0, 2.45, 0), el)
    wr = cyl("Wrist", 0.12, 0.34, (0, 2.45, 1.4), JOINT(), axis='x', seg=12, pivot=(0, 2.45, 1.4), parent=el, props={"joint": "x"})
    t = empty("Tool_Welder", (0, 2.45, 1.4), wr, props={"tool": "welder"})
    beams("Welder_Gun", [((0, 2.45, 1.4), (0, 2.25, 1.65), 0.12), ((0, 2.25, 1.65), (0, 1.95, 1.7), 0.06)], 0.1, STEEL(), (0, 2.45, 1.4), t)
    empty("Tip_Welder", (0, 1.93, 1.7), t)
    t = empty("Tool_Spray", (0, 2.45, 1.4), wr, props={"tool": "spray"})
    cyl("Spray_Body", 0.1, 0.3, (0, 2.45, 1.6), mat("SprayWhite", (0.9, 0.9, 0.9), 0.1, 0.4), axis='z', seg=12, pivot=(0, 2.45, 1.4), parent=t)
    cyl("Spray_Nozzle", 0.03, 0.12, (0, 2.45, 1.8), STEEL(), axis='z', seg=8, r2=0.05, pivot=(0, 2.45, 1.4), parent=t)
    empty("Tip_Spray", (0, 2.45, 1.88), t)
    t = empty("Tool_Gripper", (0, 2.45, 1.4), wr, props={"tool": "gripper"})
    boxes("Gripper", [((0.4, 0.12, 0.12), (0, 2.45, 1.55)), ((0.05, 0.1, 0.3), (0.17, 2.45, 1.72)), ((0.05, 0.1, 0.3), (-0.17, 2.45, 1.72))], STEEL(), (0, 2.45, 1.4), t)
    empty("Tip_Gripper", (0, 2.45, 1.85), t)
    boxes("Hazard_Base", [((1.6, 0.02, 0.12), (0, 0.01, z)) for z in (0.8, -0.8)] + [((0.12, 0.02, 1.6), (x, 0.01, 0)) for x in (0.8, -0.8)], YELLOW(), (0, 0, 0), root)
    export_glb("robot_arm.glb")
    sh.rotation_euler = (-0.35, 0, 0)
    el.rotation_euler = (0.5, 0, 0)
    base.rotation_euler = (0, 0, 0.6)
    for o in bpy.data.objects:
        if o.name in ("Tool_Spray", "Tool_Gripper"):
            o["preview_hide"] = 1
    render_preview("blender_robot_arm.png", elev=15, azim=55, dist_mul=0.9)


def build_press():
    reset_scene()
    root = empty("Press", (0, 0, 0))
    boxes("Press_Frame", [((0.8, 6.0, 0.8), (sx * 2.2, 3.0, sz * 1.4)) for sx in (1, -1) for sz in (1, -1)] +
          [((5.4, 1.4, 3.6), (0, 6.6, 0)), ((5.0, 0.9, 3.2), (0, 0.45, 0))], ROBOT(), (0, 0, 0), root)
    box("Press_Bed", (3.4, 0.25, 2.4), (0, 1.02, 0), STEEL(), pivot=(0, 0, 0), parent=root)
    ram = box("Ram", (3.4, 1.2, 2.4), (0, 5.2, 0), STEEL(), pivot=(0, 5.8, 0), parent=root, props={"joint": "ty", "travel": -3.4})
    boxes("Ram_Pistons", [((0.35, 1.4, 0.35), (sx * 1.0, 6.3, 0)) for sx in (1, -1)], mat("Chrome", (0.9, 0.9, 0.92), 1.0, 0.12), (0, 5.8, 0), ram)
    boxes("Press_Stripes", [((0.82, 0.25, 0.82), (sx * 2.2, y, sz * 1.4)) for sx in (1, -1) for sz in (1, -1) for y in (1.5, 2.5, 3.5)], YELLOW(), (0, 0, 0), root)
    box("Sheet", (2.6, 0.06, 1.6), (0, 1.18, 0), mat("HotSteel", (1, 0.4, 0.1), 0.6, 0.3, emit=(1.0, 0.35, 0.05), emit_strength=3), pivot=(0, 1.18, 0), parent=root)
    for i, nm in enumerate(("COL_PressA", "COL_PressB")):
        pass
    col("Press_L", (1.0, 7.5, 3.6), (2.2, 3.75, 0), root)
    col("Press_R", (1.0, 7.5, 3.6), (-2.2, 3.75, 0), root)
    export_glb("press.glb")
    render_preview("blender_press.png", elev=15, azim=30)


def build_crane():
    reset_scene()
    root = empty("Crane", (0, 0, 0))
    boxes("Crane_Rails", [((0.4, 0.5, 14), (sx * 4.5, 9.0, 0)) for sx in (1, -1)], YELLOW(), (0, 0, 0), root)
    bridge = boxes("Bridge", [((9.4, 0.7, 0.6), (0, 9.5, 0)), ((0.6, 0.4, 0.9), (4.5, 9.4, 0)), ((0.6, 0.4, 0.9), (-4.5, 9.4, 0))], YELLOW(), (0, 9.5, 0), root, props={"joint": "tz"})
    trol = box("Trolley", (1.2, 0.6, 1.2), (0, 9.0, 0), JOINT(), pivot=(0, 9.0, 0), parent=bridge, props={"joint": "tx"})
    hoist = empty("Hoist", (0, 8.7, 0), trol, props={"joint": "ty"})
    cyl("Cable", 0.03, 4.0, (0, 6.7, 0), STEEL(), seg=6, pivot=(0, 8.7, 0), parent=hoist)
    blk = box("HookBlock", (0.5, 0.5, 0.3), (0, 4.6, 0), YELLOW(), pivot=(0, 8.7, 0), parent=hoist)
    beams("Hook", [((0, 4.35, 0), (0, 4.0, 0), 0.08), ((0, 4.0, 0), (0, 3.9, 0.18), 0.07)], 0.08, STEEL(), (0, 8.7, 0), hoist)
    empty("HookPoint", (0, 3.9, 0), hoist)
    export_glb("crane.glb")
    render_preview("blender_crane.png", elev=20, azim=35)


def build_doors():
    # roll-up garage door: 8 slats that individually hinge/roll into the drum housing
    reset_scene()
    root = empty("GarageDoor", (0, 0, 0))
    W, H = 8.0, 6.0
    boxes("Door_Frame", [((0.4, H + 0.6, 0.5), (sx * (W / 2 + 0.2), (H + 0.6) / 2, 0)) for sx in (1, -1)], YELLOW(), (0, 0, 0), root)
    cyl("Drum_Housing", 0.5, W + 0.8, (0, H + 0.4, 0.15), STEEL(), axis='x', seg=16, pivot=(0, 0, 0), parent=root)
    n = 8
    for i in range(n):
        y0 = i * H / n
        s = box("Slat_%d" % i, (W, H / n - 0.04, 0.1), (0, y0 + H / n / 2, 0), mat("DoorSteel", (0.6, 0.62, 0.65), 0.7, 0.4),
                pivot=(0, y0, 0), parent=root, props={"joint": "roll", "index": i})
        box("Slat_%d_Rib" % i, (W - 0.1, 0.06, 0.04), (0, y0 + H / n / 2, 0.07), STEEL(), pivot=(0, y0, 0), parent=s)
    col("GarageDoor", (W, H, 0.3), (0, H / 2, 0), root)
    export_glb("garage_door.glb")
    render_preview("blender_garage_door.png", elev=10, azim=20)

    reset_scene()
    root = empty("SlidingDoors", (0, 0, 0))
    boxes("Slide_Frame", [((0.25, 3.4, 0.3), (sx * 3.1, 1.7, 0)) for sx in (1, -1)] + [((6.45, 0.4, 0.35), (0, 3.4, 0))], STEEL(), (0, 0, 0), root)
    gl = mat("Glass", (0.4, 0.55, 0.6), 0.0, 0.05, alpha=0.35)
    for side, sx in (("L", 1), ("R", -1)):
        p = box("Panel_" + side, (1.5, 3.1, 0.06), (sx * 0.75, 1.6, 0), gl, pivot=(sx * 0.0, 1.6, 0), parent=root,
                props={"joint": "tx", "travel": sx * 1.45})
        boxes("Panel_%s_Frame" % side, [((1.5, 0.08, 0.08), (sx * 0.75, y, 0)) for y in (0.06, 3.14)] +
              [((0.08, 3.1, 0.08), (sx * 0.04, 1.6, 0)), ((0.08, 3.1, 0.08), (sx * 1.46, 1.6, 0))], STEEL(), (0, 1.6, 0), p)
        box("Panel_%s_Handle" % side, (0.04, 0.6, 0.12), (sx * 0.15, 1.2, 0), mat("Chrome", (0.9, 0.9, 0.92), 1.0, 0.12), pivot=(0, 1.6, 0), parent=p)
    export_glb("sliding_door.glb")
    render_preview("blender_sliding_door.png", elev=10, azim=25)

    reset_scene()
    root = empty("Barrier", (0, 0, 0))
    boxes("Barrier_Post", [((0.5, 1.1, 0.5), (0, 0.55, 0))], YELLOW(), (0, 0, 0), root)
    arm = box("Arm", (4.5, 0.12, 0.12), (2.4, 1.0, 0), mat("BarrierStripe", (0.95, 0.95, 0.95), 0, 0.5), pivot=(0, 1.0, 0), parent=root,
              props={"hinge": "z", "open": 1.4})
    boxes("Arm_Stripes", [((0.4, 0.13, 0.13), (0.6 + i * 0.9, 1.0, 0)) for i in range(5)], mat("Lamp_PoliceRed", (0.8, 0.05, 0.05)), (0, 1.0, 0), arm)
    export_glb("barrier.glb")
    render_preview("blender_barrier.png", elev=15, azim=30)


def build_gate():
    reset_scene()
    root = empty("CemeteryGate", (0, 0, 0))
    for sx in (1, -1):
        boxes("Pillar_%d" % sx, [((1.2, 4.2, 1.2), (sx * 5.6, 2.1, 0)), ((1.5, 0.3, 1.5), (sx * 5.6, 4.35, 0)), ((1.4, 0.4, 1.4), (sx * 5.6, 0.2, 0))],
              MOSS(), (0, 0, 0), root, uv_scale=0.6)
        sphere("Pillar_Skull_%d" % sx, 0.38, (sx * 5.6, 4.85, 0), mat("Bone", (0.9, 0.87, 0.75), 0, 0.7), pivot=(0, 0, 0), parent=root, scale=(1, 0.95, 1.05))
        boxes("Pillar_Skull_Eyes_%d" % sx, [((0.12, 0.12, 0.05), (sx * 5.6 + dx, 4.9, 0.36)) for dx in (-0.13, 0.13)], IRON(), (0, 0, 0), root)
        col("Pillar_%d" % sx, (1.3, 4.6, 1.3), (sx * 5.6, 2.3, 0), root)
        wall("Fence_Wall_%d" % sx, (sx * 6.2, 0) if sx > 0 else (-30, 0), (30, 0) if sx > 0 else (-6.2, 0), 1.0, 0.6, MOSS(), root)
        bars = [((x, 1.0, 0), (x, 2.6, 0), 0.05) for x in [sx * (6.6 + i * 0.35) for i in range(int((30 - 6.6) / 0.35))]]
        bars += [((sx * 6.2, 2.4, 0), (sx * 30, 2.4, 0), 0.05)]
        beams("Fence_Bars_%d" % sx, bars, 0.05, IRON(), (0, 0, 0), root)
    beams("Gate_Arch", [((-5.0, 5.2, 0), (-2.5, 6.4, 0), 0.12), ((-2.5, 6.4, 0), (2.5, 6.4, 0), 0.12), ((2.5, 6.4, 0), (5.0, 5.2, 0), 0.12),
                        ((-5.0, 4.6, 0), (5.0, 4.6, 0), 0.1)], 0.12, IRON(), (0, 0, 0), root)
    text_mesh("Gate_Sign", "OLD TOWN CEMETERY", (0, 5.45, -0.14), 0.55, mat("RustIron", (0.35, 0.15, 0.07), 0.6, 0.6), parent=root, depth=0.08, facing='-z')
    text_mesh("Gate_Sign_Back", "REST IN PEACE", (0, 5.45, 0.14), 0.55, mat("RustIron", (0.35, 0.15, 0.07), 0.6, 0.6), parent=root, depth=0.08)
    for side, sx in (("L", 1), ("R", -1)):
        hx = sx * 5.0
        g = empty("Gate_" + side, (hx, 0, 0), root, props={"hinge": "y", "open": sx * 1.45})
        bars = [((hx - sx * (0.25 + i * 0.32), 0.2, 0), (hx - sx * (0.25 + i * 0.32), 3.6 + 0.4 * math.sin(i / 14 * math.pi), 0), 0.05) for i in range(15)]
        bars += [((hx, y, 0), (hx - sx * 4.95, y, 0), 0.07) for y in (0.35, 1.8, 3.3)]
        bars += [((hx - sx * 0.05, 0.2, 0), (hx - sx * 0.05, 3.9, 0), 0.12)]
        beams("Gate_%s_Bars" % side, bars, 0.05, IRON(), (hx, 0, 0), g)
        boxes("Gate_%s_Spikes" % side, [((0.09, 0.22, 0.09), (hx - sx * (0.25 + i * 0.32), 3.7 + 0.4 * math.sin(i / 14 * math.pi), 0), Matrix.Rotation(math.radians(45), 3, 'Y'))
                                        for i in range(15)], IRON(), (hx, 0, 0), g)
        col("Gate_%s" % side, (4.9, 3.6, 0.2), (hx - sx * 2.5, 1.8, 0), g)
    export_glb("cemetery_gate.glb")
    for o in bpy.data.objects:
        if o.name == "Gate_L":
            o.rotation_euler = (0, 0, 0.9)
    render_preview("blender_cemetery_gate.png", elev=12, azim=20, dist_mul=0.55)


def build_forklift_lift_scanner():
    reset_scene()
    root = empty("Forklift", (0, 0, 0))
    boxes("Fork_Body", [((1.2, 0.9, 2.2), (0, 0.75, 0)), ((1.2, 0.6, 0.6), (0, 1.3, -0.8))], YELLOW(), (0, 0, 0), root)
    beams("Fork_Cage", [((sx * 0.55, 1.2, z), (sx * 0.55, 2.3, z), 0.07) for sx in (1, -1) for z in (0.5, -0.6)] +
          [((sx * 0.55, 2.3, 0.5), (sx * 0.55, 2.3, -0.6), 0.07) for sx in (1, -1)] + [((-0.55, 2.3, z), (0.55, 2.3, z), 0.07) for z in (0.5, -0.6)],
          0.07, JOINT(), (0, 0, 0), root)
    box("Fork_Seat", (0.5, 0.5, 0.5), (0, 1.35, -0.1), JOINT(), pivot=(0, 0, 0), parent=root)
    boxes("Fork_Mast", [((0.12, 2.6, 0.12), (sx * 0.4, 1.4, 1.2)) for sx in (1, -1)], JOINT(), (0, 0, 0), root)
    fk = boxes("Forks", [((0.12, 0.06, 1.1), (sx * 0.3, 0.25, 1.8)) for sx in (1, -1)] + [((0.9, 0.5, 0.06), (0, 0.5, 1.26))], STEEL(), (0, 0.25, 1.26), root, props={"joint": "ty"})
    for nm, x, z, r in (("FL", 0.6, 0.7, 0.3), ("FR", -0.6, 0.7, 0.3), ("RL", 0.6, -0.7, 0.25), ("RR", -0.6, -0.7, 0.25)):
        cyl("ForkWheel_" + nm, r, 0.22, (x, r, z), mat("Rubber", (0.04, 0.04, 0.045), 0, 0.9), axis='x', seg=14, pivot=(x, r, z), parent=root, props={"joint": "x"})
    empty("Seat_Driver", (0, 1.6, -0.1), root)
    beams("Fork_Levers", [((sx, 1.45, 0.42), (sx, 1.82, 0.36), 0.03) for sx in (0.1, 0.22)], 0.03, DARKM(), (0, 0, 0), root)
    boxes("Fork_Lever_Knobs", [((0.05, 0.05, 0.05), (sx, 1.84, 0.36)) for sx in (0.1, 0.22)], mat("KnobRed", (0.8, 0.1, 0.05), 0, 0.5), (0, 0, 0), root)
    beams("Fork_Wheel", [((-0.15, 1.45, 0.45), (-0.15, 1.7, 0.33), 0.04)], 0.04, DARKM(), (0, 0, 0), root)
    empty("Fork_Grip_L", (-0.15, 1.72, 0.32), root)
    empty("Fork_Grip_R", (0.16, 1.84, 0.36), root)
    col("Forklift", (1.3, 2.3, 3.0), (0, 1.15, 0.2), root)
    export_glb("forklift.glb")
    render_preview("blender_forklift.png", elev=15, azim=40)

    reset_scene()
    root = empty("Lift", (0, 0, 0))
    box("Lift_Pit", (3.0, 0.2, 5.0), (0, 0.1, 0), JOINT(), pivot=(0, 0, 0), parent=root)
    plat = boxes("Platform", [((0.5, 0.15, 4.6), (sx * 1.0, 0.3, 0)) for sx in (1, -1)] + [((2.5, 0.12, 0.4), (0, 0.3, z)) for z in (1.6, -1.6)], YELLOW(), (0, 0.3, 0), root,
                 props={"joint": "ty", "travel": 0.9})
    boxes("Lift_Rams", [((0.2, 1.0, 0.2), (sx * 1.0, -0.2, z)) for sx in (1, -1) for z in (1.4, -1.4)], mat("Chrome", (0.9, 0.9, 0.92), 1, 0.12), (0, 0.3, 0), plat)
    export_glb("lift.glb")
    render_preview("blender_lift.png", elev=25, azim=40)

    reset_scene()
    root = empty("Scanner", (0, 0, 0))
    boxes("Scanner_Frame", [((0.4, 4.2, 0.4), (sx * 2.6, 2.1, 0)) for sx in (1, -1)] + [((5.6, 0.5, 0.5), (0, 4.3, 0))], mat("ScannerWhite", (0.85, 0.87, 0.9), 0.2, 0.3), (0, 0, 0), root)
    bar = boxes("Laser_Bar", [((5.0, 0.12, 0.12), (0, 2.0, 0))], mat("Lamp_Laser", (1, 0.1, 0.1), 0, 0.3, emit=(1, 0.05, 0.05), emit_strength=6), (0, 2.0, 0), root, props={"joint": "ty"})
    boxes("Scanner_Lenses", [((0.3, 0.3, 0.2), (sx * 2.35, 3.8, 0)) for sx in (1, -1)], mat("Lamp_Laser", (1, 0.1, 0.1)), (0, 0, 0), root)
    export_glb("scanner.glb")
    render_preview("blender_scanner.png", elev=15, azim=30)


# ====================================================================== BUILDINGS
def build_plant():
    """Motorworks plant. Local origin at the hall centre; north facade faces +z. 120 x 50 m."""
    reset_scene()
    root = empty("Plant", (0, 0, 0))
    H, T = 12.0, 0.6
    box("Plant_Floor", (120, 0.3, 50), (0, -0.09, 0), CONCRETE(), pivot=(0, 0, 0), parent=root, uv_scale=0.25)
    # north facade: lobby doors x -48..-42 (relative to wall start -60 => 12..18), custom bay x 36..44 (96..104)
    wall("Wall_N", (-60, 25), (60, 25), H, T, BRICK(), root, openings=[(12, 18, 3.6), (96, 104, 5.6)])
    wall("Wall_S", (-60, -25), (60, -25), H, T, BRICK(), root)
    wall("Wall_W", (-60, -25), (-60, 25), H, T, BRICK(), root)
    wall("Wall_E", (60, -25), (60, 25), H, T, BRICK(), root, openings=[(15, 23, 6.0)])  # exit door z -10..-2
    # lobby partitions & custom-bay partitions
    wall("Lobby_Wall_E", (-32, 8), (-32, 25), 4.5, 0.3, mat("LobbyWall", (0.85, 0.82, 0.75), 0, 0.8), root, openings=[(4, 10, 3.2)])
    wall("Lobby_Wall_S", (-60, 8), (-32, 8), 4.5, 0.3, mat("LobbyWall", (0.85, 0.82, 0.75)), root, openings=[(10, 16, 3.2)])
    wall("Bay_Wall_W", (28, 8), (28, 25), 7, 0.4, CONCRETE(), root, openings=[(3, 9, 3.2)])
    wall("Bay_Wall_S", (28, 8), (60, 8), 7, 0.4, CONCRETE(), root)
    box("Lobby_Floor", (27.6, 0.04, 16.6), (-46, 0.075, 16.5), mat("LobbyTile", (0.15, 0.12, 0.12), 0.2, 0.3), pivot=(0, 0, 0), parent=root, uv_scale=1.0)
    box("Bay_Floor", (31.4, 0.04, 16.6), (44, 0.075, 16.5), mat("EpoxyFloor", (0.25, 0.27, 0.3), 0.1, 0.25), pivot=(0, 0, 0), parent=root)
    boxes("Line_Lane", [((80, 0.03, 0.15), (12, 0.075, z)) for z in (-9.5, -2.5)], YELLOW(), (0, 0, 0), root)
    # roof with sawtooth skylights
    box("Roof_Slab", (121.4, 0.5, 51.4), (0, H + 0.15, 0), ROOF(), pivot=(0, 0, 0), parent=root)
    for i in range(6):
        z = -20 + i * 8
        profile("Skylight_%d" % i, [(z + 3, H + 0.3), (z + 3, H + 2.6), (z - 3, H + 0.3)], -55, 55, mat("SkylightGlass", (0.6, 0.7, 0.8), 0.3, 0.1, emit=(0.2, 0.22, 0.25), emit_strength=0.5), (0, 0, 0), root)
    boxes("Parapet", [((121.6, 1.2, 0.7), (0, H + 0.9, sz * 25.3)) for sz in (1, -1)] + [((0.7, 1.2, 51.6), (sx * 60.3, H + 0.9, 0)) for sx in (1, -1)], BRICK(), (0, 0, 0), root, uv_scale=0.5)
    # facade dressing
    windows_row("Facade_Windows", [x for x in range(-24, 30, 6)], 8.0, 25.33, 4.2, 2.6, root)
    boxes("Facade_Pilasters", [((1.0, H, 0.5), (x, H / 2, 25.45)) for x in (-60, -36, -24, 0, 24, 33, 47, 60)], mat("BrickDark", (0.36, 0.13, 0.09), 0, 0.9), (0, 0, 0), root, uv_scale=0.5)
    box("Lobby_Canopy", (10, 0.3, 4), (-45, 4.2, 27.2), STEEL(), pivot=(0, 0, 0), parent=root)
    beams("Lobby_Canopy_Rods", [((x, 4.3, 29), (x, 7.0, 25.4), 0.06) for x in (-49, -41)], 0.06, STEEL(), (0, 0, 0), root)
    text_mesh("Sign_Lobby", "LOBBY  ·  ORDER KIOSK", (-45, 4.6, 29.25), 0.45, mat("Lamp_Sign", (1, 1, 1), 0, 0.3, emit=(1, 0.95, 0.85), emit_strength=2), parent=root)
    text_mesh("Sign_Bay", "CUSTOM BAY  ·  PAINT SHOP", (40, 6.3, 25.4), 0.6, mat("Lamp_Sign2", (0.3, 1, 0.3), 0, 0.3, emit=(0.3, 1, 0.2), emit_strength=3), parent=root)
    text_mesh("Sign_Exit", "LINE EXIT", (60.4, 6.6, -6), 0.6, mat("Lamp_Sign", (1, 1, 1)), parent=root, facing='x')
    # giant neon sign + Halloween spider web
    boxes("Sign_Frame", [((40, 4.2, 0.4), (0, H + 3.2, 25.6))] + [((0.3, 3.5, 0.3), (x, H + 1.0, 25.6)) for x in (-15, 0, 15)], IRON(), (0, 0, 0), root)
    text_mesh("Sign_Neon", "MOTORWORKS", (0, H + 3.2, 25.85), 3.0, mat("Lamp_Neon", (1, 0.4, 0.05), 0, 0.3, emit=(1, 0.35, 0.02), emit_strength=8), parent=root, depth=0.25)
    web = []
    cx, cy, cz = 16.0, H + 4.8, 25.95
    for k in range(9):
        a = math.pi + k * math.pi / 8 * 0.9 + 0.1
        web.append(((cx, cy, cz), (cx + 9 * math.cos(a), cy + 9 * math.sin(a) * 0.55, cz), 0.06))
    for ring in range(1, 6):
        rr = ring * 1.7
        pts = [(cx + rr * math.cos(math.pi + k * math.pi / 8 * 0.9 + 0.1), cy + rr * math.sin(math.pi + k * math.pi / 8 * 0.9 + 0.1) * 0.55 - 0.15 * ring, cz) for k in range(9)]
        for k in range(8):
            web.append((pts[k], pts[k + 1], 0.04))
    beams("SpiderWeb", web, 0.05, mat("Web", (0.92, 0.92, 0.95), 0, 0.6, emit=(0.4, 0.4, 0.45), emit_strength=0.6), (0, 0, 0), root)
    sp = empty("GiantSpider", (cx - 4.0, cy - 3.0, cz + 0.4), root, props={"joint": "ty"})
    sphere("Spider_Body", 0.7, (cx - 4.0, cy - 3.0, cz + 0.4), mat("SpiderBlack", (0.03, 0.02, 0.03), 0, 0.5), pivot=(cx - 4.0, cy - 3.0, cz + 0.4), parent=sp, scale=(1, 0.8, 1.2))
    sphere("Spider_Head", 0.4, (cx - 4.0, cy - 2.5, cz + 1.0), mat("SpiderBlack", (0.03, 0.02, 0.03)), pivot=(cx - 4.0, cy - 3.0, cz + 0.4), parent=sp)
    boxes("Spider_Eyes", [((0.12, 0.12, 0.05), (cx - 4.0 + dx, cy - 2.4, cz + 1.35)) for dx in (-0.15, 0.15)], mat("Lamp_PoliceRed", (0.8, 0.05, 0.05), 0, 0.2, emit=(1, 0.05, 0.05), emit_strength=3), (cx - 4.0, cy - 3.0, cz + 0.4), sp)
    legs = []
    for sx in (1, -1):
        for k in range(4):
            z0 = cz + 0.4 + (k - 1.5) * 0.35
            legs += [((cx - 4.0, cy - 3.0, z0), (cx - 4.0 + sx * 1.3, cy - 2.2, z0 + (k - 1.5) * 0.3), 0.1),
                     ((cx - 4.0 + sx * 1.3, cy - 2.2, z0 + (k - 1.5) * 0.3), (cx - 4.0 + sx * 2.0, cy - 3.6, z0 + (k - 1.5) * 0.5), 0.08)]
    beams("Spider_Legs", legs, 0.1, mat("SpiderBlack", (0.03, 0.02, 0.03)), (cx - 4.0, cy - 3.0, cz + 0.4), sp)
    beams("Spider_Thread", [((cx - 4.0, cy - 2.4, cz + 0.4), (cx - 4.0, cy + 1.5, cz + 0.2), 0.02)], 0.02, mat("Web", (0.92, 0.92, 0.95)), (0, 0, 0), root)
    # chimneys, pipes, interior steel
    for x in (-50, -40):
        cyl("Chimney_%d" % abs(x), 1.2, 10, (x, H + 5, -18), BRICK(), seg=14, r2=1.0, pivot=(0, 0, 0), parent=root)
    # triangulated roof trusses (top chord, bottom chord, alternating diagonals) on every skylight bay
    BEAMR = mat("SteelRed", (0.55, 0.12, 0.08), 0.6, 0.45)
    truss = []
    for z in range(-20, 21, 8):
        truss += [((-59.5, H - 0.25, z), (59.5, H - 0.25, z), 0.22), ((-59.5, H - 1.7, z), (59.5, H - 1.7, z), 0.22)]
        for i, x in enumerate(range(-58, 59, 4)):
            truss.append(((x, H - 1.7, z), (x + 4, H - 0.25, z) if i % 2 == 0 else (x - 4, H - 0.25, z), 0.12))
            truss.append(((x, H - 1.7, z), (x, H - 0.25, z), 0.1))
    beams("Roof_Trusses", truss, 0.2, BEAMR, (0, 0, 0), root)
    # structural I-beam columns
    cols_xz = [(x, z) for x in (-24, -8, 8, 24, 40) for z in (-18, 4)]
    ib = []
    for (x, z) in cols_xz:
        ib += [((0.5, H, 0.06), (x, H / 2, z - 0.22)), ((0.5, H, 0.06), (x, H / 2, z + 0.22)), ((0.07, H, 0.4), (x, H / 2, z)),
               ((0.7, 0.3, 0.7), (x, 0.15, z))]
        col("Column_%d_%d" % (x, z), (0.6, H, 0.55), (x, H / 2, z), root)
    boxes("Columns_IBeam", ib, BEAMR, (0, 0, 0), root)
    boxes("Ceiling_Lights", [((6, 0.12, 0.8), (x, H - 1.2, z)) for x in range(-50, 56, 14) for z in (-14, -2, 14)],
          mat("Lamp_Ceiling", (1, 1, 0.95), 0, 0.3, emit=(1, 0.95, 0.85), emit_strength=3), (0, 0, 0), root)
    beams("Pipes", [((-58, 9, -24), (58, 9, -24), 0.4), ((-58, 9.6, -23.5), (58, 9.6, -23.5), 0.25), ((-58, 8.4, 24.3), (-34, 8.4, 24.3), 0.3)], 0.3,
          mat("PipeGreen", (0.15, 0.35, 0.2), 0.6, 0.4), (0, 0, 0), root)
    # volumetric light shafts under the skylights (game swaps FX_LightShaft for an additive gradient shader)
    shafts = []
    for i in range(6):
        z = -20 + i * 8
        for x in (-38, -6, 26, 50):
            shafts.append(((10, H - 0.4, 2.2), (x, (H - 0.4) / 2, z + 0.8), Matrix.Rotation(math.radians(-14), 3, 'X')))
    sh = boxes("FX_LightShaft", shafts, mat("FX_LightShaft", (0.9, 0.95, 1.0), 0, 1, alpha=0.08), (0, 0, 0), root)
    sh["preview_hide"] = 1
    # painted floor: hazard chevrons along the line, green pedestrian walkway
    blk = mat("HazardBlack", (0.03, 0.03, 0.03), 0, 0.8)
    boxes("Hazard_Lanes", [((84, 0.03, 0.5), (8, 0.08, z)) for z in (-1.6, -10.4)], YELLOW(), (0, 0, 0), root)
    boxes("Hazard_Chevrons", [((0.18, 0.035, 0.62), (x, 0.085, z), Matrix.Rotation(math.radians(40), 3, 'Y')) for z in (-1.6, -10.4) for x in [-33.5 + i * 0.9 for i in range(93)]],
          blk, (0, 0, 0), root)
    boxes("Walkway_Green", [((80, 0.025, 1.4), (8, 0.077, 2.4))], mat("WalkwayGreen", (0.1, 0.45, 0.2), 0, 0.7), (0, 0, 0), root)
    boxes("Walkway_Edges", [((80, 0.03, 0.08), (8, 0.08, z)) for z in (1.66, 3.14)], mat("TrimWhite", (0.95, 0.95, 0.95), 0, 0.6), (0, 0, 0), root)
    # safety bollards
    bxs = (-29, -17, -13, -1, 3, 15, 19, 31, 35, 47)
    for x in bxs:
        cyl("Bollard_%d" % (x + 100), 0.13, 1.1, (x, 0.55, 1.2), YELLOW(), seg=12, pivot=(0, 0, 0), parent=root)
        col("Bollard_%d" % (x + 100), (0.26, 1.1, 0.26), (x, 0.55, 1.2), root)
    boxes("Bollard_Bands", [((0.27, 0.12, 0.27), (x, 0.85, 1.2)) for x in bxs], blk, (0, 0, 0), root)
    # tool cribs (chain-link cages with shelving)
    cage = mat("ChainLink", (0.5, 0.52, 0.55), 0.6, 0.5, alpha=0.35)
    for ci, (cx0, cx1, cz0, cz1) in enumerate(((-59.4, -50.0, -24.4, -18.5), (-18.0, -10.0, 18.0, 24.4))):
        posts = [((x, 0, z), (x, 3.0, z), 0.06) for x in (cx0, cx1) for z in (cz0, cz1)]
        posts += [((cx0, 3.0, z), (cx1, 3.0, z), 0.05) for z in (cz0, cz1)] + [((x, 3.0, cz0), (x, 3.0, cz1), 0.05) for x in (cx0, cx1)]
        beams("ToolCrib_%d_Frame" % ci, posts, 0.06, STEEL(), (0, 0, 0), root)
        fz = cz1 if ci == 0 else cz0
        gate = (cx0 + 1.5, cx0 + 2.7)
        box("ToolCrib_%d_MeshA" % ci, (gate[0] - cx0, 2.9, 0.02), ((cx0 + gate[0]) / 2, 1.5, fz), cage, pivot=(0, 0, 0), parent=root)
        box("ToolCrib_%d_MeshB" % ci, (cx1 - gate[1], 2.9, 0.02), ((cx1 + gate[1]) / 2, 1.5, fz), cage, pivot=(0, 0, 0), parent=root)
        box("ToolCrib_%d_MeshSide" % ci, (0.02, 2.9, cz1 - cz0), (cx1, 1.5, (cz0 + cz1) / 2), cage, pivot=(0, 0, 0), parent=root)
        col("ToolCrib_%d_A" % ci, (gate[0] - cx0, 3.0, 0.1), ((cx0 + gate[0]) / 2, 1.5, fz), root)
        col("ToolCrib_%d_B" % ci, (cx1 - gate[1], 3.0, 0.1), ((cx1 + gate[1]) / 2, 1.5, fz), root)
        col("ToolCrib_%d_S" % ci, (0.1, 3.0, cz1 - cz0), (cx1, 1.5, (cz0 + cz1) / 2), root)
        sz = cz0 + 0.5 if ci == 0 else cz1 - 0.5
        furn("ToolCrib_%d_Shelf" % ci, (cx1 - cx0 - 1.0, 2.0, 0.6), ((cx0 + cx1) / 2, 1.0, sz), STEEL(), root)
        boxes("ToolCrib_%d_Bins" % ci, [((0.4, 0.3, 0.45), (cx0 + 0.9 + k * 0.6, 0.45 + r * 0.6, sz)) for k in range(int((cx1 - cx0 - 1.4) / 0.6)) for r in range(3) if (k + r) % 2 == 0],
              mat("BinBlue", (0.1, 0.3, 0.7), 0, 0.6), (0, 0, 0), root)
    # Foreman's office (glass box on I-beam stilts) + observation catwalk + stairs
    OF, OT = 4.2, 0.18
    ox0, ox1, oz0, oz1 = -6.0, 6.0, 6.4, 13.0
    box("Office_Floor", (ox1 - ox0, 0.25, oz1 - oz0), ((ox0 + ox1) / 2, OF - 0.125, (oz0 + oz1) / 2), CONCRETE(), pivot=(0, 0, 0), parent=root)
    col("Office_Floor", (ox1 - ox0, 0.25, oz1 - oz0), ((ox0 + ox1) / 2, OF - 0.125, (oz0 + oz1) / 2), root)
    box("Office_Carpet", (ox1 - ox0 - 0.3, 0.02, oz1 - oz0 - 0.3), ((ox0 + ox1) / 2, OF + 0.01, (oz0 + oz1) / 2), mat("OfficeCarpet", (0.18, 0.2, 0.3), 0, 1), pivot=(0, 0, 0), parent=root)
    stilts = []
    for (x, z) in ((ox0 + 0.2, oz0 + 0.2), (ox1 - 0.2, oz0 + 0.2), (ox0 + 0.2, oz1 - 0.2), (ox1 - 0.2, oz1 - 0.2)):
        stilts += [((0.3, OF, 0.05), (x, OF / 2, z - 0.13)), ((0.3, OF, 0.05), (x, OF / 2, z + 0.13)), ((0.05, OF, 0.26), (x, OF / 2, z))]
        col("Office_Stilt_%d_%d" % (int(x), int(z)), (0.3, OF, 0.3), (x, OF / 2, z), root)
    boxes("Office_Stilts", stilts, BEAMR, (0, 0, 0), root)
    gl = mat("OfficeFrame", (0.2, 0.22, 0.25), 0.7, 0.4)
    openwall("Office_South", (ox0, oz0), (ox1, oz0), 2.8, OT, gl, root, doors=[(-4.0, 1.1, 2.2)], windows=[(0.8, 7.8, OF + 0.9, OF + 2.6)], y0=OF)
    openwall("Office_West", (ox0, oz0), (ox0, oz1), 2.8, OT, gl, root, windows=[((oz0 + oz1) / 2, 5.0, OF + 0.9, OF + 2.6)], y0=OF)
    openwall("Office_East", (ox1, oz0), (ox1, oz1), 2.8, OT, gl, root, doors=[(12.3, 1.2, 2.2)], windows=[(8.8, 3.4, OF + 0.9, OF + 2.6)], y0=OF)
    openwall("Office_North", (ox0, oz1), (ox1, oz1), 2.8, OT, mat("OfficeWall", (0.7, 0.68, 0.62), 0, 0.8), root, y0=OF)
    box("Office_Roof", (ox1 - ox0 + 0.4, 0.2, oz1 - oz0 + 0.4), ((ox0 + ox1) / 2, OF + 2.9, (oz0 + oz1) / 2), gl, pivot=(0, 0, 0), parent=root)
    furn("Office_Desk", (2.4, 0.78, 0.9), (-2.0, OF + 0.39, 10.6), mat("DeskWood", (0.3, 0.18, 0.1), 0, 0.5), root)
    box("Office_Monitor", (0.6, 0.4, 0.05), (-2.0, OF + 1.05, 10.9), mat("Lamp_Monitor", (0.2, 0.5, 1), 0, 0.2, emit=(0.2, 0.5, 1), emit_strength=1.6), pivot=(0, 0, 0), parent=root)
    furn("Office_Cabinet", (0.6, 1.3, 0.5), (4.8, OF + 0.65, 12.4), mat("LockerGrey", (0.45, 0.5, 0.55), 0.6, 0.5), root)
    box("NightShift_Panel", (1.4, 1.0, 0.1), (0.8, OF + 1.5, oz1 - OT / 2 - 0.05), mat("PanelYellow", (0.9, 0.7, 0.05), 0.2, 0.5), pivot=(0, 0, 0), parent=root)
    text_mesh("NightShift_Label", "NIGHT SHIFT LIGHTING", (0.8, OF + 1.85, oz1 - OT / 2 - 0.11), 0.09, mat("SignDark", (0.08, 0.05, 0.1)), parent=root, depth=0.01, facing='-z')
    light_switch("NightShift", (0.8, OF + 1.4, oz1 - OT / 2 - 0.11), '-z', root)
    fixture("Office_0", (-2.5, OF + 2.75, 9.6), root)
    fixture("Office_1", (2.5, OF + 2.75, 9.6), root)
    spot("Office", (0.0, OF, 9.2), root)
    # catwalk on the column line overlooking the assembly line
    cw0, cw1, cz0, cz1 = -30.0, 44.0, 5.0, 6.4
    box("Catwalk_Grate", (cw1 - cw0, 0.08, cz1 - cz0), ((cw0 + cw1) / 2, OF - 0.04, (cz0 + cz1) / 2), mat("Grate", (0.35, 0.37, 0.4), 0.8, 0.5), pivot=(0, 0, 0), parent=root)
    col("Catwalk", (cw1 - cw0, 0.12, cz1 - cz0), ((cw0 + cw1) / 2, OF - 0.06, (cz0 + cz1) / 2), root)
    rail = [((cw0, OF + 1.05, cz0), (cw1, OF + 1.05, cz0), 0.05), ((cw0, OF + 0.55, cz0), (cw1, OF + 0.55, cz0), 0.04)]
    rail += [((x, OF, cz0), (x, OF + 1.05, cz0), 0.05) for x in range(int(cw0), int(cw1) + 1, 2)]
    for (a, b) in ((cw0, ox0), (ox1, cw1)):
        rail += [((a, OF + 1.05, cz1), (b, OF + 1.05, cz1), 0.05), ((a, OF + 0.55, cz1), (b, OF + 0.55, cz1), 0.04)]
        rail += [((x, OF, cz1), (x, OF + 1.05, cz1), 0.05) for x in range(int(a), int(b) + 1, 2)]
    rail += [((x, OF, z), (x, OF + 1.05, z), 0.05) for x in (cw0, cw1) for z in (cz0, cz1)] + [((x, OF + 1.05, cz0), (x, OF + 1.05, cz1), 0.05) for x in (cw0, cw1)]
    beams("Catwalk_Rails", rail, 0.05, YELLOW(), (0, 0, 0), root)
    col("Catwalk_RailS", (cw1 - cw0, 1.1, 0.08), ((cw0 + cw1) / 2, OF + 0.55, cz0), root)
    col("Catwalk_RailNW", (ox0 - cw0, 1.1, 0.08), ((cw0 + ox0) / 2, OF + 0.55, cz1), root)
    col("Catwalk_RailNE", (cw1 - ox1, 1.1, 0.08), ((ox1 + cw1) / 2, OF + 0.55, cz1), root)
    col("Catwalk_RailW", (0.08, 1.1, cz1 - cz0), (cw0, OF + 0.55, (cz0 + cz1) / 2), root)
    col("Catwalk_RailE", (0.08, 1.1, cz1 - cz0), (cw1, OF + 0.55, (cz0 + cz1) / 2), root)
    beams("Catwalk_Hangers", [((x, OF, z), (x, H - 1.7, z), 0.05) for x in range(-28, 44, 8) for z in (cz0, cz1)], 0.05, STEEL(), (0, 0, 0), root)
    # stairs: 21 x 0.2 m risers rising toward the office's east door
    n, run = 21, 0.28
    for k in range(n):
        hgt = OF / n * (k + 1)
        xc = ox1 + (n - 1 - k + 0.5) * run
        furn("Office_Stair_%d" % k, (run, hgt, 1.2), (xc, hgt / 2, 12.3), mat("StairSteel", (0.4, 0.42, 0.45), 0.7, 0.4), root)
    beams("Stair_Rail", [((ox1 + n * run, 1.0, z), (ox1, OF + 1.0, z), 0.05) for z in (11.65, 12.95)], 0.05, YELLOW(), (0, 0, 0), root)
    spot("StairBottom", (ox1 + n * run + 0.8, 0, 12.3), root)
    spot("StairTop", (ox1 - 0.6, OF, 12.3), root)
    # customer delivery showroom (south-east corner)
    sx0, sx1, sz0, sz1 = 46.0, 59.4, -24.4, -13.0
    box("Showroom_Floor", (sx1 - sx0, 0.03, sz1 - sz0), ((sx0 + sx1) / 2, 0.09, (sz0 + sz1) / 2), mat("ShowroomFloor", (0.06, 0.06, 0.07), 0.6, 0.12), pivot=(0, 0, 0), parent=root)
    sframe = mat("ShowroomFrame", (0.12, 0.12, 0.13), 0.8, 0.3)
    openwall("Showroom_North", (sx0, sz1), (sx1, sz1), 3.4, 0.12, sframe, root, doors=[(51.0, 2.2, 2.6)],
             windows=[(47.95, 3.7, 0.25, 3.15), (55.65, 7.3, 0.25, 3.15)], y0=0.0)
    openwall("Showroom_West", (sx0, sz0), (sx0, sz1), 3.4, 0.12, sframe, root, windows=[((sz0 + sz1) / 2, 10.8, 0.25, 3.15)], y0=0.0)
    box("Showroom_Ceiling", (sx1 - sx0, 0.15, sz1 - sz0), ((sx0 + sx1) / 2, 3.45, (sz0 + sz1) / 2), mat("ShowroomCeil", (0.15, 0.15, 0.16), 0.3, 0.6), pivot=(0, 0, 0), parent=root)
    cyl("Showroom_Podium", 3.0, 0.25, (52.7, 0.2, -19.0), mat("PodiumChrome", (0.7, 0.72, 0.75), 0.9, 0.15), seg=40, pivot=(0, 0, 0), parent=root)
    cyl("Showroom_PodiumRing", 3.1, 0.06, (52.7, 0.3, -19.0), mat("Lamp_Ring", (1, 0.4, 0.05), 0, 0.3, emit=(1, 0.35, 0.02), emit_strength=2), seg=40, pivot=(0, 0, 0), parent=root)
    col("Showroom_Podium", (5.6, 0.32, 5.6), (52.7, 0.16, -19.0), root)
    text_mesh("Showroom_Sign", "CUSTOMER DELIVERY", (52.7, 3.0, sz1 + 0.08), 0.42, mat("Lamp_NeonTeal", (0.2, 1, 0.9), 0, 0.3, emit=(0.1, 1, 0.85), emit_strength=5), parent=root, depth=0.05)
    for i, (x, z) in enumerate(((49.5, -16.0), (55.9, -16.0), (49.5, -22.0), (55.9, -22.0))):
        fixture("Showroom_%d" % i, (x, 3.3, z), root, color="#fff3e0")
    spot("Showroom", (52.7, 0.3, -19.0), root)
    furn("Showroom_Desk", (1.8, 1.0, 0.7), (57.6, 0.5, -14.4), mat("DeskWood", (0.3, 0.18, 0.1), 0, 0.5), root)
    # loading dock + parking stops
    box("Dock", (14, 1.2, 4), (-10, 0.6, -27.2), CONCRETE(), pivot=(0, 0, 0), parent=root)
    col("Dock", (14, 1.2, 4), (-10, 0.6, -27.2), root)
    export_glb("plant.glb")
    render_preview("blender_plant.png", elev=25, azim=-25, dist_mul=0.75)
    for o in bpy.data.objects:
        if o.name.startswith(("Roof_Slab", "Skylight", "Parapet", "Sign_", "SpiderWeb", "Spider", "Chimney", "Roof_Trusses", "Pipes", "Ceiling_Lights", "Wall_N", "Facade", "Lobby_Canopy", "GiantSpider")):
            o["preview_hide"] = 1
    render_preview("blender_plant_interior.png", elev=55, azim=-20, dist_mul=0.62)


def build_jumbotron():
    """Four-sided LED production screen hung from the trusses. JumboFace_* empties mark each 16:9 screen face
    (the game builds the live render-target screens there); everything else is frame, LED trim and cables."""
    reset_scene()
    root = empty("Jumbotron", (0, 0, 0))
    S, HH = 6.4, 3.9
    frame = mat("JumboFrame", (0.05, 0.05, 0.06), 0.6, 0.4)
    trim = mat("Lamp_JumboTrim", (1, 0.45, 0.05), 0, 0.3, emit=(1, 0.4, 0.05), emit_strength=4)
    box("Jumbo_Core", (S - 0.3, HH - 0.2, S - 0.3), (0, 0, 0), frame, pivot=(0, 0, 0), parent=root)
    edges = []
    for sy in (1, -1):
        edges += [((S + 0.1, 0.18, 0.18), (0, sy * HH / 2, sz * S / 2)) for sz in (1, -1)] + [((0.18, 0.18, S + 0.1), (sx * S / 2, sy * HH / 2, 0)) for sx in (1, -1)]
    edges += [((0.18, HH, 0.18), (sx * S / 2, 0, sz * S / 2)) for sx in (1, -1) for sz in (1, -1)]
    boxes("Jumbo_Frame", edges, frame, (0, 0, 0), root)
    boxes("Jumbo_Trim", [((S + 0.12, 0.06, 0.06), (0, sy * (HH / 2 - 0.12), sz * (S / 2 + 0.06))) for sy in (1, -1) for sz in (1, -1)] +
          [((0.06, 0.06, S + 0.12), (sx * (S / 2 + 0.06), sy * (HH / 2 - 0.12), 0)) for sy in (1, -1) for sx in (1, -1)], trim, (0, 0, 0), root)
    box("Jumbo_Cap", (S * 0.7, 0.5, S * 0.7), (0, HH / 2 + 0.35, 0), frame, pivot=(0, 0, 0), parent=root)
    box("Jumbo_Skirt", (S * 0.5, 0.4, S * 0.5), (0, -HH / 2 - 0.3, 0), frame, pivot=(0, 0, 0), parent=root)
    cyl("Jumbo_Beacon", 0.18, 0.3, (0, -HH / 2 - 0.6, 0), mat("Lamp_PoliceRed", (0.8, 0.05, 0.05), 0, 0.2, emit=(1, 0.05, 0.05), emit_strength=4), seg=12, pivot=(0, 0, 0), parent=root)
    beams("Jumbo_Cables", [((sx * S * 0.3, HH / 2 + 0.55, sz * S * 0.3), (sx * S * 0.45, HH / 2 + 3.6, sz * S * 0.45), 0.05) for sx in (1, -1) for sz in (1, -1)], 0.05, STEEL(), (0, 0, 0), root)
    for name, (x, z, yaw) in {"N": (0, S / 2 + 0.01, 0.0), "S": (0, -S / 2 - 0.01, math.pi), "E": (S / 2 + 0.01, 0, math.pi / 2), "W": (-S / 2 - 0.01, 0, -math.pi / 2)}.items():
        empty("JumboFace_" + name, (x, 0, z), root, props={"yaw": yaw, "w": S - 0.4, "h": (S - 0.4) * 9 / 16})
    export_glb("jumbotron.glb")
    render_preview("blender_jumbotron.png", elev=12, azim=30)


def house(key, w, d, stories, porch=True, gable_axis='x'):
    """Enterable house: hollow per-wall colliders, hinged front/back doors, glazed windows, furnished ground floor
    (foyer, living room, kitchen), wall switch, ceiling fixtures, doorbell, breaker box, phone and loot spawn points.
    Front faces +z. Ground floor at F; upper storey (house A) is a sealed, lit-window volume above the ceiling."""
    reset_scene()
    root = empty("House_" + key, (0, 0, 0))
    F, T = 0.45, 0.2
    h = 3.0 * stories
    hw, hd = w / 2, d / 2
    px = 0.6                      # living | kitchen partition
    fz = hd - 2.4                 # kitchen | foyer partition
    door_x = w / 4
    box("Foundation", (w + 0.3, F, d + 0.3), (0, F / 2, 0), CONCRETE(), pivot=(0, 0, 0), parent=root)
    col("Foundation", (w + 0.3, F, d + 0.3), (0, F / 2, 0), root)
    box("Floor_Wood", (w - 0.3, 0.02, d - 0.3), (0, F + 0.01, 0), FLOORWOOD(), pivot=(0, 0, 0), parent=root, uv_scale=1.5)
    box("Ceiling", (w - 0.3, 0.1, d - 0.3), (0, F + 2.95, 0), CEILING(), pivot=(0, 0, 0), parent=root)
    col("Ceiling", (w - 0.3, 0.1, d - 0.3), (0, F + 2.95, 0), root)  # keeps the chase camera indoors
    gy0, gy1 = F + 0.9, F + 2.3
    up = [(F + 3.9, F + 5.3)] if stories > 1 else []
    # ---- exterior shell (siding outside, wallpaper inside)
    fw = [(-w / 4, 1.7, gy0, gy1)] + [(x, 1.0, a, b) for (a, b) in up for x in (-w / 3, 0, w / 3)]
    ax, fx = openwall("Wall_Front", (-hw, hd), (hw, hd), h, T, SIDING(), root, doors=[(door_x, 1.1, 2.2)], windows=fw, y0=F, skin=(WALLPAPER(), -1))
    back_x = px + 0.75
    bw = [(-hw + 1.1, 1.0, gy0, gy1)] + [(x, 1.0, a, b) for (a, b) in up for x in (-w / 4, w / 4)]
    openwall("Wall_Back", (-hw, -hd), (hw, -hd), h, T, SIDING(), root, doors=[(back_x, 0.95, 2.1)], windows=bw, y0=F, skin=(WALLPAPER(), 1))
    lw = [(0, 1.4, gy0, gy1)] + [(z, 1.0, a, b) for (a, b) in up for z in (-d / 4, d / 4)]
    openwall("Wall_Left", (-hw, -hd), (-hw, hd), h, T, SIDING(), root, windows=lw, y0=F, skin=(WALLPAPER(), 1))
    rw = [(-d / 4 + 0.2, 1.0, gy0 + 0.2, gy1)] + [(z, 1.0, a, b) for (a, b) in up for z in (-d / 4, d / 4)]
    openwall("Wall_Right", (hw, -hd), (hw, hd), h, T, SIDING(), root, windows=rw, y0=F, skin=(WALLPAPER(), -1))
    if stories > 1:
        box("Floor2", (w - 0.3, 0.12, d - 0.3), (0, F + 3.06, 0), FLOORWOOD(), pivot=(0, 0, 0), parent=root)
        box("Upper_Glow", (w - 0.6, 2.4, d - 0.6), (0, F + 4.4, 0), mat("UpperRoom", (0.12, 0.08, 0.06), 0, 1), pivot=(0, 0, 0), parent=root)
    # ---- interior partitions
    pw = mat("InteriorWall", (0.86, 0.8, 0.68), 0, 0.85)
    openwall("Part_Kitchen", (px, -hd + T / 2), (px, fz), 2.9, 0.12, pw, root, doors=[(-d / 4, 1.0, 2.1)], y0=F, frame=True)
    openwall("Part_Foyer", (px, fz), (hw - T / 2, fz), 2.9, 0.12, pw, root, doors=[((px + hw) / 2, 1.0, 2.1)], y0=F, frame=True)
    # ---- doors
    hinged_door("Door_Front", 'x', hd, door_x, 1.1, 2.2, F, (0, -1), root, mat("DoorRed", (0.45, 0.08, 0.06), 0, 0.6))
    hinged_door("Door_Back", 'x', -hd, back_x, 0.95, 2.1, F, (0, 1), root, mat("DoorWhite", (0.85, 0.85, 0.82), 0, 0.6))
    # ---- furniture: living room
    lx = (-hw + px) / 2
    box("Rug", (3.0, 0.015, 2.4), (lx, F + 0.03, 0.2), mat("RugRed", (0.45, 0.08, 0.1), 0, 1), pivot=(0, 0, 0), parent=root)
    sx0 = -hw + T / 2
    boxes("Sofa", [((0.85, 0.42, 2.2), (sx0 + 0.55, F + 0.21, 0.2)), ((0.25, 0.9, 2.2), (sx0 + 0.22, F + 0.45, 0.2)),
                   ((0.85, 0.6, 0.22), (sx0 + 0.5, F + 0.3, 1.39)), ((0.85, 0.6, 0.22), (sx0 + 0.5, F + 0.3, -0.99))], FABRIC(), (0, 0, 0), root)
    boxes("Sofa_Cushions", [((0.7, 0.12, 0.66), (sx0 + 0.62, F + 0.47, z)) for z in (-0.5, 0.2, 0.9)], mat("Cushion", (0.5, 0.28, 0.18), 0, 1), (0, 0, 0), root)
    col("Sofa", (0.95, 0.9, 2.6), (sx0 + 0.5, F + 0.45, 0.2), root)
    furn("CoffeeTable", (0.7, 0.4, 1.2), (lx - 0.2, F + 0.2, 0.2), WOOD(), root)
    furn("TV_Stand", (0.5, 0.55, 1.5), (px - 0.35, F + 0.275, 0.2), mat("WoodDark", (0.2, 0.12, 0.07), 0, 0.6), root)
    loot("TV", 0, (px - 0.35, F + 0.55, 0.2), root, yaw=-math.pi / 2)
    furn("SideTable", (0.5, 0.6, 0.5), (sx0 + 0.4, F + 0.3, 1.9), WOOD(), root)
    loot("Jewelry", 0, (sx0 + 0.4, F + 0.6, 1.9), root, yaw=math.pi / 2)
    bx = lx + 0.4
    furn("Bookshelf", (1.4, 2.0, 0.35), (bx, F + 1.0, -hd + T / 2 + 0.2), mat("WoodDark", (0.2, 0.12, 0.07)), root)
    books = [((0.08, 0.28, 0.24), (bx - 0.6 + i * 0.09, F + 0.34 + row * 0.5, -hd + T / 2 + 0.2)) for row in range(3) for i in range(13) if (i * 7 + row) % 5]
    boxes("Books", books, mat("Books", (0.25, 0.35, 0.5), 0, 0.8), (0, 0, 0), root)
    loot("Cash", 0, (bx + 0.35, F + 2.0, -hd + T / 2 + 0.2), root)
    beams("FloorLamp", [((sx0 + 0.4, F, -1.5), (sx0 + 0.4, F + 1.5, -1.5), 0.04)], 0.04, DARKM(), (0, 0, 0), root)
    cyl("FloorLamp_Shade", 0.18, 0.3, (sx0 + 0.4, F + 1.6, -1.5), mat("Lampshade", (0.95, 0.85, 0.6), 0, 0.6, emit=(1, 0.7, 0.35), emit_strength=1.2),
        seg=12, r2=0.12, pivot=(0, 0, 0), parent=root)
    # ---- kitchen
    kx = (px + hw) / 2
    kz0 = -hd + T / 2
    c0, c1 = px + 1.4, hw - 0.9
    furn("Counter", (c1 - c0, 0.9, 0.62), ((c0 + c1) / 2, F + 0.45, kz0 + 0.31), mat("Cabinet", (0.75, 0.78, 0.72), 0, 0.5), root)
    box("Counter_Top", (c1 - c0 + 0.02, 0.04, 0.66), ((c0 + c1) / 2, F + 0.92, kz0 + 0.33), mat("Formica", (0.9, 0.5, 0.35), 0, 0.3), pivot=(0, 0, 0), parent=root)
    furn("Fridge", (0.75, 1.85, 0.7), (hw - T / 2 - 0.42, F + 0.925, kz0 + 0.38), mat("FridgeMint", (0.62, 0.86, 0.78), 0.2, 0.3), root)
    beams("Fridge_Handles", [((hw - T / 2 - 0.12, F + 0.9, kz0 + 0.75), (hw - T / 2 - 0.12, F + 1.5, kz0 + 0.75), 0.03)], 0.03, CHROME(), (0, 0, 0), root)
    furn("KitchenTable", (1.1, 0.75, 0.9), (kx, F + 0.375, (kz0 + fz) / 2 + 0.3), mat("TableYellow", (0.85, 0.7, 0.2), 0, 0.5), root)
    for dz in (-0.75, 0.75):
        furn("Chair_%d" % (dz > 0), (0.42, 0.9, 0.42), (kx, F + 0.45, (kz0 + fz) / 2 + 0.3 + dz), WOOD(), root)
    loot("Radio", 0, (c0 + 0.35, F + 0.95, kz0 + 0.3), root)
    box("Phone", (0.14, 0.22, 0.08), (px + 0.1, F + 1.35, kz0 + 1.4), mat("PhoneRed", (0.6, 0.05, 0.05), 0.1, 0.4), pivot=(0, 0, 0), parent=root)
    spot("Phone", (px + 0.6, F, kz0 + 1.4), root)
    # ---- foyer
    furn("FoyerTable", (0.45, 0.8, 0.9), (hw - T / 2 - 0.3, F + 0.4, fz + 1.2), WOOD(), root)
    loot("CandyBowl", 0, (hw - T / 2 - 0.3, F + 0.8, fz + 1.2), root)
    box("CoatRack", (0.1, 1.8, 0.1), (px + 0.35, F + 0.9, hd - 0.4), DARKM(), pivot=(0, 0, 0), parent=root)
    light_switch("Main", (door_x - 0.95, F + 1.3, hd - T / 2 - 0.02), '-z', root)
    # ---- lights
    fixture("Living", (lx, F + 2.85, 0.2), root)
    fixture("Kitchen", (kx, F + 2.85, (kz0 + fz) / 2), root)
    fixture("Foyer", ((px + hw) / 2, F + 2.85, (fz + hd) / 2), root)
    # ---- exterior interactions
    box("Doorbell", (0.08, 0.12, 0.04), (door_x + 0.85, F + 1.3, hd + T / 2 + 0.02), mat("Lamp_Doorbell", (1, 0.85, 0.5), 0, 0.3, emit=(1, 0.7, 0.3), emit_strength=3),
        pivot=(door_x + 0.85, F + 1.3, hd + T / 2 + 0.02), parent=root)
    bb = box("Breaker_Box", (0.12, 0.6, 0.45), (hw + T / 2 + 0.06, 1.35, d / 4), mat("BreakerGrey", (0.5, 0.52, 0.5), 0.6, 0.5), pivot=(hw + T / 2 + 0.06, 1.35, d / 4), parent=root)
    box("BreakerLever", (0.06, 0.18, 0.05), (hw + T / 2 + 0.15, 1.42, d / 4), mat("Lamp_PoliceRed", (0.8, 0.05, 0.05)), pivot=(hw + T / 2 + 0.15, 1.35, d / 4), parent=bb,
        props={"hinge": "z", "open": -2.4})
    beams("Breaker_Conduit", [((hw + T / 2 + 0.06, 1.65, d / 4), (hw + T / 2 + 0.06, F + h - 0.3, d / 4), 0.05)], 0.05, STEEL(), (0, 0, 0), root)
    spot("Outside", (door_x, F, hd + 1.4), root)
    spot("Inside", (door_x, F, hd - 1.4), root)
    spot("Living", (lx + 0.6, F, 0.9), root)
    spot("Kitchen", (kx, F, fz - 0.8), root)
    spot("BackIn", (back_x, F, -hd + 1.2), root)
    spot("BackOut", (back_x, 0, -hd - 1.3), root)
    steps("Back_Step", back_x, -hd - 0.15, 1.2, F, 3, 0.3, root, -1, CONCRETE())
    spot("Breaker", (hw + 0.9, 0, d / 4), root)
    # ---- roof, gables, chimney
    rise = 2.6 if stories > 1 else 2.2
    gable_roof("Roof", w, d, F + h, rise, 0.5, ROOF(), root, axis=gable_axis)
    gable_ends("Gables", w, d, F + h, rise, SIDING(), root, axis=gable_axis)
    boxes("Chimney", [((0.9, 3.0, 0.9), (-w / 3, F + h + 1.6, -d / 5))], BRICK(), (0, 0, 0), root, uv_scale=0.5)
    boxes("Eaves_Trim", [((w + 0.4, 0.18, 0.12), (0, F + h - 0.05, sz * (hd + 0.08))) for sz in (1, -1)], TRIM(), (0, 0, 0), root)
    if porch:
        pw2 = w * 0.85
        box("Porch_Deck", (pw2, 0.12, 2.4), (0, F - 0.06, hd + 1.2), WOOD(), pivot=(0, 0, 0), parent=root)
        box("Porch_Base", (pw2, F - 0.12, 2.36), (0, (F - 0.12) / 2, hd + 1.2), CONCRETE(), pivot=(0, 0, 0), parent=root)
        col("Porch", (pw2, F, 2.4), (0, F / 2, hd + 1.2), root)
        box("Porch_Roof", (pw2 + 0.3, 0.2, 2.8), (0, F + 2.9, hd + 1.3), ROOF(), pivot=(0, 0, 0), parent=root)
        posts = (-w * 0.39, -w * 0.06, w * 0.39)
        boxes("Porch_Posts", [((0.18, 2.75, 0.18), (x, F + 1.4, hd + 2.3)) for x in posts], TRIM(), (0, 0, 0), root)
        for i, x in enumerate(posts):
            col("PorchPost_%d" % i, (0.2, 2.75, 0.2), (x, F + 1.4, hd + 2.3), root)
        boxes("Porch_Rail", [((w * 0.32, 0.08, 0.08), (-w * 0.225, F + 0.9, hd + 2.3)), ((0.08, 0.08, 2.2), (-w * 0.42, F + 0.9, hd + 1.2))], TRIM(), (0, 0, 0), root)
        col("PorchRail", (w * 0.32, 0.95, 0.12), (-w * 0.225, F + 0.45, hd + 2.3), root)
        steps("Porch_Step", door_x, hd + 2.4, 1.6, F, 3, 0.32, root, 1, WOOD())
        empty("Porch_Spot", (-w * 0.2, F, hd + 1.4), root)
    export_glb("house_%s.glb" % key)
    render_preview("blender_house_%s.png" % key, elev=18, azim=30)
    # cut-away preview of the furnished ground floor
    for o in bpy.data.objects:
        if o.name.startswith(("Roof", "Gables", "Ceiling", "Floor2", "Upper_Glow", "Chimney", "Eaves", "Porch_Roof")) or (o.name.startswith("Wall_") and not o.name.startswith("Wall_Back")):
            o["preview_hide"] = 1
    render_preview("blender_house_%s_interior.png" % key, elev=58, azim=20, dist_mul=0.8)


def build_diner():
    """Moonlite Diner: walk-in stainless diner car. Checkerboard floor, chrome counter + barstools, vinyl booths,
    jukebox, kitchen pass-through, register, pendant lights, neon window signs. Front faces +z."""
    reset_scene()
    root = empty("Diner", (0, 0, 0))
    W, D, H, F, T = 16.0, 9.0, 4.2, 0.3, 0.22
    hw, hd = W / 2, D / 2
    STEELD = mat("DinerSteel", (0.85, 0.87, 0.9), 0.9, 0.2)
    RED = mat("DinerRed", (0.8, 0.05, 0.08), 0.3, 0.4)
    box("Diner_Base", (W + 0.6, F, D + 0.6), (0, F / 2, 0), mat("DinerTile", (0.85, 0.1, 0.12), 0.1, 0.5), pivot=(0, 0, 0), parent=root)
    col("Diner_Base", (W + 0.6, F, D + 0.6), (0, F / 2, 0), root)
    for sx in (1, -1):  # rounded stainless end caps (solid half-cylinders outside the dining room)
        half_cyl("Diner_End_%d" % sx, hd, H, (sx * hw, F, 0), sx, STEELD, root)
        box("Diner_EndBase_%d" % sx, (hd, F, D), (sx * (hw + hd / 2), F / 2, 0), mat("DinerTile", (0.85, 0.1, 0.12)), pivot=(0, 0, 0), parent=root)
        col("Diner_End_%d" % sx, (hd, H + F, D * 0.92), (sx * (hw + hd / 2), (H + F) / 2, 0), root)
    door_x = 1.2
    ax, fx = openwall("Diner_Front", (-hw, hd), (hw, hd), H, T, STEELD, root, doors=[(door_x, 1.3, 2.4)],
                      windows=[(x, 2.0, F + 1.0, F + 2.6) for x in (-6, -3.6, -1.2, 3.6, 6)], y0=F, skin=(mat("DinerCream", (0.95, 0.9, 0.78), 0, 0.6), -1))
    openwall("Diner_Back", (-hw, -hd), (hw, -hd), H, T, STEELD, root, doors=[(5.0, 1.0, 2.2)], y0=F, skin=(mat("KitchenTile", (0.9, 0.92, 0.9), 0, 0.4), 1))
    for sx in (1, -1):
        openwall("Diner_Side_%d" % sx, (sx * hw, -hd), (sx * hw, hd), H, T, STEELD, root, y0=F, skin=(mat("DinerCream", (0.95, 0.9, 0.78)), -sx), frame=False)
    hinged_door("Door_Front", 'x', hd, door_x, 1.3, 2.4, F, (0, -1), root, None, glass=True)
    hinged_door("Door_Back", 'x', -hd, 5.0, 1.0, 2.2, F, (0, 1), root, mat("DoorWhite", (0.85, 0.85, 0.82), 0, 0.6))
    boxes("Diner_Stripes", [((W + 0.06, 0.25, 0.04), (0, y, sz * (hd + T / 2 + 0.02))) for y in (F + 0.75, F + 3.2) for sz in (1, -1)], RED, (0, 0, 0), root)
    box("Diner_RoofCap", (W + 0.4, 0.35, D + 0.4), (0, F + H + 0.17, 0), RED, pivot=(0, 0, 0), parent=root)
    box("Ceiling", (W - 0.4, 0.1, D - 0.4), (0, F + 3.6, 0), mat("CeilingTile", (0.9, 0.88, 0.85), 0, 0.8), pivot=(0, 0, 0), parent=root)
    col("Ceiling", (W - 0.4, 0.1, D - 0.4), (0, F + 3.6, 0), root)
    # ---- floors: black & white checkerboard dining room, kitchen tiles
    kz = -2.6
    tiles("Floor_Check", -hw + 0.11, hw - 0.11, kz, hd - 0.11, F + 0.005, 0.6, mat("TileBlack", (0.04, 0.04, 0.05), 0.1, 0.3), mat("TileWhite", (0.92, 0.92, 0.9), 0.1, 0.3), root)
    box("Floor_Kitchen", (W - 0.2, 0.01, hd + kz - 0.1), (0, F + 0.005, (-hd + kz) / 2), mat("KitchenFloor", (0.55, 0.5, 0.45), 0, 0.7), pivot=(0, 0, 0), parent=root)
    # ---- kitchen partition with pass-through window and swing gap
    openwall("Diner_Kitchen", (-hw + T / 2, kz), (hw - T / 2, kz), 3.6, 0.15, mat("DinerCream", (0.95, 0.9, 0.78)), root,
             doors=[(5.0, 1.1, 2.2)], passthrough=[(-1.0, 4.0, F + 1.15, F + 2.1)], y0=F)
    box("PassThrough_Shelf", (4.2, 0.05, 0.5), (-1.0, F + 1.17, kz), CHROME(), pivot=(0, 0, 0), parent=root)
    # ---- counter, stools, register
    cz = -1.5
    furn("Counter", (9.0, 1.05, 0.6), (-1.5, F + 0.525, cz), mat("CounterRed", (0.7, 0.05, 0.08), 0.2, 0.4), root)
    box("Counter_Top", (9.2, 0.06, 0.75), (-1.5, F + 1.08, cz + 0.05), mat("Formica", (0.9, 0.9, 0.85), 0, 0.25), pivot=(0, 0, 0), parent=root)
    box("Counter_Trim", (9.1, 0.08, 0.04), (-1.5, F + 0.95, cz + 0.32), CHROME(), pivot=(0, 0, 0), parent=root)
    for i in range(7):
        x = -5.4 + i * 1.3
        cyl("Stool_Post_%d" % i, 0.05, 0.7, (x, F + 0.35, cz + 0.85), CHROME(), seg=10, pivot=(0, 0, 0), parent=root)
        cyl("Stool_Seat_%d" % i, 0.22, 0.1, (x, F + 0.75, cz + 0.85), VINYL(), seg=14, pivot=(0, 0, 0), parent=root)
        col("Stool_%d" % i, (0.4, 0.8, 0.4), (x, F + 0.4, cz + 0.85), root)
    loot("Register", 0, (2.4, F + 1.11, cz), root, yaw=math.pi)
    boxes("Pie_Case", [((0.8, 0.4, 0.5), (-4.6, F + 1.31, cz))], PANE(), (0, 0, 0), root)
    boxes("Pies", [((0.25, 0.08, 0.25), (-4.75 + i * 0.3, F + 1.2, cz)) for i in range(2)], mat("Pie", (0.85, 0.5, 0.15), 0, 0.7), (0, 0, 0), root)
    beams("Coffee_Pots", [((-3.4, F + 1.11, cz - 0.1), (-3.4, F + 1.35, cz - 0.1), 0.12)], 0.12, mat("CoffeeGlass", (0.2, 0.1, 0.05), 0.1, 0.1), (0, 0, 0), root)
    spot("Counter", (-1.5, F, -2.15), root)
    # ---- booths along the front windows
    for i, x in enumerate((-6.0, -3.6, 3.6, 6.0)):
        z = hd - 0.85
        box("Booth_Table_%d" % i, (0.75, 0.05, 1.1), (x, F + 0.76, z), mat("Formica", (0.9, 0.9, 0.85)), pivot=(0, 0, 0), parent=root)
        box("Booth_Leg_%d" % i, (0.1, 0.74, 0.1), (x, F + 0.37, z), CHROME(), pivot=(0, 0, 0), parent=root)
        for s in (1, -1):
            boxes("Booth_Bench_%d_%d" % (i, s > 0), [((0.5, 0.45, 1.2), (x + s * 0.72, F + 0.22, z)), ((0.18, 1.1, 1.2), (x + s * 1.0, F + 0.55, z))], VINYL(), (0, 0, 0), root)
        col("Booth_%d" % i, (2.3, 1.1, 1.3), (x, F + 0.55, z), root)
    # ---- jukebox, neon signs
    jx, jz = -hw + 0.55, 1.2
    furn("Jukebox", (0.6, 1.5, 0.9), (jx, F + 0.75, jz), mat("JukeWood", (0.35, 0.12, 0.05), 0.2, 0.4), root)
    cyl("Jukebox_Arch", 0.45, 0.62, (jx, F + 1.5, jz), mat("Lamp_Jukebox", (1, 0.5, 0.1), 0, 0.3, emit=(1, 0.45, 0.1), emit_strength=4), axis='x', seg=16, pivot=(0, 0, 0), parent=root)
    box("Jukebox_Glass", (0.05, 0.4, 0.6), (jx + 0.31, F + 1.2, jz), mat("Lamp_JukeGlass", (0.4, 0.9, 1), 0, 0.2, emit=(0.3, 0.8, 1), emit_strength=2), pivot=(0, 0, 0), parent=root)
    text_mesh("Neon_Pie", "PIE", (-6, F + 2.25, hd - 0.18), 0.4, mat("Lamp_NeonPink", (1, 0.2, 0.6), 0, 0.3, emit=(1, 0.15, 0.55), emit_strength=6), parent=root, depth=0.04)
    text_mesh("Neon_Coffee", "COFFEE", (6, F + 2.25, hd - 0.18), 0.35, mat("Lamp_NeonTeal", (0.2, 1, 0.9), 0, 0.3, emit=(0.1, 1, 0.85), emit_strength=5), parent=root, depth=0.04)
    # ---- kitchen
    furn("Griddle", (2.4, 0.95, 0.8), (-3.5, F + 0.475, -hd + 0.55), STEEL(), root)
    box("Griddle_Hot", (2.2, 0.03, 0.6), (-3.5, F + 0.96, -hd + 0.55), mat("Lamp_Griddle", (0.3, 0.1, 0.05), 0.5, 0.4, emit=(0.8, 0.2, 0.05), emit_strength=0.6), pivot=(0, 0, 0), parent=root)
    furn("WalkIn_Fridge", (1.2, 2.1, 0.9), (1.0, F + 1.05, -hd + 0.6), CHROME(), root)
    furn("Kitchen_Shelf", (2.0, 1.8, 0.45), (-6.4, F + 0.9, -hd + 0.4), STEEL(), root)
    # ---- lights & switch
    for i, x in enumerate((-5.0, -1.0, 3.0)):
        fixture("Dining_%d" % i, (x, F + 3.0, 0.6), root, pendant=True)
    fixture("Kitchen_0", (-3.0, F + 3.5, -3.5), root)
    fixture("Kitchen_1", (3.0, F + 3.5, -3.5), root)
    light_switch("Main", (door_x + 1.15, F + 1.3, hd - T / 2 - 0.02), '-z', root)
    spot("Outside", (door_x, 0, hd + 1.8), root)
    spot("Inside", (door_x, F, hd - 1.6), root)
    spot("Dining", (0.0, F, 0.6), root)
    spot("BackIn", (5.0, F, -hd + 1.1), root)
    spot("BackOut", (5.0, 0, -hd - 1.4), root)
    steps("Front_Step", door_x, hd + 0.3, 1.8, F, 2, 0.3, root, 1, mat("DinerTile", (0.85, 0.1, 0.12)))
    steps("Back_Step", 5.0, -hd - 0.3, 1.4, F, 2, 0.3, root, -1, CONCRETE())
    box("Diner_Awning", (W, 0.15, 1.6), (0, F + 3.4, hd + 0.8), mat("AwningTeal", (0.1, 0.6, 0.6), 0, 0.6), pivot=(0, 0, 0), parent=root)
    boxes("Diner_SignPosts", [((0.25, 3, 0.25), (x, F + H + 1.6, 0)) for x in (-3, 3)], STEEL(), (0, 0, 0), root)
    box("Diner_SignBoard", (9, 2.2, 0.4), (0, F + H + 3.8, 0), mat("SignDark", (0.08, 0.05, 0.1), 0, 0.5), pivot=(0, 0, 0), parent=root)
    text_mesh("Diner_Neon", "MOONLITE DINER", (0, F + H + 3.8, 0.25), 1.0, mat("Lamp_NeonPink", (1, 0.2, 0.6), 0, 0.3, emit=(1, 0.15, 0.55), emit_strength=6), parent=root, depth=0.15)
    text_mesh("Diner_Neon2", "OPEN ALL NIGHT", (0, F + 3.7, hd + 1.62), 0.4, mat("Lamp_NeonTeal", (0.2, 1, 0.9), 0, 0.3, emit=(0.1, 1, 0.85), emit_strength=5), parent=root, depth=0.08)
    empty("Counter_Spot", (-4, F, hd + 2.5), root)
    export_glb("diner.glb")
    render_preview("blender_diner.png", elev=15, azim=25)
    for o in bpy.data.objects:
        if o.name.startswith(("Diner_RoofCap", "Ceiling", "Diner_Sign", "Diner_Neon", "Diner_Front", "Diner_Awning", "Diner_End_")):
            o["preview_hide"] = 1
    render_preview("blender_diner_interior.png", elev=55, azim=10, dist_mul=0.75)


def build_gas_station():
    """Gas station: walk-in convenience mart (aisles, coolers, counter + register, pump console, jerrycans) and a
    covered pump island with hinged hoses/nozzles; Pump_Spot_* mark where a car parks to refuel. Front faces +z."""
    reset_scene()
    root = empty("GasStation", (0, 0, 0))
    WHITE = mat("GasWhite", (0.92, 0.92, 0.9), 0, 0.6)
    REDG = mat("GasRed", (0.8, 0.1, 0.08), 0.2, 0.5)
    F, T, H = 0.15, 0.2, 3.8
    x0, x1, z0, z1 = -13.0, -3.0, -9.5, -2.5
    box("Mart_Slab", (x1 - x0 + 0.3, F, z1 - z0 + 0.3), ((x0 + x1) / 2, F / 2, (z0 + z1) / 2), CONCRETE(), pivot=(0, 0, 0), parent=root)
    col("Mart_Slab", (x1 - x0 + 0.3, F, z1 - z0 + 0.3), ((x0 + x1) / 2, F / 2, (z0 + z1) / 2), root)
    tiles("Mart_Floor", x0 + 0.1, x1 - 0.1, z0 + 0.1, z1 - 0.1, F + 0.005, 0.5, mat("TileWhite", (0.92, 0.92, 0.9), 0.1, 0.3), mat("TileGrey", (0.6, 0.62, 0.64), 0.1, 0.3), root)
    door_x = -8.0
    openwall("Mart_Front", (x0, z1), (x1, z1), H, T, WHITE, root, doors=[(door_x, 1.3, 2.3)],
             windows=[(-11.0, 2.4, F + 0.6, F + 2.6), (-5.0, 2.4, F + 0.6, F + 2.6)], y0=F, skin=(WHITE, -1))
    openwall("Mart_Back", (x0, z0), (x1, z0), H, T, WHITE, root, y0=F, skin=(WHITE, 1))
    openwall("Mart_West", (x0, z0), (x0, z1), H, T, WHITE, root, windows=[(-6.0, 1.6, F + 1.0, F + 2.4)], y0=F, skin=(WHITE, 1))
    openwall("Mart_East", (x1, z0), (x1, z1), H, T, WHITE, root, y0=F, skin=(WHITE, -1))
    hinged_door("Door_Front", 'x', z1, door_x, 1.3, 2.3, F, (0, -1), root, None, glass=True)
    box("Mart_Ceiling", (x1 - x0 - 0.2, 0.08, z1 - z0 - 0.2), ((x0 + x1) / 2, F + 3.1, (z0 + z1) / 2), CEILING(), pivot=(0, 0, 0), parent=root)
    col("Mart_Ceiling", (x1 - x0 - 0.2, 0.08, z1 - z0 - 0.2), ((x0 + x1) / 2, F + 3.1, (z0 + z1) / 2), root)
    box("Office_Trim", (x1 - x0 + 0.2, 0.6, z1 - z0 + 0.2), ((x0 + x1) / 2, F + H, (z0 + z1) / 2), REDG, pivot=(0, 0, 0), parent=root)
    text_mesh("Mart_Sign", "MOONBEAM MART", (-8, F + H + 0.02, z1 + 0.13), 0.42, mat("Lamp_Sign", (1, 1, 1), 0, 0.3, emit=(1, 0.95, 0.85), emit_strength=2), parent=root, depth=0.05)
    # aisles with stocked shelves
    snack_cols = [(0.9, 0.2, 0.1), (0.95, 0.75, 0.1), (0.15, 0.45, 0.85), (0.2, 0.7, 0.25), (0.6, 0.1, 0.6)]
    for a, ax_ in enumerate((-11.2, -9.4)):
        furn("Aisle_%d" % a, (0.6, 1.5, 3.6), (ax_, F + 0.75, -6.7), STEEL(), root)
        for k, c in enumerate(snack_cols):
            boxes("Aisle_%d_Snacks_%d" % (a, k), [((0.18, 0.22, 0.14), (ax_ + sx * 0.2, F + 0.35 + (k % 3) * 0.45, -8.3 + j * 0.42 + k * 0.05))
                                                    for sx in (1, -1) for j in range(8) if (j + k) % 3 == 0],
                  mat("Snack_%d" % k, c, 0, 0.6), (0, 0, 0), root)
    # drink coolers along the back wall
    furn("Coolers", (4.4, 2.1, 0.7), (-10.5, F + 1.05, z0 + 0.48), STEEL(), root)
    box("Cooler_Glass", (4.2, 1.7, 0.04), (-10.5, F + 1.15, z0 + 0.85), mat("Lamp_Cooler", (0.6, 0.85, 1), 0, 0.1, emit=(0.5, 0.8, 1.0), emit_strength=1.4), pivot=(0, 0, 0), parent=root)
    boxes("Cooler_Bottles", [((0.08, 0.26, 0.08), (-12.4 + i * 0.22, F + 0.5 + r * 0.55, z0 + 0.6)) for i in range(18) for r in range(3)],
          mat("Soda", (0.7, 0.1, 0.1), 0.2, 0.3), (0, 0, 0), root)
    # counter, register, pump console, jerrycans
    furn("Mart_Counter", (2.2, 1.0, 0.7), (-4.4, F + 0.5, -4.0), mat("CounterWood", (0.4, 0.25, 0.12), 0, 0.5), root)
    box("Mart_Counter_Top", (2.3, 0.05, 0.8), (-4.4, F + 1.02, -4.0), mat("Formica", (0.9, 0.9, 0.85)), pivot=(0, 0, 0), parent=root)
    loot("Register", 0, (-4.9, F + 1.05, -4.0), root, yaw=math.pi / 2)
    box("Pump_Console", (0.5, 0.3, 0.35), (-3.8, F + 1.2, -4.0), DARKM(), pivot=(0, 0, 0), parent=root)
    box("Pump_Console_Screen", (0.02, 0.18, 0.28), (-4.06, F + 1.25, -4.0), mat("Lamp_Console", (0.2, 1, 0.4), 0, 0.2, emit=(0.1, 1, 0.3), emit_strength=2), pivot=(0, 0, 0), parent=root)
    spot("Clerk", (-3.6, F, -5.0), root)
    furn("Jerrycan_Rack", (1.2, 0.9, 0.5), (-6.0, F + 0.45, z0 + 0.4), STEEL(), root)
    shop("Jerrycan", (-6.0, F + 0.92, z0 + 0.4), root, yaw=0, price=25)
    fixture("Mart_0", (-10.5, F + 3.0, -6.0), root)
    fixture("Mart_1", (-5.5, F + 3.0, -6.0), root)
    light_switch("Main", (door_x + 1.0, F + 1.3, z1 - T / 2 - 0.02), '-z', root)
    spot("Outside", (door_x, 0, z1 + 1.3), root)
    spot("Inside", (door_x, F, z1 - 1.3), root)
    spot("Aisles", (-10.3, F, -4.0), root)
    box("Canopy", (14, 0.8, 10), (6, 5.6, 2), mat("GasRed", (0.8, 0.1, 0.08)), pivot=(0, 0, 0), parent=root)
    box("Canopy_Lights", (12, 0.05, 8), (6, 5.17, 2), mat("Lamp_Ceiling", (1, 1, 0.95), 0, 0.3, emit=(1, 0.95, 0.85), emit_strength=3), pivot=(0, 0, 0), parent=root)
    boxes("Canopy_Pillars", [((0.5, 5.2, 0.5), (x, 2.6, z)) for x in (1, 11) for z in (-1.5, 5.5)], mat("GasWhite", (0.92, 0.92, 0.9)), (0, 0, 0), root)
    for x in (1, 11):
        for z in (-1.5, 5.5):
            col("Pillar_%d_%d" % (x, int(z)), (0.6, 5.2, 0.6), (x, 2.6, z), root)
    for i, x in enumerate((4, 8)):
        box("Island_%d" % i, (1.2, 0.25, 4), (x, 0.125, 2), CONCRETE(), pivot=(0, 0, 0), parent=root)
        boxes("Pump_%d" % i, [((0.7, 1.6, 0.5), (x, 1.05, z)) for z in (1, 3)], mat("GasRed", (0.8, 0.1, 0.08)), (0, 0, 0), root)
        boxes("Pump_%d_Glass" % i, [((0.5, 0.35, 0.52), (x, 1.5, z)) for z in (1, 3)], mat("Lamp_Pump", (1, 0.95, 0.8), 0, 0.3, emit=(1, 0.9, 0.6), emit_strength=1.5), (0, 0, 0), root)
        col("Island_%d" % i, (1.2, 1.8, 4), (x, 0.9, 2), root)
        for j, z in enumerate((1, 3)):
            side = -1 if i == 0 else 1  # hoses hang on the outer face of each island, toward the car lane
            hx = x + side * 0.37
            hose = empty("Hose_%d_%d" % (i, j), (hx, 1.45, z), root, props={"hinge": "z", "open": side * 0.9})
            beams("Hose_%d_%d_Line" % (i, j), [((hx, 1.45, z), (hx + side * 0.05, 0.75, z + 0.12), 0.04), ((hx + side * 0.05, 0.75, z + 0.12), (hx + side * 0.06, 1.05, z + 0.2), 0.04)],
                  0.04, mat("Rubber", (0.04, 0.04, 0.045), 0, 0.9), (hx, 1.45, z), hose)
            noz = empty("Nozzle_%d_%d" % (i, j), (hx + side * 0.06, 1.05, z + 0.2), hose, props={"hinge": "x", "open": -0.6})
            boxes("Nozzle_%d_%d_Body" % (i, j), [((0.06, 0.16, 0.06), (hx + side * 0.06, 1.12, z + 0.2)), ((0.04, 0.04, 0.2), (hx + side * 0.06, 1.18, z + 0.32))],
                  mat("NozzleBlack", (0.05, 0.05, 0.05), 0.4, 0.5), (hx + side * 0.06, 1.05, z + 0.2), noz)
            empty("Pump_Spot_%d_%d" % (i, j), (x + side * 2.3, 0, z), root, props={"pump": i * 2 + j})
    boxes("Sign_Pole", [((0.4, 8, 0.4), (16, 4, 6))], STEEL(), (0, 0, 0), root)
    box("Sign_Board", (3.4, 3, 0.4), (16, 9, 6), mat("GasWhite", (0.92, 0.92, 0.9)), pivot=(0, 0, 0), parent=root)
    text_mesh("Gas_Sign", "GAS", (16, 9.7, 6.22), 1.0, mat("Lamp_NeonRed", (1, 0.1, 0.05), 0, 0.3, emit=(1, 0.1, 0.05), emit_strength=5), parent=root, depth=0.1)
    text_mesh("Gas_Price", "$3.13", (16, 8.4, 6.22), 0.8, mat("Lamp_Sign", (1, 1, 1), 0, 0.3, emit=(1, 0.95, 0.85), emit_strength=2), parent=root, depth=0.08)
    col("SignPole", (0.5, 8, 0.5), (16, 4, 6), root)
    export_glb("gas_station.glb")
    render_preview("blender_gas_station.png", elev=18, azim=30)


def shop_shell(label, w, d, h, color, ceil, F=0.15, T=0.25, front_windows=(), door_w=1.4, back_door=None, side_windows=()):
    """Hollow storefront shell shared by the hardware store and the police station. Returns (root, F, T, wall material)."""
    reset_scene()
    root = empty(label, (0, 0, 0))
    m = mat(label + "_Wall", color, 0, 0.9)
    hw, hd = w / 2, d / 2
    box("Slab", (w + 0.4, F, d + 0.4), (0, F / 2, 0), CONCRETE(), pivot=(0, 0, 0), parent=root)
    col("Slab", (w + 0.4, F, d + 0.4), (0, F / 2, 0), root)
    inner = mat(label + "_Inner", (0.82, 0.8, 0.74), 0, 0.85)
    openwall("Wall_Front", (-hw, hd), (hw, hd), h, T, m, root, doors=[(0, door_w, 2.5)], windows=front_windows, y0=F, skin=(inner, -1))
    openwall("Wall_Back", (-hw, -hd), (hw, -hd), h, T, m, root, doors=[back_door] if back_door else [], y0=F, skin=(inner, 1))
    openwall("Wall_West", (-hw, -hd), (-hw, hd), h, T, m, root, windows=[(z, 1.2, F + 1.0, F + 2.4) for z in side_windows], y0=F, skin=(inner, 1))
    openwall("Wall_East", (hw, -hd), (hw, hd), h, T, m, root, windows=[(z, 1.2, F + 1.0, F + 2.4) for z in side_windows], y0=F, skin=(inner, -1))
    box("Ceiling", (w - 0.3, 0.12, d - 0.3), (0, F + ceil, 0), CEILING(), pivot=(0, 0, 0), parent=root)
    col("Ceiling", (w - 0.3, 0.12, d - 0.3), (0, F + ceil, 0), root)
    box("Cornice", (w + 0.5, 0.6, d + 0.5), (0, h + F + 0.1, 0), TRIM(), pivot=(0, 0, 0), parent=root)
    box("Roof_Slab", (w + 0.2, 0.2, d + 0.2), (0, h + F - 0.1, 0), ROOF(), pivot=(0, 0, 0), parent=root)
    hinged_door("Door_Front", 'x', hd, 0, door_w, 2.5, F, (0, -1), root, None, glass=True)
    if back_door:
        hinged_door("Door_Back", 'x', -hd, back_door[0], back_door[1], back_door[2], F, (0, 1), root, mat("DoorSteel", (0.6, 0.62, 0.65), 0.7, 0.4))
    spot("Outside", (0, 0, hd + 1.6), root)
    spot("Inside", (0, F, hd - 1.6), root)
    return root, F, T, m


def build_hardware():
    """Hardware & Gun/Tool store: pegboards, tool racks, workbench (power tool kit loot), register, locked weapon &
    tool counter (Shop_* items), masks by the door, and the back-alley fence behind the store."""
    w, d, h, F = 16.0, 12.0, 6.0, 0.15
    hw, hd = w / 2, d / 2
    root, F, T, m = shop_shell("Hardware", w, d, h, (0.45, 0.25, 0.18), 3.6, front_windows=[(-5.0, 4.0, F + 0.5, F + 2.8), (5.0, 4.0, F + 0.5, F + 2.8)],
                               back_door=(4.0, 1.1, 2.3), side_windows=(2.0,))
    box("Floor", (w - 0.3, 0.01, d - 0.3), (0, F + 0.005, 0), mat("ShopFloor", (0.5, 0.45, 0.38), 0, 0.8), pivot=(0, 0, 0), parent=root, uv_scale=0.8)
    peg = mat("Pegboard", (0.75, 0.6, 0.4), 0, 0.9)
    tools = mat("ToolSteel", (0.55, 0.57, 0.6), 0.8, 0.35)
    handles = mat("ToolRed", (0.75, 0.1, 0.06), 0, 0.5)
    for sx in (1, -1):
        x = sx * (hw - T / 2 - 0.04)
        box("Pegboard_%d" % sx, (0.03, 1.8, 5.0), (x, F + 1.7, -1.5), peg, pivot=(0, 0, 0), parent=root)
        boxes("Peg_Tools_%d" % sx, [((0.04, 0.35, 0.06), (x - sx * 0.04, F + 1.2 + (k % 3) * 0.55, -3.6 + (k // 3) * 0.6)) for k in range(21)], tools, (0, 0, 0), root)
        boxes("Peg_Handles_%d" % sx, [((0.05, 0.14, 0.07), (x - sx * 0.05, F + 1.0 + (k % 3) * 0.55, -3.6 + (k // 3) * 0.6)) for k in range(21)], handles, (0, 0, 0), root)
    for i, x in enumerate((-3.6, -0.6)):
        furn("ToolRack_%d" % i, (0.7, 1.9, 4.0), (x, F + 0.95, -0.8), STEEL(), root)
        boxes("ToolRack_%d_Stock" % i, [((0.25, 0.25, 0.3), (x + sx * 0.18, F + 0.4 + r * 0.6, -2.4 + j * 0.55)) for sx in (1, -1) for r in range(3) for j in range(6) if (r + j) % 2 == 0],
              mat("StockBox", (0.8, 0.55, 0.2), 0, 0.7), (0, 0, 0), root)
    furn("Workbench", (2.6, 0.95, 0.9), (-5.6, F + 0.475, -4.3), WOOD(), root)
    box("Vise", (0.25, 0.2, 0.3), (-6.6, F + 1.05, -4.3), DARKM(), pivot=(0, 0, 0), parent=root)
    loot("Toolkit", 0, (-5.0, F + 0.97, -4.3), root, yaw=0.3)
    # checkout counter by the door
    furn("Checkout", (2.4, 1.0, 0.7), (4.6, F + 0.5, 3.2), mat("CounterWood", (0.4, 0.25, 0.12), 0, 0.5), root)
    loot("Register", 0, (4.0, F + 1.02, 3.2), root, yaw=math.pi)
    spot("Cashier", (4.6, F, 2.3), root)
    # weapon & tool counter: glass display case + locked wall rack
    case_z = -hd + 1.6
    furn("WeaponCase", (5.6, 1.0, 0.7), (3.4, F + 0.5, case_z), mat("CaseWood", (0.25, 0.14, 0.08), 0, 0.5), root)
    box("WeaponCase_Glass", (5.5, 0.3, 0.68), (3.4, F + 1.15, case_z), PANE(), pivot=(0, 0, 0), parent=root)
    box("WeaponRack", (5.6, 1.6, 0.12), (3.4, F + 1.9, -hd + T / 2 + 0.08), mat("RackGreen", (0.15, 0.25, 0.18), 0, 0.8), pivot=(0, 0, 0), parent=root)
    text_mesh("WeaponSign", "TOOLS · ARMS · AMMO", (3.4, F + 2.95, -hd + T / 2 + 0.16), 0.28, mat("Lamp_Sign", (1, 1, 1), 0, 0.3, emit=(1, 0.95, 0.85), emit_strength=2), parent=root, depth=0.03)
    shop("Crowbar", (1.4, F + 1.95, -hd + T / 2 + 0.22), root, yaw=0, price=60)
    shop("Pistol", (2.6, F + 1.95, -hd + T / 2 + 0.22), root, yaw=0, price=450)
    shop("Shotgun", (4.2, F + 1.95, -hd + T / 2 + 0.22), root, yaw=0, price=950)
    shop("Ammo", (5.6, F + 1.04, case_z), root, yaw=0.2, price=40)
    shop("Jerrycan", (-6.6, F, 4.6), root, yaw=0.4, price=25)
    shop("Mask", (-2.0, F + 1.0, 4.3), root, yaw=math.pi, price=15)
    furn("MaskStand", (0.6, 1.0, 0.6), (-2.0, F + 0.5, 4.3), WOOD(), root)
    spot("Clerk", (3.4, F, case_z - 0.75), root)
    spot("Counter", (3.4, F, case_z + 1.0), root)
    for i, (x, z) in enumerate(((-4, 1.5), (3, 1.5), (-4, -3.5), (3, -3.5))):
        fixture("Shop_%d" % i, (x, F + 3.45, z), root)
    light_switch("Main", (-1.3, F + 1.3, hd - T / 2 - 0.02), '-z', root)
    spot("BackIn", (4.0, F, -hd + 1.2), root)
    spot("BackOut", (4.0, 0, -hd - 1.3), root)
    # back alley: chain-link fence, dumpster, crates, the fence's lamp
    az = -hd - 4.0
    beams("Alley_Fence", [((x, 0, az - 0.5), (x, 2.4, az - 0.5), 0.06) for x in range(-8, 9, 2)] + [((-8, y, az - 0.5), (8, y, az - 0.5), 0.05) for y in (0.1, 1.2, 2.4)],
          0.06, STEEL(), (0, 0, 0), root)
    box("Alley_Mesh", (16, 2.3, 0.02), (0, 1.25, az - 0.5), mat("ChainLink", (0.5, 0.52, 0.55), 0.6, 0.5, alpha=0.35), pivot=(0, 0, 0), parent=root)
    col("Alley_Fence", (16, 2.4, 0.2), (0, 1.2, az - 0.5), root)
    furn("Dumpster", (2.0, 1.3, 1.1), (-4.5, 0.65, az + 0.9), mat("DumpsterGreen", (0.12, 0.3, 0.15), 0.4, 0.6), root)
    box("Dumpster_Lid", (2.05, 0.08, 1.15), (-4.5, 1.34, az + 0.9), mat("DumpsterLid", (0.05, 0.05, 0.05), 0.2, 0.7), pivot=(0, 0, 0), parent=root)
    for i, (x, z) in enumerate(((5.5, az + 1.0), (6.4, az + 0.8))):
        furn("Alley_Crate_%d" % i, (0.8, 0.8, 0.8), (x, 0.4, z), WOOD(), root)
    box("Alley_Lamp", (0.4, 0.2, 0.3), (2.0, 3.2, -hd - 0.3), mat("Lamp_Street", (1, 0.85, 0.55), 0, 0.3, emit=(1, 0.75, 0.4), emit_strength=4), pivot=(0, 0, 0), parent=root)
    empty("LightPoint", (2.0, 3.0, -hd - 0.6), root)
    spot("Fence", (1.5, 0, az + 1.1), root)
    text_mesh("Sign_Text", "HARDWARE", (0, 4.0, hd + 0.3), 0.8, mat("Lamp_Sign", (1, 1, 1), 0, 0.3, emit=(1, 0.95, 0.85), emit_strength=2), parent=root, depth=0.08)
    box("Sign_Board", (w * 0.6, 1.3, 0.25), (0, 4.0, hd + 0.15), mat("SignDark", (0.08, 0.05, 0.1), 0, 0.5), pivot=(0, 0, 0), parent=root)
    boxes("Awning", [((w * 0.9 / 8, 0.12, 1.8), (-w * 0.45 + (i + 0.5) * w * 0.9 / 8, 3.3, hd + 0.9), Matrix.Rotation(math.radians(-15), 3, 'X')) for i in range(0, 8, 2)],
          mat("AwningRed", (0.75, 0.1, 0.08), 0, 0.7), (0, 0, 0), root)
    boxes("Awning2", [((w * 0.9 / 8, 0.12, 1.8), (-w * 0.45 + (i + 0.5) * w * 0.9 / 8, 3.3, hd + 0.9), Matrix.Rotation(math.radians(-15), 3, 'X')) for i in range(1, 8, 2)],
          TRIM(), (0, 0, 0), root)
    export_glb("hardware.glb")
    render_preview("blender_hardware.png", elev=15, azim=25)
    for o in bpy.data.objects:
        if o.name.startswith(("Ceiling", "Cornice", "Roof_Slab", "Wall_Front", "Sign_", "Awning")):
            o["preview_hide"] = 1
    render_preview("blender_hardware_interior.png", elev=55, azim=15, dist_mul=0.8)


def build_police():
    """Police station: lobby (desk, wanted posters, benches), holding cell with hinged barred door, evidence locker
    room (stealable confiscated cash + weapons) and armory, all walkable; portico, flagpole and blue lamps outside."""
    w, d, h, F = 22.0, 14.0, 8.0, 0.15
    hw, hd = w / 2, d / 2
    root, F, T, m = shop_shell("PoliceStation", w, d, h, (0.55, 0.55, 0.6), 3.6, door_w=1.6,
                               front_windows=[(x, 2.2, F + 0.9, F + 2.6) for x in (-8.5, -4.5, 4.5, 8.5)], back_door=(-8.0, 1.0, 2.3))
    windows_row("Upper_Windows", [x for x in (-w / 3, -w / 9, w / 9, w / 3)], h - 2.0, hd + 0.16, 1.2, 1.6, root, lit=True)
    box("Floor", (w - 0.3, 0.01, d - 0.3), (0, F + 0.005, 0), mat("TerrazzoFloor", (0.62, 0.62, 0.6), 0.1, 0.4), pivot=(0, 0, 0), parent=root, uv_scale=0.8)
    pw = mat("PoliceInner", (0.7, 0.74, 0.78), 0, 0.85)
    zp = 1.0  # lobby | back rooms
    openwall("Part_Lobby", (-hw + T / 2, zp), (hw - T / 2, zp), 3.6, 0.15, pw, root, doors=[(-7.0, 1.1, 2.2), (0.0, 1.3, 2.3), (7.0, 1.1, 2.2)], y0=F)
    openwall("Part_West", (-3.0, -hd + T / 2), (-3.0, zp), 3.6, 0.15, pw, root, y0=F)
    openwall("Part_East", (3.0, -hd + T / 2), (3.0, zp), 3.6, 0.15, pw, root, y0=F)
    hinged_door("Door_Evidence", 'x', zp, -7.0, 1.1, 2.2, F, (0, -1), root, mat("DoorSteel", (0.6, 0.62, 0.65), 0.7, 0.4))
    # lobby: desk, monitor, posters, benches, flags
    furn("FrontDesk", (5.0, 1.1, 0.8), (1.0, F + 0.55, 3.6), mat("DeskWood", (0.3, 0.18, 0.1), 0, 0.5), root)
    box("FrontDesk_Top", (5.1, 0.05, 0.9), (1.0, F + 1.12, 3.6), mat("Formica", (0.9, 0.9, 0.85)), pivot=(0, 0, 0), parent=root)
    box("Monitor", (0.5, 0.35, 0.05), (2.2, F + 1.4, 3.3), mat("Lamp_Monitor", (0.2, 0.5, 1), 0, 0.2, emit=(0.2, 0.5, 1), emit_strength=1.6), pivot=(0, 0, 0), parent=root)
    spot("Desk", (1.0, F, 2.6), root)
    poster = mat("Poster", (0.9, 0.85, 0.7), 0, 0.9)
    for i, x in enumerate((-9.0, -7.8, -6.6)):
        box("Poster_%d" % i, (0.9, 1.2, 0.02), (x, F + 1.7, zp + 0.1), poster, pivot=(0, 0, 0), parent=root)
    for i, x in enumerate((5.4, 6.6)):
        box("Poster_%d" % (i + 3), (0.9, 1.2, 0.02), (x, F + 1.7, zp + 0.1), poster, pivot=(0, 0, 0), parent=root)
    for i, x in enumerate((-8.5, 8.5)):
        furn("Bench_%d" % i, (2.2, 0.5, 0.5), (x, F + 0.25, hd - 0.7), WOOD(), root)
    # holding cell (bars + hinged barred door) in the middle back room
    cz = -3.0
    bars = [((x, F, cz), (x, F + 3.0, cz), 0.05) for x in [-2.8 + i * 0.2 for i in range(29)] if not (-0.6 < x < 0.6)]
    bars += [((-2.9, F + y, cz), (2.9, F + y, cz), 0.06) for y in (0.1, 1.5, 2.95)]
    beams("Cell_Bars", bars, 0.05, IRON(), (0, 0, 0), root)
    col("Cell_Bars_W", (2.3, 3.0, 0.12), (-1.75, F + 1.5, cz), root)
    col("Cell_Bars_E", (2.3, 3.0, 0.12), (1.75, F + 1.5, cz), root)
    cd = empty("Cell_Door", (-0.6, F, cz), root, props={"hinge": "y", "open": -1.4})
    beams("Cell_Door_Bars", [((x, F + 0.05, cz), (x, F + 2.9, cz), 0.05) for x in (-0.5, -0.3, -0.1, 0.1, 0.3, 0.5)] +
          [((-0.6, F + y, cz), (0.6, F + y, cz), 0.06) for y in (0.1, 1.5, 2.85)], 0.05, IRON(), (-0.6, F, cz), cd)
    col("Cell_Door", (1.2, 2.9, 0.12), (0, F + 1.45, cz), cd)
    furn("Cell_Bench", (2.6, 0.45, 0.5), (0, F + 0.22, -hd + 0.6), STEEL(), root)
    spot("Cell", (0, F, -5.0), root)
    # evidence locker room (west)
    for i in range(6):
        furn("Locker_%d" % i, (0.6, 2.0, 0.55), (-10.4, F + 1.0, -6.0 + i * 0.65), mat("LockerGrey", (0.45, 0.5, 0.55), 0.6, 0.5), root)
    furn("Evidence_Table", (1.6, 0.8, 0.9), (-6.5, F + 0.4, -3.0), STEEL(), root)
    loot("Evidence", 0, (-6.8, F + 0.82, -3.0), root, yaw=0.4)
    furn("Evidence_Shelf", (2.4, 1.9, 0.5), (-6.0, F + 0.95, -hd + 0.45), STEEL(), root)
    boxes("Evidence_Boxes", [((0.45, 0.3, 0.35), (-7.0 + j * 0.55, F + 0.35 + r * 0.6, -hd + 0.45)) for j in range(4) for r in range(3) if (j + r) % 2],
          mat("Cardboard", (0.6, 0.45, 0.28), 0, 0.9), (0, 0, 0), root)
    furn("Evidence_Rack", (0.4, 1.4, 2.0), (-3.5, F + 0.7, -4.5), mat("RackGreen", (0.15, 0.25, 0.18), 0, 0.8), root)
    shop("EvidencePistol", (-3.75, F + 1.1, -4.9), root, yaw=-math.pi / 2, price=0)
    shop("EvidenceShotgun", (-3.75, F + 1.1, -3.9), root, yaw=-math.pi / 2, price=0)
    spot("Evidence", (-6.5, F, -1.5), root)
    # armory (east)
    for i in range(3):
        furn("GunRack_%d" % i, (0.35, 1.8, 1.8), (10.5, F + 0.9, -5.5 + i * 2.1), mat("RackGreen", (0.15, 0.25, 0.18)), root)
        beams("GunRack_%d_Rifles" % i, [((10.3, F + 0.4, -6.2 + i * 2.1 + k * 0.28), (10.3, F + 1.6, -6.2 + i * 2.1 + k * 0.28), 0.06) for k in range(6)], 0.06, DARKM(), (0, 0, 0), root)
    furn("Armory_Bench", (1.6, 0.9, 0.7), (6.5, F + 0.45, -5.8), STEEL(), root)
    shop("ArmoryAmmo", (6.5, F + 0.92, -5.8), root, yaw=0, price=0)
    spot("Armory", (6.0, F, -2.5), root)
    for i, (x, z) in enumerate(((-6, 4), (0, 4), (6, 4), (-7, -3), (0, -1.5), (7, -3))):
        fixture("Station_%d" % i, (x, F + 3.45, z), root, color="#e8f0ff")
    light_switch("Main", (1.25, F + 1.3, hd - T / 2 - 0.02), '-z', root)
    spot("BackIn", (-8.0, F, -hd + 1.2), root)
    spot("BackOut", (-8.0, 0, -hd - 1.3), root)
    # portico, flag, blue lamps, sign
    boxes("Columns", [((0.6, 3.4, 0.6), (x, 1.7, hd + 2.0)) for x in (-3, -1.4, 1.4, 3)], TRIM(), (0, 0, 0), root)
    box("Portico", (8, 0.5, 2.8), (0, 3.6, hd + 1.4), TRIM(), pivot=(0, 0, 0), parent=root)
    for x in (-3, -1.4, 1.4, 3):
        col("Column_%d" % int(x * 10), (0.6, 3.4, 0.6), (x, 1.7, hd + 2.0), root)
    boxes("Blue_Lamps", [((0.4, 0.6, 0.4), (sx * 4.5, 2.6, hd + 0.3)) for sx in (1, -1)], mat("Lamp_PoliceBlue", (0.05, 0.1, 0.8), 0, 0.2, emit=(0.1, 0.2, 1), emit_strength=3), (0, 0, 0), root)
    cyl("Flagpole", 0.08, 12, (w / 2 + 2, 6, hd + 2), STEEL(), seg=8, pivot=(0, 0, 0), parent=root)
    box("Flag", (2.4, 1.4, 0.03), (w / 2 + 3.25, 11.2, hd + 2), mat("FlagBlue", (0.1, 0.15, 0.5), 0, 0.8), pivot=(0, 0, 0), parent=root)
    col("Flagpole", (0.2, 12, 0.2), (w / 2 + 2, 6, hd + 2), root)
    box("Sign_Board", (w * 0.6, 1.3, 0.25), (0, 4.6, hd + 0.15), mat("SignDark", (0.08, 0.05, 0.1), 0, 0.5), pivot=(0, 0, 0), parent=root)
    text_mesh("Sign_Text", "POLICE", (0, 4.6, hd + 0.3), 0.8, mat("Lamp_PoliceBlue", (0.05, 0.1, 0.8), 0, 0.2, emit=(0.1, 0.2, 1), emit_strength=3), parent=root, depth=0.08)
    export_glb("police_station.glb")
    render_preview("blender_police_station.png", elev=15, azim=25)
    for o in bpy.data.objects:
        if o.name.startswith(("Ceiling", "Cornice", "Roof_Slab", "Wall_Front", "Sign_", "Portico", "Upper_Windows", "Columns")):
            o["preview_hide"] = 1
    render_preview("blender_police_station_interior.png", elev=55, azim=15, dist_mul=0.8)


# ========================================================================== PROPS
def build_props():
    reset_scene()
    root = empty("Props", (0, 0, 0))
    X = [0.0]

    def grp(name, w=2.5, **props):
        g = empty(name, (X[0], 0, 0), root, props=props or None)
        X[0] += w
        return g, X[0] - w

    # pumpkins
    g, x = grp("Pumpkin", 1.2)
    lathe("Pumpkin_Body", [(0.0, 0.0), (0.22, 0.04), (0.3, 0.18), (0.24, 0.34), (0.0, 0.36)], (x, 0, 0), PUMPKIN(), axis='y', seg=20, pivot=(x, 0, 0), parent=g, waves=(10, 0.07))
    cyl("Pumpkin_Stem", 0.035, 0.12, (x, 0.4, 0), mat("Stem", (0.2, 0.3, 0.1), 0, 0.8), seg=6, pivot=(x, 0, 0), parent=g)
    g, x = grp("Pumpkin_Lantern", 1.2, light=1)
    lathe("Lantern_Body", [(0.0, 0.0), (0.24, 0.04), (0.32, 0.2), (0.26, 0.38), (0.0, 0.4)], (x, 0, 0), PUMPKIN(), axis='y', seg=20, pivot=(x, 0, 0), parent=g, waves=(10, 0.07))
    cyl("Lantern_Stem", 0.035, 0.12, (x, 0.44, 0), mat("Stem", (0.2, 0.3, 0.1)), seg=6, pivot=(x, 0, 0), parent=g)
    face = [((0.1, 0.09, 0.08), (x - 0.11, 0.25, 0.3), Matrix.Rotation(math.radians(45), 3, 'Z')),
            ((0.1, 0.09, 0.08), (x + 0.11, 0.25, 0.3), Matrix.Rotation(math.radians(45), 3, 'Z')),
            ((0.07, 0.07, 0.08), (x, 0.17, 0.32), Matrix.Rotation(math.radians(45), 3, 'Z'))]
    face += [((0.06, 0.06 if i % 2 else 0.1, 0.08), (x - 0.15 + i * 0.06, 0.09, 0.29)) for i in range(6)]
    boxes("Lantern_Face", face, GLOW(), (x, 0, 0), g)
    # tombstones
    g, x = grp("Tombstone_Round", 1.5)
    boxes("Tomb_R_Slab", [((0.9, 1.0, 0.22), (x, 0.5, 0))], STONE(), (x, 0, 0), g)
    cyl("Tomb_R_Top", 0.45, 0.22, (x, 1.0, 0), STONE(), axis='z', seg=16, pivot=(x, 0, 0), parent=g)
    box("Tomb_R_Base", (1.1, 0.2, 0.45), (x, 0.1, 0), MOSS(), pivot=(x, 0, 0), parent=g)
    text_mesh("Tomb_R_RIP", "R.I.P", (x, 0.85, 0.12), 0.2, mat("Engraving", (0.15, 0.15, 0.16), 0, 1), parent=g, depth=0.02)
    g, x = grp("Tombstone_Cross", 1.5)
    boxes("Tomb_C", [((0.2, 1.6, 0.2), (x, 0.8, 0)), ((0.9, 0.2, 0.2), (x, 1.15, 0)), ((0.6, 0.25, 0.4), (x, 0.12, 0))], STONE(), (x, 0, 0), g)
    g, x = grp("Tombstone_Obelisk", 1.5)
    boxes("Tomb_O", [((0.8, 0.4, 0.8), (x, 0.2, 0)), ((0.55, 2.0, 0.55), (x, 1.4, 0))], MOSS(), (x, 0, 0), g)
    cyl("Tomb_O_Tip", 0.0, 0.5, (x, 2.65, 0), MOSS(), seg=4, r2=0.39, pivot=(x, 0, 0), parent=g)
    g, x = grp("Tombstone_Slab", 2.0)
    boxes("Tomb_S", [((1.0, 0.3, 2.0), (x, 0.15, 0)), ((0.9, 0.8, 0.18), (x, 0.55, -0.95), Matrix.Rotation(math.radians(-14), 3, 'X'))], STONE(), (x, 0, 0), g)
    # crypt (with hinged iron door)
    g, x = grp("Crypt", 7)
    boxes("Crypt_Body", [((4.2, 3.4, 5), (x, 1.9, 0)), ((5, 0.4, 5.8), (x, 0.2, 0))], MOSS(), (x, 0, 0), g, uv_scale=0.6)
    profile("Crypt_Roof", [(3.1, 3.6), (0, 4.7), (-3.1, 3.6)], x - 2.5, x + 2.5, STONE(), (x, 0, 0), g)
    # roof runs along z: build profile in x then the gable faces front: use pediment boxes
    boxes("Crypt_Columns", [((0.4, 3.3, 0.4), (x + sx, 1.85, 2.9)) for sx in (-1.7, -0.6, 0.6, 1.7)], STONE(), (x, 0, 0), g)
    box("Crypt_Lintel", (4.4, 0.5, 0.8), (x, 3.7, 2.8), STONE(), pivot=(x, 0, 0), parent=g)
    text_mesh("Crypt_Name", "FAMILY  VLAD", (x, 3.7, 3.22), 0.32, mat("Engraving", (0.15, 0.15, 0.16)), parent=g, depth=0.02)
    door = box("CryptDoor", (1.4, 2.4, 0.1), (x - 0.7, 1.6, 2.53), IRON(), pivot=(x - 1.4, 1.6, 2.53), parent=g, props={"hinge": "y", "open": -1.4})
    beams("CryptDoor_Bars", [((x - 1.4 + i * 0.28, 0.5, 2.6), (x - 1.4 + i * 0.28, 2.7, 2.6), 0.04) for i in range(1, 5)], 0.04, mat("RustIron", (0.35, 0.15, 0.07), 0.6, 0.6), (x - 1.4, 1.6, 2.53), door)
    box("CryptDoor_Fixed", (1.4, 2.4, 0.1), (x + 0.7, 1.6, 2.53), IRON(), pivot=(x, 0, 0), parent=g)
    col("Crypt", (4.4, 4.0, 5.2), (x, 2.0, 0), g)
    # trees
    g, x = grp("Tree_Autumn", 7)
    beams("Tree_Trunk", [((x, 0, 0), (x + 0.2, 3.2, 0.1), 0.6, 0.35), ((x + 0.2, 3.0, 0.1), (x + 1.4, 4.6, 0.4), 0.3, 0.15),
                         ((x + 0.2, 3.0, 0.1), (x - 1.2, 4.8, -0.3), 0.3, 0.15), ((x + 0.2, 3.2, 0.1), (x + 0.1, 5.3, -0.2), 0.28, 0.12)], 0.4, mat("Bark", (0.22, 0.15, 0.1), 0, 0.95), (x, 0, 0), g)
    bm = bmesh.new()
    for (cx, cy, cz, rr) in ((0.2, 5.6, 0, 2.0), (1.6, 5.0, 0.5, 1.5), (-1.3, 5.1, -0.3, 1.6), (0.3, 6.6, 0.2, 1.4), (-0.5, 4.6, 1.2, 1.2), (0.8, 4.8, -1.2, 1.3)):
        m = Matrix.Translation((x + cx, cy, cz)) @ Matrix.Diagonal((rr, rr * 0.85, rr, 1))
        res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0, matrix=m)
        for v in res["verts"]:
            v.co += Vector((random.uniform(-0.15, 0.15), random.uniform(-0.15, 0.15), random.uniform(-0.15, 0.15)))
    mesh_from_bm("Tree_Foliage", bm, (x, 0, 0), mat("Foliage", (0.95, 0.45, 0.08), 0, 0.8), g)
    col("Tree", (0.6, 4, 0.6), (x, 2, 0), g)
    g, x = grp("Tree_Dead", 6)
    segs = []

    def branch(p, d, L, t, depth):
        q = (p[0] + d[0] * L, p[1] + d[1] * L, p[2] + d[2] * L)
        segs.append((p, q, t, t * 0.6))
        if depth == 0:
            return
        for k in range(2 + (depth > 1)):
            nd = Vector((d[0] + random.uniform(-0.9, 0.9), d[1] + random.uniform(-0.1, 0.5), d[2] + random.uniform(-0.9, 0.9))).normalized()
            branch(q, nd, L * random.uniform(0.55, 0.75), t * 0.6, depth - 1)
    branch((x, 0, 0), (0.1, 1, 0.05), 3.0, 0.5, 4)
    beams("DeadTree", segs, 0.3, mat("DeadBark", (0.12, 0.1, 0.09), 0, 1.0), (x, 0, 0), g)
    col("DeadTree", (0.5, 3, 0.5), (x, 1.5, 0), g)
    # streetlight + lanterns
    g, x = grp("Streetlight", 2.5, light=1)
    beams("Lamp_Pole", [((x, 0, 0), (x, 6.0, 0), 0.18, 0.12), ((x, 6.0, 0), (x, 6.3, 1.4), 0.1)], 0.15, IRON(), (x, 0, 0), g)
    box("Lamp_Head", (0.5, 0.25, 0.7), (x, 6.25, 1.6), IRON(), pivot=(x, 0, 0), parent=g)
    box("Lamp_Bulb", (0.36, 0.08, 0.5), (x, 6.09, 1.6), LAMP(), pivot=(x, 0, 0), parent=g)
    empty("LightPoint", (x, 5.9, 1.6), g)
    col("Streetlight", (0.3, 6, 0.3), (x, 3, 0), g)
    g, x = grp("Lantern_Post", 1.5, light=1)
    beams("LPost", [((x, 0, 0), (x, 1.8, 0), 0.12)], 0.12, IRON(), (x, 0, 0), g)
    box("LPost_Cage", (0.35, 0.45, 0.35), (x, 2.0, 0), IRON(), pivot=(x, 0, 0), parent=g)
    box("LPost_Glow", (0.28, 0.36, 0.38), (x, 2.0, 0), mat("Lamp_Candle", (1, 0.7, 0.3), 0, 0.3, emit=(1, 0.55, 0.15), emit_strength=4), pivot=(x, 0, 0), parent=g)
    box("LPost_Glow2", (0.38, 0.36, 0.28), (x, 2.0, 0), mat("Lamp_Candle", (1, 0.7, 0.3)), pivot=(x, 0, 0), parent=g)
    cyl("LPost_Cap", 0.0, 0.25, (x, 2.35, 0), IRON(), seg=4, r2=0.3, pivot=(x, 0, 0), parent=g)
    empty("LightPoint", (x, 2.0, 0), g)
    # ghost (sheet)
    g, x = grp("Ghost", 1.5)
    lathe("Ghost_Sheet", [(0.48, 0.0), (0.42, 0.4), (0.35, 1.0), (0.32, 1.35), (0.22, 1.6), (0.0, 1.68)], (x, 0, 0),
          mat("GhostSheet", (0.95, 0.95, 1.0), 0, 0.6, emit=(0.5, 0.55, 0.6), emit_strength=0.5), axis='y', seg=20, pivot=(x, 0, 0), parent=g, waves=(7, 0.1))
    boxes("Ghost_Eyes", [((0.08, 0.14, 0.05), (x + dx, 1.38, 0.32)) for dx in (-0.1, 0.1)] + [((0.12, 0.12, 0.05), (x, 1.18, 0.34))], mat("GhostEye", (0.02, 0.02, 0.02), 0, 1), (x, 0, 0), g)
    # fence
    g, x = grp("Fence_Iron", 4.5)
    bars = [((x - 2 + i * 0.25, 0, 0), (x - 2 + i * 0.25, 1.6, 0), 0.04) for i in range(17)]
    bars += [((x - 2, y, 0), (x + 2, y, 0), 0.05) for y in (0.2, 1.4)]
    beams("Fence_Bars", bars, 0.04, IRON(), (x, 0, 0), g)
    boxes("Fence_Spikes", [((0.07, 0.16, 0.07), (x - 2 + i * 0.25, 1.65, 0), Matrix.Rotation(math.radians(45), 3, 'Y')) for i in range(17)], IRON(), (x, 0, 0), g)
    col("Fence", (4, 1.7, 0.15), (x, 0.85, 0), g)
    # street furniture (breakable)
    g, x = grp("Hydrant", 1.0, breakable=1)
    cyl("Hydrant_Body", 0.16, 0.7, (x, 0.35, 0), mat("HydrantRed", (0.8, 0.1, 0.05), 0.3, 0.5), seg=12, pivot=(x, 0, 0), parent=g)
    sphere("Hydrant_Cap", 0.17, (x, 0.72, 0), mat("HydrantRed", (0.8, 0.1, 0.05)), pivot=(x, 0, 0), parent=g)
    cyl("Hydrant_Nozzle", 0.07, 0.4, (x, 0.45, 0), mat("HydrantRed", (0.8, 0.1, 0.05)), axis='x', seg=8, pivot=(x, 0, 0), parent=g)
    g, x = grp("Mailbox", 1.0, breakable=1)
    beams("Mailbox_Post", [((x, 0, 0), (x, 1.0, 0), 0.1)], 0.1, WOOD(), (x, 0, 0), g)
    box("Mailbox_Box", (0.25, 0.25, 0.5), (x, 1.12, 0), mat("MailboxBlack", (0.05, 0.05, 0.06), 0.6, 0.4), pivot=(x, 0, 0), parent=g)
    box("Mailbox_Flag", (0.02, 0.2, 0.06), (x + 0.14, 1.25, -0.1), mat("HydrantRed", (0.8, 0.1, 0.05)), pivot=(x, 0, 0), parent=g)
    g, x = grp("Bench", 2.2)
    boxes("Bench", [((1.8, 0.08, 0.5), (x, 0.45, 0)), ((1.8, 0.4, 0.06), (x, 0.75, -0.24)), ((0.08, 0.45, 0.5), (x - 0.8, 0.22, 0)), ((0.08, 0.45, 0.5), (x + 0.8, 0.22, 0))], WOOD(), (x, 0, 0), g)
    col("Bench", (1.8, 0.9, 0.55), (x, 0.45, 0), g)
    g, x = grp("HayBale", 1.6, breakable=1)
    box("Hay", (1.2, 0.6, 0.7), (x, 0.3, 0), mat("Hay", (0.85, 0.7, 0.3), 0, 1.0), pivot=(x, 0, 0), parent=g)
    g, x = grp("Scarecrow", 1.8)
    beams("Scarecrow_Frame", [((x, 0, 0), (x, 2.0, 0), 0.08), ((x - 0.8, 1.5, 0), (x + 0.8, 1.5, 0), 0.07)], 0.08, WOOD(), (x, 0, 0), g)
    box("Scarecrow_Shirt", (0.7, 0.7, 0.3), (x, 1.35, 0), mat("Flannel", (0.6, 0.15, 0.1), 0, 0.9), pivot=(x, 0, 0), parent=g)
    lathe("Scarecrow_Head", [(0.0, -0.18), (0.18, -0.12), (0.22, 0.0), (0.16, 0.13), (0.0, 0.18)], (x, 2.0, 0), PUMPKIN(), axis='y', seg=14, pivot=(x, 0, 0), parent=g, waves=(8, 0.06))
    boxes("Scarecrow_Face", [((0.06, 0.06, 0.05), (x + dx, 2.05, 0.2)) for dx in (-0.07, 0.07)], GLOW(), (x, 0, 0), g)
    cyl("Scarecrow_Hat", 0.32, 0.04, (x, 2.17, 0), mat("Hay", (0.85, 0.7, 0.3)), seg=14, pivot=(x, 0, 0), parent=g)
    cyl("Scarecrow_HatTop", 0.15, 0.25, (x, 2.3, 0), mat("Hay", (0.85, 0.7, 0.3)), seg=12, r2=0.1, pivot=(x, 0, 0), parent=g)
    # factory / kiosk furniture
    g, x = grp("Kiosk", 2.0)
    boxes("Kiosk_Body", [((0.8, 1.0, 0.5), (x, 0.5, 0)), ((0.9, 0.08, 0.6), (x, 1.04, 0.05))], mat("KioskBlack", (0.06, 0.06, 0.07), 0.4, 0.3), (x, 0, 0), g)
    box("Kiosk_Screen", (0.8, 0.55, 0.06), (x, 1.45, 0.0), mat("Lamp_Screen", (0.2, 0.6, 1), 0, 0.2, emit=(0.3, 0.6, 1.0), emit_strength=2), pivot=(x, 0, 0), parent=g,
        rot=Matrix.Rotation(math.radians(-20), 3, 'X'))
    col("Kiosk", (0.9, 1.6, 0.6), (x, 0.8, 0), g)
    g, x = grp("InfoPanel", 1.5)
    beams("Info_Post", [((x, 0, 0), (x, 1.2, 0), 0.08)], 0.08, STEEL(), (x, 0, 0), g)
    box("Info_Board", (0.9, 0.6, 0.06), (x, 1.45, 0), mat("Lamp_Info", (1, 0.75, 0.2), 0, 0.3, emit=(1, 0.6, 0.1), emit_strength=1.5), pivot=(x, 0, 0), parent=g)
    text_mesh("Info_E", "E", (x, 1.45, 0.04), 0.35, mat("SignDark", (0.08, 0.05, 0.1)), parent=g, depth=0.02)
    g, x = grp("Turntable", 7)
    cyl("Turntable_Base", 3.2, 0.3, (x, 0.15, 0), mat("KioskBlack", (0.06, 0.06, 0.07)), seg=40, pivot=(x, 0, 0), parent=g)
    cyl("Turntable_Top", 3.0, 0.06, (x, 0.32, 0), mat("TurntableTop", (0.3, 0.3, 0.32), 0.8, 0.3), seg=40, pivot=(x, 0.3, 0), parent=g, props={"joint": "y"})
    cyl("Turntable_Ring", 3.25, 0.05, (x, 0.28, 0), mat("Lamp_Ring", (1, 0.4, 0.05), 0, 0.3, emit=(1, 0.35, 0.02), emit_strength=1.5), seg=40, pivot=(x, 0, 0), parent=g)
    g, x = grp("Barrel", 1.2, breakable=1)
    cyl("Barrel_Body", 0.32, 0.9, (x, 0.45, 0), mat("BarrelBlue", (0.1, 0.25, 0.5), 0.5, 0.5), seg=14, pivot=(x, 0, 0), parent=g)
    g, x = grp("Pallet_Crates", 2.2)
    boxes("Crates", [((1.2, 0.15, 1.2), (x, 0.075, 0)), ((1.0, 0.8, 1.0), (x, 0.55, 0))], WOOD(), (x, 0, 0), g)
    col("Crates", (1.2, 0.95, 1.2), (x, 0.47, 0), g)
    g, x = grp("Skeleton_Prop", 1.5)
    sphere("SkelP_Skull", 0.14, (x, 0.95, 0.1), mat("Bone", (0.9, 0.87, 0.75), 0, 0.7), pivot=(x, 0, 0), parent=g)
    beams("SkelP_Bones", [((x, 0.2, 0), (x, 0.85, 0.05), 0.05), ((x - 0.18, 0.75, 0), (x + 0.18, 0.75, 0), 0.04)] +
          [((x + sx * 0.18, 0.75, 0), (x + sx * 0.3, 0.3, 0.2), 0.035) for sx in (1, -1)] +
          [((x + sx * 0.1, 0.2, 0), (x + sx * 0.15, 0.05, 0.6), 0.04) for sx in (1, -1)], 0.04, mat("Bone", (0.9, 0.87, 0.75)), (x, 0, 0), g)
    boxes("SkelP_Ribs", [((0.3 - k * 0.03, 0.025, 0.2), (x, 0.65 - k * 0.07, 0.05)) for k in range(4)], mat("Bone", (0.9, 0.87, 0.75)), (x, 0, 0), g)
    g, x = grp("Banner", 5)
    beams("Banner_Poles", [((x + sx * 2, 0, 0), (x + sx * 2, 5.5, 0), 0.12) for sx in (1, -1)], 0.12, IRON(), (x, 0, 0), g)
    box("Banner_Cloth", (3.8, 1.2, 0.03), (x, 4.6, 0), mat("BannerCloth", (0.95, 0.5, 0.1), 0, 0.9), pivot=(x, 0, 0), parent=g)
    col("Banner_L", (0.2, 5.5, 0.2), (x + 2, 2.75, 0), g)
    col("Banner_R", (0.2, 5.5, 0.2), (x - 2, 2.75, 0), g)
    # ---- weapons (origin = grip in the hand, barrel along +z, Muzzle_* at the barrel tip)
    GUNM = mat("GunMetal", (0.08, 0.08, 0.09), 0.8, 0.35)
    GUNW = mat("GunWood", (0.35, 0.18, 0.08), 0, 0.55)
    g, x = grp("Weapon_Pistol", 1.0, weapon="pistol")
    boxes("Pistol_Body", [((0.034, 0.045, 0.21), (x, 0.045, 0.06)), ((0.032, 0.13, 0.05), (x, -0.03, -0.01), Matrix.Rotation(math.radians(-14), 3, 'X')),
                          ((0.012, 0.03, 0.06), (x, -0.005, 0.045))], GUNM, (x, 0, 0), g)
    cyl("Pistol_Barrel", 0.011, 0.04, (x, 0.05, 0.18), GUNM, axis='z', seg=8, pivot=(x, 0, 0), parent=g)
    empty("Muzzle_Pistol", (x, 0.05, 0.2), g)
    g, x = grp("Weapon_Shotgun", 1.6, weapon="shotgun")
    boxes("Shotgun_Stock", [((0.05, 0.11, 0.32), (x, -0.03, -0.27), Matrix.Rotation(math.radians(-8), 3, 'X'))], GUNW, (x, 0, 0), g)
    boxes("Shotgun_Receiver", [((0.055, 0.08, 0.26), (x, 0.02, 0.0)), ((0.03, 0.09, 0.05), (x, -0.04, -0.03), Matrix.Rotation(math.radians(-15), 3, 'X'))], GUNM, (x, 0, 0), g)
    cyl("Shotgun_Barrel", 0.019, 0.62, (x, 0.045, 0.43), GUNM, axis='z', seg=10, pivot=(x, 0, 0), parent=g)
    cyl("Shotgun_Tube", 0.015, 0.5, (x, 0.008, 0.38), GUNM, axis='z', seg=8, pivot=(x, 0, 0), parent=g)
    cyl("Shotgun_Pump", 0.028, 0.2, (x, 0.008, 0.33), GUNW, axis='z', seg=10, pivot=(x, 0, 0), parent=g)
    empty("Muzzle_Shotgun", (x, 0.045, 0.75), g)
    g, x = grp("Weapon_Crowbar", 1.0, weapon="crowbar")
    beams("Crowbar_Bar", [((x, 0, -0.08), (x, 0.0, 0.52), 0.03), ((x, 0.0, 0.52), (x, -0.05, 0.6), 0.03), ((x, 0, -0.08), (x, 0.04, -0.13), 0.028)], 0.03,
          mat("CrowbarRed", (0.7, 0.06, 0.04), 0.4, 0.4), (x, 0, 0), g)
    empty("Muzzle_Crowbar", (x, -0.05, 0.6), g)
    g, x = grp("Weapon_Launcher", 1.6, weapon="launcher")
    cyl("Launcher_Tube", 0.075, 0.78, (x, 0.07, 0.12), PUMPKIN(), axis='z', seg=14, pivot=(x, 0, 0), parent=g)
    lathe("Launcher_Muzzle", [(0.0, 0.5), (0.1, 0.52), (0.13, 0.6), (0.1, 0.68), (0.07, 0.69)], (x, 0.07, 0), PUMPKIN(), axis='z', seg=14, pivot=(x, 0, 0), parent=g, waves=(8, 0.08))
    boxes("Launcher_Face", [((0.03, 0.03, 0.02), (x + dx, 0.11, 0.6)) for dx in (-0.04, 0.04)] + [((0.08, 0.02, 0.02), (x, 0.04, 0.62))], GLOW(), (x, 0, 0), g)
    boxes("Launcher_Grip", [((0.04, 0.12, 0.05), (x, -0.03, 0.0)), ((0.05, 0.05, 0.2), (x, 0.0, -0.18))], GUNM, (x, 0, 0), g)
    empty("Muzzle_Launcher", (x, 0.07, 0.72), g)
    # ---- shop items
    g, x = grp("Item_Jerrycan", 1.0, item="jerrycan")
    box("Jerrycan_Body", (0.17, 0.34, 0.3), (x, 0.17, 0), mat("JerryRed", (0.75, 0.06, 0.04), 0.3, 0.5), pivot=(x, 0, 0), parent=g)
    beams("Jerrycan_Handle", [((x, 0.34, -0.1), (x, 0.39, -0.04), 0.03), ((x, 0.39, -0.04), (x, 0.39, 0.04), 0.03), ((x, 0.39, 0.04), (x, 0.34, 0.08), 0.03)], 0.03,
          mat("JerryRed", (0.75, 0.06, 0.04)), (x, 0, 0), g)
    cyl("Jerrycan_Spout", 0.03, 0.08, (x, 0.37, 0.12), mat("Steel", (0.45, 0.47, 0.5), 0.85, 0.35), seg=8, pivot=(x, 0, 0), parent=g)
    g, x = grp("Item_Ammo", 1.0, item="ammo")
    box("Ammo_Box", (0.24, 0.13, 0.15), (x, 0.065, 0), mat("AmmoOlive", (0.25, 0.3, 0.12), 0.2, 0.6), pivot=(x, 0, 0), parent=g)
    box("Ammo_Label", (0.12, 0.05, 0.01), (x, 0.08, 0.08), mat("AmmoYellow", (0.9, 0.75, 0.1), 0, 0.5), pivot=(x, 0, 0), parent=g)
    g, x = grp("Item_Mask", 1.0, item="mask")
    lathe("ItemMask_Head", [(0.0, 0.02), (0.15, 0.05), (0.2, 0.2), (0.16, 0.34), (0.0, 0.38)], (x, 0, 0), PUMPKIN(), axis='y', seg=16, pivot=(x, 0, 0), parent=g, waves=(9, 0.07))
    boxes("ItemMask_Face", [((0.06, 0.06, 0.03), (x + dx, 0.23, 0.18), Matrix.Rotation(math.radians(45), 3, 'Z')) for dx in (-0.07, 0.07)] + [((0.14, 0.035, 0.03), (x, 0.12, 0.18))],
          GLOW(), (x, 0, 0), g)
    # ---- stealable loot (origin at the bottom centre, front facing +z)
    g, x = grp("Loot_TV", 1.2, loot="tv", value=180, heavy=1)
    box("TV_Cabinet", (0.62, 0.5, 0.48), (x, 0.25, 0), mat("TVWood", (0.32, 0.18, 0.08), 0, 0.55), pivot=(x, 0, 0), parent=g)
    box("TV_Bezel", (0.54, 0.42, 0.03), (x, 0.27, 0.245), mat("TVBezel", (0.1, 0.1, 0.1), 0.3, 0.5), pivot=(x, 0, 0), parent=g)
    box("TV_Screen", (0.44, 0.32, 0.02), (x - 0.03, 0.28, 0.262), mat("Lamp_TV", (0.5, 0.7, 1.0), 0, 0.15, emit=(0.45, 0.65, 1.0), emit_strength=2.5), pivot=(x, 0, 0), parent=g)
    boxes("TV_Knobs", [((0.04, 0.04, 0.03), (x + 0.22, 0.38 - k * 0.09, 0.262)) for k in range(3)], CHROME(), (x, 0, 0), g)
    beams("TV_Antenna", [((x, 0.5, -0.05), (x - 0.22, 0.85, -0.08), 0.012), ((x, 0.5, -0.05), (x + 0.24, 0.82, -0.1), 0.012)], 0.012, CHROME(), (x, 0, 0), g)
    g, x = grp("Loot_Register", 1.0, loot="register", value=250, heavy=1)
    boxes("Register_Body", [((0.46, 0.12, 0.42), (x, 0.06, 0)), ((0.42, 0.16, 0.26), (x, 0.2, -0.04), Matrix.Rotation(math.radians(-12), 3, 'X'))],
          mat("RegisterSilver", (0.65, 0.67, 0.7), 0.8, 0.3), (x, 0, 0), g)
    boxes("Register_Keys", [((0.05, 0.02, 0.04), (x - 0.15 + (k % 5) * 0.075, 0.29, -0.08 + (k // 5) * 0.06)) for k in range(15)], mat("KeyIvory", (0.92, 0.9, 0.82), 0, 0.5), (x, 0, 0), g)
    box("Register_Display", (0.22, 0.09, 0.03), (x, 0.36, -0.14), mat("Lamp_RegDisplay", (0.2, 1, 0.3), 0, 0.2, emit=(0.1, 1, 0.3), emit_strength=2), pivot=(x, 0, 0), parent=g)
    box("Register_Drawer", (0.4, 0.07, 0.02), (x, 0.06, 0.21), mat("RegisterDark", (0.15, 0.15, 0.16), 0.5, 0.4), pivot=(x, 0, 0), parent=g)
    g, x = grp("Loot_Jewelry", 0.8, loot="jewelry", value=150, heavy=0)
    box("Jewelry_Box", (0.26, 0.1, 0.18), (x, 0.05, 0), mat("Velvet", (0.35, 0.05, 0.3), 0, 0.9), pivot=(x, 0, 0), parent=g)
    box("Jewelry_Lid", (0.27, 0.025, 0.19), (x, 0.17, -0.12), mat("Velvet", (0.35, 0.05, 0.3)), pivot=(x, 0, 0), parent=g, rot=Matrix.Rotation(math.radians(70), 3, 'X'))
    boxes("Jewelry_Trim", [((0.27, 0.015, 0.015), (x, 0.1, sz * 0.09)) for sz in (1, -1)], mat("Gold", (1.0, 0.78, 0.3), 1.0, 0.25), (x, 0, 0), g)
    for k in range(7):
        sphere("Jewelry_Pearl_%d" % k, 0.018, (x - 0.09 + k * 0.03, 0.11, 0.02 + 0.03 * math.sin(k)), mat("Pearl", (0.95, 0.93, 0.9), 0.2, 0.2), pivot=(x, 0, 0), parent=g, seg=6)
    g, x = grp("Loot_Toolkit", 1.0, loot="toolkit", value=120, heavy=1)
    box("Toolkit_Box", (0.52, 0.24, 0.25), (x, 0.12, 0), mat("ToolboxRed", (0.75, 0.08, 0.05), 0.4, 0.4), pivot=(x, 0, 0), parent=g)
    beams("Toolkit_Handle", [((x - 0.15, 0.24, 0), (x - 0.15, 0.3, 0), 0.02), ((x - 0.15, 0.3, 0), (x + 0.15, 0.3, 0), 0.02), ((x + 0.15, 0.3, 0), (x + 0.15, 0.24, 0), 0.02)],
          0.02, DARKM(), (x, 0, 0), g)
    boxes("Toolkit_Drill", [((0.07, 0.16, 0.06), (x + 0.12, 0.33, 0.07)), ((0.06, 0.06, 0.18), (x + 0.12, 0.42, 0.12))], mat("DrillYellow", (0.95, 0.7, 0.05), 0.2, 0.5), (x, 0, 0), g)
    g, x = grp("Loot_Evidence", 0.8, loot="evidence", value=400, heavy=0)
    box("Evidence_Bag", (0.36, 0.06, 0.46), (x, 0.03, 0), mat("EvidenceBag", (0.85, 0.85, 0.8), 0, 0.3, alpha=0.55), pivot=(x, 0, 0), parent=g)
    boxes("Evidence_Cash", [((0.15, 0.035, 0.07), (x - 0.07 + (k % 2) * 0.14, 0.03, -0.14 + (k // 2) * 0.1)) for k in range(6)], mat("CashGreen", (0.35, 0.55, 0.3), 0, 0.8), (x, 0, 0), g)
    box("Evidence_Label", (0.3, 0.065, 0.08), (x, 0.031, 0.17), mat("EvidenceRed", (0.8, 0.08, 0.06), 0, 0.6), pivot=(x, 0, 0), parent=g)
    g, x = grp("Loot_CandyBowl", 1.0, loot="candybowl", value=40, heavy=0)
    lathe("CandyBowl_Bowl", [(0.06, 0.0), (0.18, 0.03), (0.26, 0.13), (0.27, 0.16)], (x, 0, 0), PUMPKIN(), axis='y', seg=18, pivot=(x, 0, 0), parent=g)
    cand = [(0.95, 0.2, 0.15), (0.2, 0.75, 0.25), (0.95, 0.85, 0.15), (0.55, 0.2, 0.75)]
    for k in range(12):
        a = k * 2.4
        sphere("Candy_%d" % k, 0.035, (x + 0.15 * math.cos(a) * (0.4 + (k % 3) * 0.3), 0.15 + (k % 2) * 0.03, 0.15 * math.sin(a) * (0.4 + (k % 3) * 0.3)),
               mat("Candy_%d" % (k % 4), cand[k % 4], 0.1, 0.3), pivot=(x, 0, 0), parent=g, seg=6)
    g, x = grp("Loot_Radio", 1.0, loot="radio", value=90, heavy=0)
    box("Radio_Body", (0.36, 0.22, 0.14), (x, 0.11, 0), mat("RadioWood", (0.45, 0.25, 0.1), 0, 0.5), pivot=(x, 0, 0), parent=g)
    box("Radio_Grille", (0.18, 0.15, 0.01), (x - 0.07, 0.11, 0.071), mat("RadioCloth", (0.75, 0.65, 0.45), 0, 0.95), pivot=(x, 0, 0), parent=g)
    cyl("Radio_Dial", 0.045, 0.012, (x + 0.1, 0.12, 0.072), mat("Lamp_RadioDial", (1, 0.75, 0.3), 0, 0.3, emit=(1, 0.6, 0.2), emit_strength=1.5), axis='z', seg=12, pivot=(x, 0, 0), parent=g)
    beams("Radio_Handle", [((x - 0.12, 0.22, 0), (x - 0.08, 0.28, 0), 0.015), ((x - 0.08, 0.28, 0), (x + 0.08, 0.28, 0), 0.015), ((x + 0.08, 0.28, 0), (x + 0.12, 0.22, 0), 0.015)],
          0.015, CHROME(), (x, 0, 0), g)
    g, x = grp("Loot_Cash", 0.8, loot="cash", value=0, heavy=0)
    boxes("Cash_Stack", [((0.16, 0.03, 0.07), (x + (k % 2) * 0.02, 0.015 + k * 0.03, (k % 3) * 0.01)) for k in range(4)], mat("CashGreen", (0.35, 0.55, 0.3), 0, 0.8), (x, 0, 0), g)
    boxes("Cash_Bands", [((0.03, 0.032, 0.072), (x + (k % 2) * 0.02, 0.015 + k * 0.03, (k % 3) * 0.01)) for k in range(4)], mat("CashBand", (0.9, 0.85, 0.7), 0, 0.6), (x, 0, 0), g)
    export_glb("props.glb")
    for i, g in enumerate([o for o in root.children]):
        g.location = g2b(((i % 6) * 7.0, 0, -(i // 6) * 7.0))
    render_preview("blender_props.png", elev=32, azim=15, dist_mul=0.62)


BUILDERS = {
    "robot": build_robot_arm, "press": build_press, "crane": build_crane, "doors": build_doors, "gate": build_gate,
    "machines": build_forklift_lift_scanner, "plant": build_plant, "diner": build_diner, "gas": build_gas_station,
    "hardware": build_hardware, "police": build_police, "jumbotron": lambda: build_jumbotron(),
    "houseA": lambda: house("a", 10, 8, 2), "houseB": lambda: house("b", 12, 9, 1, gable_axis='z'),
    "props": build_props,
}

if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for k, fn in BUILDERS.items():
        if not only or k in only:
            fn()
    write_report("world" if not only else "world_" + "_".join(only))
    print("WORLD_DONE")
