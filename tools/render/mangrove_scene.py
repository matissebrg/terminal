"""Mangrove hero render: a liquid-chrome mangrove on mirror water, for the site's first screen.

Run:  python3 mangrove_scene.py <out.png> <width> <height> <samples> [shot]
shot: 'hero' (default, above the water) or 'roots' (below the surface, looking at the roots).
The camera sees a flat background exactly the page colour (Standard view transform), while
reflections see a studio: soft boxes, black flags for contrast, and one mint strip from the logo.
"""
import math
import random
import sys

import bpy
from mathutils import Vector

OUT, W, H, SAMPLES = sys.argv[-5], int(sys.argv[-4]), int(sys.argv[-3]), int(sys.argv[-2])
SHOT = sys.argv[-1]
# 'grow' = the roots shot, animated: every root grows down from the surface while the camera sinks with them.
# Renders frames GROW_FIRST..GROW_LAST (env vars, default the whole 1..72) as OUT####.png.
GROW = SHOT == "grow"
if GROW:
    SHOT = "roots"

PAPER = "#EDF0EC"      # page colour above water (keep in sync with --brume in the CSS)
ABYSS = "#04110F"      # page colour below water (--abysse)
MINT = "#3FE3A6"       # the logo's green


def lin(hexstr, a=1.0):
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*c, a)


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 10
sc.cycles.glossy_bounces = 8
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.render.resolution_percentage = 100
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_depth = "16"
sc.render.filepath = OUT
random.seed(7)

# ---------------------------------------------------------------- materials
def principled(name, base, metallic, rough, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(base)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if coat:
        b.inputs["Coat Weight"].default_value = coat
    return m


chrome = principled("chrome", "#E6ECEA", 1.0, 0.045)


def emission_mat(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs[0].default_value = lin(color)
    e.inputs[1].default_value = strength
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs[0], o.inputs[0])
    return m


def surface_from_below():
    m = bpy.data.materials.new("surface")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vlen = nt.nodes.new("ShaderNodeVectorMath"); vlen.operation = "LENGTH"
    nt.links.new(tc.outputs["Object"], vlen.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0; cr.elements[0].color = lin("#BFF5E2")
    cr.elements[1].position = 1.0; cr.elements[1].color = lin(ABYSS)
    mid = cr.elements.new(0.22); mid.color = lin("#2C8E74")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0
    mr.inputs["From Max"].default_value = 11.0
    nt.links.new(vlen.outputs["Value"], mr.inputs["Value"])
    # caustic shimmer
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.feature = "DISTANCE_TO_EDGE"
    vor.inputs["Scale"].default_value = 1.4
    cpow = nt.nodes.new("ShaderNodeMath"); cpow.operation = "POWER"; cpow.inputs[1].default_value = 0.35
    nt.links.new(vor.outputs["Distance"], cpow.inputs[0])
    mulc = nt.nodes.new("ShaderNodeMixRGB"); mulc.blend_type = "MULTIPLY"; mulc.inputs["Fac"].default_value = 0.35
    nt.links.new(mr.outputs["Result"], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], mulc.inputs[1])
    nt.links.new(cpow.outputs[0], mulc.inputs[2])
    e = nt.nodes.new("ShaderNodeEmission"); e.inputs[1].default_value = 1.6
    nt.links.new(mulc.outputs[0], e.inputs[0])
    nt.links.new(e.outputs[0], out.inputs[0])
    return m


def water_mat(bg_hex, under=False):
    """Mirror near the tree, fading to the exact page colour with distance (seen by the camera)."""
    m = bpy.data.materials.new("water")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    # radial distance (x, y stretched so the pool reads as an ellipse from the low camera)
    vlen = nt.nodes.new("ShaderNodeVectorMath")
    vlen.operation = "LENGTH"
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    mx = nt.nodes.new("ShaderNodeMath"); mx.operation = "MULTIPLY"; mx.inputs[1].default_value = 0.8
    nt.links.new(sep.outputs["X"], mx.inputs[0])
    nt.links.new(mx.outputs[0], comb.inputs["X"])
    nt.links.new(sep.outputs["Y"], comb.inputs["Y"])
    nt.links.new(comb.outputs[0], vlen.inputs[0])
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = 1.4
    ramp.inputs["From Max"].default_value = 3.6
    ramp.inputs["To Min"].default_value = 1.0
    ramp.inputs["To Max"].default_value = 0.0
    ramp.interpolation_type = "SMOOTHERSTEP"
    nt.links.new(vlen.outputs["Value"], ramp.inputs["Value"])
    # glossy water with the faintest concentric ripple
    glossy = nt.nodes.new("ShaderNodeBsdfGlossy")
    glossy.inputs["Roughness"].default_value = 0.012
    glossy.inputs["Color"].default_value = lin("#F1F5F3" if not under else "#7FD9BC")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "RINGS"
    wave.inputs["Scale"].default_value = 1.6
    wave.inputs["Distortion"].default_value = 0.6
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.012
    nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], glossy.inputs["Normal"])
    bg = nt.nodes.new("ShaderNodeEmission")
    bg.inputs[0].default_value = lin(bg_hex)
    bg.inputs[1].default_value = 1.0
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(ramp.outputs["Result"], mix.inputs["Fac"])
    nt.links.new(bg.outputs[0], mix.inputs[1])
    nt.links.new(glossy.outputs[0], mix.inputs[2])
    lake = nt.nodes.new("ShaderNodeEmission")
    lake.inputs[0].default_value = lin("#16211E" if not under else "#7FE7C6")
    lake.inputs[1].default_value = 1.0 if not under else 0.6
    lp = nt.nodes.new("ShaderNodeLightPath")
    seen = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], seen.inputs["Fac"])
    nt.links.new(lake.outputs[0], seen.inputs[1])
    nt.links.new(mix.outputs[0], seen.inputs[2])
    nt.links.new(seen.outputs[0], out.inputs[0])
    return m


