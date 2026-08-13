# 0004 — Scene state keyed by file name

**Status:** Accepted · **Recorded:** 2026-08-13 (retrospectively, from the
existing implementation)

## Context

Repaint has no backend and no accounts. A scene arrives as a `File` dropped on
the window, and the app needs somewhere to hang everything it remembers about
that scene: manual material tagging, three scheme slots, the live colour of every
wall, two camera poses, and a settings patch.

Something has to identify "this apartment" across reloads. The candidates:

| Key                        | Problem                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| File name                  | Renames lose state; two unrelated files with the same name collide                                                  |
| Content hash               | Every re-export from Blender is a new file, so every re-export loses state — the exact moment you most want it kept |
| Scene/root node name       | Often empty, often just the Blender file name, and not reliably stable                                              |
| A user-chosen project name | Adds a naming step before the app does anything useful                                                              |

The dominant workflow is iterating: export `apartment.glb`, look at it, change
something in Blender, re-export over the same path, drop it in again. Keeping
schemes across _that_ cycle is the thing that matters.

## Decision

Key scene state by the dropped file's name (`LoadedScene.key = file.name`). The
built-in demo room uses the reserved key `__fallback__`.

The colour library is deliberately **not** scene-scoped — it is global, so a
saved paint colour follows you between apartments.

## Consequences

**Good.**

- Re-exporting over the same filename keeps everything, which is the common case.
- No naming step, no project concept, no UI for managing saved scenes.
- The key is human-readable in an exported JSON file, so hand-editing or
  re-targeting an export is straightforward.

**Costs.**

- **Renaming an export starts it fresh.** Export the JSON first if the schemes
  matter.
- **Two different apartments named `apartment.glb` share state.** They will show
  each other's schemes and wall colours.
- Colours are replayed onto whatever materials the new file has. Material names
  that survive a re-export keep their paint; renamed ones come back at their
  exported colour, and entries for materials the scene no longer has are ignored
  rather than erroring.

Both costs are documented in [Persistence](../../reference/persistence.md) and
surfaced in [Troubleshooting](../../guides/troubleshooting.md) rather than
mitigated in code.

## Mitigation available today

**Data → Export JSON** writes the entire store — every scene keyed by name, plus
the global library — to a file. **Import JSON** merges it back, replacing the
entry for each incoming file name. That is the escape hatch for a rename, and the
way to move state between machines or browsers.

## If this is revisited

A plausible upgrade is a stable ID written into the GLB itself (a custom `extras`
field on the scene node), falling back to the file name when absent. That would
survive renames without breaking existing saves, at the cost of asking authors to
add one more thing to their export.
