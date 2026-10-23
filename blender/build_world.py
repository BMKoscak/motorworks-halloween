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


def wall(name, a, b, h, t, mtl, parent, openings=(), y0=0.0):
    """Axis-aligned wall from a=(x,z) to b=(x,z) with door/window openings [(s0,s1,top)] measured along the wall."""
    ax = 'x' if abs(b[0] - a[0]) > abs(b[1] - a[1]) else 'z'
    L = abs((b[0] - a[0]) if ax == 'x' else (b[1] - a[1]))
    start = min(a[0], b[0]) if ax == 'x' else min(a[1], b[1])
    fixed = a[1] if ax == 'x' else a[0]
    cuts = sorted(openings)
    pieces = []
    cur = 0.0
    for (s0, s1, top) in cuts:
        if s0 > cur:
            pieces.append((cur, s0, y0, h))
        pieces.append((s0, s1, top, h))  # lintel
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
    boxes("Roof_Trusses", [((120, 0.4, 0.3), (0, H - 0.6, z)) for z in range(-20, 21, 8)], STEEL(), (0, 0, 0), root)
    boxes("Columns", [((0.5, H, 0.5), (x, H / 2, z)) for x in range(-24, 60, 16) for z in (-18, 6)], STEEL(), (0, 0, 0), root)
    for x in range(-24, 60, 16):
        for z in (-18, 6):
            col("Column_%d_%d" % (x, z), (0.6, H, 0.6), (x, H / 2, z), root)
    boxes("Ceiling_Lights", [((6, 0.12, 0.8), (x, H - 1.2, z)) for x in range(-50, 56, 14) for z in (-14, -2, 14)],
          mat("Lamp_Ceiling", (1, 1, 0.95), 0, 0.3, emit=(1, 0.95, 0.85), emit_strength=3), (0, 0, 0), root)
    beams("Pipes", [((-58, 9, -24), (58, 9, -24), 0.4), ((-58, 9.6, -23.5), (58, 9.6, -23.5), 0.25), ((-58, 8.4, 24.3), (-34, 8.4, 24.3), 0.3)], 0.3,
          mat("PipeGreen", (0.15, 0.35, 0.2), 0.6, 0.4), (0, 0, 0), root)
    # loading dock + parking stops
    box("Dock", (14, 1.2, 4), (-10, 0.6, -27.2), CONCRETE(), pivot=(0, 0, 0), parent=root)
    col("Dock", (14, 1.2, 4), (-10, 0.6, -27.2), root)
    export_glb("plant.glb")
    render_preview("blender_plant.png", elev=25, azim=-25, dist_mul=0.75)


