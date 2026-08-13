"""Bake lighting and export a Repaint-ready .glb from any .blend, headless.

Automates the Blender workflow from docs/guides/ end to end:

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
  6. exports a .glb with the settings docs/guides/preparing-a-blender-scene.md
     asks for (cameras on, +Y up, apply modifiers, UVs, normals).

Usage:

  blender --background apartment.blend --python scripts/bake_export.py -- \
      --out apartment.glb [options]

Run with `-- --help` for the option list, or see
docs/guides/baking-lighting.md, "Automating this guide with a script".

The source .blend is never saved — everything happens on the in-memory
copy. Bake images are packed into the export and also written to
<out dir>/bakes/ for inspection.

Notes:
  - The scene still needs lights (or a world) to bake, and paintable
    materials still need the PAINT_ name prefix — a script can't guess
    which walls you want to repaint.
  - Meshes that already have 2+ UV layers get the lightmap at index 2+,
    not TEXCOORD_1; the script warns when that happens.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import time
from dataclasses import dataclass
from typing import Iterable, Literal, Sequence, cast

import bpy

LIGHTMAP_UV = "Lightmap"
BAKE_NODE = "REPAINT_BAKE"
BAKE_UV_NODE = "REPAINT_BAKE_UV"
GLTF_GROUP = "glTF Material Output"

GroupBy = Literal["collection", "single"]


@dataclass(frozen=True)
class Options:
    out: str | None
    atlas_size: int
    samples: int
    margin: int
    island_margin: float
    min_size: float
    group_by: GroupBy
    gpu: bool
    draco: bool
    no_lights: bool


def parse_options() -> Options:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="bake_export.py")
    p.add_argument("--out", default=None,
                   help="output .glb (default: <blend name>.glb next to it)")
    p.add_argument("--atlas-size", type=int, default=2048,
                   help="bake image size per atlas group, px")
    p.add_argument("--samples", type=int, default=128,
                   help="Cycles samples for the bake")
    p.add_argument("--margin", type=int, default=16,
                   help="bake margin, px")
    p.add_argument("--island-margin", type=float, default=0.03,
                   help="Smart UV Project island margin")
    p.add_argument("--min-size", type=float, default=0.0,
                   help="skip baking objects whose largest bounding-box "
                        "dimension is below this many metres; they still "
                        "export, just without a lightmap (objects sharing a "
                        "material with a baked object are promoted into the "
                        "bake instead)")
    p.add_argument("--group-by", choices=("collection", "single"),
                   default="collection",
                   help="'collection' = one atlas per top-level collection "
                        "(groups sharing a material are merged, since the "
                        "bake image is per material); 'single' = one atlas "
                        "for everything")
    p.add_argument("--gpu", action="store_true",
                   help="try to bake on the GPU (Metal/CUDA/OptiX/HIP)")
    p.add_argument("--draco", action="store_true",
                   help="enable Draco compression in the export")
    p.add_argument("--no-lights", action="store_true",
                   help="don't export punctual lights")
    ns = p.parse_args(argv)
    return Options(
        out=ns.out,
        atlas_size=ns.atlas_size,
        samples=ns.samples,
        margin=ns.margin,
        island_margin=ns.island_margin,
        min_size=ns.min_size,
        group_by=cast(GroupBy, ns.group_by),
        gpu=ns.gpu,
        draco=ns.draco,
        no_lights=ns.no_lights,
    )


def log(msg: str) -> None:
    print(f"[bake_export] {msg}", flush=True)


def sanitize(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in name)


def default_out_path() -> str:
    blend = str(bpy.data.filepath)
    if not blend:
        return os.path.abspath("untitled.glb")
    return os.path.splitext(blend)[0] + ".glb"


def select_only(objects: Sequence[bpy.types.Object]) -> None:
    """Make exactly these objects selected, with the first one active."""
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def materials_of(ob: bpy.types.Object) -> list[bpy.types.Material]:
    return [slot.material for slot in ob.material_slots if slot.material]


def enable_gpu() -> str | None:
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


def world_emits_light(world: bpy.types.World | None) -> bool:
    """Best-effort check whether the world contributes any light."""
    if world is None:
        return False
    if not world.use_nodes:
        return bool(max(world.color[:3]) > 0.0)
    for node in world.node_tree.nodes:
        if node.bl_idname in ("ShaderNodeTexEnvironment", "ShaderNodeTexSky"):
            return True
        if node.bl_idname == "ShaderNodeBackground":
            strength = node.inputs["Strength"]
            color = node.inputs["Color"]
            if strength.is_linked or color.is_linked:
                return True
            if strength.default_value > 0.0 and max(color.default_value[:3]) > 0.0:
                return True
    return False


def bakeable_objects(
    min_size: float,
) -> tuple[list[bpy.types.Object], list[bpy.types.Object]]:
    """Visible mesh objects with materials. Returns (bake, skipped_small)."""
    bake: list[bpy.types.Object] = []
    small: list[bpy.types.Object] = []
    for ob in bpy.context.view_layer.objects:
        if ob.type != "MESH" or ob.hide_render:
            continue
        if not ob.data.polygons:
            continue
        if not materials_of(ob):
            log(f"skip (no material): {ob.name}")
            continue
        if min_size > 0 and max(ob.dimensions) < min_size:
            small.append(ob)
            continue
        bake.append(ob)
    return bake, small


def promote_shared_small(
    bake: list[bpy.types.Object], small: list[bpy.types.Object]
) -> list[bpy.types.Object]:
    """The bake image lives on the material, so a small object sharing a
    material with a baked object must be baked too — otherwise its mesh
    would carry an occlusion texture but no lightmap UV layer."""
    baked_mats = {m for ob in bake for m in materials_of(ob)}
    promoted: list[bpy.types.Object] = []
    changed = True
    while changed:
        changed = False
        for ob in list(small):
            if any(m in baked_mats for m in materials_of(ob)):
                small.remove(ob)
                bake.append(ob)
                promoted.append(ob)
                baked_mats.update(materials_of(ob))
                changed = True
    return promoted


def top_level_collection_map() -> dict[str, str]:
    """Object name -> name of the top-level collection it lives under
    (first one wins for objects linked into several). Objects sitting
    directly in the scene collection aren't in the map."""
    mapping: dict[str, str] = {}
    for child in bpy.context.scene.collection.children:
        for ob in child.all_objects:
            mapping.setdefault(ob.name, child.name)
    return mapping


