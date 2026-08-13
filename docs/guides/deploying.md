# Deploying and sharing a build

Repaint is a fully client-side app. There is no backend, no upload step and no
analytics — a build is a folder of static files. Your GLB is read with
`FileReader` and never leaves the tab.

There are two build outputs, and which you want depends on how the recipient will
open it.

| Output              | Command               | Opens from              | Compressed GLBs   |
| ------------------- | --------------------- | ----------------------- | ----------------- |
| `dist/`             | `pnpm build`          | A static server         | ✅ Yes            |
| `dist/repaint.html` | `pnpm build:portable` | Double-click, `file://` | ❌ No — see below |

## The normal build

```bash
pnpm build
```

That runs `tsc --noEmit` first and then `vite build`, so a type error fails the
build rather than shipping. Output lands in `dist/`, with sourcemaps.

Serve it locally to check:

```bash
pnpm serve:dist
```

That is `vite preview --port 4173` — <http://localhost:4173>.

### `dist/` must be served, not opened

Double-clicking `dist/index.html` gives you a blank page. Browsers block ES
module imports and WASM fetches on the `file://` protocol.

Any static server works — `pnpm serve:dist`, `pnpm dlx serve dist`, or
`python3 -m http.server`. The build uses a **relative `base`** (set in
`vite.config.ts`), so `dist/` also works from a subfolder on any host without
rewriting asset URLs. Drop it on GitHub Pages, Netlify, S3, or an internal
webserver as-is.

## The portable single-file build

```bash
pnpm build:portable
```

This runs the normal build and then `scripts/make-portable.mjs`, which folds the
JS bundle and the stylesheet inline into a single self-contained
**`dist/repaint.html`**. The script prints the finished size when it is done.

That file can be emailed, dropped in a shared folder, and **double-clicked
straight from Finder or Explorer** — no server required. Browsers block
`file://` imports of _separate_ files, but an _inline_ module script is fine.

**The one caveat**, which the script also prints: the DRACO and KTX2 decoders are
WASM files fetched on demand, and `fetch()` is blocked on `file://`. So from the
portable file:

- Uncompressed GLBs — Blender's default export — work fully.
- meshopt works (its decoder is bundled JS, no fetch).
- **Draco and KTX2 compressed files do not decode.** Those need the served
  build.

The app notices this case: if a load fails while running on `file://`, it logs a
console warning pointing at `pnpm serve:dist`.

## Hosting notes

- **No server configuration is needed** beyond serving static files. There are no
  routes, no API, no environment variables — see
  [Configuration](../reference/configuration.md), which is entirely runtime UI
  state.
- **Everything persists in the visitor's `localStorage`**, per browser and per
  origin. Deploying a new build does not disturb saved schemes; see
  [Persistence](../reference/persistence.md).
- **Users on phones and tablets** get a "use a desktop" page rather than a broken
  app.
- **Redistribution is MIT**, both for `dist/` and for the portable
  `dist/repaint.html` — including the bundled three.js, lil-gui and stats.js,
  which are MIT as well. The licence asks that the copyright notice travel with
  substantial copies, so ship [LICENSE](../../LICENSE) alongside a build you pass
  on, or paste it into the page you host it from.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main`, on every pull request, and
on manual dispatch. Node 24.x, pnpm from the `packageManager` field, three jobs:

| Job       | What it runs                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Check** | `format:check`, then `lint`, then `typecheck` — each with `if: ${{ !cancelled() }}` so one run reports everything that needs fixing, not just the first failure |
| **Test**  | `pnpm test`                                                                                                                                                     |
| **Build** | `pnpm build:portable`, asserts `dist/repaint.html` is non-empty, and uploads `dist/` as an artifact with 14-day retention                                       |

The Build job covers both the Vite build and the single-file bundling, because
`build:portable` runs `build` first.

To download a built copy without building it yourself, open the CI run on GitHub
and grab the `dist` artifact.
