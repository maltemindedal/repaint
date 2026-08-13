# Baking lighting into a glTF export

Blender's glTF exporter has **no lightmap slot**. This guide covers the way
around it: bake to a second UV set, smuggle the bake out through the
**occlusion** input, and let Repaint re-route it into three.js's `lightMap`.

Baking is optional. A scene without one still works — it relies on the exported
punctual lights and the environment map instead.

Assumes you have already read [Preparing a Blender scene](preparing-a-blender-scene.md).

## 1. Make the lightmap UV layer

For each object that should carry baked light:

1. Select the object → **Object Data Properties** (green triangle) → **UV Maps**.
2. Add a second UV map with **+**. Name it something consistent, e.g. `UVMap.001`
   or `Lightmap`. Keep your original UV map **first in the list** — glTF exports
   list order as `TEXCOORD_0`, `TEXCOORD_1`, …, and the app expects the bake on
   `TEXCOORD_1`.
3. With the new UV map selected (click its name so it is the active one), enter
   Edit Mode, select all (<kbd>A</kbd>), then **UV → Smart UV Project**. An island
   margin of `0.02`–`0.05` stops light bleeding between islands at low
   resolutions.

> Doing this for many objects: select them all, make the active object one you
> have already set up, then **Object → Link/Transfer Data → Copy UV Maps**. Verify
> per object afterwards — it only works cleanly for matching topology.

## 2. Add the bake target image

1. **Image Editor → New**. Name it `Bake_Living`, size 2048×2048, uncheck
   **Alpha**, and check **32-bit Float** if you plan to bake to HDR and tone it
   down later (otherwise leave it off).
2. In each material, add an **Image Texture** node, point it at that image, and
   **select the node but do not connect it**. Cycles bakes into whichever image
   texture node is _active_ in the material.
3. Set the node's UV source: add a **UV Map** node, set it to your lightmap UV
   layer, and wire it into the image texture's `Vector`.

## 3. Bake

1. **Render Properties** → Render Engine **Cycles**.
2. Scroll to **Bake**.
3. Choose a **Bake Type**:

   | Bake type                                                               | Result                                                                                                                      | Verdict                                                      |
   | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
   | **Diffuse**, with **Direct + Indirect** checked and **Color unchecked** | Incoming light with no albedo, so the app can multiply your live paint colour by it                                         | ✅ **Recommended**                                           |
   | **Combined**                                                            | Everything, including the wall's base colour — it bakes the _current_ paint into the texture, which fights with recolouring | Only if you set every paintable material to pure white first |
   | **Ambient Occlusion**                                                   | Cheap and fast, no light direction                                                                                          | Fine for a first pass                                        |

4. Set **Margin** ≈ 16 px.
5. **Bake**. Save the image (`Image → Save As`, PNG or JPG) _and_ keep it packed
   (`File → External Data → Pack Resources`) so it travels inside the `.glb`.

## 4. Hook it up for export

