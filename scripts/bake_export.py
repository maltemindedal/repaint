"""Bake lighting and export a Repaint-ready .glb from any .blend, headless.

Automates the README's "Blender workflow" section end to end:

  1. converts bakeable meshes to plain meshes (applies modifiers, makes
     linked duplicates single-user so their lightmap UVs don't overlap),
  2. adds a second UV layer (`Lightmap`) and Smart-UV-projects each atlas
     group *together* so all islands share one 0-1 space,
  3. creates one standalone bake image per group (black, no alpha, sRGB),
  4. wires an Image Texture + UV Map node into every material and a
     `glTF Material Output` node group with the bake in its `Occlusion`
     input (what the glTF exporter reads, and what the app re-routes into
     three.js's lightMap slot),
  5. bakes Diffuse / Direct+Indirect (Color off) with Cycles,
  6. exports a .glb with the settings the README's table asks for
     (cameras on, +Y up, apply modifiers, UVs, normals).

Usage:

  blender --background apartment.blend --python scripts/bake_export.py -- \
      --out apartment.glb [options]

Options (after the `--`):

  --out PATH            output .glb (default: <blend name>.glb next to it)
  --atlas-size N        bake image size per group, px       (default 2048)
  --samples N           Cycles samples for the bake         (default 128)
  --margin N            bake margin, px                     (default 16)
  --island-margin F     Smart UV Project island margin      (default 0.03)
  --min-size F          skip baking objects whose largest bounding-box
                        dimension is below F metres; they still export,
                        just without a lightmap              (default 0.0)
  --group-by MODE       'collection' = one atlas per top-level collection
                        (groups sharing a material are merged, since the
                        bake image is per material); 'single' = one atlas
                        for everything                (default collection)
  --gpu                 try to bake on the GPU (Metal/CUDA/OptiX/HIP)
  --draco               enable Draco compression in the export
  --no-lights           don't export punctual lights

The source .blend is never saved — everything happens on the in-memory
copy. Bake images are also written to <out dir>/bakes/ for inspection.

Notes:
  - The scene still needs lights (or a world) to bake, and paintable
    materials still need the PAINT_ name prefix — a script can't guess
    which walls you want to repaint.
  - Meshes that already have 2+ UV layers get the lightmap at index 2+,
    not TEXCOORD_1; the script warns when that happens.
"""

import argparse
import math
import os
import sys
import time

import bpy

LIGHTMAP_UV = "Lightmap"
BAKE_NODE = "REPAINT_BAKE"
BAKE_UV_NODE = "REPAINT_BAKE_UV"
GLTF_GROUP = "glTF Material Output"


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="bake_export.py")
    p.add_argument("--out", default=None)
    p.add_argument("--atlas-size", type=int, default=2048)
    p.add_argument("--samples", type=int, default=128)
    p.add_argument("--margin", type=int, default=16)
    p.add_argument("--island-margin", type=float, default=0.03)
    p.add_argument("--min-size", type=float, default=0.0)
    p.add_argument("--group-by", choices=("collection", "single"), default="collection")
    p.add_argument("--gpu", action="store_true")
    p.add_argument("--draco", action="store_true")
    p.add_argument("--no-lights", action="store_true")
    return p.parse_args(argv)


def log(msg):
    print(f"[bake_export] {msg}", flush=True)


def default_out_path():
    blend = bpy.data.filepath
    if not blend:
        return os.path.abspath("untitled.glb")
    return os.path.splitext(blend)[0] + ".glb"


def enable_gpu():
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for dtype in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
            try:
                prefs.compute_device_type = dtype
            except TypeError:
                continue
            prefs.get_devices()
            found = [d for d in prefs.devices if d.type == dtype]
            if found:
                for d in prefs.devices:
                    d.use = d.type in (dtype, "CPU")
                return dtype
    except Exception as exc:  # GPU is best-effort; CPU bake still works
        log(f"GPU setup failed ({exc}); falling back to CPU")
    return None


def bakeable_objects(min_size):
    """Visible mesh objects with materials. Returns (bake, skipped_small)."""
    bake, small = [], []
    for ob in bpy.context.view_layer.objects:
        if ob.type != "MESH" or ob.hide_render:
            continue
        if not ob.data.polygons:
            continue
        if not any(slot.material for slot in ob.material_slots):
            log(f"skip (no material): {ob.name}")
            continue
        if min_size > 0 and max(ob.dimensions) < min_size:
            small.append(ob)
            continue
        bake.append(ob)
    return bake, small