def house(key, w, d, stories, porch=True, gable_axis='x'):
    reset_scene()
    root = empty("House_" + key, (0, 0, 0))
    h = 3.0 * stories
    box("Foundation", (w + 0.3, 0.6, d + 0.3), (0, 0.3, 0), CONCRETE(), pivot=(0, 0, 0), parent=root)
    boxes("Walls", [((w, h, d), (0, 0.6 + h / 2, 0))], SIDING(), (0, 0, 0), root, uv_scale=1.0)
    col("House", (w + 0.3, h + 0.6, d + 0.3), (0, (h + 0.6) / 2, 0), root)
    rise = 2.6 if stories > 1 else 2.2
    gable_roof("Roof", w, d, 0.6 + h, rise, 0.5, ROOF(), root, axis=gable_axis)
    gable_ends("Gables", w, d, 0.6 + h, rise, SIDING(), root, axis=gable_axis)
    for s in range(stories):
        y = 0.6 + 1.6 + s * 3.0
        xs = [-w / 3, w / 3] if s == 0 else [-w / 3, 0, w / 3]
        windows_row("Windows_F%d" % s, xs, y, d / 2 + 0.03, 1.1, 1.4, root, lit=random.random() > 0.3)
        windows_row("Windows_B%d" % s, [-w / 4, w / 4], y, -d / 2 - 0.03, 1.1, 1.4, root, lit=random.random() > 0.5)
        windows_row("Windows_S%d" % s, [-d / 4, d / 4], y, w / 2 + 0.03, 1.1, 1.4, root, facing='x', lit=random.random() > 0.5)
    box("Door", (1.1, 2.2, 0.08), (0, 1.7, d / 2 + 0.04), mat("DoorRed", (0.45, 0.08, 0.06), 0, 0.6), pivot=(0, 0, 0), parent=root)
    box("Door_Frame", (1.4, 2.4, 0.06), (0, 1.8, d / 2 + 0.02), TRIM(), pivot=(0, 0, 0), parent=root)
    boxes("Chimney", [((0.9, 3.0, 0.9), (w / 3, 0.6 + h + 1.8, -d / 5))], BRICK(), (0, 0, 0), root, uv_scale=0.5)
    if porch:
        box("Porch_Deck", (w * 0.7, 0.25, 2.4), (0, 0.55, d / 2 + 1.2), WOOD(), pivot=(0, 0, 0), parent=root)
        box("Porch_Roof", (w * 0.75, 0.2, 2.8), (0, 3.35, d / 2 + 1.3), ROOF(), pivot=(0, 0, 0), parent=root)
        boxes("Porch_Posts", [((0.18, 2.7, 0.18), (x, 2.0, d / 2 + 2.3)) for x in (-w * 0.33, -w * 0.11, w * 0.11, w * 0.33)], TRIM(), (0, 0, 0), root)
        boxes("Porch_Rail", [((w * 0.25, 0.08, 0.08), (sx * w * 0.22, 1.5, d / 2 + 2.3)) for sx in (1, -1)], TRIM(), (0, 0, 0), root)
        box("Porch_Steps", (1.6, 0.3, 0.6), (0, 0.15, d / 2 + 2.7), WOOD(), pivot=(0, 0, 0), parent=root)
        col("Porch", (w * 0.7, 0.6, 2.4), (0, 0.3, d / 2 + 1.2), root)
        empty("Porch_Spot", (w * 0.25, 0.7, d / 2 + 1.6), root)
    export_glb("house_%s.glb" % key)
    render_preview("blender_house_%s.png" % key, elev=18, azim=30)


def build_diner():
    reset_scene()
    root = empty("Diner", (0, 0, 0))
    W, D, H = 16.0, 9.0, 4.4
    box("Diner_Base", (W + 0.5, 0.6, D + 0.5), (0, 0.3, 0), mat("DinerTile", (0.85, 0.1, 0.12), 0.1, 0.5), pivot=(0, 0, 0), parent=root)
    box("Diner_Body", (W, H, D), (0, 0.6 + H / 2, 0), mat("DinerSteel", (0.85, 0.87, 0.9), 0.9, 0.2), pivot=(0, 0, 0), parent=root)
    for sx in (1, -1):
        cyl("Diner_End_%d" % sx, D / 2, H, (sx * W / 2, 0.6 + H / 2, 0), mat("DinerSteel", (0.85, 0.87, 0.9)), seg=20, pivot=(0, 0, 0), parent=root)
    col("Diner", (W + D, H + 0.6, D), (0, (H + 0.6) / 2, 0), root)
    boxes("Diner_Stripes", [((W + 0.2, 0.25, D + 0.2), (0, y, 0)) for y in (1.4, 4.4)], mat("DinerRed", (0.8, 0.05, 0.08), 0.3, 0.4), (0, 0, 0), root)
    windows_row("Diner_Windows", [x for x in (-6, -3.6, -1.2, 3.6, 6)], 2.8, D / 2 + 0.03, 2.0, 1.6, root, frame=False)
    box("Diner_Door", (1.4, 2.6, 0.08), (1.2, 1.9, D / 2 + 0.04), mat("Glass", (0.4, 0.55, 0.6), 0.0, 0.05, alpha=0.35), pivot=(0, 0, 0), parent=root)
    box("Diner_RoofCap", (W + 0.4, 0.35, D + 0.4), (0, 0.6 + H + 0.17, 0), mat("DinerRed", (0.8, 0.05, 0.08)), pivot=(0, 0, 0), parent=root)
    box("Diner_Awning", (W, 0.15, 1.6), (0, 4.0, D / 2 + 0.8), mat("AwningTeal", (0.1, 0.6, 0.6), 0, 0.6), pivot=(0, 0, 0), parent=root)
    boxes("Diner_SignPosts", [((0.25, 3, 0.25), (x, 6.5, 0)) for x in (-3, 3)], STEEL(), (0, 0, 0), root)
    box("Diner_SignBoard", (9, 2.2, 0.4), (0, 8.6, 0), mat("SignDark", (0.08, 0.05, 0.1), 0, 0.5), pivot=(0, 0, 0), parent=root)
    text_mesh("Diner_Neon", "MOONLITE DINER", (0, 8.6, 0.25), 1.0, mat("Lamp_NeonPink", (1, 0.2, 0.6), 0, 0.3, emit=(1, 0.15, 0.55), emit_strength=6), parent=root, depth=0.15)
    text_mesh("Diner_Neon2", "OPEN ALL NIGHT", (0, 4.75, D / 2 + 1.62), 0.4, mat("Lamp_NeonTeal", (0.2, 1, 0.9), 0, 0.3, emit=(0.1, 1, 0.85), emit_strength=5), parent=root, depth=0.08)
    empty("Counter_Spot", (-4, 0.6, D / 2 + 2.5), root)
    export_glb("diner.glb")
    render_preview("blender_diner.png", elev=15, azim=25)


