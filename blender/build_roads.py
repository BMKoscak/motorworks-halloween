"""Street network: asphalt, junction pads, painted markings, crosswalks, signals, stop signs, street-name blades,
manholes, storm drains, the Proving Ground drag strip (christmas tree, start/finish lines, bleachers).

Run: blender -b --factory-startup -P blender/build_roads.py
Everything is generated from src/data/streets.json, the same file the game's AI road graph reads, so the painted
lanes, stop bars and crosswalks line up exactly with where traffic drives and stops.  The geometry formulas
(junction pad radius, crosswalk/stop-bar distances) are mirrored in src/world/streetGeom.js.

Runtime contract (glTF node names):
  Signal_<NODE>_<road>            empty, props {node, road, group 'A'|'B'}; children SigLamp_<NODE>_<road>_R|Y|G
  PedHead_<NODE>_<road>_<0|1>     pedestrian head; children PedLamp_..._W (walk) and PedLamp_..._D (don't walk)
  DragTree                        drag-strip christmas tree; children DragLamp_Stage|Y1|Y2|Y3|G|R
  COL_*                           static colliders (signal poles, tree, bleachers)
"""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector, Matrix
from mwlib import *

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = json.load(open(os.path.join(ROOT_DIR, "src", "data", "streets.json"), encoding="utf8"))

ASPHALT = lambda: mat("Asphalt", (0.075, 0.075, 0.085), 0.0, 0.92)
GRAVEL = lambda: mat("Gravel", (0.28, 0.25, 0.21), 0.0, 1.0)
WHITE = lambda: mat("RoadPaint_White", (0.85, 0.85, 0.8), 0.0, 0.7)
YELLOWP = lambda: mat("RoadPaint_Yellow", (0.9, 0.62, 0.08), 0.0, 0.7)
IRONM = lambda: mat("Iron", (0.05, 0.05, 0.06), 0.7, 0.5)
POLE = lambda: mat("SignalPole", (0.32, 0.34, 0.33), 0.8, 0.45)
HOUSING = lambda: mat("SignalHousing", (0.05, 0.05, 0.05), 0.2, 0.6)
BACKPLATE = lambda: mat("SignalBackplate", (0.03, 0.03, 0.035), 0.2, 0.7)
SIGN_GREEN = lambda: mat("SignGreen", (0.05, 0.32, 0.16), 0.1, 0.5)
SIGN_RED = lambda: mat("SignRed", (0.75, 0.05, 0.05), 0.1, 0.5)
SIGN_WHITE = lambda: mat("SignWhite", (0.95, 0.95, 0.93), 0.1, 0.5)
INK = lambda: mat("SignInk", (0.05, 0.05, 0.05), 0.0, 0.8)
CONCRETE = lambda: mat("Concrete", (0.5, 0.5, 0.48), 0.0, 0.95)
WOODB = lambda: mat("Wood", (0.35, 0.2, 0.1), 0.0, 0.8)
STEEL = lambda: mat("Steel", (0.45, 0.47, 0.5), 0.85, 0.35)
COLM = lambda: mat("COL", (1, 0, 1), 0, 1)

LIFT = 0.05        # asphalt above the terrain surface
PAINT = 0.012      # paint above the asphalt
DIM = 0.25         # unlit lamp emission (runtime drives the real values)


def col(name, size, center, parent):
    return box("COL_" + name, size, center, COLM(), pivot=center, parent=parent)


def lamp_mat(name, rgb):
    return mat(name, tuple(c * 0.35 for c in rgb), 0.0, 0.3, emit=rgb, emit_strength=DIM)


# ------------------------------------------------------------------------------------------------ terrain (mirror of src/world/terrain.js)
def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def terrain_h(x, z):
    h = 10.0 * smooth((z - 148) / (214 - 148))
    dx = max(0.0, abs(x) - 208)
    dz = max(0.0, -148 - z) + max(0.0, z - 338)
    e = dx + dz
    if e > 0:
        h += math.pow(e, 1.25) * 0.9 + math.sin(x * 0.07) * math.cos(z * 0.05) * min(e, 6)
    return h


# ------------------------------------------------------------------------------------------------ centrelines (mirror of THREE.CatmullRomCurve3 'catmullrom', tension 0.3)
def v2(p):
    return Vector((p[0], p[1]))


def _hermite(p0, p1, p2, p3, t, tension=0.3):
    t0 = (p2 - p0) * tension
    t1 = (p3 - p1) * tension
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * t0 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * t1


