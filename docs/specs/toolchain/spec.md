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