def build_gas_station():
    reset_scene()
    root = empty("GasStation", (0, 0, 0))
    box("Office", (10, 4.2, 7), (-8, 2.1, -6), mat("GasWhite", (0.92, 0.92, 0.9), 0, 0.6), pivot=(0, 0, 0), parent=root)
    col("Office", (10, 4.2, 7), (-8, 2.1, -6), root)
    windows_row("Office_Windows", [-10.5, -8, -5.5], 2.0, -2.47, 2.0, 1.8, root)
    box("Office_Trim", (10.2, 0.6, 7.2), (-8, 4.2, -6), mat("GasRed", (0.8, 0.1, 0.08), 0.2, 0.5), pivot=(0, 0, 0), parent=root)
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
    boxes("Sign_Pole", [((0.4, 8, 0.4), (16, 4, 6))], STEEL(), (0, 0, 0), root)
    box("Sign_Board", (3.4, 3, 0.4), (16, 9, 6), mat("GasWhite", (0.92, 0.92, 0.9)), pivot=(0, 0, 0), parent=root)
    text_mesh("Gas_Sign", "GAS", (16, 9.7, 6.22), 1.0, mat("Lamp_NeonRed", (1, 0.1, 0.05), 0, 0.3, emit=(1, 0.1, 0.05), emit_strength=5), parent=root, depth=0.1)
    text_mesh("Gas_Price", "$3.13", (16, 8.4, 6.22), 0.8, mat("Lamp_Sign", (1, 1, 1), 0, 0.3, emit=(1, 0.95, 0.85), emit_strength=2), parent=root, depth=0.08)
    col("SignPole", (0.5, 8, 0.5), (16, 4, 6), root)
    export_glb("gas_station.glb")
    render_preview("blender_gas_station.png", elev=18, azim=30)


