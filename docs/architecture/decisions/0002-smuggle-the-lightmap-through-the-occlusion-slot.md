# 0002 — Smuggle the lightmap through the occlusion slot

**Status:** Accepted · **Recorded:** 2026-08-13 (retrospectively, from the
existing implementation)

## Context

The point of the app is judging paint colour under the room's real lighting,
which means the apartment needs baked lighting from Cycles.

**Blender's glTF exporter has no lightmap slot.** glTF 2.0 core has no lightmap
concept at all. The exporter does read an **occlusion** input, via a custom node
group named `glTF Material Output` — a documented Blender feature intended for
baked ambient occlusion.

three.js, meanwhile, has both: `material.aoMap` (red channel only, multiplied
into ambient light) and `material.lightMap` (full RGB, multiplied into diffuse
irradiance). The second is what baked lighting actually is.

## Decision

Ask authors to wire their bake into the `glTF Material Output` node's
`Occlusion` input, then re-route it on import.

For a **standalone** occlusion texture, `processScene.ts`:

1. Flags the texture **sRGB**. A Cycles bake saved as PNG/JPG is sRGB-encoded,
   and reading it as linear data washes the room out.
2. Assigns it to `material.lightMap` with an intensity of π
   ([ADR 0003](0003-default-lightmap-intensity-is-pi.md)).
3. Points `material.aoMap` at the **same texture instance** with
   `aoMapIntensity = 0`.

Step 3 is deliberate: one upload and one colour-space decision, and the
occlusion is not multiplied in twice — which would give muddy corners.

### The ORM exception

glTF may legally pack occlusion (R), roughness (G) and metallic (B) into one
texture. Driving `lightMap` with that would light the room with the roughness and
metallic channels.

The app detects the case — GLTFLoader hands each slot its own `Texture` instance,
but they share one `source` — and then treats the texture as **plain ambient
occlusion**: `aoMapIntensity = 1`, no lightmap, and a console explanation. Scenes
in that state also get a per-scene default `aoMapIntensity` of 1, since the global
default of 0 would silently disable the only effect available to them.

## Consequences

**Good.**

- Real baked lighting from a stock Blender export, with no custom exporter, no
  glTF extension and no sidecar file.
- Both intensities are debug-panel sliders, so someone who baked pure AO rather
  than diffuse light can push AO up and the lightmap down.

**Costs.**

- The convention is invisible in the file itself: a `.glb` that says "occlusion"
  means "lighting" only by this app's reading. Other viewers show it as AO.
- Authors must keep the bake as its own image, which the docs have to state
  explicitly and the app has to detect when they don't.
- The bake must land on `TEXCOORD_1`. When a mesh claims it but ships no second
  UV set, the app copies `uv` into `uv1` and warns, rather than rendering the wall
  black — a fallback that exists purely because this path is easy to get wrong in
  Blender.

## See also

- [Baking lighting](../../guides/baking-lighting.md) — the authoring workflow.
- [Blender manual: baked ambient occlusion](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html#baked-ambient-occlusion)
  — the `glTF Material Output` node group this depends on. Source of truth for
  the exporter's behaviour; verify against the Blender version you use.
