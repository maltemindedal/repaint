# Configuration

Repaint has **no environment variables and no runtime config file**. It is a
static client-side app; everything configurable is a control in the debug panel
(<kbd>`</kbd>), and every value is persisted per scene.

Where those values are stored, and what else is saved alongside them, is covered
in [Persistence](persistence.md).

## Settings

Defined in `SceneSettings` (`src/types.ts`) with defaults in `DEFAULT_SETTINGS`
(`src/state/store.ts`). Ranges are the debug-panel slider bounds.

### Rendering

| Key           | Type    | Default | Range              | Effect                                                                                                                                        |
| ------------- | ------- | ------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `exposure`    | number  | `1.0`   | 0.1 – 3, step 0.01 | `renderer.toneMappingExposure`.                                                                                                               |
| `toneMapping` | boolean | `true`  | —                  | ACES filmic when on, none when off. Also bound to <kbd>T</kbd> and the toolbar button. Off is colour-accurate; on looks like a Cycles render. |

### Baked lighting

| Key                 | Type    | Default              | Range            | Effect                                                                                                                                                                  |
| ------------------- | ------- | -------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lightMapIntensity` | number  | `Math.PI` (≈3.14159) | 0 – 6, step 0.01 | `material.lightMapIntensity` on every material with a detected lightmap. π, not 1 — see [ADR 0003](../architecture/decisions/0003-default-lightmap-intensity-is-pi.md). |
| `aoMapIntensity`    | number  | `0.0`                | 0 – 2, step 0.01 | `material.aoMapIntensity` on lightmapped _and_ AO-only materials. 0 because the same texture drives the lightmap, and feeding it in twice doubles the occlusion.        |
| `envIntensity`      | number  | `0.25`               | 0 – 2, step 0.01 | `scene.environmentIntensity`. Kept low so a bake stays dominant.                                                                                                        |
| `punctualLights`    | boolean | `false`              | —                | Visibility of lights imported from the GLB.                                                                                                                             |

### Navigation

| Key          | Type    | Default | Range              | Effect                                                                                                                       |
| ------------ | ------- | ------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `eyeHeight`  | number  | `1.65`  | 0.2 – 6, step 0.01 | Walk-mode camera height above the scene floor, in metres. Clamped to the same range wherever it is set, including on import. |
| `walkSpeed`  | number  | `2.4`   | 0.3 – 8, step 0.1  | Metres per second. Values from other sources are clamped to 0.2 – 20.                                                        |
| `highlights` | boolean | `true`  | —                  | Hover brightening and the selection pulse. Turning it off clears any active highlight.                                       |

### Per-scene default overrides

Two settings are _guesses_ rather than preferences. They are written only when
the current file has no value of its own, so they never override a choice you
made (`SceneSession.applyHeuristicDefaults`):

| Setting          | Condition                                    | Value used                                                                                                         |
| ---------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `punctualLights` | The scene contains lights                    | `true` when no bake was detected, `false` when one was — a baked scene shouldn't be double-lit                     |
| `aoMapIntensity` | The scene has ORM-packed occlusion materials | `1` — for those materials the AO slider is the whole effect, and the global default of 0 would silently disable it |

## Session-only panel controls

These two are debug-panel controls that are **not** persisted. They reset on
reload.

| Control         | Default   | Range           | Effect                                                                                                                         |
| --------------- | --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Background      | `#1a1a1a` | colour picker   | Viewport background. Neutral grey on purpose — a tinted surround biases how you read a paint sample.                           |
| Max pixel ratio | `2`       | 1 – 3, step 0.5 | Caps `renderer.setPixelRatio(min(devicePixelRatio, value))`. Dropping to 1 is the fastest performance fix on a Retina display. |

The Scene folder also holds read-only readouts (geometry, textures, compression,
whether a bake was detected, whether the file has lights) refreshed twice a
second, plus **Frame scene**, **Reset all colours** and **Log material report**.

## Fixed constants

Not configurable, but useful to know. Each is a single named constant in the
source.

| Constant                                         | Value                                     | Where                             |
| ------------------------------------------------ | ----------------------------------------- | --------------------------------- |
| Paint material prefix                            | `PAINT_`                                  | `src/types.ts`                    |
| Start camera object name                         | `START_CAM`                               | `src/types.ts`                    |
| Sprint multiplier                                | 3×                                        | `src/nav/WalkMotion.ts`           |
| Eye-height rise rate (<kbd>Q</kbd>/<kbd>E</kbd>) | 1.1 m/s                                   | `src/nav/WalkMotion.ts`           |
| Scroll-to-eye-height                             | 0.0012 m per wheel delta unit             | `src/nav/WalkControls.ts`         |
| Look sensitivity                                 | 0.0022 rad/px                             | `src/nav/WalkMotion.ts`           |
| Walk bounds padding                              | 0.25 m outside the scene box              | `src/nav/WalkMotion.ts`           |
| Walk pose settle delay                           | 0.5 s of stillness                        | `src/nav/WalkMotion.ts`           |
| Camera field of view                             | 55° (overridden by `START_CAM`'s own fov) | `src/core/Viewer.ts`              |
| Camera near / far                                | 0.05 m / 500 m                            | `src/core/Viewer.ts`              |
| Orbit floor clamp                                | 0.08 m above the scene floor              | `src/nav/NavigationController.ts` |
| Screenshot scale                                 | 2×, capped at a device pixel ratio of 4   | `src/core/Viewer.ts`              |
| Performance check                                | once, 5 s after load, warns below 45 fps  | `src/main.ts`                     |

## Build-time configuration

`vite.config.ts`:

| Option                        | Value               | Why                                                                                                           |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `base`                        | `'./'`              | Relative, so `dist/` can be served from any subfolder without rewriting asset URLs.                           |
| `build.target`                | `es2023`            | Matches the TypeScript target.                                                                                |
| `build.sourcemap`             | `true`              | Sourcemaps ship with `dist/`. The portable build strips the pointer, since an inline script can't resolve it. |
| `build.chunkSizeWarningLimit` | `1500`              | three.js is large; the default limit is noise here.                                                           |
| `server.open`                 | `true`              | `pnpm dev` opens a browser tab.                                                                               |
| `test.environment`            | `node`              | The suite runs headless. `sidebar.test.ts` opts into happy-dom with a `@vitest-environment` docblock.         |
| `test.include`                | `test/**/*.test.ts` |                                                                                                               |

`pnpm-workspace.yaml` allows exactly one dependency build script: esbuild's
postinstall, which unpacks the platform binary Vite and Vitest need.