Principled BSDF has no occlusion input, so the glTF exporter reads the bake from
a dedicated node group instead. Per the
[Blender manual](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html#baked-ambient-occlusion),
it looks for a custom node group named `glTF Material Output` with an input
named **`Occlusion`**.

1. Enable **Preferences → Add-ons → Shader Editor Add-ons**. You then get the
   node from **Add → Output → glTF Material Output**.
2. Drop that node into every material carrying a bake, and wire your bake Image
   Texture's **Color** output into its **`Occlusion`** input.
3. Leave it otherwise unconnected — it never renders in Blender. It is metadata
   the exporter reads.
4. Set the bake Image Texture node's **Color Space** to **sRGB**.

### Give the bake its own image

glTF stores occlusion in the **red channel only**, so it can legally share one
texture with roughness (green) and metallic (blue). If your material also has
roughness/metallic image textures, the exporter may pack all three into one
image — and then green and blue hold roughness and metallic, not light.

When that happens, Repaint uses the texture as plain ambient occlusion instead of
a lightmap and says so in the console — the detection mechanics are in
[ADR 0002 § The ORM exception](../architecture/decisions/0002-smuggle-the-lightmap-through-the-occlusion-slot.md#the-orm-exception).
For real baked lighting, keep the bake as a standalone image and leave roughness
and metallic as plain values.

## Automating this guide with a script

[`scripts/bake_export.py`](../../scripts/bake_export.py) runs everything above —
plus the [glTF export](preparing-a-blender-scene.md) — headless, no clicking:

```bash
blender --background apartment.blend --python scripts/bake_export.py -- \
    --out apartment.glb --gpu
```

It applies modifiers, makes linked duplicates single-user, adds the `Lightmap`
UV layer, atlas-unwraps groups of objects **together** into a shared UV space
(one atlas per top-level collection by default — groups that share a material
are merged, because the bake image lives on the material), wires the bake nodes
and the `glTF Material Output` group into every material, bakes Diffuse
Direct+Indirect with Cycles, and exports the `.glb` with the settings from
[Preparing a Blender scene](preparing-a-blender-scene.md). The source `.blend`
is never saved; bake PNGs land in `bakes/` next to the output for inspection.

Options after the `--` (also via `-- --help`):

| Flag                | Default       | Meaning                                                                                                                                                                                                            |
| ------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--out PATH`        | `<blend>.glb` | Output file.                                                                                                                                                                                                       |
| `--atlas-size N`    | `2048`        | Bake image size per atlas group.                                                                                                                                                                                   |
| `--samples N`       | `128`         | Cycles samples. Bump if the bake is noisy.                                                                                                                                                                         |
| `--margin N`        | `16`          | Bake margin in pixels.                                                                                                                                                                                             |
| `--island-margin F` | `0.03`        | Smart UV Project island spacing.                                                                                                                                                                                   |
| `--min-size F`      | `0` (off)     | Skip baking objects smaller than F metres — still exported, just lit by the environment. Objects sharing a material with a baked object are promoted into the bake instead (the bake image lives on the material). |
| `--group-by MODE`   | `collection`  | `collection` or `single` (one atlas for everything).                                                                                                                                                               |
| `--gpu`             | off           | Bake on Metal/CUDA/OptiX/HIP if available.                                                                                                                                                                         |
| `--draco`           | off           | Draco-compress the export.                                                                                                                                                                                         |
| `--no-lights`       | off           | Leave punctual lights out of the `.glb`.                                                                                                                                                                           |

What it can't do for you: name your `PAINT_` materials (that's a design
decision — though the in-app manual tagging fallback still works), light the
scene (a bake with no lights is black, and the script warns about it), or judge
bake quality — check the result in the app and re-run with more samples or a
bigger atlas where it looks rough.

## What the app does with it on import

For a standalone bake, Repaint flags the occlusion texture sRGB and re-routes it
into `material.lightMap`, with ambient occlusion zeroed so the bake is not
multiplied in twice. The exact four-step wiring, and the reasoning behind each
step, lives in
[ADR 0002: smuggle the lightmap through the occlusion slot](../architecture/decisions/0002-smuggle-the-lightmap-through-the-occlusion-slot.md).

What matters while authoring: both intensities are sliders in the debug panel
(<kbd>`</kbd>), so if you baked pure AO rather than diffuse light, push **AO
intensity** up and **Lightmap intensity** down.

## Why the default lightmap intensity is π, not 1

A Cycles bake stores light _after_ the `albedo / π` division that three.js
applies on its own, so passing it through at intensity 1 renders the room π times
too dark — the full derivation is
[ADR 0003](../architecture/decisions/0003-default-lightmap-intensity-is-pi.md).
The slider ranges 0–6 if your bake was exposed differently.

## Troubleshooting a bake

| Symptom                                                | Cause                                                 | Fix                                                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Room is uniformly dark                                 | Lightmap intensity at 1, or no bake detected          | Check `baked: yes` in the debug panel's Scene folder; raise **Lightmap intensity** toward π           |
| Corners look muddy                                     | AO being multiplied in on top of a lightmap           | Set **AO intensity** to 0                                                                             |
| Console warns about a shared ORM texture               | Bake packed with roughness/metallic                   | Re-export the bake as its own image                                                                   |
| Console warns about `TEXCOORD_1` with no second UV set | Exporter promised a second UV set but didn't ship one | Re-export with the lightmap UV layer included — the app falls back to UV0 rather than rendering black |
| Whole scene washed out                                 | Bake read as linear rather than sRGB                  | Set the bake Image Texture node's Color Space to sRGB and re-export                                   |

More general problems: [Troubleshooting](troubleshooting.md).