def group_key(ob, mode):
    if mode == "single":
        return "Scene"
    cols = ob.users_collection
    return cols[0].name if cols else "Scene"


def build_groups(objects, mode):
    """Group objects, then merge any groups that share a material —
    the bake image lives on the material, so a material can only belong
    to one atlas."""
    parent = {}

    def find(k):
        parent.setdefault(k, k)
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    def union(a, b):
        parent[find(a)] = find(b)

    keys = {ob: group_key(ob, mode) for ob in objects}
    for k in keys.values():
        find(k)
    by_material = {}
    for ob, k in keys.items():
        for slot in ob.material_slots:
            if slot.material is None:
                continue
            if slot.material in by_material:
                union(k, by_material[slot.material])
            else:
                by_material[slot.material] = k
    groups = {}
    for ob, k in keys.items():
        groups.setdefault(find(k), []).append(ob)
    return groups


def convert_to_mesh(objects):
    """Apply modifiers and make shared mesh data single-user, so every
    object owns the UVs its atlas region is baked into."""
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.convert(target="MESH")
    for ob in objects:
        if ob.data.users > 1:
            ob.data = ob.data.copy()


def add_lightmap_layer(ob):
    me = ob.data
    render_idx = next(
        (i for i, l in enumerate(me.uv_layers) if l.active_render), 0
    )
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
        render_idx = 0
    layer = me.uv_layers.get(LIGHTMAP_UV)
    if layer is None:
        layer = me.uv_layers.new(name=LIGHTMAP_UV)
        if layer is None:
            log(f"WARNING: {ob.name} is at the 8-UV-layer limit, skipping")
            return False
    idx = list(me.uv_layers).index(layer)
    if idx != 1:
        log(
            f"WARNING: {ob.name}: lightmap is TEXCOORD_{idx}, not TEXCOORD_1 "
            f"(mesh already had {idx} UV layers)"
        )
    # Bake target = active layer; texture sampling default = render layer.
    # The lightmap must be the former and never the latter.
    if me.uv_layers[render_idx] is not layer:
        me.uv_layers[render_idx].active_render = True
    layer.active_render = False
    me.uv_layers.active = layer
    return True


def unwrap_group(objects, island_margin):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.reveal()
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(66),
        island_margin=island_margin,
        correct_aspect=True,
        scale_to_bounds=False,
    )
    bpy.ops.object.mode_set(mode="OBJECT")


def make_bake_image(name, size):
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.generated_color = (0.0, 0.0, 0.0, 1.0)
    img.colorspace_settings.name = "sRGB"
    return img


def gltf_output_tree():
    tree = bpy.data.node_groups.get(GLTF_GROUP)
    if tree is None:
        tree = bpy.data.node_groups.new(GLTF_GROUP, "ShaderNodeTree")
        if hasattr(tree, "interface"):  # Blender 4.x
            tree.interface.new_socket(
                "Occlusion", in_out="INPUT", socket_type="NodeSocketFloat"
            )
        else:  # Blender 3.x
            tree.inputs.new("NodeSocketFloat", "Occlusion")
        tree.nodes.new("NodeGroupInput")
    return tree


def wire_material(mat, image):
    """Bake image node (active, unconnected to shading) + UV Map node +
    glTF Material Output group with the bake in its Occlusion input."""
    mat.use_nodes = True
    nt = mat.node_tree

    tex = nt.nodes.get(BAKE_NODE)
    if tex is None or tex.bl_idname != "ShaderNodeTexImage":
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.name = BAKE_NODE
        tex.label = "Repaint bake"
        tex.location = (-600, -400)
    tex.image = image

    uvn = nt.nodes.get(BAKE_UV_NODE)
    if uvn is None or uvn.bl_idname != "ShaderNodeUVMap":
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.name = BAKE_UV_NODE
        uvn.location = (-800, -400)
    uvn.uv_map = LIGHTMAP_UV
    nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])

    grp = next(
        (
            n
            for n in nt.nodes
            if n.bl_idname == "ShaderNodeGroup"
            and n.node_tree is not None
            and n.node_tree.name.startswith(GLTF_GROUP)
        ),
        None,
    )
    if grp is None:
        grp = nt.nodes.new("ShaderNodeGroup")
        grp.location = (-300, -400)
    grp.node_tree = gltf_output_tree()
    nt.links.new(tex.outputs["Color"], grp.inputs["Occlusion"])

    # Cycles bakes into the *active* image texture node.
    for n in nt.nodes:
        n.select = False
    tex.select = True
    nt.nodes.active = tex


