# Contributing

## Setup

```bash
pnpm install
```

```bash
pnpm dev
```

pnpm 11.10.0 is pinned by the `packageManager` field, so `corepack enable` gets
you the right version. CI runs Node 24.x; nothing enforces that locally.

pnpm blocks dependency build scripts by default. `pnpm-workspace.yaml` allows
exactly one — esbuild's postinstall, which unpacks the platform binary Vite and
Vitest need. If you add a dependency that needs a build step, it goes there
deliberately.

## Before you push

```bash
pnpm check
```

That is `tsc --noEmit && oxlint && oxfmt --check` — the same three checks CI runs,
in one command. Plus:

```bash
pnpm test
```

Full script list: [reference/scripts.md](reference/scripts.md).

## Tests

94 tests across 7 files, all in `test/`, all running in plain node — no browser,
no GPU. That is a property worth protecting: five modules
(`processScene.ts`, `PaintRegistry.ts`, `PaintController.ts`, `SceneSession.ts`,
`WalkMotion.ts`) are deliberately renderer-free so the real pipeline can be
exercised headlessly.

- Anything needing a `document` opts in per file with a
  `@vitest-environment happy-dom` docblock, as `sidebar.test.ts` does. The suite
  default stays `node`.
- New code in the core or nav layers should be testable the same way. If a module
  needs a `WebGLRenderer` to be tested, that is usually a sign the renderer-facing
  part wants separating from the logic.
- For manual testing against a real glTF file — the loader, the occlusion→lightmap
  rerouting, `TEXCOORD_1`, `START_CAM`:

  ```bash
  node test/fixtures/make-fixture.mjs
  ```

  That writes `test/fixtures/apartment-fixture.glb` (gitignored) and drops in like
  any other export.

## Code conventions

Formatting is `oxfmt` (100 columns, single quotes) and linting is `oxlint`
(`typescript`, `unicorn`, `oxc` and `import` plugins; `correctness` is an error,
`suspicious` and `perf` are warnings). Both configs are in the repo root — don't
fight them, run `pnpm format`.

Beyond what the tools check, the house style in this codebase is:

**Comments explain why, not what.** The existing comments are dense and they are
load-bearing: they record the reasoning that stops a later change from
reintroducing a bug. `PaintRegistry.setColor` explains why it does _not_ touch
`needsUpdate`; `SceneSession.load` explains why its steps are in that order.
Match that when you touch those files.

**TypeScript is strict**, with `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch` and `noUncheckedSideEffectImports` on. Imports carry
explicit `.ts` extensions (`allowImportingTsExtensions`).

**Make invalid states unrepresentable where it's cheap.** `AppliedSettingKey`
excludes `eyeHeight` from the settings that flow store→app, because eye height
flows the other way; the type makes the old double-ownership bug impossible
rather than merely avoided.

**One owner per piece of state.** Colour writes go through `PaintRegistry`. The
fan-out to store and views goes through `PaintController`. Scene activation order
lives in `SceneSession`. Eye height is owned by `WalkMotion` while walk mode runs
and by the store when persisted, with one documented seam between them.

## Pull requests

CI runs on every pull request: **Check** (format, lint, typecheck), **Test**, and
**Build** (which also asserts `dist/repaint.html` was produced). All three must
pass.

Observed conventions from the history — imperative subject lines, sentence case,
often naming the change's shape rather than its files:

```text
Add a CI workflow: check, test, build (#16)
Move from npm to pnpm (#15)
Keep the exported colour across a re-discovery (#14)
NavigationController: atomic switchMode, private walk input (#7)
```

PRs are merged into `main` with the PR number appended to the subject, which
suggests squash merges.

> **TODO(verify):** There is no `CONTRIBUTING.md`, PR template, `CODEOWNERS` or
> written branch policy in the repository, so review requirements and branch
> naming are inferred from commit history rather than documented. A maintainer
> should confirm or replace this section.

## Documentation

Docs live in `docs/` and follow the [Diátaxis](https://diataxis.fr) split —
tutorial, how-to guides, reference, explanation. Two rules:

- **Every command, path, default and version in the docs must come from the
  repository.** If you change a default in `DEFAULT_SETTINGS`, a script in
  `package.json` or a constant the docs quote, update
  [reference/configuration.md](reference/configuration.md) or
  [reference/scripts.md](reference/scripts.md) in the same PR.
- **`docs/README.md` is the map.** Adding a page means adding its line there.

Architectural decisions with a real trade-off go in
[architecture/decisions/](architecture/decisions/) as
`NNNN-<kebab-case-slug>.md`, numbered sequentially.