def centreline(road, step=1.5):
    nodes = S["nodes"]
    pts = [v2(nodes[road["a"]])] + [v2(p) for p in road.get("via", [])] + [v2(nodes[road["b"]])]
    dense = []
    if len(pts) < 3:
        dense = [pts[0], pts[1]]
    else:
        ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
        for i in range(1, len(ext) - 2):
            for k in range(40):
                dense.append(_hermite(ext[i - 1], ext[i], ext[i + 1], ext[i + 2], k / 40.0))
        dense.append(pts[-1])
    # resample at constant spacing
    cum = [0.0]
    for i in range(1, len(dense)):
        cum.append(cum[-1] + (dense[i] - dense[i - 1]).length)
    L = cum[-1]
    n = max(1, int(math.ceil(L / step)))
    out, j = [], 1
    for k in range(n + 1):
        s = L * k / n
        while j < len(cum) - 1 and cum[j] < s:
            j += 1
        f = (s - cum[j - 1]) / max(1e-9, cum[j] - cum[j - 1])
        out.append(dense[j - 1].lerp(dense[j], f))
    return out


def tangents(line):
    out = []
    for i in range(len(line)):
        a, b = line[max(0, i - 1)], line[min(len(line) - 1, i + 1)]
        out.append((b - a).normalized())
    return out


def right_of(t):
    """Right-hand side of travel direction t (game convention, matches roadGraph offsetLine)."""
    return Vector((-t.y, t.x))


def coarse(r):
    """Straight roads on the flat town plain need no dense sampling (keeps roads.glb small)."""
    line = LINES[r["id"]]
    return 12.0 if not r.get("via") and all(terrain_h(p.x, p.y) == 0 for p in line) else 1.5


def cumlen(line):
    c = [0.0]
    for i in range(1, len(line)):
        c.append(c[-1] + (line[i] - line[i - 1]).length)
    return c


# ------------------------------------------------------------------------------------------------ junction geometry (mirror of streetGeom.js)
DRAWN = [r for r in S["roads"] if r.get("surface", "asphalt") != "lot"]
LINES = {r["id"]: centreline(r) for r in S["roads"]}


def node_roads(nid, drawn_only=True):
    out = []
    for r in (DRAWN if drawn_only else S["roads"]):
        line = LINES[r["id"]]
        if r["a"] == nid:
            out.append((r, (line[1] - line[0]).normalized()))
        elif r["b"] == nid:
            out.append((r, (line[-2] - line[-1]).normalized()))
    return out


def pad_radius(nid):
    rs = node_roads(nid)
    if len(rs) < 2:
        return 0.0
    if len(rs) == 2 and rs[0][1].dot(rs[1][1]) < -0.95:
        return 0.0
    return max(r["width"] / 2 for r, _ in rs) + 1.5


def approach(nid, road):
    """(stop_dist, crosswalk (near, far) or None, control) for traffic arriving at node nid along road."""
    padR = pad_radius(nid)
    if nid in S["signals"]:
        near = padR + 0.4
        return near + 3.9, (near, near + 3.0), "signal"
    if road["id"] in S["stops"].get(nid, []):
        if padR:
            return padR + 0.7, None, "stop"
        others = [r["width"] / 2 for r, _d in node_roads(nid) if r is not road]
        return (max(others) + 1.2 if others else 5.0), None, "stop"
    return None, None, None


# ------------------------------------------------------------------------------------------------ bmesh helpers
class Acc:
    """Accumulates world-space quads into one bmesh per material."""
    def __init__(self):
        self.bm = bmesh.new()

    def quad(self, a, b, c, d):
        vs = [self.bm.verts.new(p) for p in (a, b, c, d)]
        try:
            self.bm.faces.new(vs)
        except ValueError:
            pass

    def flat_rect(self, centre, u, w_u, w_v, y_off):
        """Rectangle on the ground: centre (x,z), u = unit along-axis (2D), sizes along u and across."""
        v = right_of(u)
        hu, hv = u * (w_u / 2), v * (w_v / 2)
        cs = [centre - hu - hv, centre + hu - hv, centre + hu + hv, centre - hu + hv]
        pts = [Vector((p.x, terrain_h(p.x, p.y) + LIFT + y_off, p.y)) for p in cs]
        # wind so the face points up (+y)
        e1, e2 = pts[1] - pts[0], pts[2] - pts[0]
        if e1.cross(e2).y < 0:
            pts.reverse()
        self.quad(*pts)

    def build(self, name, material, parent):
        if not self.bm.faces:
            self.bm.free()
            return None
        return mesh_from_bm(name, self.bm, (0, 0, 0), material, parent, uv_scale=0.25)


