"""Motorworks Blender helper library.

All geometry is authored in *game space* (x right/left, y up, z forward, metres),
the same space Three.js uses after glTF import. `g2b` converts to Blender space
(x, -z, y) so the glTF exporter's +Y-up conversion lands every node exactly where
the game expects it.

Every object is created with its ORIGIN AT ITS PIVOT (hinge / joint) and its
geometry offset around it, so doors, hoods, joints etc. rotate naturally after
export.  Children are parented with identity parent-inverse and a pure
translation, so glTF local transforms are clean offsets.
"""
import bpy, bmesh, math, os, json, sys
from mathutils import Vector, Matrix

G2B = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))


def g2b(v):
    return Vector((v[0], -v[2], v[1]))


# --------------------------------------------------------------------------- scene
def reset_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.cameras, bpy.data.lights, bpy.data.curves):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)


# ----------------------------------------------------------------------- materials
_MATS = {}


def mat(name, color=(0.8, 0.8, 0.8), metal=0.0, rough=0.5, emit=None, emit_strength=1.0, alpha=1.0):
    """Get-or-create a Principled material. Names are significant: the game
    overrides materials by name (Paint, Paint2, Glass, Chrome, Lamp_Head ...)."""
    if name in _MATS and _MATS[name].name in bpy.data.materials:
        return _MATS[name]
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    bsdf = None
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            bsdf = n
    if bsdf is None:
        bsdf = m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        out = [n for n in m.node_tree.nodes if n.type == 'OUTPUT_MATERIAL']
        if out:
            m.node_tree.links.new(bsdf.outputs[0], out[0].inputs[0])
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    m.diffuse_color = (*color, alpha)  # used by Workbench preview renders
    _MATS[name] = m
    return m


