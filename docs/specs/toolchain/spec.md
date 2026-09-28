# INIT-1: TypeScript foundation

Status: dependency setup complete; the [reference SVG harness](../svg-baselines/spec.md), mapping stories and [activation demo](../svg-activation/spec.md) provide real behavior tests.

As a contributor, I want pinned tools and a locked dependency install so I can begin the first mapping story.

## Decisions and scope

- Node 24.x declared in `package.json` engines; contributors choose how to install it. `mise.toml` is an ignored local preference. pnpm 11.28.0 is selected by `packageManager`; TypeScript 7.0.2 and Node types 24.13.6 are locked dependencies.
- One private ESM package with strict TypeScript, declarations, and source maps. No product entry point yet.
- Use standard user-level caches. No project cache folder, global tool replacement, remote, or publishing.
- Node's test runner covers actual behavior. Playwright verifies rendering and browser interaction; Vite 8.3.1 serves the demo; markdown-it 15.0.2 supplies the Markdown adapter and its own types. Versions are locked in the manifest/lockfile.

## Acceptance and verification

| ID | Requirement | Status |
|---|---|---|
| INIT-AC1 | Frozen dependency installation leaves the lockfile unchanged | Verified, including offline install, 2026-09-25 |
| INIT-AC2, INIT-AC3, INIT-C1 | Synthetic compiler/import test requirements | Retired: these tested the toolchain rather than project behavior; test and emitted artifacts removed |
| INIT-AC4 | Setup instructions match available commands and distinguish setup from product verification | Updated: typecheck/build/test cover mapping, Markdown and browser behavior; `demo` serves the generated page; no synthetic toolchain test |

The former dummy test's passing results are not product evidence. The current tests render real diagram inputs and compare SVG; do not add placeholders to manufacture a passing build.

## Maintenance plan

Keep documentation under `docs/` except root README and AGENTS; update links when moving files. Keep scripts tied to real implementation and verification. Verify file layout, local links, and script references after cleanup; no behavior tests are needed for documentation moves or removal of the dummy test.

Setup notes: pnpm 12.6.0 stalled on registry resolution in this environment, so 11.28.0 is pinned. Local verification used Node 24.19.0; that patch version and mise are not contributor requirements. Sandbox verification needs access to the user caches; do not work around it with project-local caches.

## LAYOUT-1: separate language tooling

As a contributor, I want each language's manifest, lockfile and dependencies inside its own directory, with neutral root commands for working on the whole project.

- **LAYOUT-AC1:** The root has no package.json, pnpm files or node_modules. The standalone `mermaid-trace-ts/` package retains its pinned tools and exact locked dependencies; Rust tooling stays in `mermaid-trace-rs/`.
- **LAYOUT-AC2:** Root `make build`, `make test`, `make typecheck`, `make snapshots-update`, `make native-build`, `make native-test` and `make preview ARGS='watch path --source'` replace the workspace aliases. Preview paths remain relative to the root and options pass through unchanged.
- **LAYOUT-AC3:** Frozen install does not change resolved dependencies; existing native/browser acceptance tests pass. Setup and diagnostic instructions describe the new commands.

Plan: move the lockfile and change only its importer path; remove the single-package workspace and root manifest. Use a small Makefile delegating to existing package/Cargo commands, invoking Corepack from the TS directory so it honors that package's pnpm pin. Relink the standalone dependencies, then remove only the obsolete root dependency directory. Keep source and artifact contracts unchanged. Verify the absent root target first, then frozen install, Make targets, typecheck, existing full suite and actual CLI help/preview. No synthetic toolchain test or new dependency.

Verification, 2026-09-26: `make -n test` initially failed because no root target existed. The standalone offline frozen install reused all 204 cached dependencies without changing the lockfile beyond its importer path. Dependency links now resolve within the TS directory; root language files/dependencies are absent. `make typecheck test build` passes all 6 Rust and 24 TypeScript/browser tests. Dry runs verify demo and snapshot delegation without rewriting baselines; `make preview ARGS='--help'` succeeds. The actual root-relative watch command serves both mapped native diagrams and the source pane at port 5174. Changed Markdown links and `git diff --check` pass.
