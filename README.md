# Repaint

[![CI](https://github.com/maltemindedal/repaint/actions/workflows/ci.yml/badge.svg)](https://github.com/maltemindedal/repaint/actions/workflows/ci.yml)

A local, client-side 3D viewer for a Blender apartment export. Walk around, click
a wall, paste a paint hex, and flip between colour schemes while standing in the
same spot.

Choosing wall paint from a chart is guesswork: a 3 cm swatch under shop lighting
tells you very little about four square metres of wall under your own windows.
Repaint loads your apartment with its Cycles lighting baked in, lets you recolour
any wall by hex, and binds whole colour schemes to <kbd>1</kbd> / <kbd>2</kbd> /
<kbd>3</kbd> so you can A/B them from a fixed viewpoint.

Nothing leaves your machine: no backend, no uploads, no analytics. Your GLB is
read with `FileReader` and stays in the tab.

## Quick start

Requires **Node 24.x** and **pnpm 11.10.0** (pinned by `packageManager` — run
`corepack enable`).

```bash
pnpm install
```

```bash
pnpm dev
```

Vite opens <http://localhost:5173>. You get a small procedurally generated demo
room — two walls, a ceiling, a floor and a fake baked gradient — so the whole UI
is usable before you have an export ready.

Hover a wall, click it, and paste a hex into the sidebar picker. The hex box
accepts anything containing a hex, so a whole product name works:

```text
Alcro Lammull #E8E4DA
```

Press <kbd>Tab</kbd> to walk around with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>,
and <kbd>?</kbd> for every shortcut.

Then drop your own `.glb` anywhere on the window. Each repaintable wall needs its
own material named with a `PAINT_` prefix — `PAINT_Living_North` appears in the
sidebar as **Living North**. Materials without the prefix can be ticked by hand
under **All materials**.

> **Before you trust a colour on screen:** tone mapping is on by default, so an
> on-screen pixel is _not_ the hex you typed. Press <kbd>T</kbd> to turn it off.
> Read [Judging colour accurately](docs/guides/judging-colour.md) — the app is
> built to compare colours, not to replace a tester pot.

### Static build

```bash
pnpm build
```

```bash
pnpm serve:dist
```

`dist/` must be **served**, not opened as `file://` — browsers block ES modules
there, so double-clicking `dist/index.html` gives you a blank page. The build uses
a relative `base`, so it works from a subfolder on any static host.

For a copy you can email and double-click:

```bash
pnpm build:portable
```

That folds everything into a single self-contained `dist/repaint.html`. Draco and
KTX2 files still need the served build — see
[Deploying](docs/guides/deploying.md).

## Documentation

Full index: **[docs/README.md](docs/README.md)**

|                                                                       |                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| [Getting started](docs/getting-started.md)                            | Install → running → first repaint, in about 10 minutes        |
| [Preparing a Blender scene](docs/guides/preparing-a-blender-scene.md) | The `PAINT_` convention, material rules, glTF export settings |
| [Baking lighting](docs/guides/baking-lighting.md)                     | Cycles bake → second UV set → occlusion slot → lightmap       |
| [Judging colour accurately](docs/guides/judging-colour.md)            | Tone mapping, what the app can and cannot tell you            |
| [Deploying](docs/guides/deploying.md)                                 | Static build, portable single file, hosting, CI               |
| [Troubleshooting](docs/guides/troubleshooting.md)                     | Loading, appearance, performance, saved state                 |
| [Keyboard shortcuts](docs/reference/keyboard-shortcuts.md)            | Every key and mouse interaction                               |
| [Configuration](docs/reference/configuration.md)                      | Every setting: type, default, range, effect                   |
| [Persistence](docs/reference/persistence.md)                          | What is saved, where, and the export format                   |
| [Scripts](docs/reference/scripts.md)                                  | Every `package.json` script                                   |
| [Architecture](docs/architecture/overview.md)                         | Components, data flow, testable seams, ADRs                   |

## Project structure

```text
src/
  core/       Viewer, loading, scene processing, paint registry, picking
  nav/        Orbit ⇄ walk navigation and the DOM-free walk state machine
  state/      Persisted store and validating localStorage layer
  ui/         Sidebar, colour picker, toolbar, debug panel, overlays
  util/       sRGB hex helpers and small DOM helpers
test/         94 tests, headless node; fixtures/ generates a sample GLB
scripts/      make-portable.mjs — folds dist/ into one HTML file
docs/         All documentation (see the index above)
```

Vanilla three.js, no React — see
[ADR 0001](docs/architecture/decisions/0001-vanilla-threejs-over-react-three-fiber.md)
for why.

## Contributing

`pnpm check` runs typecheck, lint and format check together; `pnpm test` runs the
suite. See [docs/contributing.md](docs/contributing.md).

## License

> **TODO(verify):** No licence file exists in this repository, and `package.json`
> is marked `"private": true` with no `license` field. Add a `LICENSE` and link it
> here, or state that the project is unlicensed and all rights are reserved.
