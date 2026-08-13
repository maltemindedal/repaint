# Troubleshooting

Start with the two built-in diagnostics:

- **The debug panel** — press <kbd>`</kbd>. Mesh, triangle and texture counts,
  which compression is in use, whether a bake was detected, whether the file has
  punctual lights, plus a live FPS meter.
- **The console** — every load writes a collapsed `[scene]` report with
  dimensions, material and texture counts, compression flags and warnings.

## Loading

### The page is blank after opening `dist/index.html`

You opened it as a `file://` URL. Browsers block ES module imports there. Serve
it instead:

```bash
pnpm serve:dist
```

Or build the double-clickable single file with `pnpm build:portable` — see
[Deploying](deploying.md#the-portable-single-file-build).

### A compressed `.glb` fails to load from the portable file

DRACO and KTX2 decoders are WASM fetched on demand, and `fetch()` is blocked on
`file://`. The app logs this specific warning when it detects the situation. Use
the served build for Draco/KTX2 files.

### "Only .glb / .gltf (or a settings .json) can be dropped here"

The app accepts exactly those three extensions. Dropping a `.json` imports
settings rather than a scene.

### "No PAINT_ materials found"

Discovery is by **material** name, not mesh name. Open **All materials** in the
sidebar and tick what you want to paint — that tagging is remembered per file
name. Or re-export with the `PAINT_` prefix; see
[Preparing a Blender scene](preparing-a-blender-scene.md).

To see what the app actually found: **Scene → Log material report** in the debug
panel prints every material with whether it is paintable, whether it came from
the prefix, whether it carries a colour texture, and how many meshes use it.

### The room is the wrong size, or the console warns about scene height

The app warns when the scene's bounding box is taller than 100 m or shorter than
0.5 m. Work in metres and check the **Scene unit** / scale setting in the glTF
exporter. At centimetre scale, a 1.65 m eye height puts you inside the floor slab.

## Appearance

### A wall won't change colour

It probably has a base-colour **image texture**, which sits on top of the colour
the app writes. The **All materials** list flags materials carrying one. Paintable
materials need a flat Base Color with nothing plugged into it.

### The room is far too dark, or far too bright

Check `baked` in the debug panel's Scene folder.

- `baked: yes` and still dark → **Lightmap intensity** should be near π (3.14),
  its default. Something has moved it.
- `baked: no` but you expected a bake → the occlusion texture is probably
  ORM-packed. The console says so explicitly. See
  [Baking lighting](baking-lighting.md#give-the-bake-its-own-image).
- Washed out → the bake was read as linear rather than sRGB; check the Color Space
  on the Image Texture node and re-export.

### The colour on screen doesn't match the hex I typed

Expected. Press <kbd>T</kbd> to turn tone mapping off. Read
[Judging colour accurately](judging-colour.md) — this is the single most
important caveat in the app.

### Corners look muddy

One texture is driving both the lightmap and ambient occlusion at full strength,
so the occlusion is multiplied in twice. Set **AO intensity** to 0.

## Performance

Five seconds after a scene loads, if the frame rate is below 45 fps the app logs
an actionable hint naming the actual cause. It checks, in order:

| Condition                        | Hint                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| No Draco and no meshopt          | Geometry is uncompressed — re-export with Compression, or run `gltf-transform meshopt`   |
| No KTX2 and textures over 128 MB | Textures are uncompressed RGBA — `gltf-transform uastc`/`etc1s` typically cuts VRAM 4–8× |
| Textures over 256 MB             | Halve the lightmap resolution — 2K per room is usually plenty                            |
| Over 1500 meshes                 | That many draw calls; join meshes that share a material in Blender                       |

The fastest local fix on a Retina display is dropping **Max pixel ratio** to 1 in
the debug panel. It defaults to 2.

## Screenshots

### A screenshot came back blank

`preserveDrawingBuffer` is off, so screenshots re-render and read the buffer
synchronously. That is the cause if it ever fails; the app reports
"the drawing buffer came back empty" rather than saving a blank file.

Screenshots capture the **viewport only** — no sidebar, no toolbar. They render
at 2× the on-screen resolution (capped at a device pixel ratio of 4) and download
as `repaint_<scheme>_<timestamp>.png`.

## Saved state

### My schemes disappeared

Scene state is keyed by **file name**. Renaming your export starts it fresh, and
two different files with the same name share state. Export the JSON first if that
matters — see [Persistence](../reference/persistence.md).

### Nothing persists between reloads

The app falls back to in-memory storage when `localStorage` is unavailable —
Safari private mode has the API but throws on write. State then lasts only for
the session. Save failures (including quota) are logged as
`[storage] save failed (quota?)`.

Corrupt saved data is not fatal: everything read back is validated field by field
and anything malformed is dropped, with `[storage] could not read saved data,
starting fresh.` in the console.

## Input

### I get a "Repaint works on a desktop" page

Your device matched `(pointer: coarse) and (hover: none)`. Press **Continue
anyway** if that is wrong — a touchscreen laptop, or Chrome's device-emulation
toolbar. The unlock lasts for the browser session. Closing the device toolbar or
plugging in a mouse also boots the app automatically.

### Keyboard shortcuts do nothing

They are ignored while you are typing in a text field, and any shortcut pressed
with <kbd>Cmd</kbd>, <kbd>Ctrl</kbd> or <kbd>Alt</kbd> held is passed through to
the browser. Click the viewport and try again.

### I can walk through walls

By design — there is no collision. Movement is clamped to the scene's bounding
box (plus 0.25 m) so you cannot get lost, and nothing else.
