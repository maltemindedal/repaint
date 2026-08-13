# Repaint

A local, client-side 3D viewer for a Blender apartment export. Walk around, click a
wall, paste a paint hex, and flip between colour schemes while standing in the same
spot.

```bash
npm install
npm run dev          # http://localhost:5173
```

Static build:

```bash
npm run build        # typechecks, then emits dist/
npm run serve:dist   # serves dist/ at http://localhost:4173
```

> `dist/` needs to be **served**, not opened as `file://`. Browsers block ES modules
> and WASM fetches on the `file://` protocol, so double-clicking `dist/index.html`
> gives you a blank page. `npm run serve:dist` (or any static server —
> `npx serve dist`, `python3 -m http.server`) is the way. The build uses a relative
> `base`, so it also works from a subfolder on any host.

Nothing leaves your machine: no backend, no uploads, no analytics. Your GLB is read
with `FileReader` and stays in the tab.

---

## Table of contents

- [Quick start](#quick-start)
- [The Blender workflow](#the-blender-workflow) ← **the important part**
  - [1. Naming paintable materials](#1-naming-paintable-materials)
  - [2. Baking lighting to a second UV set](#2-baking-lighting-to-a-second-uv-set)
  - [3. glTF export settings](#3-gltf-export-settings)
  - [4. Sanity-check before you drop it in](#4-sanity-check-before-you-drop-it-in)
- [The tone-mapping colour caveat](#the-tone-mapping-colour-caveat)
- [Using the app](#using-the-app)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [What gets saved](#what-gets-saved)
- [Performance](#performance)
- [Architecture](#architecture)
- [Assumptions and limitations](#assumptions-and-limitations)

---

## Quick start

On first open Repaint shows a small procedurally generated demo room — two walls, a
ceiling, a floor and a fake baked gradient — so the whole UI is usable before you
have an export ready. Drop your own `.glb` anywhere on the window to replace it.

---

## The Blender workflow

The app is built around one convention. Follow it and everything is automatic;
deviate and there is a manual fallback for each part.

### 1. Naming paintable materials

**Every repaintable wall gets its own material, named with a `PAINT_` prefix.**

```
PAINT_Living_North
PAINT_Living_East
PAINT_Bedroom
PAINT_Hall_Ceiling
```

The sidebar strips the prefix, replaces underscores with spaces and title-cases the
rest, so `PAINT_Living_North` shows up as **Living North**. Blender's duplicate
suffix (`.001`) is stripped too.

Rules that matter:

- **Discovery is by material name, never by mesh name.** Name your objects whatever
  you like. A mesh called `PAINT_Floor_Mesh` whose material is `Floor_Oak` will
  _not_ be paintable — which is the intended behaviour.
- **One material per repaintable surface.** If the north and south walls share a
  material, they are one entry and always get the same colour. That is usually what
  you want for a single room; split the material if you want them independent.
- **Paintable materials must use a flat Base Color** — a colour swatch straight
  into Principled BSDF's _Base Color_, with **no image texture plugged in**. The app
  writes `material.color` directly, so a base-colour texture would sit on top and
  hide your paint. The sidebar's _All materials_ list flags any material carrying a
  colour texture.
- **Principled BSDF only.** The glTF exporter maps it to `MeshStandardMaterial`,
  which is what the app looks for.
- Roughness/metallic are yours. Matte wall paint is roughly `roughness 0.9`,
  `metallic 0`.

**If you don't follow this**: the app lists _every_ material in the scene under
**All materials** in the sidebar, and you tick the ones you want to repaint. That
tagging is remembered per file name, so you only do it once. You can also un-tick a
`PAINT_` material to hide it from the list.

### 2. Baking lighting to a second UV set

Blender's glTF exporter has **no lightmap slot**. The trick is to smuggle the bake
out through the **occlusion** input, which the app then re-routes into three.js's
`lightMap`.

**a. Make the lightmap UV layer.**

For each object that should carry baked light:

1. Select the object → **Object Data Properties** (green triangle) → **UV Maps**.
2. Add a second UV map with **+**. Name it something consistent, e.g. `UVMap.001`
   or `Lightmap`. Keep your original UV map **first in the list** — glTF exports
   list order as `TEXCOORD_0`, `TEXCOORD_1`, …, and the app expects the bake on
   `TEXCOORD_1`.
3. With the new UV map selected (click its name so it's the active one), enter Edit
   Mode, select all (`A`), then **UV → Smart UV Project**. Island margin `0.02`–
   `0.05` stops light bleeding between islands at low resolutions.

> Doing this for many objects: select them all, make the active object the one you
> just set up, then **Object → Link/Transfer Data → Copy UV Maps**. Verify per
> object afterwards — it only works cleanly for matching topology.

**b. Add the bake target image.**

1. **Image Editor → New**. Name it `Bake_Living`, size 2048×2048, uncheck **Alpha**,
   and check **32-bit Float** if you plan to bake to HDR and tone it down later
   (otherwise leave it off).
2. In each material, add an **Image Texture** node, point it at that image, and
   **select the node but do not connect it**. Cycles bakes into whichever image
   texture node is _active_ in the material. Also set the node's UV source: add a
   **UV Map** node, set it to your lightmap UV layer, and wire it into the image
   texture's `Vector`.

**c. Bake.**

1. **Render Properties** → Render Engine **Cycles**.
2. Scroll to **Bake**.
3. **Bake Type**:
   - **Combined** — everything, including the base colour of the wall. Convenient,
     but it bakes the _current_ paint colour into the texture, which fights with
     recolouring. Only use it if you set every paintable material to pure white
     first.
   - **Diffuse** with **Direct + Indirect** checked and **Color unchecked** — this
     is the one you want. It gives you incoming light with no albedo, so the app
     can multiply your live paint colour by it. ✅ **Recommended.**
   - **Ambient Occlusion** — cheap, fast, no light direction. Fine for a first pass.
4. Check **Margin** ≈ 16 px.
5. **Bake**. Save the image (`Image → Save As`, PNG or JPG) _and_ keep it packed
   (`File → External Data → Pack Resources`) so it travels inside the `.glb`.

**d. Hook it up for export.**

Principled BSDF has no occlusion input, so the glTF exporter reads the bake from a
dedicated node group instead. Per the
[Blender manual](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html#baked-ambient-occlusion),
it looks for _"a custom node group by the name of `glTF Material Output`"_ with an
input named **`Occlusion`**.

1. Enable **Preferences → Add-ons → Shader Editor Add-ons** (`Node Wrangler`'s
   sibling). You then get the node from **Add → Output → glTF Material Output**.
2. Drop that node into every material carrying a bake, and wire your bake Image
   Texture's **Color** output into its **`Occlusion`** input.
3. Leave it otherwise unconnected — it never renders in Blender. It's metadata the
   exporter reads.
4. Set the bake Image Texture node's **Color Space** to **sRGB**.

> **Give the bake its own image.** glTF stores occlusion in the **red channel
> only**, so it can share one texture with roughness (green) and metallic (blue).
> If your material also has roughness/metallic image textures, the exporter may
> pack all three into one image — and then green and blue hold roughness and
> metallic, not light. The app detects this (the slots share a texture source),
> falls back to using it as plain ambient occlusion, and tells you so in the
> console. For real baked lighting, keep the bake as a standalone image and leave
> roughness/metallic as plain values.

On import, for a standalone bake, the app:

- takes the glTF occlusion texture (GLTFLoader puts it in `material.aoMap`),
- flags it **sRGB** — a Cycles bake saved as PNG/JPG is sRGB-encoded, and reading it
  as linear data would wash the room out,
- assigns it to **`material.lightMap`**, which samples full RGB and multiplies into
  diffuse irradiance — which is what baked light _is_,
- and points `material.aoMap` at the **same texture instance** with
  **`aoMapIntensity = 0`**.

That last part is deliberate: feeding one texture into both slots at full strength
multiplies the occlusion in twice and gives you muddy corners. Both intensities are
sliders in the debug panel (`` ` ``), so if you baked pure AO rather than diffuse
light, push **AO intensity** up and **Lightmap intensity** down.

**Why the default lightmap intensity is π (3.14), not 1.** three.js adds the
lightmap to `irradiance`, and `RE_IndirectDiffuse_Physical` then multiplies that by
`BRDF_Lambert() = albedo / π`. A Cycles Diffuse or Combined bake already stores
outgoing radiance for a white surface — the answer _before_ that division. Leaving
the intensity at 1 makes the room come out π times too dark, which people usually
compensate for by cranking exposure and wrecking the colours. Setting it to π puts
the division back, so a bake value of "fully lit" renders as your paint colour at
full brightness. Slider range is 0–6 if your bake was exposed differently.

If a mesh has an occlusion texture on `TEXCOORD_1` but no second UV set, the app
falls back to `UV0` and logs a warning rather than rendering the wall black.

### 3. glTF export settings

**File → Export → glTF 2.0 (.glb/.gltf)**

| Setting                           | Value                                       | Why                                                                                           |
| --------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Format**                        | `glTF Binary (.glb)`                        | One self-contained file with textures packed in.                                              |
| **Include → Selected Objects**    | off (or on, deliberately)                   | Easy way to ship a single room.                                                               |
| **Include → Cameras**             | **on**                                      | Needed for `START_CAM`, see below.                                                            |
| **Include → Punctual Lights**     | your call                                   | The app loads them but leaves them **off** when it detects a bake. Toggle in the debug panel. |
| **Transform → +Y Up**             | **on** (the default)                        | Converts Blender's Z-up. Leave it alone.                                                      |
| **Data → Mesh → Apply Modifiers** | **on**                                      | Otherwise your Solidify/Bevel/Array modifiers don't ship.                                     |
| **Data → Mesh → UVs**             | **on**                                      | Non-negotiable — it's how the lightmap is sampled.                                            |
| **Data → Mesh → Normals**         | **on**                                      |                                                                                               |
| **Data → Material → Materials**   | `Export`                                    |                                                                                               |
| **Data → Material → Images**      | `Automatic` (or `JPEG` to shrink lightmaps) |                                                                                               |
| **Compression (Draco)**           | on for anything big                         | Fully supported, see below.                                                                   |

**Scale.** Work in metres. The default walk eye height is 1.65 m and the movement
speed is 2.4 m/s; if your scene is in centimetres you'll appear to be a 165 m giant
moving at a crawl. The app logs the scene's bounding-box dimensions on load and
warns if the height looks wrong for an apartment.

**Compression.** All three paths are wired up and decode locally — no CDN, works
offline:

- **Draco** geometry — tick **Compression** in the exporter.
- **meshopt** (`EXT_meshopt_compression`) — Blender can't emit this, but
  `npx @gltf-transform/cli meshopt in.glb out.glb` can, and the app reads it.
- **KTX2/Basis** textures (`KHR_texture_basisu`) — likewise via
  `npx @gltf-transform/cli uastc in.glb out.glb` (or `etc1s` for smaller files).
  This is the single biggest VRAM win for a lightmap-heavy apartment.

The decoder WASM ships with three.js and is emitted into `dist/assets` by Vite, so
a built copy of the app decodes compressed files with no network access.

**`START_CAM` (optional).** Add a camera in Blender, name the **object**
`START_CAM`, and place it where you want the app to open. Export with **Cameras**
enabled. The app uses its position, orientation and field of view for the initial
view. Without one, it opens standing inside the bounding box at 1.6 m, looking
across the room.

### 4. Sanity-check before you drop it in

Before debugging the app, confirm the file itself is right:

1. Open <https://gltf-viewer.donmccurdy.com/> and drag your `.glb` in. If the room
   looks wrong there, it's the export, not this app.
2. In that viewer, check the material list for your `PAINT_` names.
3. `npx @gltf-transform/cli inspect yourfile.glb` prints materials, textures,
   compression and, crucially, which `TEXCOORD` sets each mesh carries.

In this app, press `` ` `` for the debug panel (mesh/triangle/texture counts,
compression, whether a bake was detected) and check the console — every load logs a
collapsed report. **Scene → Log material report** prints a table of every material
with whether it's paintable and whether it carries a colour texture.

---

## The tone-mapping colour caveat

**Read this before trusting a colour on screen.**

The app defaults to **ACES filmic tone mapping**, because that's what makes a
three.js view resemble a Cycles render — it rolls off highlights and adds the
contrast you expect from a rendered image. But tone mapping is a non-linear
transform applied _after_ lighting. A wall painted `#E8E4DA` will **not** produce
`#E8E4DA` on screen: it's been multiplied by the lightmap and then pushed through a
film curve.

So:

- **Press `T`** (or use the toolbar `ACES`/`Raw` button) to switch tone mapping off
  when you want to judge a colour literally. The button turns red as a reminder.
  With tone mapping off, `Color.setStyle()`'s sRGB→linear conversion and
  `outputColorSpace = SRGBColorSpace` on the way out are an exact round trip, so a
  fully lit surface shows the hex you typed.
- Even then, the lightmap still multiplies the colour. Set **Lightmap intensity**
  to `0` and **Environment** to `1` in the debug panel if you want to see the raw
  swatch — at which point you may as well look at the sidebar swatch, which is the
  literal hex on a neutral grey background.
- The UI chrome is a deliberately **hue-neutral grey ramp** for the same reason. A
  blue-tinted dark theme next to a warm white sample makes the sample look warmer
  than it is.

**None of this replaces a physical sample.** Screen gamut, panel calibration,
ambient light in _your_ room and the sheen of the actual paint all move the result
more than anything in this app. Use it to shortlist and to compare colours against
each other, then buy tester pots and put them on the actual wall in daylight and at
night. The A/B scheme flipping (`1` / `2` / `3` from a fixed viewpoint) is where
this tool genuinely beats a paint chart; absolute colour accuracy is not.

---

## Using the app

**Loading.** Drag a `.glb` (or `.gltf`) anywhere onto the window, or use **Open
.glb**. Dropping a previously exported settings `.json` imports it.

**Navigation.** Two modes, `Tab` to switch, and switching never moves the camera.

- **Orbit** (default) — drag to orbit, scroll to dolly, right-drag to pan. Damped.
  Can't drop below the floor. **Double-click any surface** to ease the pivot onto
  that point, which is how you get the camera to behave in a tight room.
- **Walk** — `WASD`, `Shift` to move faster, `Q`/`E` or scroll for eye height,
  drag to look. `L` grabs pointer lock for a proper FPS feel; `Esc` releases it.
  While locked, clicking picks the wall under the centre of the screen. There's no
  collision (by design) — you're clamped to the scene's bounding box so you can't
  get lost.

Both modes are damped, because comparing two off-whites needs the image to stop
moving.

**Picking colours.** Hover a paintable surface and it lifts very slightly and
highlights its sidebar row. Click it to select and open the picker. The picker has
an HSV field, a hue slider, and a hex box that accepts anything containing a hex —
pasting `Alcro Lammull #E8E4DA` works.

Selection flashes the wall briefly rather than tinting it permanently, so a selected
wall still shows its true colour.

**Library.** **Save…** in the picker adds the current colour to the global library
and focuses its name field so you can type `Alcro Lammull #E8E4DA`. Library swatches
appear as chips inside every picker; click one to apply. The library is shared
across every scene.

**Schemes.** Three slots, always available, bound to `1`/`2`/`3`. **Save current**
snapshots every wall colour into a slot; the number key applies it instantly. This
is the point of the app: stand still, press `1`, `2`, `3`.

**Screenshots.** `P` or the **PNG** button renders one frame at 2× the on-screen
resolution and downloads it. The filename includes the active scheme name and a
timestamp: `repaint_warm-white_2026-08-13T17-42-01.png`.

**Reset.** The `↺` on a row, **Reset** in the picker, or `R` for the selected wall,
puts it back to the colour the GLB shipped with. **Data → Reset all walls** does
every wall.

---

## Keyboard shortcuts

| Key             | Action                                       |
| --------------- | -------------------------------------------- |
| `Tab`           | Orbit ⇄ Walk                                 |
| `W` `A` `S` `D` | Walk (`Shift` = faster)                      |
| `Q` / `E`       | Lower / raise eye height (scroll also works) |
| `L`             | Pointer lock (walk mode)                     |
| `Esc`           | Release pointer lock · close help · deselect |
| double-click    | Orbit: set the pivot to that point           |
| `F`             | Frame the whole scene                        |
| `1` `2` `3`     | Apply scheme slot 1 / 2 / 3                  |
| `R`             | Reset the selected wall                      |
| `T`             | Tone mapping on/off                          |
| `P`             | 2× PNG screenshot                            |
| `` ` ``         | Debug panel + FPS meter                      |
| `?`             | Shortcut list                                |

---

## What gets saved

Everything is `localStorage`, under one key (`apartment-walkthrough:v1` — the
pre-rename key, kept as-is so saves made before the app was called Repaint still
load).

**Per scene**, keyed by **file name**:

- manual paintable-material tagging (and un-tagging)
- the three-plus scheme slots and their names
- the live colour of every wall, so a reload picks up exactly where you left off
- last camera pose, stored separately for orbit and walk (walk saves shortly
  after you stop moving, so a reload puts you back where you stood)
- settings: exposure, tone mapping, lightmap/AO/environment intensity, punctual
  lights, eye height, walk speed, highlights

**Global:** the colour library.

Keying on file name means renaming your export starts fresh, and two different files
with the same name share state. **Data → Export JSON** writes everything to a file;
**Import JSON** (or dropping the `.json` on the window) merges it back.

---

## Performance

Targets 60 fps on a laptop with a few hundred MB of apartment. Steps taken:

- Recolouring writes `material.color` and nothing else. It never touches
  `needsUpdate`, never toggles a material feature, and so never invalidates
  three.js's program cache — a colour change costs one uniform upload, and dragging
  the picker doesn't stutter. There's a unit test asserting `material.version`
  doesn't move across colour changes.
- Hover highlighting nudges `material.emissive`, which is always present in the
  standard-material shader, for the same reason. Adding an outline pass or toggling
  a map would recompile on every pointer move across a wall.
- The sidebar updates only the affected row on a colour change instead of
  re-rendering, so the open picker doesn't get torn out from under the pointer.
- `devicePixelRatio` capped at 2 (adjustable 1–3 in the debug panel — dropping to 1
  is the fastest fix on a Retina display).
- Camera poses persist on a lazier timer than everything else, since they change
  every frame you move.

Five seconds after loading a scene, if the frame rate is below 45 fps the app logs
a specific, actionable hint to the console — whether geometry is uncompressed,
whether textures are uncompressed RGBA and how many MB that is, and whether you have
too many draw calls. The debug panel (`` ` ``) has a live stats.js FPS meter and the
scene's geometry/texture/compression numbers.

---

## Architecture

Vanilla three.js, not React Three Fiber. For a single-canvas tool with one imperative
scene graph, R3F's reconciler adds a React dependency and a mental indirection layer
without buying anything: the hot path — a colour write during a picker drag — is a
uniform upload straight to `material.color`, and it stays that way whatever the panels
around it do. The UI is small enough that plain DOM is less code than the React it'd
replace.

The panels do diff, though, because they have to. `Sidebar` takes its whole state as
one view model and works out what moved (`src/ui/Sidebar.ts`), and `Toolbar` skips a
slot rebuild when the schemes are unchanged. That is deliberate and about 60 lines,
not a reconciler: it exists so the app can re-render both panels after _every_
mutation — including on each pointermove of a drag — instead of each call site
remembering which half of the UI it was supposed to touch. Two rules keep it cheap:
`PaintRegistry.list()` / `allMaterials()` are sorted once per discovery rather than
per render (the sort is an Intl collation, and it was the whole cost), and a section
is compared against a snapshot of its own contents, since the store mutates the
objects it hands out in place.

```
src/
  main.ts                  App — wiring, shortcuts, persistence, screenshots
  sidebarViewModel.ts      Gathers what the sidebar should be showing into one
                           plain object; no DOM, so it is directly assertable
  types.ts                 Shared types; PAINT_ prefix and START_CAM name live here
  core/
    Viewer.ts              Renderer, camera, frame loop, environment, tone mapping
    SceneLoader.ts         GLB → LoadedScene, disposal, load report
    loaders.ts             GLTFLoader + DRACO / KTX2 / meshopt
    processScene.ts        Renderer-free: lightmap wiring, bounds, START_CAM, stats
    PaintRegistry.ts       Discovery + the single write path for material.color
    PaintController.ts     The paint fan-out: registry + store + one change event
    Picker.ts              Raycast hover/select, emissive highlight
    materials.ts           Shared material type guards
    fallbackScene.ts       Procedural demo room (also the smoke-test fixture)
  nav/
    NavigationController.ts  Mode switching, pose save/restore, double-click focus
    WalkControls.ts          Damped first-person controls; settle-detection for
                             persisting the walk pose after you stop moving
  state/
    store.ts               All persisted state, debounced writes
    storage.ts             localStorage + memory fallback; validating migration
  ui/                      Sidebar, ColorPicker, Toolbar, DropZone, DebugPanel,
                           HelpOverlay, StatusPanel (toasts/loading), swatches
    Sidebar.ts             One `render(viewModel)`; diffs internally so it can
                           be re-rendered on every pointermove of a colour drag
    MobileGate.ts          Touch-only devices get the "use a desktop" page in
                           index.html instead of a booted app
scripts/
  make-portable.mjs        Folds dist/ into the single-file dist/repaint.html
test/
  smoke.test.ts            23 tests over the fallback scene
  paint-controller.test.ts   8 tests over the paint fan-out, with a fake store
  viewModel.test.ts        6 tests over the sidebar view model — no DOM
  sidebar.test.ts          16 tests over the sidebar's rendering and diffing
  fixtures/make-fixture.mjs  Generates a convention-following GLB for manual testing
```

A colour change has to reach four places — the registry (what's on the GPU), the
store (what survives a reload), the sidebar and the toolbar. `PaintController`
owns that fan-out so no _edit_ can do half of it: it writes the registry and
the store, then emits one change carrying the targets that actually moved and,
only when they went stale, the scheme rows to re-render. `main.ts` subscribes
once and updates both views from there. (Restoring saved colours after a load
goes straight to the registry — it is _reading_ the store, so it has nothing to
write back.) That "only when stale" is what keeps a picker drag cheap: it fires
a paint per pointermove, and rebuilding the toolbar scheme slots each time would
undo the targeted row update the sidebar does.

`processScene.ts`, `PaintRegistry.ts` and `PaintController.ts` deliberately need
no renderer, which is what lets the tests run the real pipeline headlessly in
node:

```bash
npm test
```

They build the procedural room, run discovery against it, and check the colour
write path, scheme capture/apply, name cleanup, persistence round-trips, the
ORM-vs-lightmap classification, and that corrupt saved data is sanitised. The
fan-out is covered against a fake store: which walls each operation reports, and
that the scheme rows are asked to re-render exactly when the slots change and
not once more. Whether `main.ts` then draws both views is browser-side and not
covered here — the sidebar/toolbar seam is the next thing worth deepening.

The sidebar splits the same way, which is why it takes a view model at all.
`sidebarViewModel.ts` answers "what should the panel be showing?" as a plain
object, and `viewModel.test.ts` asserts that in plain node — including that
nothing from three.js leaks in, and that paint rows are _snapshots_ rather than
the registry's live targets (which it mutates in place, so handing them over
would leave the panel diffing a value against itself).

Only the drawing half needs a document. `sidebar.test.ts` runs against happy-dom
via a `@vitest-environment` docblock, so the rest of the suite stays in plain
node, and covers which sections a render rebuilds, which it leaves standing, and
what survives an open colour picker.

Linting and formatting are [oxlint](https://oxc.rs) and oxfmt (configs in
`.oxlintrc.json` / `.oxfmtrc.json`):

```bash
npm run lint           # oxlint
npm run format         # oxfmt --write
npm run check          # typecheck + lint + format check, in one
```

For manual testing against an actual glTF file — the loader, the occlusion→lightmap
rerouting, `TEXCOORD_1`, `START_CAM` — generate a fixture and drop it in:

```bash
node test/fixtures/make-fixture.mjs   # → test/fixtures/apartment-fixture.glb
```

It deliberately includes a mesh named `PAINT_Floor_Mesh` whose material is
`Floor_Oak`, to prove discovery ignores mesh names.

In `npm run dev`, `window.apt` is the app instance — `apt.registry.list()`,
`apt.scene.stats`, `apt.viewer.renderer.info` are handy when a scene misbehaves.

---

## Assumptions and limitations

Noted here rather than guessed at silently:

- **Units are metres and up is +Y.** Standard Blender glTF export. The app warns on
  load if the scene height looks implausible.
- **Paintable = `MeshStandardMaterial`.** `KHR_materials_*` extensions that make
  GLTFLoader produce a `MeshPhysicalMaterial` still work (it extends
  `MeshStandardMaterial`); anything else is skipped.
- **The occlusion slot means "baked lighting"** — unless it's ORM-packed, which the
  app detects and treats as plain AO instead. If you use a standalone occlusion map
  for genuine AO on top of real-time lights, set **Lightmap intensity** to `0` and
  **AO intensity** to `1` in the debug panel and turn **GLB lights** on.
- **Punctual lights default off when a bake is detected**, on when it isn't. Either
  way it's a toggle, and your choice is remembered per file.
- **No collision.** Walk mode clamps to the scene bounding box only, as specified —
  you can walk through walls.
- **One material = one colour.** Walls sharing a material always share a colour.
- **Scene state is keyed by file name.** Renaming your export loses its schemes;
  export the JSON first if that matters.
- **Screenshots capture the viewport only** — no sidebar, no toolbar.
- **`preserveDrawingBuffer` is off**; screenshots re-render and read the buffer
  synchronously. If a screenshot ever comes back blank, that's the cause.
- The **environment map** is three.js's `RoomEnvironment` at `0.25` intensity, just
  enough that untextured materials aren't dead flat. Baked lighting stays dominant.
  Adjustable in the debug panel.