# ------------------------------------------------------------------------ objects
def empty(name, pivot=(0, 0, 0), parent=None, props=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.15
    bpy.context.scene.collection.objects.link(ob)
    _place(ob, pivot, parent)
    if props:
        for k, v in props.items():
            ob[k] = v
    return ob


def _place(ob, pivot, parent):
    ob["_gp"] = list(pivot)  # remember game-space world pivot for children
    if parent is not None:
        ob.parent = parent
        ob.matrix_parent_inverse = Matrix.Identity(4)
        pp = parent["_gp"]
        ob.location = g2b((pivot[0] - pp[0], pivot[1] - pp[1], pivot[2] - pp[2]))
    else:
        ob.location = g2b(pivot)


def _box_uv(bm, scale=1.0):
    """World-scale box projection UVs (bricks/asphalt tile at a constant size)."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            co = l.vert.co
            if ax == 0:
                l[uv].uv = (co[1] * scale, co[2] * scale)
            elif ax == 1:
                l[uv].uv = (co[0] * scale, co[2] * scale)
            else:
                l[uv].uv = (co[0] * scale, co[1] * scale)


def mesh_from_bm(name, bm, pivot, material, parent=None, uv_scale=1.0, smooth=False, props=None):
    """bm geometry is in game-space *world* coords; it is re-centred on pivot."""
    px, py, pz = pivot
    for v in bm.verts:
        v.co = Vector((v.co.x - px, v.co.y - py, v.co.z - pz))
    bm.transform(G2B.to_4x4())
    bm.normal_update()
    _box_uv(bm, uv_scale)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if material is not None:
        mats = material if isinstance(material, (list, tuple)) else [material]
        for m in mats:
            me.materials.append(m)
    _place(ob, pivot, parent)
    if props:
        for k, v in props.items():
            ob[k] = v
    return ob


def _bm_box(bm, size, center, rot=None):
    m = Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    if rot is not None:
        m = rot.to_4x4() @ m
    m = Matrix.Translation(center) @ m
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def box(name, size, center, material, pivot=None, parent=None, rot=None, props=None, uv_scale=1.0):
    bm = bmesh.new()
    _bm_box(bm, size, Vector(center), rot)
    return mesh_from_bm(name, bm, pivot if pivot is not None else center, material, parent, uv_scale, props=props)


def boxes(name, specs, material, pivot, parent=None, uv_scale=1.0, props=None):
    """Several boxes merged into one object. specs: [(size, center), ...]"""
    bm = bmesh.new()
    for s in specs:
        _bm_box(bm, s[0], Vector(s[1]), s[2] if len(s) > 2 else None)
    return mesh_from_bm(name, bm, pivot, material, parent, uv_scale, props=props)


AXIS_ROT = {
    'y': Matrix.Identity(3),
    'x': Matrix.Rotation(math.radians(90), 3, 'Z') @ Matrix.Rotation(math.radians(90), 3, 'X'),
    'z': Matrix.Rotation(math.radians(90), 3, 'X'),
}


def _bm_cyl(bm, r1, r2, depth, center, axis='y', seg=16, rot=None):
    # bmesh cone is built along its local Z; map Z -> requested game axis
    base = {'y': Matrix.Rotation(math.radians(-90), 3, 'X'),
            'x': Matrix.Rotation(math.radians(90), 3, 'Y'),
            'z': Matrix.Identity(3)}[axis]
    if rot is not None:
        base = rot @ base
    m = Matrix.Translation(center) @ base.to_4x4()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                          radius1=r1, radius2=r2, depth=depth, matrix=m)


def cyl(name, r, depth, center, material, axis='y', seg=16, r2=None, pivot=None, parent=None, rot=None, smooth=False, props=None):
    bm = bmesh.new()
    _bm_cyl(bm, r, r if r2 is None else r2, depth, Vector(center), axis, seg, rot)
    return mesh_from_bm(name, bm, pivot if pivot is not None else center, material, parent, smooth=smooth, props=props)


def sphere(name, r, center, material, pivot=None, parent=None, scale=(1, 1, 1), seg=12, smooth=True, props=None):
    bm = bmesh.new()
    m = Matrix.Translation(Vector(center)) @ Matrix.Diagonal((*scale, 1.0))
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2), radius=r, matrix=m)
    return mesh_from_bm(name, bm, pivot if pivot is not None else center, material, parent, smooth=smooth, props=props)


def _bm_beam(bm, p1, p2, t, t2=None):
    """Square beam from p1 to p2 (game space)."""
    a, b = Vector(p1), Vector(p2)
    d = b - a
    L = d.length
    if L < 1e-6:
        return
    z = d.normalized()
    up = Vector((0, 1, 0)) if abs(z.y) < 0.95 else Vector((1, 0, 0))
    x = up.cross(z).normalized()
    y = z.cross(x)
    t2 = t if t2 is None else t2
    rot = Matrix((x, y, z)).transposed()
    if t2 == t:
        _bm_box(bm, (t, t, L), (a + b) / 2, rot)
    else:  # tapered: frustum built from cone
        m = Matrix.Translation((a + b) / 2) @ rot.to_4x4()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=6,
                              radius1=t / 2, radius2=t2 / 2, depth=L, matrix=m)


def beams(name, segs, t, material, pivot, parent=None, props=None):
    bm = bmesh.new()
    for s in segs:
        _bm_beam(bm, s[0], s[1], s[2] if len(s) > 2 else t, s[3] if len(s) > 3 else None)
    return mesh_from_bm(name, bm, pivot, material, parent, props=props)


def _offset_poly(pts, d):
    """Inward miter offset of a closed 2D polygon (counter-clockwise or not)."""
    n = len(pts)
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    sgn = 1 if area > 0 else -1
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        e1 = (p1 - p0).normalized()
        e2 = (p2 - p1).normalized()
        n1 = Vector((-e1.y, e1.x)) * sgn
        n2 = Vector((-e2.y, e2.x)) * sgn
        bis = (n1 + n2)
        if bis.length < 1e-6:
            bis = n1
        bis.normalize()
        cosang = max(0.35, bis.dot(n1))
        out.append(p1 + bis * (d / cosang))
    return out


def _bm_profile(bm, profile_zy, x0, x1, bevel=0.0):
    """Extrude a closed (z,y) polygon along x from x0 to x1 with chamfered sides."""
    rings = []
    if bevel > 0:
        inner = _offset_poly(profile_zy, bevel)
        xs = [(x0, inner), (x0 + bevel, profile_zy), (x1 - bevel, profile_zy), (x1, inner)]
    else:
        xs = [(x0, profile_zy), (x1, profile_zy)]
    for x, poly in xs:
        rings.append([bm.verts.new((x, p[1], p[0])) for p in poly])
    n = len(profile_zy)
    for r in range(len(rings) - 1):
        a, b = rings[r], rings[r + 1]
        for i in range(n):
            j = (i + 1) % n
            try:
                bm.faces.new((a[i], a[j], b[j], b[i]))
            except ValueError:
                pass
    for ring, rev in ((rings[0], True), (rings[-1], False)):
        try:
            bm.faces.new(list(reversed(ring)) if rev else ring)
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def profile(name, profile_zy, x0, x1, material, pivot, parent=None, bevel=0.0, props=None):
    bm = bmesh.new()
    _bm_profile(bm, profile_zy, x0, x1, bevel)
    return mesh_from_bm(name, bm, pivot, material, parent, props=props)


def lathe(name, pts_ry, center, material, axis='x', seg=24, pivot=None, parent=None, smooth=True, props=None, waves=None, closed=False):
    """Revolve a (radius, along-axis) polyline around an axis. Optional waves=(count, amp)
    perturbs radius by angle (pumpkin ribs, ghost hems)."""
    bm = bmesh.new()
    rings = []
    c = Vector(center)
    for (r, h) in pts_ry:
        ring = []
        for s in range(seg):
            a = 2 * math.pi * s / seg
            rr = r
            if waves:
                rr = r * (1 + waves[1] * math.cos(waves[0] * a))
            ca, sa = math.cos(a) * rr, math.sin(a) * rr
            if axis == 'x':
                co = (h, ca, sa)
            elif axis == 'y':
                co = (ca, h, sa)
            else:
                co = (ca, sa, h)
            ring.append(bm.verts.new(c + Vector(co)))
        rings.append(ring)
    if closed:
        rings.append(rings[0])
    for r in range(len(rings) - 1):
        for s in range(seg):
            t = (s + 1) % seg
            try:
                bm.faces.new((rings[r][s], rings[r][t], rings[r + 1][t], rings[r + 1][s]))
            except ValueError:
                pass
    if pts_ry[0][0] > 1e-4 and not closed:
        bm.faces.new(rings[0])
    if pts_ry[-1][0] > 1e-4 and not closed:
        bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm, pivot if pivot is not None else center, material, parent, smooth=smooth, props=props)


def text_mesh(name, text, center, height, material, parent=None, depth=0.05, facing='z', props=None):
    """Blender text converted to a real mesh (neon signs). Faces +z (game) by default."""
    cu = bpy.data.curves.new(name + "_c", 'FONT')
    cu.body = text
    cu.size = height
    cu.extrude = depth / 2
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.bevel_depth = 0.0
    cu.resolution_u = 3  # low curve resolution keeps engraved/neon text light on triangles
    tob = bpy.data.objects.new(name + "_t", cu)
    bpy.context.scene.collection.objects.link(tob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tob.evaluated_get(dg))
    bpy.data.objects.remove(tob, do_unlink=True)
    bm = bmesh.new()
    bm.from_mesh(me)
    # font space: x right, y up, z out  ==> game: x -> -x when facing +z (viewer looks -z)
    rot = {'z': Matrix(((-1, 0, 0), (0, 1, 0), (0, 0, -1))) @ Matrix(((-1, 0, 0), (0, 1, 0), (0, 0, -1))),
           '-z': Matrix(((-1, 0, 0), (0, 1, 0), (0, 0, -1))),
           'x': Matrix(((0, 0, 1), (0, 1, 0), (-1, 0, 0))),
           '-x': Matrix(((0, 0, -1), (0, 1, 0), (1, 0, 0)))}[facing]
    for v in bm.verts:
        co = rot @ v.co
        v.co = Vector(center) + co
    return mesh_from_bm(name, bm, center, material, parent, props=props)


def join_into(name, objs):
    """Not used for hinged parts. Merges static decoration into one mesh."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


# ------------------------------------------------------------------- export/render
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(ROOT, "public", "models")
SHOT_DIR = os.path.join(ROOT, "public", "docs", "screenshots")
REPORT = []


def _clean_props():
    for ob in bpy.data.objects:
        if "_gp" in ob.keys():
            del ob["_gp"]


def export_glb(fname):
    _clean_props()
    os.makedirs(MODEL_DIR, exist_ok=True)
    path = os.path.join(MODEL_DIR, fname)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False,
                              export_extras=True, export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False)
    nodes = [o.name for o in bpy.data.objects]
    REPORT.append({"file": fname, "objects": len(nodes),
                   "meshes": sum(1 for o in bpy.data.objects if o.type == 'MESH'),
                   "tris": sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'),
                   "hinges": [o.name for o in bpy.data.objects if "hinge" in o.keys() or "joint" in o.keys()],
                   "bytes": os.path.getsize(path)})
    return path