def build_groups(
    objects: Sequence[bpy.types.Object], mode: GroupBy
) -> dict[str, list[bpy.types.Object]]:
    """Group objects, then merge any groups that share a material —
    the bake image lives on the material, so a material can only belong
    to one atlas."""
    parent: dict[str, str] = {}

    def find(k: str) -> str:
        parent.setdefault(k, k)
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    def union(a: str, b: str) -> None:
        parent[find(a)] = find(b)

    top_level = top_level_collection_map()
    keys: dict[bpy.types.Object, str] = {
        ob: ("Scene" if mode == "single" else top_level.get(ob.name, "Scene"))
        for ob in objects
    }
    for k in keys.values():
        find(k)
    by_material: dict[bpy.types.Material, str] = {}
    for ob, k in keys.items():
        for mat in materials_of(ob):
            if mat in by_material:
                union(k, by_material[mat])
            else:
                by_material[mat] = k
    groups: dict[str, list[bpy.types.Object]] = {}
    for ob, k in keys.items():
        groups.setdefault(find(k), []).append(ob)
    return groups


def convert_to_mesh(objects: Sequence[bpy.types.Object]) -> None:
    """Apply modifiers and make shared mesh data single-user, so every
    object owns the UVs its atlas region is baked into."""
    select_only(objects)
    bpy.ops.object.convert(target="MESH")
    for ob in objects:
        if ob.data.users > 1:
            ob.data = ob.data.copy()


def add_lightmap_layer(ob: bpy.types.Object) -> bool:
    me = cast(bpy.types.Mesh, ob.data)
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


def unwrap_group(objects: Sequence[bpy.types.Object], island_margin: float) -> None:
    select_only(objects)
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


def make_bake_image(name: str, size: int) -> bpy.types.Image:
    existing = bpy.data.images.get(name)
    if existing is not None:
        bpy.data.images.remove(existing)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.generated_color = (0.0, 0.0, 0.0, 1.0)
    img.colorspace_settings.name = "sRGB"
    return img


def gltf_output_tree() -> bpy.types.ShaderNodeTree:
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
    return cast(bpy.types.ShaderNodeTree, tree)


def wire_material(mat: bpy.types.Material, image: bpy.types.Image) -> None:
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
    cast(bpy.types.ShaderNodeTexImage, tex).image = image

    uvn = nt.nodes.get(BAKE_UV_NODE)
    if uvn is None or uvn.bl_idname != "ShaderNodeUVMap":
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.name = BAKE_UV_NODE
        uvn.location = (-800, -400)
    cast(bpy.types.ShaderNodeUVMap, uvn).uv_map = LIGHTMAP_UV
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
    cast(bpy.types.ShaderNodeGroup, grp).node_tree = gltf_output_tree()
    nt.links.new(tex.outputs["Color"], grp.inputs["Occlusion"])

    # Cycles bakes into the *active* image texture node.
    for n in nt.nodes:
        n.select = False
    tex.select = True
    nt.nodes.active = tex