def build_shop(fname, label, w, d, h, color, sign, sign_mat, police=False):
    reset_scene()
    root = empty(label, (0, 0, 0))
    m = mat(label + "_Wall", color, 0, 0.9)
    box("Walls", (w, h, d), (0, h / 2, 0), m, pivot=(0, 0, 0), parent=root, uv_scale=0.5)
    col("Walls", (w, h, d), (0, h / 2, 0), root)
    box("Cornice", (w + 0.5, 0.6, d + 0.5), (0, h + 0.1, 0), TRIM(), pivot=(0, 0, 0), parent=root)
    windows_row("Store_Windows", [-w / 3, w / 3], 1.8, d / 2 + 0.03, w / 4, 2.2, root)
    if h > 6:
        windows_row("Upper_Windows", [x for x in (-w / 3, -w / 9, w / 9, w / 3)], h - 2.2, d / 2 + 0.03, 1.2, 1.6, root, lit=not police)
    box("Entrance", (2.2, 2.8, 0.1), (0, 1.4, d / 2 + 0.05), mat("Glass", (0.4, 0.55, 0.6), 0.0, 0.05, alpha=0.35), pivot=(0, 0, 0), parent=root)
    box("Sign_Board", (w * 0.6, 1.3, 0.25), (0, h - 0.9 if h <= 6 else 4.0, d / 2 + 0.15), mat("SignDark", (0.08, 0.05, 0.1), 0, 0.5), pivot=(0, 0, 0), parent=root)
    text_mesh("Sign_Text", sign, (0, h - 0.9 if h <= 6 else 4.0, d / 2 + 0.3), 0.8, sign_mat, parent=root, depth=0.08)
    if police:
        boxes("Columns", [((0.6, 3.4, 0.6), (x, 1.7, d / 2 + 2.0)) for x in (-3, -1, 1, 3)], TRIM(), (0, 0, 0), root)
        box("Portico", (8, 0.5, 2.8), (0, 3.6, d / 2 + 1.4), TRIM(), pivot=(0, 0, 0), parent=root)
        for x in (-3, -1, 1, 3):
            col("Column_%d" % x, (0.6, 3.4, 0.6), (x, 1.7, d / 2 + 2.0), root)
        boxes("Blue_Lamps", [((0.4, 0.6, 0.4), (sx * 4.5, 2.6, d / 2 + 0.3)) for sx in (1, -1)], mat("Lamp_PoliceBlue", (0.05, 0.1, 0.8), 0, 0.2, emit=(0.1, 0.2, 1), emit_strength=3), (0, 0, 0), root)
        cyl("Flagpole", 0.08, 12, (w / 2 + 2, 6, d / 2 + 2), STEEL(), seg=8, pivot=(0, 0, 0), parent=root)
        box("Flag", (2.4, 1.4, 0.03), (w / 2 + 3.25, 11.2, d / 2 + 2), mat("FlagBlue", (0.1, 0.15, 0.5), 0, 0.8), pivot=(0, 0, 0), parent=root)
        col("Flagpole", (0.2, 12, 0.2), (w / 2 + 2, 6, d / 2 + 2), root)
    else:
        boxes("Awning", [((w * 0.9 / 8, 0.12, 1.8), (-w * 0.45 + (i + 0.5) * w * 0.9 / 8, 3.3, d / 2 + 0.9), Matrix.Rotation(math.radians(-15), 3, 'X')) for i in range(0, 8, 2)],
              mat("AwningRed", (0.75, 0.1, 0.08), 0, 0.7), (0, 0, 0), root)
        boxes("Awning2", [((w * 0.9 / 8, 0.12, 1.8), (-w * 0.45 + (i + 0.5) * w * 0.9 / 8, 3.3, d / 2 + 0.9), Matrix.Rotation(math.radians(-15), 3, 'X')) for i in range(1, 8, 2)],
              TRIM(), (0, 0, 0), root)
    export_glb(fname)
    render_preview("blender_" + fname.replace(".glb", ".png"), elev=15, azim=25)


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
    export_glb("props.glb")
    for i, g in enumerate([o for o in root.children]):
        g.location = g2b(((i % 6) * 7.0, 0, -(i // 6) * 7.0))
    render_preview("blender_props.png", elev=32, azim=15, dist_mul=0.62)


BUILDERS = {
    "robot": build_robot_arm, "press": build_press, "crane": build_crane, "doors": build_doors, "gate": build_gate,
    "machines": build_forklift_lift_scanner, "plant": build_plant, "diner": build_diner, "gas": build_gas_station,
    "hardware": lambda: build_shop("hardware.glb", "Hardware", 16, 12, 6, (0.45, 0.25, 0.18), "HARDWARE",
                                   mat("Lamp_Sign", (1, 1, 1), 0, 0.3, emit=(1, 0.95, 0.85), emit_strength=2)),
    "police": lambda: build_shop("police_station.glb", "PoliceStation", 22, 14, 8, (0.55, 0.55, 0.6), "POLICE",
                                 mat("Lamp_PoliceBlue", (0.05, 0.1, 0.8), 0, 0.2, emit=(0.1, 0.2, 1), emit_strength=3), police=True),
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
