# Getting started

Zero to a repainted wall. About ten minutes, no Blender file required — the app
ships with a procedural demo room so you can learn the controls before you have
an export ready.

## Prerequisites

| Tool    | Version                                  | Notes                                                                                                       |
| ------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Node    | 24.x                                     | What CI runs and the app is developed against (`.github/workflows/ci.yml`). No `engines` field enforces it. |
| pnpm    | 11.10.0                                  | Pinned by the `packageManager` field in `package.json`. `corepack enable` picks it up automatically.        |
| Browser | Any current desktop browser with WebGL 2 | Touch-only devices get a "use a desktop" page instead — see [the gate](#a-note-on-phones-and-tablets).      |

## 1. Install and run

```bash
pnpm install
```

```bash
pnpm dev
```

Vite starts on <http://localhost:5173> and opens a browser tab for you
(`server.open` is on in `vite.config.ts`). If port 5173 is busy, Vite picks the
next free one and prints the real URL — read the terminal rather than assuming.

You should see a small grey room: two walls, a ceiling, a floor, and a soft
baked-looking gradient. A status line at the bottom left reads _"Drop a .glb
anywhere to load your apartment."_

## 2. Paint a wall

1. **Move the pointer over a wall.** It brightens very slightly, the cursor
   changes, and the matching row in the right-hand sidebar highlights. That
   brightening is the app telling you the surface is paintable.
2. **Click it.** The wall pulses twice and its colour picker opens in the
   sidebar.
3. **Type or paste a hex** into the picker's hex box. The field accepts anything
   _containing_ a hex, so pasting a whole product name works:

   ```text
   Alcro Lammull #E8E4DA
   ```

   The wall updates as you drag the HSV field or the hue slider — there is no
   "apply" step.

## 3. Keep a colour, and undo one

Two things you'll want immediately.

**Save a colour to the library.** Press **Save…** in the picker. The colour is
added to the sidebar's **Colour library** and its name field is focused, so you
can type straight over the suggested name — `Alcro Lammull #E8E4DA`. Library
swatches then appear as chips inside every picker: select a wall, click a chip,
done. The library is **global**, so it follows you from one apartment to the next.

**Put a wall back.** Any of these reset the selected wall to the colour its file
shipped with:

- the ↺ button on its sidebar row,
- **Reset** in the picker,
- <kbd>R</kbd>.

**Data → Reset all walls** does every wall at once, leaving your schemes,
library and settings untouched.

## 4. Save it as a scheme

1. Paint a second wall a different colour.
2. In the sidebar's **Schemes** section, press **Save current** on slot 1. That
   snapshots every wall's colour into the slot.
3. Repaint the walls differently, then press **Save current** on slot 2.
4. Now press <kbd>1</kbd> and <kbd>2</kbd> alternately.

Both schemes apply instantly from wherever you are standing. This is what the
tool is for: comparing two off-whites from a fixed viewpoint, with the light and
the framing held constant.

## 5. Walk around

Press <kbd>Tab</kbd> to switch from orbit to walk mode. Switching never moves the
camera — it changes the input scheme only.

- <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> (or the arrow keys) to move,
  <kbd>Shift</kbd> to move 3× faster.
- Drag to look around, or press <kbd>L</kbd> for pointer lock and a proper
  first-person feel. <kbd>Esc</kbd> releases it.
- <kbd>Q</kbd> / <kbd>E</kbd> or the scroll wheel changes eye height. It starts
  at 1.65 m and is remembered as you change it.

There is no collision — you can walk through walls, and you are clamped only to
the scene's bounding box. Press <kbd>Tab</kbd> to go back to orbit, and
<kbd>?</kbd> at any time for the full shortcut list.

## 6. Load your own apartment

Drag a `.glb` anywhere onto the window, or use **Open .glb** in the sidebar.

For the app to find your walls automatically, each repaintable material needs a
`PAINT_` prefix — `PAINT_Living_North` shows up in the sidebar as **Living
North**. If your export doesn't follow that convention, nothing is lost: open
**All materials** in the sidebar and tick the materials you want to paint. That
choice is remembered per file name.

Two guides cover the export end in full:

- [Preparing a Blender scene](guides/preparing-a-blender-scene.md) — naming, material
  setup, and the glTF export settings.
- [Baking lighting](guides/baking-lighting.md) — how to get a Cycles bake through
  glTF and into the viewer.

## Before you trust a colour on screen

Tone mapping is on by default, which makes the view resemble a Cycles render but
means an on-screen pixel is **not** the hex you typed. Press <kbd>T</kbd> to turn
it off when you want to judge a colour literally. [Judging colour
accurately](guides/judging-colour.md) explains what the app can and cannot tell
you — read it before you buy paint.

## A note on phones and tablets

Repaint needs hover, a keyboard and a 340 px sidebar, so touch-only devices get a
"open this on a desktop" page instead of a WebGL context they can't drive. There
is a **Continue anyway** button for devices the media query gets wrong, such as a
touchscreen laptop.

## Where next

- [Keyboard shortcuts](reference/keyboard-shortcuts.md) — the full table.
- [What gets saved](reference/persistence.md) — everything lives in
  `localStorage`; nothing is uploaded anywhere.
- [Troubleshooting](guides/troubleshooting.md) — a scene that loads wrong, looks
  wrong, or runs slowly.
