# FORK-1: explicit flowchart source mappings

Status: implemented, verified and published to [Nek/mermaid](https://github.com/Nek/mermaid/tree/feat/flowchart-source-mappings), 2026-09-26.

As an embedding developer, I want Mermaid to return source mappings with its rendered SVG, so that Mermaid Trace can remove runtime interception of private parser actions.

## Scope and decisions

Maintain a small fork at `../mermaid`, based on upstream `develop` at `69778e6e995cd72c6cb524449d8e08ee3d231628`. The local `origin` points to `Nek/mermaid`, and `upstream` points to `mermaid-js/mermaid`. Do not publish an upstream proposal in this story.

Upstream's agentflow diagram already records grammar locations and uses shared preprocessing hooks. Its line-offset approach does not establish exact original UTF-16 offsets through all transformations. Reuse its pattern of explicit grammar-to-DB calls, while keeping flowchart provenance separate. [PR 8294](https://github.com/mermaid-js/mermaid/pull/8294) supplies language syntax metadata, not rendered occurrence mappings; the inspected proposals do not replace this story.

Add optional `{ sourceMap: true }` as the fourth `mermaid.render` argument. Return `sourceMap` only when requested: exact original `source` plus node/edge occurrences with semantic/visual identities, end-exclusive UTF-16 spans and optional label spans. Multiple references to one node remain separate. Capture locations in grammar actions, without replacing parser methods at runtime. Mermaid Trace owns SVG serialization and interaction.

Support ordinary flowcharts with comments, CRLF, plain/quoted labels and nested groups. Explicitly reject unsupported preprocessing (frontmatter, directives, HTML/entities/Markdown labels) and shape metadata for mapped renders. Group/style/title occurrences are outside this projection. Normal renders retain their existing syntax and behavior. Mapping failures throw; never return guessed or partially shifted spans.

## Acceptance and plan

| ID | Observable acceptance | Check | Status |
|---|---|---|---|
| FORK-AC1 | Original-source node/edge/label selections remain exact through comments, CRLF, Unicode, repeated references and closing-brace whitespace normalization | Native parser tests with independent spans | Passed |
| FORK-AC2 | Mapped render returns matching identities; unmapped render omits metadata and retains ordinary output | Public API/browser tests; unmodified fork baseline comparison | Passed |
| FORK-AC3 | Unsupported input/diagram throws; mapping state does not leak between renders | Negative and repeated-render tests | Passed |
| FORK-AC4 | Mermaid Trace consumes render-result data without private parser hooks; saved SVG still reads without Mermaid | Existing mapping suite against fork | Passed |

Write failing native tests, implement source provenance and the opt-in render contract, run existing flowchart/parser/API tests, then build and exercise the actual browser artifact. Keep released Mermaid reference baselines unchanged; upstream development output is compared against its own unmodified build. Replace Trace's adapter only after the fork contract passes. Document reproducible local setup and commit each verified repository change atomically. The clickable Markdown demonstration follows this producer story.

## Implementation and verification

Mermaid commit: [`f938745`](https://github.com/Nek/mermaid/commit/f9387456a1e27315e325ada0d8a1cc583ecdf95b) on `feat/flowchart-source-mappings`. It includes native grammar provenance, the opt-in render API, tests, usage documentation and a changeset. The remote branch was verified to match the tested local commit. No upstream issue or PR was published.

- TDD: native tests failed on missing mapping methods; API tests failed on missing opt-in behavior; the browser contract failed against the unmodified build because `sourceMap` was absent. All pass with the patch.
- Upstream checks: 1,119 tests passed, 3 existing tests skipped across flowchart, Diagram, Mermaid API, preprocessing and comment suites. Full bundle and declaration builds passed; touched-file ESLint passed with existing warnings; all Jison grammars passed the conflict/lint check. No full-repository browser suite was run.
- Trace checks: all 7 integration tests and typechecking passed. Tests explicitly make private `mermaidAPI` access throw while rendering mapped fixtures. Saved SVG decodes without Mermaid.
- All four raw SVG fixtures were byte-identical between the unmodified `69778e6` build and the patched build, and the existing npm-release baselines remain unchanged. Verification used the pinned Chromium on macOS ARM64.

The fork maps native node forms rather than recognizing a small list of grammar reductions. Trace still rejects repeated explicit label declarations for one node until a selection policy is defined. The serialized SVG remains format 0. This API is a fork proposal, not an upstream-supported interface.

## Local setup

The current checkout at `../mermaid` is already built. To reproduce it elsewhere, run from the Trace repository root, with no existing sibling `mermaid` directory:

```sh
git clone --branch feat/flowchart-source-mappings https://github.com/Nek/mermaid.git ../mermaid
git -C ../mermaid switch --detach f9387456a1e27315e325ada0d8a1cc583ecdf95b
cd ../mermaid
corepack pnpm install --frozen-lockfile
```

Mermaid's install `prepare` script builds the bundles and declarations. For subsequent edits, run `corepack pnpm build` in the fork. Each repository declares its own pnpm version; ensure `pnpm` on PATH honors `packageManager` (Corepack shims do this), since upstream scripts invoke `pnpm` internally. Do not change either lockfile to make the versions match.

Return to the Trace root and run `make test`. An alternate checkout can be selected with `MERMAID_TRACE_BUNDLE=/absolute/path/to/mermaid.min.js`. This path belongs to the test harness only; the browser producer accepts a Mermaid instance supplied by its caller. No published fork package is required for local development.

An upstream discussion and PR remain later steps; they should disclose AI assistance and focus on the small source-map API. The viewer remains in Trace. The temporary portable patch was removed after publishing the fork; the pinned commit above is the reproducible source.
