# 0001 — Vanilla three.js over React Three Fiber

**Status:** Accepted · **Recorded:** 2026-08-13 (retrospectively, from the
existing implementation)

## Context

Repaint is a single-canvas tool with one imperative scene graph and a small
amount of surrounding UI: a sidebar, a toolbar, a debug panel and a few
overlays.

React Three Fiber is the default choice for three.js in a modern codebase, so
not using it needs a reason.

The hot path in this app is narrow and known: a colour write during a colour
picker drag. That fires on every `pointermove`, and it must stay a uniform
upload straight to `material.color` — anything that invalidates three.js's
program cache stalls a frame.

## Decision

Use three.js directly. Build the UI from plain DOM.

Accept a small amount of hand-written diffing where the panels need it, rather
than adopting a reconciler:

- `Sidebar` takes its whole state as one view model (`render(viewModel)`) and
  works out what moved internally.
- `Toolbar` skips a slot rebuild when the schemes are unchanged.

## Consequences

**Good.**

- The hot path is exactly as cheap as three.js allows, and stays that way
  whatever the panels around it do.
- No React dependency and no reconciler indirection between an event and the
  uniform it writes.
- The UI is small enough that plain DOM is less code than the React it would
  replace.
- The diffing that does exist is about 60 lines, which buys something specific:
  the app can re-render both panels after _every_ mutation instead of each call
  site remembering which half of the UI to touch.

**Costs.**

- The diffing is hand-written, so it is on us to keep it correct. Two rules make
  it tractable, and both are load-bearing: sorted views are built once per
  discovery rather than per render (the sort is an `Intl` collation, and it was
  the whole cost), and a section is compared against a snapshot of its _own_
  contents, because the store mutates the objects it hands out in place.
- `sidebar.test.ts` exists largely to hold that diffing honest — 16 tests over
  which sections a render rebuilds, which it leaves standing, and what survives
  an open colour picker.
- Contributors who know R3F have to learn this codebase's conventions instead.

## Notes

The decision is scoped to this app's shape. A tool with many scenes, or with UI
that composes 3D content declaratively, would weigh it differently.
