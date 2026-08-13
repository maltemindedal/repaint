# Preparing a Blender scene

How to author and export an apartment so Repaint can find its walls. Follow the
naming convention and everything is automatic; deviate and there is a manual
fallback for each part.

Baking lighting is a separate job — see [Baking lighting](baking-lighting.md).

## Name paintable materials with a `PAINT_` prefix

**Every repaintable wall gets its own material, named with a `PAINT_` prefix.**

```text
PAINT_Living_North
PAINT_Living_East
PAINT_Bedroom
PAINT_Hall_Ceiling
```

The sidebar strips the prefix, replaces underscores with spaces, and title-cases
the rest, so `PAINT_Living_North` displays as **Living North**. Blender's
duplicate suffix (`.001`) is stripped too, and all-caps words like `NORTH`
survive intact.

### Rules that matter

**Discovery is by material name, never by mesh name.** Name your objects
whatever you like. A mesh called `PAINT_Floor_Mesh` whose material is `Floor_Oak`
is _not_ paintable — that is the intended behaviour, and there is a test fixture
built specifically to prove it.

**One material per repaintable surface.** If the north and south walls share a
material they are one entry and always take the same colour. That is usually
right for a single room; split the material if you want them independent.

**Paintable materials need a flat Base Color** — a colour swatch straight into
Principled BSDF's _Base Color_, with **no image texture plugged in**. The app
writes `material.color` directly, so a base-colour texture would sit on top and
hide your paint. The sidebar's **All materials** list flags any material carrying
a colour texture.

**Principled BSDF only.** The glTF exporter maps it to three.js's
`MeshStandardMaterial`, which is what the app looks for. Materials that arrive as
anything else are skipped. (`KHR_materials_*` extensions that produce a
`MeshPhysicalMaterial` still work — it extends `MeshStandardMaterial`.)

Roughness and metallic are yours. Matte wall paint is roughly `roughness 0.9`,
`metallic 0`.

### If you don't follow the convention

The sidebar lists _every_ material in the scene under **All materials**; tick the
ones you want to repaint. That tagging is remembered per file name, so you only
do it once. You can also un-tick a `PAINT_` material to hide it.

Only the deviation from what discovery would do on its own is stored, so adding
the `PAINT_` prefix in a later re-export doesn't leave a stale override behind.

## Work in metres

The default walk eye height is 1.65 m and the movement speed is 2.4 m/s. If your
scene is in centimetres you will appear to be a 165 m giant moving at a crawl.

The app logs the scene's bounding-box dimensions on every load, and warns when
the height is above 100 m or below 0.5 m.

## Add a `START_CAM` (optional)

Add a camera in Blender, name the **object** `START_CAM`, and place it where you
want the app to open. Export with **Cameras** enabled. The app uses its position,
orientation and field of view for the initial view.

`START_CAM`, `START_CAM.001` and `start_cam` all count. Without one, the app
opens standing inside the bounding box at 1.6 m, looking across the room.

A saved camera pose for the file takes precedence over `START_CAM` — the app
puts you back where you last stood.

## glTF export settings

**File → Export → glTF 2.0 (.glb/.gltf)**

| Setting                           | Value                                       | Why                                                                                           |
| --------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Format**                        | `glTF Binary (.glb)`                        | One self-contained file with textures packed in.                                              |
| **Include → Selected Objects**    | off (or on, deliberately)                   | Easy way to ship a single room.                                                               |
| **Include → Cameras**             | **on**                                      | Needed for `START_CAM`.                                                                       |
| **Include → Punctual Lights**     | your call                                   | The app loads them but leaves them **off** when it detects a bake. Toggle in the debug panel. |
| **Transform → +Y Up**             | **on** (the default)                        | Converts Blender's Z-up. Leave it alone.                                                      |
| **Data → Mesh → Apply Modifiers** | **on**                                      | Otherwise Solidify/Bevel/Array modifiers don't ship.                                          |
| **Data → Mesh → UVs**             | **on**                                      | Non-negotiable — it's how the lightmap is sampled.                                            |
| **Data → Mesh → Normals**         | **on**                                      |                                                                                               |
| **Data → Material → Materials**   | `Export`                                    |                                                                                               |
| **Data → Material → Images**      | `Automatic` (or `JPEG` to shrink lightmaps) |                                                                                               |
| **Compression (Draco)**           | on for anything big                         | Fully supported — see below.                                                                  |

## Compression

All three paths are wired up and decode locally. No CDN, works offline: since
three.js r180 the loaders resolve their own WASM through
`new URL(…, import.meta.url)`, so Vite emits version-matched decoder copies into
`dist/assets`.

- **Draco** geometry — tick **Compression** in the Blender exporter.
- **meshopt** (`EXT_meshopt_compression`) — Blender can't emit this, but
  `pnpm dlx @gltf-transform/cli meshopt in.glb out.glb` can, and the app reads it.
- **KTX2/Basis** textures (`KHR_texture_basisu`) — likewise via
  `pnpm dlx @gltf-transform/cli uastc in.glb out.glb`, or `etc1s` for smaller
  files. This is the single biggest VRAM win for a lightmap-heavy apartment.

One caveat: the DRACO and KTX2 decoders are WASM fetched on demand, and `fetch()`
is blocked on the `file://` protocol. Compressed files therefore need a served
build, not the double-clickable single-file build. See
[Deploying](deploying.md#the-portable-single-file-build).

## Check the file before you debug the app

1. Open <https://gltf-viewer.donmccurdy.com/> and drag your `.glb` in. If the
   room looks wrong there, it's the export, not this app.
2. In that viewer, check the material list for your `PAINT_` names.
3. Run `pnpm dlx @gltf-transform/cli inspect yourfile.glb` — it prints materials,
   textures, compression, and which `TEXCOORD` sets each mesh carries.

Inside Repaint, press <kbd>`</kbd> for the debug panel (mesh/triangle/texture
counts, compression, whether a bake was detected). Every load also writes a
collapsed report to the console, and **Scene → Log material report** in the debug
panel prints a table of every material with whether it is paintable and whether
it carries a colour texture.

## A test fixture that follows this convention

If you want a known-good file to compare against:

```bash
node test/fixtures/make-fixture.mjs
```

That writes `test/fixtures/apartment-fixture.glb` — `PAINT_` materials with flat
base colours, a baked texture in the occlusion slot on `TEXCOORD_1`, a
`START_CAM`, and one deliberately non-paintable mesh named `PAINT_Floor_Mesh`
whose material is `Floor_Oak`.