# ---------------------------------------------------------------- the mangrove
def link(obj, mat):
    obj.data.materials.append(mat)
    return obj


# crown: a wide, slightly flattened dome of metaballs (liquid chrome)
mb = bpy.data.metaballs.new("crown")
mb.resolution = 0.05
mb.render_resolution = 0.035
mb.threshold = 0.5
crown = bpy.data.objects.new("crown", mb)
sc.collection.objects.link(crown)
# nine lobes in an umbrella fan (the logo's crown), each a cluster of small balls
LOBES = [(0.0, 0.0, 4.25, 0.95)]
for i in range(8):
    ang = 2 * math.pi * i / 8 + 0.2
    rr = random.uniform(1.45, 2.05)
    LOBES.append((rr * math.cos(ang), rr * math.sin(ang) * 0.7, 3.55 - 0.25 * (rr - 1.4) + random.uniform(-0.12, 0.12), 0.8))
for (cx, cy, cz, spread) in LOBES:
    for j in range(15):
        u = Vector((random.gauss(0, 1), random.gauss(0, 0.8), random.gauss(0, 0.55))).normalized()
        d = random.uniform(0.0, spread)
        el = mb.elements.new()
        el.co = (cx + u.x * d, cy + u.y * d, cz + u.z * d * 0.7)
        el.radius = random.uniform(0.46, 0.64)
        el.stiffness = 1.6
# underside: a shallow lid so the canopy has a readable bottom edge
for i in range(16):
    ang = 2 * math.pi * i / 16
    rr = random.uniform(0.8, 2.1)
    el = mb.elements.new()
    el.co = (rr * math.cos(ang), rr * math.sin(ang) * 0.7, 3.05 + random.uniform(-0.08, 0.1))
    el.radius = random.uniform(0.42, 0.55)
    el.stiffness = 1.8
link(crown, chrome)


def tube(name, pts, radii, mat, res=12):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 6
    cu.resolution_u = res
    cu.use_fill_caps = True
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    for p, (co, r) in zip(sp.points, zip(pts, radii)):
        p.co = (*co, 1.0)
        p.radius = r
    sp.order_u = min(4, len(pts))
    sp.use_endpoint_u = True
    ob = bpy.data.objects.new(name, cu)
    sc.collection.objects.link(ob)
    return link(ob, mat)


# trunk splitting into the crown
tube("trunk", [(0, 0, 1.05), (0.02, 0.0, 1.9), (-0.03, 0.02, 2.7), (0, 0, 3.4)], [0.26, 0.22, 0.2, 0.24], chrome)
for k, (dx, dy) in enumerate([(-1.1, 0.1), (1.0, -0.15), (0.2, 0.6), (-0.4, -0.5)]):
    tube(f"branch{k}", [(0, 0, 2.3), (dx * 0.35, dy * 0.35, 2.75), (dx * 0.8, dy * 0.8, 3.15), (dx, dy, 3.4)],
         [0.12, 0.1, 0.08, 0.07], chrome)