def ribbon(acc, line, off0, off1, s0, s1, y_off, dash=None, step=1.5):
    """Strip between lateral offsets off0..off1 along the centreline between arclengths s0..s1 (optionally dashed (on, off))."""
    cum = cumlen(line)
    tan = tangents(line)
    if s1 - s0 < 0.05:
        return

    def at(s):
        j = 1
        while j < len(cum) - 1 and cum[j] < s:
            j += 1
        f = (s - cum[j - 1]) / max(1e-9, cum[j] - cum[j - 1])
        return line[j - 1].lerp(line[j], f), tan[j - 1].lerp(tan[j], f).normalized()

    spans = []
    if dash:
        s = s0
        while s < s1:
            spans.append((s, min(s1, s + dash[0])))
            s += dash[0] + dash[1]
    else:
        spans = [(s0, s1)]
    for a, b in spans:
        n = max(1, int(math.ceil((b - a) / step)))
        prev = None
        for k in range(n + 1):
            s = a + (b - a) * k / n
            p, t = at(s)
            r = right_of(t)
            l0, l1 = p + r * off0, p + r * off1
            cur = [Vector((q.x, terrain_h(q.x, q.y) + LIFT + y_off, q.y)) for q in (l0, l1)]
            if prev:
                pts = [prev[0], prev[1], cur[1], cur[0]]
                e1, e2 = pts[1] - pts[0], pts[2] - pts[0]
                if e1.cross(e2).y < 0:
                    pts.reverse()
                acc.quad(*pts)
            prev = cur


def yaw_of(d):
    """Rotation about game Y that turns local +z into the 2D direction d=(x,z)."""
    return math.atan2(d.x, d.y)


def RY(a):
    return Matrix.Rotation(a, 3, 'Y')


def text_oriented(name, text, centre, height, material, rot, parent, depth=0.02):
    """Text mesh with an arbitrary game-space rotation: font x -> rot@x, font y -> rot@y, font z (normal) -> rot@z."""
    cu = bpy.data.curves.new(name + "_c", 'FONT')
    cu.body = text
    cu.size = height
    cu.extrude = depth / 2
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.resolution_u = 2
    tob = bpy.data.objects.new(name + "_t", cu)
    bpy.context.scene.collection.objects.link(tob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tob.evaluated_get(dg))
    bpy.data.objects.remove(tob, do_unlink=True)
    bm = bmesh.new()
    bm.from_mesh(me)
    for v in bm.verts:
        v.co = Vector(centre) + rot @ v.co
    return mesh_from_bm(name, bm, centre, material, parent)


def face_rot(n3):
    """Rotation whose font normal (z) points along horizontal n3=(x,0,z), font y = up."""
    z = Vector(n3).normalized()
    y = Vector((0, 1, 0))
    x = y.cross(z).normalized()
    return Matrix((x, y, z)).transposed()


