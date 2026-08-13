# Keyboard shortcuts

Press <kbd>?</kbd> in the app for an abbreviated version of this list.

Shortcuts are ignored while you are typing in a text field, and any key pressed
with <kbd>Cmd</kbd>, <kbd>Ctrl</kbd> or <kbd>Alt</kbd> held is passed through to
the browser untouched.

Keys are matched by physical position (`KeyboardEvent.code`), so they work the
same on non-QWERTY layouts.

## Navigation

| Key                                                 | Action                                                      |
| --------------------------------------------------- | ----------------------------------------------------------- |
| <kbd>Tab</kbd>                                      | Switch orbit ⇄ walk. Never moves the camera.                |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Walk (walk mode)                                            |
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> | Walk — same as WASD                                         |
| <kbd>Shift</kbd>                                    | Hold to move 3× faster                                      |
| <kbd>Q</kbd> / <kbd>E</kbd>                         | Lower / raise eye height, 1.1 m per second held             |
| <kbd>L</kbd>                                        | Request pointer lock (walk mode only)                       |
| <kbd>F</kbd>                                        | Frame the whole scene                                       |
| <kbd>Esc</kbd>                                      | Close help → release pointer lock → deselect, in that order |

## Colour

| Key                                    | Action                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> | Apply scheme slot 1 / 2 / 3                                                      |
| <kbd>R</kbd>                           | Reset the selected wall to its exported colour                                   |
| <kbd>T</kbd>                           | Tone mapping on / off — off means the on-screen colour matches the hex literally |
| <kbd>P</kbd>                           | Save a 2× PNG screenshot                                                         |

## Panels

| Key          | Action                  |
| ------------ | ----------------------- |
| <kbd>`</kbd> | Debug panel + FPS meter |
| <kbd>?</kbd> | Shortcut list           |

## Mouse

| Input                 | Mode  | Action                                                       |
| --------------------- | ----- | ------------------------------------------------------------ |
| Hover                 | both  | Brightens a paintable surface and highlights its sidebar row |
| Click                 | both  | Select a wall and open its picker                            |
| Drag                  | orbit | Orbit the pivot                                              |
| Right-drag            | orbit | Pan                                                          |
| Scroll                | orbit | Dolly in / out                                               |
| Double-click          | orbit | Ease the pivot onto the clicked point                        |
| Drag                  | walk  | Look around                                                  |
| Scroll                | walk  | Change eye height                                            |
| Drop `.glb` / `.gltf` | —     | Load a scene                                                 |
| Drop `.json`          | —     | Import settings                                              |

A click is distinguished from the end of a drag by distance: a pointer that moved
more than 4 px between press and release does not select.

Under pointer lock there is no cursor, so clicking picks whatever is under the
centre of the screen.

## Related

- [Configuration](configuration.md) — the debug panel's settings, defaults and
  ranges.
- [Judging colour accurately](../guides/judging-colour.md) — why <kbd>T</kbd>
  matters.
