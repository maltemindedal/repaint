# Repaint documentation

An annotated map of every document here. Organised by
[Diátaxis](https://diataxis.fr): learning, tasks, lookup, understanding.

New here? Start with [Getting started](getting-started.md), then read
[Judging colour accurately](guides/judging-colour.md) before you trust anything
on screen.

## Tutorial — learning by doing

| Document                              | What it covers                                                                                                                    | For                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [Getting started](getting-started.md) | Install, run, paint a wall, save a scheme, walk around. Uses the built-in demo room, so no Blender file needed. About 10 minutes. | Anyone opening the app for the first time |

## How-to guides — one task per page

| Document                                                         | What it covers                                                                                                | For                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [Preparing a Blender scene](guides/preparing-a-blender-scene.md) | The `PAINT_` material convention, material rules, scene units, `START_CAM`, glTF export settings, compression | Anyone authoring an apartment to load                     |
| [Baking lighting](guides/baking-lighting.md)                     | Lightmap UVs, the Cycles bake, and getting it through glTF via the `glTF Material Output` node                | Authors who want their room lit the way Cycles renders it |
| [Judging colour accurately](guides/judging-colour.md)            | Getting the most literal colour reading the app can give, and where its honesty ends                          | **Everyone**, before choosing a paint                     |
| [Deploying](guides/deploying.md)                                 | The static build, the portable single-file build, hosting, and what CI produces                               | Anyone sharing a build with someone else                  |
| [Troubleshooting](guides/troubleshooting.md)                     | A scene that loads wrong, looks wrong, runs slowly, or won't persist                                          | Anyone stuck                                              |

## Reference — exhaustive and factual

| Document                                              | What it covers                                                                                      | For                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [Keyboard shortcuts](reference/keyboard-shortcuts.md) | Every key and mouse interaction, by mode                                                            | Lookup while using the app               |
| [Configuration](reference/configuration.md)           | Every setting: type, default, range, effect. Plus fixed constants and build-time config             | Tuning the viewer, or changing a default |
| [Persistence](reference/persistence.md)               | The storage key, what is saved per scene vs globally, the export/import JSON format, and validation | Understanding or moving saved state      |
| [Scripts](reference/scripts.md)                       | Every `package.json` script, what it runs, and toolchain versions                                   | Day-to-day development                   |

## Explanation — understanding the why

| Document                                                                                                                         | What it covers                                                                                                                  | For                                             |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [Architecture overview](architecture/overview.md)                                                                                | Components, scene-activation order, how a colour change reaches the GPU and the store, why recolouring is cheap, testable seams | Contributors, and anyone modifying the app      |
| [ADR 0001 — Vanilla three.js over R3F](architecture/decisions/0001-vanilla-threejs-over-react-three-fiber.md)                    | Why there is no React, and what the hand-written diffing buys                                                                   | Contributors questioning the UI approach        |
| [ADR 0002 — Lightmap through the occlusion slot](architecture/decisions/0002-smuggle-the-lightmap-through-the-occlusion-slot.md) | Why baked lighting travels in the occlusion slot, and how ORM-packed textures are handled                                       | Anyone touching the loader or the bake workflow |
| [ADR 0003 — Default lightmap intensity is π](architecture/decisions/0003-default-lightmap-intensity-is-pi.md)                    | The `BRDF_Lambert` division that makes 1 wrong and π right                                                                      | Anyone who thinks the default looks arbitrary   |
| [ADR 0004 — Scene state keyed by file name](architecture/decisions/0004-scene-state-keyed-by-file-name.md)                       | Why renames lose state, and why that beats the alternatives                                                                     | Anyone changing persistence                     |

## Contributing

| Document                        | What it covers                                                                                                  | For                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [Contributing](contributing.md) | Dev setup, the pre-push check, test conventions, code style, PR conventions, and how to keep these docs in sync | Anyone opening a PR against this repo |

## Conventions used here

- Every command, path, default and version is taken from the repository. Anything
  that could not be verified is marked `TODO(verify)`.
- Information lives in exactly one place; other pages link to it.
- Filenames are kebab-case `.md`. ADRs are `NNNN-<slug>.md`, numbered
  sequentially.
