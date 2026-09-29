# Deploying and sharing a build

Repaint is a fully client-side app. There is no backend, no upload step and no
analytics. A build is a folder of static files. Your GLB is read with
`FileReader` and never leaves the tab.

There are two build outputs, and which you want depends on how the recipient will
open it.

| Output              | Command               | Opens from              | Compressed GLBs  |
| ------------------- | --------------------- | ----------------------- | ---------------- |
| `dist/`             | `pnpm build`          | A static server         | ✅ Yes           |
| `dist/repaint.html` | `pnpm build:portable` | Double-click, `file://` | ❌ No. See below |

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

That is `vite preview --port 4173` at <http://localhost:4173>.

### `dist/` must be served, not opened

Double-clicking `dist/index.html` gives you a blank page. Browsers block ES
module imports and WASM fetches on the `file://` protocol.

Any static server works. Use `pnpm serve:dist`, `pnpm dlx serve dist`, or
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
straight from Finder or Explorer**. No server is required. Browsers block
`file://` imports of _separate_ files, but an _inline_ module script is fine.

**The one caveat**, which the script also prints: the DRACO and KTX2 decoders are
WASM files fetched on demand, and `fetch()` is blocked on `file://`. So from the
portable file:

- Uncompressed GLBs, including Blender's default export, work fully.
- meshopt works (its decoder is bundled JS, no fetch).
- **Draco and KTX2 compressed files do not decode.** Those need the served
  build.

The app notices this case: if a load fails while running on `file://`, it logs a
console warning pointing at `pnpm serve:dist`.

## Hosting notes

- **No server configuration is needed** beyond serving static files. There are no
  routes, no API, and no environment variables. See
  [Configuration](../reference/configuration.md), which is entirely runtime UI
  state.
- **Everything persists in the visitor's `localStorage`**, per browser and per
  origin. Deploying a new build does not disturb saved schemes; see
  [Persistence](../reference/persistence.md).
- **Users on phones and tablets** get a "use a desktop" page rather than a broken
  app.
- **Redistribution is MIT**, both for `dist/` and for the portable
  `dist/repaint.html`, including the bundled three.js (with its fps meter) and
  lil-gui, which are MIT as well. The licence asks that the copyright notice
  travel with substantial copies, so ship [LICENSE](../../LICENSE) alongside a
  build you pass on, or paste it into the page you host it from.

## Content-Security-Policy

`index.html` carries a Content-Security-Policy `<meta>`. The app never needs the
network beyond its own files, so the policy says so: a bug or a hostile file cannot
make the page contact another origin, load a script from one, or submit a form.

| Directive                               | Value                                     | Why                                                                                                      |
| --------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `default-src`                           | `'none'`                                  | Everything not listed below is refused                                                                   |
| `script-src`                            | `'self' 'wasm-unsafe-eval' 'unsafe-eval'` | The bundle; the Draco and Basis WebAssembly; and the KTX2 transcoder, which builds functions at run time |
| `style-src`                             | `'self' 'unsafe-inline'`                  | The stylesheet, and inline `style` attributes the UI sets                                                |
| `img-src`                               | `'self' data: blob:`                      | The page's own images, the favicon, and images embedded in a glTF                                        |
| `font-src`                              | `data:`                                   | None are used                                                                                            |
| `connect-src`                           | `'self' data: blob:`                      | The decoders and the loaders' own reads; nothing else                                                    |
| `worker-src`                            | `blob:`                                   | The decoders run in workers built from blob URLs                                                         |
| `base-uri`, `form-action`, `object-src` | `'none'`                                  | Nothing needs them                                                                                       |

This is egress control rather than defence against script injection: `'unsafe-eval'`
is needed for KTX2 files and `'unsafe-inline'` for the UI's own inline styles.

In the portable `repaint.html` there is no origin to load a script from, only the one
inline script, so `scripts/make-portable.mjs` replaces `script-src 'self'` with that
script's SHA-256 hash. If the policy in `index.html` is edited so that text no longer
appears, the portable build fails rather than shipping a file that is blocked or open.

A `<meta>` policy cannot carry `frame-ancestors`. A host that can send headers should
send the same policy as a `Content-Security-Policy` header and add
`frame-ancestors 'none'` to stop the page being embedded.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main`, on every pull request, and
on manual dispatch. Node 24.x, pnpm from the `packageManager` field, three jobs:

| Job       | What it runs                                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Check** | `format:check`, then `lint`, then `typecheck`. Each uses `if: ${{ !cancelled() }}` so one run reports everything that needs fixing, not just the first failure |
| **Test**  | `pnpm test`                                                                                                                                                    |
| **Build** | `pnpm build:portable`, asserts `dist/repaint.html` is non-empty, and uploads `dist/` as an artifact with 14-day retention                                      |

The Build job covers both the Vite build and the single-file bundling, because
`build:portable` runs `build` first.

`.github/workflows/codeql.yml` runs GitHub's CodeQL code scanning on pushes to
`main` and on every pull request. It analyses two languages:
`javascript-typescript` (the app, scripts and tests) and `actions` (the workflow
files). Neither needs a build step. Findings appear under the repository's
**Security → Code scanning** tab and as annotations on pull requests.

Third-party actions are pinned to full commit SHAs (a tag can be moved), with the
release named in a trailing comment; checkouts do not keep the token
(`persist-credentials: false`) because no job pushes. `.github/dependabot.yml`
opens weekly PRs for the actions and the npm dependencies, only for releases that
are at least a week old, matching `minimumReleaseAge` in `pnpm-workspace.yaml`.

To download a built copy without building it yourself, open the CI run on GitHub
and grab the `dist` artifact.
