# Persistence: what gets saved

Everything Repaint remembers lives in the browser's `localStorage`, under a
single key. Nothing is uploaded anywhere — there is no backend, no account and no
analytics.

## The storage key

```text
apartment-walkthrough:v1
```

That is the pre-rename key, kept as-is so schemes and libraries saved before the
app was called Repaint still load (`STORAGE_KEY` in `src/state/storage.ts`).

If `localStorage` is unavailable — Safari private mode has the API but throws on
write — the app transparently falls back to an in-memory store, and state lasts
only for the session.

## Scope: per scene, keyed by file name

Scene state is keyed by the **dropped file's name**. The built-in demo room uses
the reserved key `__fallback__`.

Two consequences, both deliberate ([ADR 0004](../architecture/decisions/0004-scene-state-keyed-by-file-name.md)):

- Renaming your export starts it fresh.
- Two different files with the same name share state.

Export the JSON first if either would cost you something.

### Saved per scene

| Data                  | Notes                                                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tagged` / `untagged` | Manual paintable-material tagging. Only the _deviation_ from what `PAINT_` discovery would do is stored, so a re-export that adds the prefix doesn't leave a stale override. |
| `schemes`             | The three keyboard-addressable slots (`slot-1`…`slot-3`) with their names and colour maps. Older saves with fewer slots are topped up to three on load.                      |
| `activeSchemeId`      | Which slot is live — used for the screenshot filename.                                                                                                                       |
| `current`             | The live colour of every wall, so a reload picks up exactly where you left off.                                                                                              |
| `poses`               | Last camera pose, stored separately for `orbit` and `walk`.                                                                                                                  |
| `settings`            | A partial patch over the global defaults — only keys you have actually changed. See [Configuration](configuration.md).                                                       |

### Saved globally

| Data      | Notes                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| `library` | The colour library — name and hex per entry. Shared across every scene, so it follows you between apartments. |

### Stored elsewhere

| Key                    | Store            | Purpose                                                                                                                                                                                      |
| ---------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repaint:allow-mobile` | `sessionStorage` | Set by **Continue anyway** on the touch-device gate. Session-scoped on purpose: a deliberate override shouldn't have to be repeated on every reload, but shouldn't outlive the visit either. |

## When writes happen

Writes are debounced, because dragging a colour picker fires a lot of them.

| Trigger      | Delay                                        |
| ------------ | -------------------------------------------- |
| Most changes | 250 ms                                       |
| Camera poses | 800 ms — they change on every frame you move |
| `pagehide`   | Immediate flush                              |

A pending short-delay save is never postponed by a lazy one. In walk mode the
pose is only written once the camera has been still for 0.5 s, so walking
somewhere is persisted rather than saved a hundred times on the way.

## Export and import

**Data → Export JSON** in the sidebar writes the whole store — every scene,
plus the global library — to `repaint-YYYY-MM-DD.json`.

**Data → Import JSON**, or dropping a `.json` anywhere on the window, merges a
file back in:

- Scenes are merged by key, and an incoming scene **replaces** the existing entry
  for that file name.
- Library colours are merged by `name|hex`, so re-importing your own export does
  not create duplicates.

An import is flushed to storage immediately rather than debounced.

### File format

```jsonc
{
  "version": 1,
  "library": [{ "id": "lib-…", "name": "Alcro Lammull", "hex": "#e8e4da" }],
  "scenes": {
    "apartment.glb": {
      "tagged": [],
      "untagged": [],
      "schemes": [
        { "id": "slot-1", "name": "Warm white", "colors": { "PAINT_Living_North": "#e8e4da" } },
      ],
      "activeSchemeId": "slot-1",
      "poses": {
        "orbit": { "position": [3, 1.65, 3], "target": [0, 1.5, 0] },
      },
      "settings": { "exposure": 1.2 },
      "current": { "PAINT_Living_North": "#e8e4da" },
    },
  },
}
```

## Validation

Saved data comes from `localStorage` or a user-supplied file, so every field is
checked on the way in rather than blind-cast (`migrate()` in
`src/state/storage.ts`). Anything that doesn't hold its shape is dropped, never
propagated:

- Scheme entries need a string `id` and `name`; colour maps keep only string
  values.
- Poses need `position` and `target` as three finite numbers each, or the mode is
  dropped.
- Settings keep only known keys whose values have the expected type. A finite
  number passes the type check but may still be out of range — `eyeHeight` and
  `walkSpeed` are clamped by the modules that own them.
- Unparseable JSON logs `[storage] could not read saved data, starting fresh.`
  and yields an empty store rather than throwing.

## Clearing it

There is no "clear everything" button. Use your browser's devtools to delete the
`apartment-walkthrough:v1` key, or clear site data for the origin.

**Data → Reset all walls** is narrower: it puts every wall back to the colour its
GLB shipped with, leaving schemes, library and settings alone.