# ------------------------------------------------------------------------------------------------ build
def build_roads():
    reset_scene()
    root = empty("Roads", (0, 0, 0))
    surf = empty("Road_Surfaces", (0, 0, 0), root)
    paint = empty("Road_Markings", (0, 0, 0), root)
    furn = empty("Road_Furniture", (0, 0, 0), root)
    asph, grav, white, yellow, iron = Acc(), Acc(), Acc(), Acc(), Acc()

    # -- road ribbons
    for r in DRAWN:
        line = LINES[r["id"]]
        acc = grav if r.get("surface") == "gravel" else asph
        L = cumlen(line)[-1]
        ribbon(acc, line, -r["width"] / 2, r["width"] / 2, 0, L, 0.0, step=coarse(r))

    # -- junction pads (discs following the terrain) give rounded corners
    for nid, p in S["nodes"].items():
        R = pad_radius(nid)
        if R <= 0:
            continue
        c = v2(p)
        n = 32
        ctr = asph.bm.verts.new((c.x, terrain_h(c.x, c.y) + LIFT + 0.004, c.y))
        ring = []
        for k in range(n):
            a = 2 * math.pi * k / n
            q = c + Vector((math.cos(a), math.sin(a))) * R
            ring.append(asph.bm.verts.new((q.x, terrain_h(q.x, q.y) + LIFT + 0.004, q.y)))
        for k in range(n):
            try:
                f = asph.bm.faces.new((ctr, ring[(k + 1) % n], ring[k]))
            except ValueError:
                pass

    # -- markings
    for r in DRAWN:
        if r.get("surface") == "gravel":
            continue
        line = LINES[r["id"]]
        L = cumlen(line)[-1]
        trims = []
        for nid in (r["a"], r["b"]):
            sd, cw, ctrl = approach(nid, r)
            R = pad_radius(nid)
            if sd:
                trims.append(sd + 0.3)
            elif R:
                trims.append(R + 0.3)
            elif nid in S["deadEnds"] or nid == "CEM" or nid == "SPUR":
                trims.append(3.0)
            else:
                trims.append(0.0)
        s0, s1 = trims[0], L - trims[1]
        half = r["width"] / 2
        edge = r.get("edge", half - 0.35)
        # double yellow centre line
        for o in (-0.13, 0.13):
            ribbon(yellow, line, o - 0.05, o + 0.05, s0, s1, PAINT, step=coarse(r))
        # white edge lines
        for sgn in (-1, 1):
            ribbon(white, line, sgn * edge - 0.07, sgn * edge + 0.07, s0, s1, PAINT, step=coarse(r))
        # parking-stall ticks between the edge line and the curb on Main Street
        if r["id"].startswith("main"):
            tan = tangents(line)
            cum = cumlen(line)
            s = s0 + 3
            while s < s1 - 3:
                i = min(range(len(cum)), key=lambda k: abs(cum[k] - s))
                p, t = line[i], tan[i]
                for sgn in (-1, 1):
                    if sgn < 0 and -64 < p.x < 84:   # plant lot frontage + exit road: no kerbside parking
                        continue
                    q = p + right_of(t) * (sgn * (edge + (half - edge) / 2))
                    white.flat_rect(q, right_of(t), half - edge - 0.3, 0.12, PAINT)
                s += 6.5
        # stop bars, crosswalks and STOP lettering at controlled approaches
        for end, nid in ((0, r["a"]), (1, r["b"])):
            sd, cw, ctrl = approach(nid, r)
            if not sd:
                continue
            node = v2(S["nodes"][nid])
            tan = tangents(line)
            d_in = -tan[0] if end == 0 else tan[-1]      # travel direction of the arriving lane, into the node
            # point on centreline sd before the node
            p_bar = node - d_in * sd
            rgt = right_of(d_in)
            white.flat_rect(p_bar + rgt * (half / 2 + 0.07), d_in, 0.5, half - 0.3, PAINT + 0.002)
            if cw:
                near, far = cw
                mid = node - d_in * ((near + far) / 2)
                k = -half + 0.5
                while k < half - 0.4:
                    white.flat_rect(mid + rgt * (k + 0.25), d_in, far - near, 0.5, PAINT + 0.003)
                    k += 1.0
            if ctrl == "stop":
                rot = Matrix((Vector((rgt.x, 0, rgt.y)), Vector((d_in.x, 0, d_in.y)), Vector((0, 1, 0)))).transposed()
                c = p_bar - d_in * 2.4 + rgt * (r["w"])
                text_oriented("Paint_STOP_%s_%s" % (nid, r["id"]), "STOP", (c.x, terrain_h(c.x, c.y) + LIFT + PAINT, c.y), 1.6, WHITE(), rot, paint, depth=0.002)
    # mid-block crosswalks
    for cwk in S["crosswalks"]:
        r = next(x for x in S["roads"] if x["id"] == cwk["road"])
        half = r["width"] / 2
        u = Vector((1, 0)) if cwk["axis"] == "x" else Vector((0, 1))
        c = Vector((cwk["x"], cwk["z"]))
        k = -half + 0.5
        while k < half - 0.4:
            white.flat_rect(c + right_of(u) * (k + 0.25), u, 3.0, 0.5, PAINT + 0.003)
            k += 1.0
        for sgn in (-1, 1):  # advance yield bars
            white.flat_rect(c + u * sgn * 3.2, u, 0.3, half * 2 - 0.6, PAINT + 0.002)

    # -- drag strip: staging / start line, checkered finish, distance lettering
    ds = S["dragStrip"]
    st, fi = v2(ds["start"]), v2(ds["finish"])
    u = (fi - st).normalized()
    white.flat_rect(st + right_of(u) * 2.75, u, 0.35, 5.0, PAINT + 0.004)          # start line, eastbound lane
    white.flat_rect(st - u * 1.2 + right_of(u) * 2.75, u, 0.18, 5.0, PAINT + 0.004)  # pre-stage
    for i in range(10):
        for j in range(2):
            if (i + j) % 2 == 0:
                q = fi + right_of(u) * (-5.0 + i * 1.0 + 0.5) + u * (j * 1.0 - 0.5)
                white.flat_rect(q, u, 1.0, 1.0, PAINT + 0.004)
    rot = Matrix((Vector((0, 0, 1)), Vector((1, 0, 0)), Vector((0, 1, 0)))).transposed()
    for txt, k in (("START", -4.0), ("FINISH", 0.0)):
        p = (st if txt == "START" else fi) - u * (4.5 if txt == "START" else -3.5) + right_of(u) * 2.75
        text_oriented("Paint_" + txt, txt, (p.x, terrain_h(p.x, p.y) + LIFT + PAINT, p.y), 1.5, WHITE(), rot, paint, depth=0.002)

    # -- manholes & storm drains
    for r in DRAWN:
        if r.get("surface") == "gravel":
            continue
        line = LINES[r["id"]]
        tan = tangents(line)
        cum = cumlen(line)
        s, side = 18.0, 1
        while s < cum[-1] - 12:
            i = min(range(len(cum)), key=lambda k: abs(cum[k] - s))
            p = line[i] + right_of(tan[i]) * (1.4 * side)
            n = 14
            y = terrain_h(p.x, p.y) + LIFT + 0.014
            ctr = iron.bm.verts.new((p.x, y, p.y))
            ring = [iron.bm.verts.new((p.x + math.cos(2 * math.pi * k / n) * 0.36, y, p.y + math.sin(2 * math.pi * k / n) * 0.36)) for k in range(n)]
            for k in range(n):
                try:
                    iron.bm.faces.new((ctr, ring[(k + 1) % n], ring[k]))
                except ValueError:
                    pass
            if r["id"].startswith("main") or r["id"] == "elm":
                q = line[i] + right_of(tan[i]) * (-side * (r["width"] / 2 - 0.3))
                iron.flat_rect(q, tan[i], 0.9, 0.42, 0.016)
            s += 44.0
            side = -side

    asph.build("Road_Asphalt", ASPHALT(), surf)
    grav.build("Road_Gravel", GRAVEL(), surf)
    white.build("Paint_White", WHITE(), paint)
    yellow.build("Paint_Yellow", YELLOWP(), paint)
    iron.build("Road_Ironwork", IRONM(), furn)

    # -- traffic signals (mast arm per approach, far-right corner) + pedestrian heads at each crosswalk end
    R_LAMP = lamp_mat("Lamp_SigR", (1.0, 0.06, 0.03))
    Y_LAMP = lamp_mat("Lamp_SigY", (1.0, 0.62, 0.02))
    G_LAMP = lamp_mat("Lamp_SigG", (0.1, 1.0, 0.45))
    W_LAMP = lamp_mat("Lamp_PedWalk", (0.9, 0.95, 1.0))
    D_LAMP = lamp_mat("Lamp_PedDont", (1.0, 0.45, 0.05))
    for nid, sig in S["signals"].items():
        node = v2(S["nodes"][nid])
        for r, dout in node_roads(nid):
            d_in = -dout
            group = "A" if r["id"] in sig["A"] else "B"
            sd, cw, _ = approach(nid, r)
            # crossing half-width: widest other road at this node
            cross = max([x["width"] / 2 for x, _d in node_roads(nid) if x is not r] or [6])
            rgt = right_of(d_in)
            pole = node + d_in * (cross + 2.2) + rgt * (r["width"] / 2 + 1.3)
            head = node + d_in * (cross + 2.2) + rgt * r["w"]
            g = empty("Signal_%s_%s" % (nid, r["id"]), (head.x, 0, head.y), furn, props={"node": nid, "road": r["id"], "group": group})
            yb = terrain_h(pole.x, pole.y)
            cyl("SignalPole_%s_%s" % (nid, r["id"]), 0.16, 6.2, (pole.x, yb + 3.1, pole.y), POLE(), seg=10, pivot=(head.x, 0, head.y), parent=g)
            beams("SignalArm_%s_%s" % (nid, r["id"]), [((pole.x, yb + 5.75, pole.y), (head.x - rgt.x * 0.4, yb + 5.75, head.y - rgt.y * 0.4), 0.12),
                                                      ((pole.x, yb + 4.9, pole.y), (pole.x + (head.x - pole.x) * 0.45, yb + 5.72, pole.y + (head.y - pole.y) * 0.45), 0.06)],
                  0.1, POLE(), (head.x, 0, head.y), g)
            col("SignalPole_%s_%s" % (nid, r["id"]), (0.36, 6.0, 0.36), (pole.x, yb + 3.0, pole.y), g)
            ry = RY(yaw_of(-d_in))   # head faces the arriving traffic
            hc = Vector((head.x, yb + 5.0, head.y))
            box("SignalHousing_%s_%s" % (nid, r["id"]), (0.44, 1.14, 0.3), hc, HOUSING(), pivot=(head.x, 0, head.y), parent=g, rot=ry)
            box("SignalBack_%s_%s" % (nid, r["id"]), (0.78, 1.46, 0.03), hc + ry @ Vector((0, 0, -0.17)), BACKPLATE(), pivot=(head.x, 0, head.y), parent=g, rot=ry)
            beams("SignalHanger_%s_%s" % (nid, r["id"]), [((head.x, yb + 5.57, head.y), (head.x, yb + 5.75, head.y), 0.06)], 0.06, POLE(), (head.x, 0, head.y), g)
            for k, (lm, suf) in enumerate(((R_LAMP, "R"), (Y_LAMP, "Y"), (G_LAMP, "G"))):
                lc = hc + ry @ Vector((0, 0.35 - k * 0.35, 0.16))
                cyl("SigLamp_%s_%s_%s" % (nid, r["id"], suf), 0.13, 0.04, lc, lm, axis='z', seg=14, rot=ry, pivot=(head.x, 0, head.y), parent=g)
                box("SignalVisor_%s_%s_%d" % (nid, r["id"], k), (0.3, 0.035, 0.24), lc + ry @ Vector((0, 0.15, 0.12)), HOUSING(), pivot=(head.x, 0, head.y), parent=g, rot=ry)
            # pedestrian heads at both ends of this approach's crosswalk, facing across the street
            near, far = cw
            mid = node - d_in * ((near + far) / 2)
            for e, sgn in enumerate((1, -1)):
                pp = mid + rgt * sgn * (r["width"] / 2 + 0.9)
                face = rgt * -sgn
                ph = empty("PedHead_%s_%s_%d" % (nid, r["id"], e), (pp.x, 0, pp.y), furn, props={"node": nid, "road": r["id"], "group": group})
                y0 = terrain_h(pp.x, pp.y)
                cyl("PedPost_%s_%s_%d" % (nid, r["id"], e), 0.06, 2.9, (pp.x, y0 + 1.45, pp.y), POLE(), seg=8, pivot=(pp.x, 0, pp.y), parent=ph)
                pr = RY(yaw_of(face))
                c = Vector((pp.x, y0 + 2.45, pp.y)) + pr @ Vector((0, 0, 0.12))
                box("PedHousing_%s_%s_%d" % (nid, r["id"], e), (0.34, 0.62, 0.2), c, HOUSING(), pivot=(pp.x, 0, pp.y), parent=ph, rot=pr)
                box("PedLamp_%s_%s_%d_D" % (nid, r["id"], e), (0.24, 0.22, 0.02), c + pr @ Vector((0, 0.15, 0.105)), D_LAMP, pivot=(pp.x, 0, pp.y), parent=ph, rot=pr)
                box("PedLamp_%s_%s_%d_W" % (nid, r["id"], e), (0.24, 0.22, 0.02), c + pr @ Vector((0, -0.15, 0.105)), W_LAMP, pivot=(pp.x, 0, pp.y), parent=ph, rot=pr)
                cyl("PedButton_%s_%s_%d" % (nid, r["id"], e), 0.05, 0.03, (pp.x, y0 + 1.1, pp.y), BACKPLATE(), axis='z', seg=8, rot=pr, pivot=(pp.x, 0, pp.y), parent=ph)

    # -- stop signs (right side of each stop-controlled approach)
    for nid, roads in S["stops"].items():
        node = v2(S["nodes"][nid])
        for r, dout in node_roads(nid, drawn_only=False):
            if r["id"] not in roads:
                continue
            d_in = -dout
            sd, _cw, _ = approach(nid, r)
            p = node - d_in * (sd - 0.4) + right_of(d_in) * (r["width"] / 2 + 0.7)
            y0 = terrain_h(p.x, p.y)
            g = empty("StopSign_%s_%s" % (nid, r["id"]), (p.x, 0, p.y), furn)
            beams("StopPost_%s" % r["id"], [((p.x, y0, p.y), (p.x, y0 + 2.35, p.y), 0.07)], 0.07, POLE(), (p.x, 0, p.y), g)
            ry = RY(yaw_of(-d_in))
            c = Vector((p.x, y0 + 2.3, p.y)) + ry @ Vector((0, 0, 0.05))
            cyl("StopOct_%s_%s" % (nid, r["id"]), 0.42, 0.03, c, SIGN_RED(), axis='z', seg=8, rot=ry @ Matrix.Rotation(math.pi / 8, 3, 'Z'), pivot=(p.x, 0, p.y), parent=g)
            cyl("StopRim_%s_%s" % (nid, r["id"]), 0.45, 0.02, c - ry @ Vector((0, 0, 0.012)), SIGN_WHITE(), axis='z', seg=8, rot=ry @ Matrix.Rotation(math.pi / 8, 3, 'Z'), pivot=(p.x, 0, p.y), parent=g)
            n3 = ry @ Vector((0, 0, 1))
            text_oriented("StopTxt_%s_%s" % (nid, r["id"]), "STOP", tuple(c + n3 * 0.022), 0.22, SIGN_WHITE(), face_rot(n3), g, depth=0.01)

    # -- street-name blades on a corner post of every junction
    named = {}
    for r in S["roads"]:
        if r.get("name"):
            named.setdefault(r["a"], []).append(r)
            named.setdefault(r["b"], []).append(r)
    for nid, rs in named.items():
        names = []
        for r in rs:
            if r["name"] not in [n for n, _ in names]:
                d = [d for x, d in node_roads(nid, False) if x is r]
                if d:
                    names.append((r["name"], d[0]))
        if len(names) < 2:
            continue
        (n1, d1), (n2, d2) = names[0], names[1]
        diag = d1 + d2
        if diag.length < 0.2:
            diag = right_of(d1)
        diag.normalize()
        R = pad_radius(nid) or 7.5
        p = v2(S["nodes"][nid]) + diag * (R + 1.2)
        y0 = terrain_h(p.x, p.y)
        g = empty("StreetSign_%s" % nid, (p.x, 0, p.y), furn)
        beams("StreetPost_%s" % nid, [((p.x, y0, p.y), (p.x, y0 + 3.1, p.y), 0.08)], 0.08, POLE(), (p.x, 0, p.y), g)
        for k, (nm, d) in enumerate(((n1, d1), (n2, d2))):
            y = y0 + 2.95 + k * 0.36
            ry = RY(yaw_of(d))
            c = Vector((p.x, y, p.y)) + ry @ Vector((0, 0, 0.75))
            box("StreetBlade_%s_%d" % (nid, k), (0.03, 0.3, 1.6), c, SIGN_GREEN(), pivot=(p.x, 0, p.y), parent=g, rot=ry)
            side = right_of(d)
            for sgn in (1, -1):
                n3 = Vector((side.x * sgn, 0, side.y * sgn))
                text_oriented("StreetName_%s_%d_%d" % (nid, k, sgn), nm, tuple(c + n3 * 0.02), 0.15, SIGN_WHITE(), face_rot(n3), g, depth=0.006)

    # -- speed-limit signs where the avenues feed Main Street
    for nm, x, z, fx, fz in (("SPEED_W", -184, 9.6, -1, 0), ("SPEED_E", 184, -9.6, 1, 0), ("SPEED_ELM", 9.2, 130, 0, 1), ("SPEED_S", -60, -132, 1, 0)):
        y0 = terrain_h(x, z)
        g = empty("SpeedSign_" + nm, (x, 0, z), furn)
        beams("SpeedPost_" + nm, [((x, y0, z), (x, y0 + 2.2, z), 0.07)], 0.07, POLE(), (x, 0, z), g)
        n3 = Vector((fx, 0, fz))
        ry = RY(math.atan2(fx, fz))
        c = Vector((x, y0 + 2.05, z))
        box("SpeedPlate_" + nm, (0.6, 0.78, 0.03), c, SIGN_WHITE(), pivot=(x, 0, z), parent=g, rot=ry)
        text_oriented("SpeedTxt1_" + nm, "SPEED", tuple(c + n3 * 0.02 + Vector((0, 0.24, 0))), 0.11, INK(), face_rot(n3), g, depth=0.006)
        text_oriented("SpeedTxt2_" + nm, "LIMIT", tuple(c + n3 * 0.02 + Vector((0, 0.1, 0))), 0.11, INK(), face_rot(n3), g, depth=0.006)
        text_oriented("SpeedTxt3_" + nm, "35", tuple(c + n3 * 0.02 + Vector((0, -0.16, 0))), 0.3, INK(), face_rot(n3), g, depth=0.006)

    # -- drag strip: christmas tree (faces the staging cars), finish gantry posts, bleachers
    tree_p = st + u * 3.0 + right_of(u) * -(5.5 + 0.9)   # north shoulder, just past the start line
    y0 = terrain_h(tree_p.x, tree_p.y)
    tree = empty("DragTree", (tree_p.x, 0, tree_p.y), furn)
    ry = RY(yaw_of(-u))
    beams("DragTree_Post", [((tree_p.x, y0, tree_p.y), (tree_p.x, y0 + 3.6, tree_p.y), 0.16)], 0.16, POLE(), (tree_p.x, 0, tree_p.y), tree)
    hc = Vector((tree_p.x, y0 + 2.6, tree_p.y))
    box("DragTree_Body", (0.5, 2.1, 0.22), hc, HOUSING(), pivot=(tree_p.x, 0, tree_p.y), parent=tree, rot=ry)
    lamps = [("Stage", (1.0, 0.9, 0.5), 0.86), ("Y1", (1.0, 0.6, 0.02), 0.5), ("Y2", (1.0, 0.6, 0.02), 0.18), ("Y3", (1.0, 0.6, 0.02), -0.14),
             ("G", (0.1, 1.0, 0.3), -0.48), ("R", (1.0, 0.05, 0.02), -0.82)]
    for nm, rgb, dy in lamps:
        lm = lamp_mat("Lamp_Drag" + nm, rgb)
        cyl("DragLamp_" + nm, 0.13, 0.05, hc + ry @ Vector((0, dy, 0.12)), lm, axis='z', seg=14, rot=ry, pivot=(tree_p.x, 0, tree_p.y), parent=tree)
    col("DragTree", (0.5, 3.6, 0.5), (tree_p.x, y0 + 1.8, tree_p.y), tree)
    for sgn in (1, -1):  # finish posts with banners
        q = fi + right_of(u) * sgn * 6.4
        yq = terrain_h(q.x, q.y)
        beams("FinishPost_%d" % sgn, [((q.x, yq, q.y), (q.x, yq + 4.0, q.y), 0.14)], 0.14, STEEL(), (0, 0, 0), furn)
        col("FinishPost_%d" % sgn, (0.3, 4.0, 0.3), (q.x, yq + 2.0, q.y), furn)
        f = q + right_of(u) * (-sgn * 0.85)
        box("FinishFlag_%d" % sgn, (1.4, 0.8, 0.05), (f.x, yq + 3.4, f.y), SIGN_WHITE(), pivot=(0, 0, 0), parent=furn, rot=RY(yaw_of(u)))
        n3 = Vector((-u.x, 0, -u.y))
        text_oriented("FinishTxt_%d" % sgn, "FINISH", (f.x - u.x * 0.03, yq + 3.4, f.y - u.y * 0.03), 0.22, INK(), face_rot(n3), furn, depth=0.006)
    # bleachers on the south verge facing the strip
    bx0, bx1, bz = -60.0, -24.0, -139.5
    specs, cols = [], []
    for k in range(5):
        y = 0.45 * (k + 1)
        z = bz - k * 0.8
        specs.append(((bx1 - bx0, 0.08, 0.75), ((bx0 + bx1) / 2, y, z)))
        specs.append(((bx1 - bx0, 0.45, 0.06), ((bx0 + bx1) / 2, y - 0.22, z + 0.36)))
    boxes("Bleacher_Seats", specs, WOODB(), (0, 0, 0), furn)
    legs = [((x, 0, bz + 0.3), (x, 0.45 * 5, bz - 3.5), 0.1) for x in (bx0 + 0.3, (bx0 + bx1) / 2, bx1 - 0.3)]
    legs += [((x, 0, bz - 3.3), (x, 0.45 * 5 + 1.1, bz - 3.3), 0.08) for x in (bx0 + 0.3, (bx0 + bx1) / 2, bx1 - 0.3)]
    legs += [((bx0 + 0.3, 0.45 * 5 + 1.0, bz - 3.3), (bx1 - 0.3, 0.45 * 5 + 1.0, bz - 3.3), 0.06)]
    beams("Bleacher_Frame", legs, 0.08, STEEL(), (0, 0, 0), furn)
    col("Bleachers", (bx1 - bx0, 2.3, 4.0), ((bx0 + bx1) / 2, 1.15, bz - 1.6), furn)
    for k in range(5):
        empty("Spot_Bleacher_%d" % k, ((bx0 + bx1) / 2, 0.45 * (k + 1) + 0.04, bz - k * 0.8), furn)

    export_glb("roads.glb")
    render_preview("blender_roads.png", elev=62, azim=20, dist_mul=0.55)


if __name__ == "__main__":
    build_roads()
    write_report("roads")
    print("ROADS_DONE")