# prop roots: arches from the trunk out and down into the water
NR = 14
for k in range(NR):
    a = 2 * math.pi * k / NR + random.uniform(-0.18, 0.18)
    R = random.uniform(1.25, 2.35)
    h0 = random.uniform(1.15, 1.85)
    ca, sa = math.cos(a), math.sin(a) * 0.8
    pts = [
        (0.06 * ca, 0.06 * sa, h0),
        (0.38 * R * ca, 0.38 * R * sa, h0 + 0.32),
        (0.78 * R * ca, 0.78 * R * sa, h0 * 0.62),
        (R * ca, R * sa, 0.18),
        (R * 1.03 * ca, R * 1.03 * sa, -0.35 if SHOT == "hero" else -1.6),
    ] + ([] if SHOT == "hero" else [(R * 1.55 * ca + random.uniform(-.3, .3), R * 1.55 * sa, -3.4), (R * 1.75 * ca, R * 1.75 * sa, -5.5)])
    tube(f"root{k}", pts, ([0.12, 0.095, 0.072, 0.06, 0.055] if SHOT == "hero" else [0.12, 0.1, 0.09, 0.085, 0.08, 0.07, 0.05])[:len(pts)], chrome)

# aerial roots dropping from the canopy edge, swaying a little
for k in range(6):
    a = 2 * math.pi * (k + random.uniform(0.1, 0.9)) / 6
    rr = random.uniform(1.3, 2.2)
    x, y = rr * math.cos(a), rr * math.sin(a) * 0.75
    top, sway = 2.9, random.uniform(-0.18, 0.18)
    tube(f"aerial{k}", [(x, y, top), (x + sway, y, top * 0.62), (x - sway * 0.5, y, top * 0.3), (x, y, -0.3 if SHOT == "hero" else -3.2)],
         [0.03, 0.024, 0.02, 0.018], chrome, res=8)

# ---------------------------------------------------------------- water, studio, world
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
water = bpy.context.object
water.data.materials.append(water_mat(PAPER) if SHOT == "hero" else surface_from_below())
if SHOT != "hero":
    water.visible_shadow = False


def area(name, loc, rot, size, color, strength, shape="RECTANGLE", size_y=None, cam_visible=False):
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = shape
    ld.size = size
    if size_y:
        ld.size_y = size_y
    ld.color = lin(color)[:3]
    ld.energy = strength
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = rot
    ob.visible_camera = cam_visible
    sc.collection.objects.link(ob)
    return ob


def card(name, loc, rot, sx, sy, mat):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.object
    ob.scale = (sx, sy, 1)
    ob.data.materials.append(mat)
    ob.visible_camera = False
    ob.visible_shadow = False
    return ob


if SHOT == "hero":
    # soft key from upper left, rim from behind, a long mint strip low on the left
    area("key", (-6, -6, 9), (math.radians(40), 0, math.radians(-40)), 6, "#FFFFFF", 2600)
    area("fill", (7, -4, 4), (math.radians(70), 0, math.radians(60)), 5, "#F2F6F4", 700)
    area("rim", (0, 8, 7), (math.radians(-50), 0, 0), 8, "#FFFFFF", 1800)
    area("mint", (-7.5, -1.5, 2.2), (0, math.radians(-90), 0), 0.35, MINT, 900, size_y=9)
    # black flags: what the chrome reflects as its dark accents
    black = emission_mat("flag", "#0D1714", 1.0)
    card("flagL", (-9, 2, 4), (0, math.radians(90), 0), 6, 10, black)
    card("flagR", (9, 3, 3.5), (0, math.radians(-90), 0), 5, 8, black)
    card("flagTop", (0, 3, 13), (0, 0, 0), 9, 4, black)
    cam_loc, target, lens = Vector((0, -16.5, 1.3)), Vector((0, 0, 2.2)), 58
    bg_cam, bg_env = PAPER, ("#FFFFFF", "#EDF0EC", "#3A4642")
else:
    # below the surface: roots lit from above through the water, mint rim, abyss beyond
    area("sun", (0, 0, 14), (0, 0, 0), 10, "#E9FFF7", 5200)
    area("mintL", (-6, -3, -1.5), (0, math.radians(-75), 0), 0.4, MINT, 700, size_y=8)
    area("mintR", (6, 2, -2), (0, math.radians(80), 0), 0.4, MINT, 450, size_y=8)
    water.location.z = 0.0
    water.rotation_euler = (math.pi, 0, 0)        # we look at its underside
    cam_loc, target, lens = Vector((0.4, -7.4, -1.15)), Vector((0, 0, -0.9)), 24
    bg_cam, bg_env = ABYSS, ("#2F8A73", "#0A2A24", "#020807")