def bake_group(objects: Sequence[bpy.types.Object], margin: int) -> None:
    for i, ob in enumerate(objects, 1):
        select_only([ob])
        me = cast(bpy.types.Mesh, ob.data)
        me.uv_layers.active = me.uv_layers[LIGHTMAP_UV]
        log(f"  bake {i}/{len(objects)}: {ob.name}")
        bpy.ops.object.bake(
            type="DIFFUSE",
            pass_filter={"DIRECT", "INDIRECT"},
            margin=margin,
            use_clear=False,  # image starts black; objects accumulate
        )


def save_bakes(images: Iterable[bpy.types.Image], out_path: str) -> None:
    """Write bake PNGs next to the output and pack them, so the export
    never depends on unsaved in-memory pixel buffers."""
    bake_dir = os.path.join(os.path.dirname(os.path.abspath(out_path)), "bakes")
    os.makedirs(bake_dir, exist_ok=True)
    for img in images:
        img.filepath_raw = os.path.join(bake_dir, f"{img.name}.png")
        img.file_format = "PNG"
        img.save()
        img.pack()
    log(f"bake images saved to {bake_dir}/ and packed")


def export_glb(path: str, opts: Options) -> None:
    kwargs: dict[str, object] = dict(
        filepath=path,
        export_format="GLB",
        export_cameras=True,       # needed for START_CAM
        export_apply=True,         # apply modifiers
        export_yup=True,
        export_texcoords=True,     # non-negotiable: lightmap sampling
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_lights=not opts.no_lights,
        export_draco_mesh_compression_enable=opts.draco,
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        # Older exporters lack some kwargs; retry without the optional ones.
        kwargs.pop("export_draco_mesh_compression_enable", None)
        kwargs.pop("export_image_format", None)
        bpy.ops.export_scene.gltf(**kwargs)


def main() -> None:
    opts = parse_options()
    out = os.path.abspath(opts.out or default_out_path())
    t0 = time.time()

    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = opts.samples
    scene.render.bake.use_selected_to_active = False
    if opts.gpu:
        dtype = enable_gpu()
        scene.cycles.device = "GPU" if dtype else "CPU"
        log(f"compute device: {dtype or 'CPU (no GPU found)'}")

    n_lights = sum(
        1 for ob in scene.objects if ob.type == "LIGHT" and not ob.hide_render
    )
    if n_lights == 0 and not world_emits_light(scene.world):
        log("WARNING: no lights and the world looks dark — "
            "the bake will probably be black")

    paint = [m for m in bpy.data.materials if m.name.startswith("PAINT_")]
    log(f"{len(paint)} PAINT_ material(s) found" if paint else
        "WARNING: no PAINT_ materials — nothing will be repaintable "
        "(you can still tag materials manually in the app)")

    objects, small = bakeable_objects(opts.min_size)
    promoted = promote_shared_small(objects, small)
    if promoted:
        log(f"{len(promoted)} small object(s) promoted into the bake "
            "(they share a material with a baked object)")
    if small:
        log(f"{len(small)} object(s) under --min-size {opts.min_size} m: "
            "exported without a bake")
    if not objects:
        log("nothing to bake; exporting as-is")
        export_glb(out, opts)
        return

    convert_to_mesh(objects)
    groups = build_groups(objects, opts.group_by)
    log(f"{len(objects)} object(s) in {len(groups)} atlas group(s)")

    images: list[bpy.types.Image] = []
    for key, obs in sorted(groups.items()):
        log(f"group '{key}': {len(obs)} object(s)")

        obs = [ob for ob in obs if add_lightmap_layer(ob)]
        if not obs:
            continue
        unwrap_group(obs, opts.island_margin)

        img = make_bake_image(f"Bake_{sanitize(key)}", opts.atlas_size)
        images.append(img)
        materials = {m for ob in obs for m in materials_of(ob)}
        for mat in materials:
            wire_material(mat, img)

        bake_group(obs, opts.margin)

    save_bakes(images, out)
    export_glb(out, opts)
    log(f"exported {out} in {time.time() - t0:.0f}s")
    log("the source .blend was not modified on disk")


main()