def render_preview(fname, elev=22, azim=35, dist_mul=1.0, hide_prefix="COL_", bg=(0.09, 0.07, 0.12)):
    """Workbench render of the current scene, auto-framed on the bounding box."""
    sc = bpy.context.scene
    bpy.context.view_layer.update()
    for o in bpy.data.objects:
        if o.name.startswith(hide_prefix) or o.get("preview_hide"):
            o.hide_render = True
            for c in o.children_recursive:
                c.hide_render = True
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    dg = bpy.context.evaluated_depsgraph_get()
    for o in bpy.data.objects:
        if o.type != 'MESH' or o.hide_render:
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector(map(min, mins, w))
            maxs = Vector(map(max, maxs, w))
    ctr = (mins + maxs) / 2
    rad = max((maxs - mins).length / 2, 0.3)
    cam_d = bpy.data.cameras.new("PreviewCam")
    cam_d.lens = 35
    cam = bpy.data.objects.new("PreviewCam", cam_d)
    sc.collection.objects.link(cam)
    e, a = math.radians(elev), math.radians(azim)
    vfov = 2 * math.atan(math.tan(math.atan(18 / 35)) * 9 / 16)
    d = rad / math.sin(vfov / 2) * 0.95 * dist_mul
    cam.location = ctr + Vector((math.sin(a) * math.cos(e) * d, -math.cos(a) * math.cos(e) * d, math.sin(e) * d))
    direction = ctr - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_shadows = True
    sh.show_cavity = True
    try:
        sh.cavity_type = 'BOTH'
    except Exception:
        pass
    sh.background_type = 'VIEWPORT'
    sh.background_color = bg
    sc.render.resolution_x = 1280
    sc.render.resolution_y = 720
    sc.render.film_transparent = False
    try:
        sc.display.render_aa = '8'
    except Exception:
        pass
    os.makedirs(SHOT_DIR, exist_ok=True)
    sc.render.filepath = os.path.join(SHOT_DIR, fname)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


def write_report(name):
    path = os.path.join(ROOT, "blender", "report_" + name + ".json")
    with open(path, "w") as f:
        json.dump(REPORT, f, indent=1)