world = bpy.data.worlds.new("world")
sc.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputWorld")
lp = nt.nodes.new("ShaderNodeLightPath")
cam_bg = nt.nodes.new("ShaderNodeBackground")
cam_bg.inputs[0].default_value = lin(bg_cam)
cam_bg.inputs[1].default_value = 1.0
# studio gradient for reflections: bright above, mid at the horizon, darker below
tc = nt.nodes.new("ShaderNodeTexCoord")
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
nt.links.new(tc.outputs["Generated"], sep.inputs[0])
cr = nt.nodes.new("ShaderNodeValToRGB")
cr.color_ramp.elements[0].position = 0.30
cr.color_ramp.elements[0].color = lin(bg_env[2])
cr.color_ramp.elements[1].position = 0.80
cr.color_ramp.elements[1].color = lin(bg_env[0])
mid = cr.color_ramp.elements.new(0.505)
mid.color = lin(bg_env[1])
zmap = nt.nodes.new("ShaderNodeMapRange")
zmap.inputs["From Min"].default_value = -1.0
zmap.inputs["From Max"].default_value = 1.0
nt.links.new(sep.outputs["Z"], zmap.inputs["Value"])
nt.links.new(zmap.outputs["Result"], cr.inputs[0])
env_bg = nt.nodes.new("ShaderNodeBackground")
env_bg.inputs[1].default_value = 0.9
nt.links.new(cr.outputs[0], env_bg.inputs[0])
mix = nt.nodes.new("ShaderNodeMixShader")
nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
nt.links.new(env_bg.outputs[0], mix.inputs[1])
nt.links.new(cam_bg.outputs[0], mix.inputs[2])
nt.links.new(mix.outputs[0], out.inputs[0])

cam_data = bpy.data.cameras.new("cam")
cam_data.lens = lens
cam = bpy.data.objects.new("cam", cam_data)
cam.location = cam_loc
cam.rotation_euler = (target - cam_loc).to_track_quat("-Z", "Y").to_euler()
sc.collection.objects.link(cam)
sc.camera = cam

if not GROW:
    bpy.ops.render.render(write_still=True)
    print("RENDERED", OUT)
else:
    import os
    FRAMES = int(os.environ.get("GROW_FRAMES", 120))   # 5 s at 24 fps: slow enough to read as growth, not a jolt
    sc.render.fps = 24
    sc.frame_start = int(os.environ.get("GROW_FIRST", 1))
    sc.frame_end = int(os.environ.get("GROW_LAST", FRAMES))
    sc.render.image_settings.color_depth = "8"
    sc.render.filepath = OUT

    def fcurves(idblock):
        """F-curves of an ID's action, for both the classic and the layered (Blender 4.4+) action API."""
        act = idblock.animation_data.action if idblock.animation_data else None
        if act is None:
            return []
        if hasattr(act, "fcurves") and len(act.fcurves):
            return list(act.fcurves)
        out = []
        for layer in getattr(act, "layers", []):
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []):
                    out += list(bag.fcurves)
        return out

    def smooth(idblock):
        for fc in fcurves(idblock):
            for kp in fc.keyframe_points:
                kp.interpolation = "SINE"
                kp.easing = "EASE_IN_OUT"

    # each root grows along its own length (bevel factor), from where it meets the surface down to its tip,
    # in a slow, overlapping wave, easing in and out
    rnd = random.Random(11)
    roots = [o for o in sc.objects if o.name.startswith(("root", "aerial"))]
    rnd.shuffle(roots)
    span = FRAMES * 0.28
    for i, ob in enumerate(roots):
        cu = ob.data
        cu.bevel_factor_mapping_end = "SPLINE"
        f0 = 3 + span * i / max(1, len(roots) - 1) + rnd.uniform(0, 4)
        f1 = min(f0 + FRAMES * rnd.uniform(0.55, 0.66), FRAMES - 4)
        cu.bevel_factor_end = 0.42 if ob.name.startswith("root") else 0.5
        cu.keyframe_insert("bevel_factor_end", frame=f0)
        cu.bevel_factor_end = 1.0
        cu.keyframe_insert("bevel_factor_end", frame=f1)
        smooth(cu)
    # the camera sinks a little with the roots, gently
    for f, (cz, tz) in ((1, (-0.85, -0.6)), (FRAMES, (-1.3, -1.35))):
        loc, tgt = Vector((0.4, -7.4, cz)), Vector((0, 0, tz))
        cam.location = loc
        cam.rotation_euler = (tgt - loc).to_track_quat("-Z", "Y").to_euler()
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)
    smooth(cam)
    bpy.ops.render.render(animation=True)
    print("RENDERED FRAMES", sc.frame_start, sc.frame_end)
