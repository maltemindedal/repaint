# Scripts

Every script in `package.json`, what it actually runs, and when you want it.

## Development

| Script            | Runs                       | Notes                                                                                                                                                    |
| ----------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`        | `vite`                     | Dev server with HMR on <http://localhost:5173> (Vite's default; it moves to the next free port if that one is taken). Opens a browser tab automatically. |
| `pnpm preview`    | `vite preview`             | Serves an existing `dist/` on Vite's default preview port, 4173. Requires a prior build.                                                                 |
| `pnpm serve:dist` | `vite preview --port 4173` | The same thing with the port pinned. This is the one referenced elsewhere in the docs.                                                                   |

## Build

| Script                | Runs                                               | Notes                                                                                                                                 |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`          | `tsc --noEmit && vite build`                       | Typechecks first, so a type error fails the build. Emits `dist/` with sourcemaps.                                                     |
| `pnpm build:portable` | `pnpm run build && node scripts/make-portable.mjs` | Builds, then folds the JS and CSS inline into a single double-clickable `dist/repaint.html`. See [Deploying](../guides/deploying.md). |

## Quality

| Script              | Runs                                      | Notes                                                                    |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm check`        | `tsc --noEmit && oxlint && oxfmt --check` | Everything CI's Check job runs, in one command. Use this before pushing. |
| `pnpm typecheck`    | `tsc --noEmit`                            |                                                                          |
| `pnpm lint`         | `oxlint`                                  | Config in `.oxlintrc.json`.                                              |
| `pnpm format`       | `oxfmt`                                   | Formats in place.                                                        |
| `pnpm format:check` | `oxfmt --check`                           | Fails instead of writing. Config in `.oxfmtrc.json`.                     |

Unlike `pnpm check`, CI runs the three checks as separate steps guarded with
`if: ${{ !cancelled() }}`, so one run reports every problem rather than stopping
at the first.

## Tests

| Script            | Runs         | Notes                                                                                                                                            |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`       | `vitest run` | The whole suite, in plain node — no browser, no GPU. Per-file breakdown: [architecture/overview.md](../architecture/overview.md#testable-seams). |
| `pnpm test:watch` | `vitest`     | Watch mode.                                                                                                                                      |

## Not a package script

| Command                                                                    | Purpose                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node test/fixtures/make-fixture.mjs`                                      | Generates `test/fixtures/apartment-fixture.glb`, a convention-following file for manual testing of the loader, the occlusion→lightmap rerouting, `TEXCOORD_1` and `START_CAM`. Gitignored.                                                 |
| `blender --background <file>.blend --python scripts/bake_export.py -- ...` | Headless bake-and-export pipeline: lightmap UVs, atlas unwrap, Cycles bake, `glTF Material Output` wiring, `.glb` export. See [Baking lighting § Automating this guide](../guides/baking-lighting.md#automating-this-guide-with-a-script). |

## Toolchain versions

| Tool           | Version           | Pinned by                                                                                               |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| Node           | 24.x              | `NODE_VERSION` in `.github/workflows/ci.yml`. No `engines` field enforces it locally.                   |
| pnpm           | 11.10.0           | `packageManager` in `package.json` — CI reads the version from there rather than pinning it separately. |
| TypeScript     | ^5.9.2            | `package.json`                                                                                          |
| Vite           | ^8.2.1            | `package.json`                                                                                          |
| Vitest         | ^3.2.4            | `package.json`                                                                                          |
| three.js       | ^0.185.1          | `package.json`                                                                                          |
| oxlint / oxfmt | ^1.78.0 / ^0.63.0 | `package.json`                                                                                          |