def bake_group(objects, margin):
    for i, ob in enumerate(objects, 1):
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        ob.data.uv_layers.active = ob.data.uv_layers[LIGHTMAP_UV]
        log(f"  bake {i}/{len(objects)}: {ob.name}")
        bpy.ops.object.bake(
            type="DIFFUSE",
            pass_filter={"DIRECT", "INDIRECT"},
            margin=margin,
            use_clear=False,  # image starts black; objects accumulate
        )


def save_bakes(images, out_path):
    bake_dir = os.path.join(os.path.dirname(os.path.abspath(out_path)), "bakes")
    os.makedirs(bake_dir, exist_ok=True)
    for img in images:
        img.filepath_raw = os.path.join(bake_dir, f"{img.name}.png")
        img.file_format = "PNG"
        img.save()
    log(f"bake images saved to {bake_dir}/")


def export_glb(path, draco, lights):
    kwargs = dict(
        filepath=path,
        export_format="GLB",
        export_cameras=True,       # needed for START_CAM
        export_apply=True,         # apply modifiers
        export_yup=True,
        export_texcoords=True,     # non-negotiable: lightmap sampling
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_lights=lights,
        export_draco_mesh_compression_enable=draco,
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        # Older exporters lack some kwargs; retry without the optional ones.
        kwargs.pop("export_draco_mesh_compression_enable", None)
        kwargs.pop("export_image_format", None)
        bpy.ops.export_scene.gltf(**kwargs)


def main():
    args = parse_args()
    out = os.path.abspath(args.out or default_out_path())
    t0 = time.time()

    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = args.samples
    scene.render.bake.use_selected_to_active = False
    if args.gpu:
        dtype = enable_gpu()
        scene.cycles.device = "GPU" if dtype else "CPU"
        log(f"compute device: {dtype or 'CPU (no GPU found)'}")

    n_lights = sum(1 for ob in scene.objects if ob.type == "LIGHT" and not ob.hide_render)
    if n_lights == 0 and (scene.world is None or not scene.world.use_nodes):
        log("WARNING: no lights and no world — the bake will be black")

    paint = [m for m in bpy.data.materials if m.name.startswith("PAINT_")]
    log(f"{len(paint)} PAINT_ material(s) found" if paint else
        "WARNING: no PAINT_ materials — nothing will be repaintable "
        "(you can still tag materials manually in the app)")

    objects, small = bakeable_objects(args.min_size)
    if small:
        log(f"{len(small)} object(s) under --min-size {args.min_size} m: "
            "exported without a bake")
    if not objects:
        log("nothing to bake; exporting as-is")
        export_glb(out, args.draco, not args.no_lights)
        return

    convert_to_mesh(objects)
    groups = build_groups(objects, args.group_by)
    log(f"{len(objects)} object(s) in {len(groups)} atlas group(s)")

    images = []
    for key, obs in sorted(groups.items()):
        safe = "".join(c if c.isalnum() else "_" for c in key)
        log(f"group '{key}': {len(obs)} object(s)")

        obs = [ob for ob in obs if add_lightmap_layer(ob)]
        if not obs:
            continue
        unwrap_group(obs, args.island_margin)

        img = make_bake_image(f"Bake_{safe}", args.atlas_size)
        images.append(img)
        materials = {
            slot.material for ob in obs for slot in ob.material_slots if slot.material
        }
        for mat in materials:
            wire_material(mat, img)

        bake_group(obs, args.margin)

    save_bakes(images, out)
    export_glb(out, args.draco, not args.no_lights)
    log(f"exported {out} in {time.time() - t0:.0f}s")
    log("the source .blend was not modified on disk")


main()
