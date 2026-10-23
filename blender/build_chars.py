"""Articulated characters: human rig (with costume/hat accessories) and the Skeleton Welder.

Run: blender -b --factory-startup -P blender/build_chars.py
Every limb is a separate node whose origin sits exactly on its joint (shoulder, elbow,
hip, knee, ankle, neck) so the game animates walk cycles, waving, machine operation,
door reaching and running by rotating the joint nodes - no skinning, no floating limbs.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Matrix
from mwlib import *

SKIN = lambda: mat("C_Skin", (0.85, 0.62, 0.48), 0, 0.7)
SHIRT = lambda: mat("C_Shirt", (0.9, 0.45, 0.1), 0, 0.8)
PANTS = lambda: mat("C_Pants", (0.15, 0.2, 0.35), 0, 0.85)
SHOES = lambda: mat("C_Shoes", (0.08, 0.06, 0.05), 0, 0.7)
HAIR = lambda: mat("C_Hair", (0.2, 0.12, 0.06), 0, 0.9)
BONE = lambda: mat("Bone", (0.92, 0.89, 0.78), 0, 0.65)
DARK = lambda: mat("C_Dark", (0.02, 0.02, 0.02), 0, 1)
J = {"joint": "x"}


def accessories(head):
    hh = empty("Hat_Hard", (0, 1.82, 0), head, props={"accessory": 1})
    sphere("HardHat_Dome", 0.15, (0, 1.84, 0), mat("HardHatYellow", (0.95, 0.75, 0.05), 0.1, 0.4), pivot=(0, 1.82, 0), parent=hh, scale=(1, 0.75, 1.1))
    cyl("HardHat_Brim", 0.19, 0.02, (0, 1.81, 0.02), mat("HardHatYellow", (0.95, 0.75, 0.05)), seg=18, pivot=(0, 1.82, 0), parent=hh)
    hc = empty("Hat_Cap", (0, 1.82, 0), head, props={"accessory": 1})
    cyl("Cap_Crown", 0.15, 0.1, (0, 1.88, -0.01), mat("PoliceNavy", (0.05, 0.07, 0.2), 0, 0.6), seg=16, r2=0.16, pivot=(0, 1.82, 0), parent=hh if False else hc)
    box("Cap_Visor", (0.2, 0.02, 0.1), (0, 1.84, 0.15), DARK(), pivot=(0, 1.82, 0), parent=hc)
    box("Cap_Badge", (0.05, 0.05, 0.01), (0, 1.89, 0.15), mat("Brass", (0.8, 0.6, 0.2), 1, 0.3), pivot=(0, 1.82, 0), parent=hc)
    hw = empty("Hat_Witch", (0, 1.82, 0), head, props={"accessory": 1})
    cyl("Witch_Brim", 0.3, 0.02, (0, 1.84, 0), mat("WitchBlack", (0.04, 0.02, 0.06), 0, 0.8), seg=20, pivot=(0, 1.82, 0), parent=hw)
    cyl("Witch_Cone", 0.15, 0.45, (0, 2.07, -0.03), mat("WitchBlack", (0.04, 0.02, 0.06)), seg=14, r2=0.01, pivot=(0, 1.82, 0), parent=hw)
    box("Witch_Band", (0.29, 0.05, 0.29), (0, 1.88, -0.01), mat("WitchPurple", (0.4, 0.1, 0.5), 0, 0.6), pivot=(0, 1.82, 0), parent=hw)
    hf = empty("Hat_Fedora", (0, 1.82, 0), head, props={"accessory": 1})
    cyl("Fedora_Brim", 0.24, 0.02, (0, 1.84, 0), mat("FedoraBrown", (0.25, 0.18, 0.12), 0, 0.8), seg=18, pivot=(0, 1.82, 0), parent=hf)
    cyl("Fedora_Crown", 0.14, 0.14, (0, 1.92, 0), mat("FedoraBrown", (0.25, 0.18, 0.12)), seg=14, r2=0.12, pivot=(0, 1.82, 0), parent=hf)
    mp = empty("Mask_Pumpkin", (0, 1.74, 0), head, props={"accessory": 1})
    lathe("PumpkinHead", [(0.0, -0.2), (0.17, -0.17), (0.23, 0.0), (0.18, 0.15), (0.0, 0.2)], (0, 1.76, 0), mat("Pumpkin", (0.95, 0.42, 0.05), 0, 0.6),
          axis='y', seg=18, pivot=(0, 1.74, 0), parent=mp, waves=(9, 0.07))
    glow = mat("Lamp_Pumpkin", (1, 0.6, 0.1), 0, 0.3, emit=(1, 0.55, 0.05), emit_strength=5)
    boxes("PumpkinHead_Face", [((0.07, 0.07, 0.04), (dx, 1.8, 0.21), Matrix.Rotation(math.radians(45), 3, 'Z')) for dx in (-0.08, 0.08)] +
          [((0.16, 0.04, 0.04), (0, 1.68, 0.21))], glow, (0, 1.74, 0), mp)
    cyl("PumpkinHead_Stem", 0.025, 0.08, (0, 1.98, 0), mat("Stem", (0.2, 0.3, 0.1), 0, 0.8), seg=6, pivot=(0, 1.74, 0), parent=mp)
    mh = empty("Mask_Hockey", (0, 1.74, 0), head, props={"accessory": 1})
    box("HockeyMask", (0.22, 0.26, 0.04), (0, 1.74, 0.13), mat("MaskWhite", (0.92, 0.9, 0.85), 0, 0.5), pivot=(0, 1.74, 0), parent=mh)
    boxes("HockeyMask_Marks", [((0.05, 0.015, 0.01), (dx, 1.79, 0.155), Matrix.Rotation(math.radians(30 if dx > 0 else -30), 3, 'Z')) for dx in (-0.06, 0.06)],
          mat("MaskRed", (0.8, 0.05, 0.05), 0, 0.5), (0, 1.74, 0), mh)
    mw = empty("Mask_Welder", (0, 1.74, 0), head, props={"accessory": 1})
    box("WelderMask", (0.26, 0.28, 0.05), (0, 1.74, 0.15), mat("WelderGrey", (0.2, 0.22, 0.24), 0.3, 0.5), pivot=(0, 1.74, 0), parent=mw)
    box("WelderVisor", (0.16, 0.06, 0.01), (0, 1.77, 0.18), mat("WelderGlass", (0.1, 0.4, 0.15), 0.5, 0.1, emit=(0.05, 0.3, 0.1), emit_strength=0.6), pivot=(0, 1.74, 0), parent=mw)
    ms = empty("Mask_Super", (0, 1.74, 0), head, props={"accessory": 1})
    boxes("SuperMask", [((0.24, 0.07, 0.03), (0, 1.77, 0.125))] + [((0.05, 0.03, 0.03), (sx * 0.13, 1.79, 0.11)) for sx in (1, -1)],
          mat("SuperRed", (0.85, 0.05, 0.08), 0, 0.5), (0, 1.74, 0), ms)
    # demographic hair: long hair / ponytail (female meshes), beard + moustache (male meshes); C_Hair is recoloured per NPC
    hl = empty("Hair_Long", (0, 1.6, 0), head, props={"accessory": 1})
    boxes("LongHair", [((0.27, 0.36, 0.08), (0, 1.62, -0.11)), ((0.05, 0.3, 0.16), (0.12, 1.66, -0.02)), ((0.05, 0.3, 0.16), (-0.12, 1.66, -0.02)),
                       ((0.28, 0.06, 0.06), (0, 1.86, 0.09))], HAIR(), (0, 1.6, 0), hl)
    hp = empty("Hair_Ponytail", (0, 1.6, 0), head, props={"accessory": 1})
    sphere("Ponytail_Knot", 0.06, (0, 1.8, -0.15), HAIR(), pivot=(0, 1.6, 0), parent=hp)
    beams("Ponytail", [((0, 1.78, -0.17), (0, 1.52, -0.22), 0.07, 0.03)], 0.07, HAIR(), (0, 1.6, 0), hp)
    bd = empty("Beard", (0, 1.6, 0), head, props={"accessory": 1})
    boxes("BeardMesh", [((0.2, 0.1, 0.06), (0, 1.66, 0.105)), ((0.12, 0.05, 0.05), (0, 1.61, 0.1))], HAIR(), (0, 1.6, 0), bd)
    mu = empty("Moustache", (0, 1.6, 0), head, props={"accessory": 1})
    box("MoustacheMesh", (0.11, 0.025, 0.03), (0, 1.695, 0.135), HAIR(), pivot=(0, 1.6, 0), parent=mu)


def hand_props(hand, x):
    lt = empty("Hold_Lantern", (x, 0.86, 0), hand, props={"accessory": 1})
    beams("Lantern_Handle", [((x, 0.86, 0), (x, 0.74, 0), 0.015)], 0.015, DARK(), (x, 0.86, 0), lt)
    box("Lantern_Glass", (0.12, 0.16, 0.12), (x, 0.65, 0), mat("Lamp_Candle", (1, 0.7, 0.3), 0, 0.3, emit=(1, 0.55, 0.15), emit_strength=4), pivot=(x, 0.86, 0), parent=lt)
    cb = empty("Hold_Clipboard", (x, 0.86, 0), hand, props={"accessory": 1})
    box("Clipboard", (0.02, 0.3, 0.22), (x, 0.84, 0.08), mat("ClipBrown", (0.5, 0.35, 0.2), 0, 0.8), pivot=(x, 0.86, 0), parent=cb)
    wt = empty("Hold_Torch", (x, 0.86, 0), hand, props={"accessory": 1})
    beams("Torch", [((x, 0.86, 0.0), (x, 0.84, 0.3), 0.04), ((x, 0.84, 0.3), (x, 0.78, 0.36), 0.02)], 0.04, mat("Steel", (0.45, 0.47, 0.5), 0.85, 0.35), (x, 0.86, 0), wt)
    empty("Torch_Tip", (x, 0.78, 0.37), wt)
    fl = empty("Hold_Flashlight", (x, 0.86, 0), hand, props={"accessory": 1})
    cyl("Flashlight", 0.03, 0.22, (x, 0.85, 0.08), DARK(), axis='z', seg=8, pivot=(x, 0.86, 0), parent=fl)
    cbag = empty("Hold_CandyBag", (x, 0.86, 0), hand, props={"accessory": 1})
    beams("CandyBag_Handle", [((x - 0.07, 0.86, 0), (x, 0.9, 0), 0.015), ((x, 0.9, 0), (x + 0.07, 0.86, 0), 0.015)], 0.015, DARK(), (x, 0.86, 0), cbag)
    lathe("CandyBag_Pail", [(0.0, 0.62), (0.1, 0.63), (0.12, 0.72), (0.1, 0.84), (0.09, 0.85)], (x, 0, 0), mat("Pumpkin", (0.95, 0.42, 0.05), 0, 0.6),
          axis='y', seg=14, pivot=(x, 0.86, 0), parent=cbag, smooth=True)
    boxes("CandyBag_Face", [((0.03, 0.03, 0.02), (x + dx, 0.77, 0.11)) for dx in (-0.035, 0.035)] + [((0.07, 0.02, 0.02), (x, 0.71, 0.115))],
          DARK(), (x, 0.86, 0), cbag)


def build_human():
    reset_scene()
    root = empty("Character", (0, 0, 0))
    hips = box("Hips", (0.34, 0.2, 0.2), (0, 0.93, 0), PANTS(), pivot=(0, 0.95, 0), parent=root, props=J)
    torso = boxes("Torso", [((0.42, 0.42, 0.24), (0, 1.34, 0)), ((0.36, 0.2, 0.22), (0, 1.1, 0))], SHIRT(), (0, 1.02, 0), hips, props=J)
    box("Torso_Belt", (0.37, 0.05, 0.23), (0, 1.02, 0), DARK(), pivot=(0, 1.02, 0), parent=torso)
    box("Torso_Collar", (0.2, 0.05, 0.2), (0, 1.56, 0), SHIRT(), pivot=(0, 1.02, 0), parent=torso)
    head = sphere("Head", 0.13, (0, 1.74, 0), SKIN(), pivot=(0, 1.6, 0), parent=torso, scale=(0.95, 1.1, 1.0), props=J)
    cyl("Neck", 0.055, 0.12, (0, 1.6, 0), SKIN(), seg=10, pivot=(0, 1.6, 0), parent=head)
    sphere("Hair", 0.138, (0, 1.79, -0.015), HAIR(), pivot=(0, 1.6, 0), parent=head, scale=(1, 0.65, 1.02))
    boxes("Eyes", [((0.035, 0.03, 0.02), (dx, 1.76, 0.125)) for dx in (-0.045, 0.045)], DARK(), (0, 1.6, 0), head)
    box("Nose", (0.03, 0.05, 0.04), (0, 1.72, 0.135), SKIN(), pivot=(0, 1.6, 0), parent=head)
    jaw = box("Jaw", (0.08, 0.02, 0.02), (0, 1.66, 0.125), mat("C_Mouth", (0.4, 0.1, 0.1), 0, 0.8), pivot=(0, 1.67, 0.1), parent=head, props=J)
    accessories(head)
    # skirt (female meshes) rides on the hips; costumes for the trick-or-treaters ride on the torso
    sk = empty("Skirt", (0, 0.95, 0), hips, props={"accessory": 1})
    lathe("SkirtMesh", [(0.19, 1.0), (0.21, 0.9), (0.27, 0.62), (0.28, 0.58)], (0, 0, 0), mat("C_Skirt", (0.4, 0.1, 0.3), 0, 0.8), axis='y', seg=16,
          pivot=(0, 0.95, 0), parent=sk, smooth=True)
    cg = empty("Costume_Ghost", (0, 1.02, 0), torso, props={"accessory": 1})
    lathe("GhostCostume", [(0.0, 1.98), (0.16, 1.93), (0.2, 1.74), (0.33, 1.42), (0.36, 1.0), (0.38, 0.6), (0.4, 0.42)], (0, 0, 0),
          mat("GhostSheet", (0.95, 0.95, 1.0), 0, 0.6, emit=(0.5, 0.55, 0.6), emit_strength=0.5), axis='y', seg=18, pivot=(0, 1.02, 0), parent=cg, waves=(7, 0.08))
    boxes("GhostCostume_Eyes", [((0.06, 0.09, 0.03), (dx, 1.77, 0.19)) for dx in (-0.06, 0.06)], DARK(), (0, 1.02, 0), cg)
    cp = empty("Costume_Cape", (0, 1.02, 0), torso, props={"accessory": 1})
    boxes("Cape", [((0.5, 0.95, 0.03), (0, 1.03, -0.17), Matrix.Rotation(math.radians(8), 3, 'X')), ((0.32, 0.06, 0.26), (0, 1.53, -0.02))],
          mat("CapeRed", (0.8, 0.05, 0.08), 0, 0.6), (0, 1.02, 0), cp)
    box("Cape_Emblem", (0.14, 0.12, 0.02), (0, 1.36, 0.125), mat("CapeGold", (1.0, 0.75, 0.1), 0.4, 0.4), pivot=(0, 1.02, 0), parent=cp)
    for side, sx in (("L", 1), ("R", -1)):
        ua = box("UpperArm_" + side, (0.11, 0.32, 0.12), (sx * 0.265, 1.36, 0), SHIRT(), pivot=(sx * 0.25, 1.5, 0), parent=torso, props=J)
        la = box("LowerArm_" + side, (0.09, 0.28, 0.1), (sx * 0.27, 1.06, 0), SKIN(), pivot=(sx * 0.27, 1.2, 0), parent=ua, props=J)
        hand = sphere("Hand_" + side, 0.055, (sx * 0.27, 0.87, 0), SKIN(), pivot=(sx * 0.27, 0.91, 0), parent=la, scale=(0.8, 1.1, 1.0), props=J)
        hand_props(hand, sx * 0.27)
        ul = box("UpperLeg_" + side, (0.15, 0.42, 0.16), (sx * 0.1, 0.7, 0), PANTS(), pivot=(sx * 0.1, 0.9, 0), parent=hips, props=J)
        ll = box("LowerLeg_" + side, (0.13, 0.4, 0.14), (sx * 0.1, 0.29, 0), PANTS(), pivot=(sx * 0.1, 0.49, 0), parent=ul, props=J)
        box("Foot_" + side, (0.13, 0.08, 0.26), (sx * 0.1, 0.04, 0.05), SHOES(), pivot=(sx * 0.1, 0.09, 0), parent=ll, props=J)
    export_glb("character.glb")
    for o in bpy.data.objects:
        if o.get("accessory") and o.name not in ("Hat_Hard", "Hold_Clipboard"):
            o["preview_hide"] = 1
    for o in bpy.data.objects:
        if o.name == "UpperArm_L":
            o.rotation_euler = (0, -2.3, 0)   # wave (game z == blender -y)
        if o.name == "UpperLeg_R":
            o.rotation_euler = (-0.4, 0, 0)
    render_preview("blender_character.png", elev=10, azim=30, dist_mul=0.9)


def build_skeleton():
    reset_scene()
    root = empty("Skeleton", (0, 0, 0))
    B = BONE()
    hips = boxes("Hips", [((0.32, 0.12, 0.14), (0, 0.95, 0))], B, (0, 0.95, 0), root, props=J)
    torso = beams("Torso", [((0, 0.98, -0.04), (0, 1.55, -0.04), 0.06)], 0.06, B, (0, 1.02, 0), hips, props=J)
    rib = []
    for k in range(5):
        y = 1.48 - k * 0.075
        w = 0.17 - k * 0.012
        rib += [((-w, y, 0.02), (w, y, 0.02), 0.025), ((-w, y, 0.02), (-w, y - 0.02, -0.07), 0.025), ((w, y, 0.02), (w, y - 0.02, -0.07), 0.025)]
    rib += [((0, 1.5, 0.06), (0, 1.2, 0.05), 0.03), ((-0.22, 1.52, 0), (0.22, 1.52, 0), 0.03)]
    beams("Ribcage", rib, 0.025, B, (0, 1.02, 0), torso)
    head = sphere("Head", 0.13, (0, 1.76, 0), B, pivot=(0, 1.6, 0), parent=torso, scale=(0.9, 1.0, 1.05), props=J)
    beams("Neck", [((0, 1.56, -0.03), (0, 1.66, -0.02), 0.04)], 0.04, B, (0, 1.6, 0), head)
    boxes("EyeSockets", [((0.06, 0.06, 0.03), (dx, 1.78, 0.12)) for dx in (-0.045, 0.045)] + [((0.03, 0.04, 0.03), (0, 1.71, 0.13))], DARK(), (0, 1.6, 0), head)
    boxes("Eye_Glow", [((0.025, 0.025, 0.01), (dx, 1.78, 0.137)) for dx in (-0.045, 0.045)], mat("Lamp_EyeGreen", (0.3, 1, 0.3), 0, 0.3, emit=(0.2, 1, 0.2), emit_strength=4), (0, 1.6, 0), head)
    jaw = boxes("Jaw", [((0.16, 0.05, 0.12), (0, 1.645, 0.05))], B, (0, 1.67, -0.02), head, props=J)
    boxes("Teeth", [((0.012, 0.02, 0.01), (-0.05 + i * 0.02, 1.67, 0.11)) for i in range(6)], B, (0, 1.67, -0.02), jaw)
    accessories(head)
    for side, sx in (("L", 1), ("R", -1)):
        ua = beams("UpperArm_" + side, [((sx * 0.25, 1.5, 0), (sx * 0.27, 1.21, 0), 0.04)], 0.04, B, (sx * 0.25, 1.5, 0), torso, props=J)
        sphere("Shoulder_Knob_" + side, 0.04, (sx * 0.25, 1.5, 0), B, pivot=(sx * 0.25, 1.5, 0), parent=ua, seg=8)
        la = beams("LowerArm_" + side, [((sx * 0.27, 1.2, 0), (sx * 0.26, 0.93, 0), 0.03), ((sx * 0.29, 1.2, 0), (sx * 0.29, 0.93, 0), 0.025)], 0.03, B, (sx * 0.27, 1.2, 0), ua, props=J)
        sphere("Elbow_Knob_" + side, 0.035, (sx * 0.27, 1.2, 0), B, pivot=(sx * 0.27, 1.2, 0), parent=la, seg=8)
        hand = boxes("Hand_" + side, [((0.05, 0.08, 0.06), (sx * 0.27, 0.88, 0))] + [((0.012, 0.06, 0.012), (sx * 0.27 + dx, 0.82, 0.02)) for dx in (-0.015, 0.0, 0.015)],
                     B, (sx * 0.27, 0.91, 0), la, props=J)
        hand_props(hand, sx * 0.27)
        ul = beams("UpperLeg_" + side, [((sx * 0.1, 0.9, 0), (sx * 0.1, 0.5, 0), 0.05)], 0.05, B, (sx * 0.1, 0.9, 0), hips, props=J)
        sphere("Knee_" + side, 0.045, (sx * 0.1, 0.49, 0), B, pivot=(sx * 0.1, 0.9, 0), parent=ul, seg=8)
        ll = beams("LowerLeg_" + side, [((sx * 0.1, 0.49, 0), (sx * 0.1, 0.1, 0), 0.04), ((sx * 0.12, 0.49, 0), (sx * 0.12, 0.1, 0), 0.025)], 0.04, B, (sx * 0.1, 0.49, 0), ul, props=J)
        boxes("Foot_" + side, [((0.08, 0.05, 0.22), (sx * 0.1, 0.04, 0.05))], B, (sx * 0.1, 0.09, 0), ll, props=J)
    export_glb("skeleton.glb")
    for o in bpy.data.objects:
        if o.get("accessory") and o.name not in ("Hat_Hard", "Hold_Torch"):
            o["preview_hide"] = 1
        if o.name == "Jaw":
            o.rotation_euler = (0.35, 0, 0)
        if o.name == "UpperArm_R":
            o.rotation_euler = (-1.2, 0, 0)
    render_preview("blender_skeleton.png", elev=10, azim=30, dist_mul=0.9)


if __name__ == "__main__":
    build_human()
    build_skeleton()
    write_report("chars")
    print("CHARS_DONE")
