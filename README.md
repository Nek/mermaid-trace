# Mermaid Trace

Connect Mermaid source, its AST, and diagram elements so a visual selection can identify the exact source that produced it.

**Status:** native Rust/Merman flowchart, sequence, Gantt, journey, Kanban and state mapping, independent SVG activation, and a live Markdown/Mermaid CLI. Work is underway on `feat/merman-backend`; no Trace package or crate is published yet. TypeScript is selected, with Clojure-inspired functional design and a preference for individual thi.ng libraries.

**Required release scope:** source ↔ AST ↔ visual mapping for all built-in Mermaid diagram types, including experimental types and renderer variants. Rendering alone or whole-diagram fallback does not count as element support. The native preview maps flowchart node occurrences, connectors and labels, plus sequence participants, messages/labels, notes, activations and control blocks. Planning diagrams map Gantt tasks/labels/sections/title, journey tasks/scores/actors/sections/title, and Kanban columns/cards/labels/ticket/assignee/priority. State diagrams map declarations/references/aliases, individual repeated description rows, special/composite states, concurrency, transitions/labels, attached notes and frontmatter titles; native style/link/direction statements retain their source relationships. Other families currently have whole-diagram selection only; [the coverage checklist](docs/specs/diagram-coverage/spec.md) tracks the unfinished requirement.

## Products and boundaries

- **Mapping core:** source spans, AST identities, provenance, and bidirectional lookups. Independent of the DOM and file system.
- **Static SVG renderer:** accepts Mermaid source and produces a displayable SVG containing mapping data. The artifact needs no JavaScript or Mermaid runtime to display.
- **Interactivity library:** accepts an existing annotated inline SVG and adds selection, highlighting, and host callbacks. It does not parse or render Mermaid to activate that SVG.
- **Viewer/widget:** a small consumer combining an SVG, source view, and the interactivity library. Hosts can supply their own editor instead.

These are logical boundaries in one project, not a requirement for four packages. Rust supplies native core/rendering capabilities using the same artifact contract; the JavaScript interactivity library must accept compatible SVG from either implementation.

Markdown integration is part of initial delivery: markdown-it fence provenance and a unified mdast/hast document view, with VS Code preview hooks investigated early. Other targets include JavaScript applications and native Rust hosts. Multiuser editing is a later possibility, not part of the initial release.

## Repository layout

- `mermaid-trace-ts/`: TypeScript libraries, viewer, CLI, tests, package manifest, pnpm lockfile and dependencies. Its producer communicates with the Rust executable over JSON lines.
- `mermaid-trace-rs/`: Rust library/executable, Cargo lockfile and bootstrap for an exact commit of [our Merman fork](https://github.com/Nek/merman). The checkout lives in ignored `vendor/merman/`.
- `docs/`: shared requirements, contracts, roadmap and examples.

The root Makefile builds and tests Rust and TypeScript. Each language owns its manifest; pnpm and Cargo lockfiles pin their dependencies. Shared docs and artifact contracts govern both. See [native setup](docs/native-renderer.md).

## Documentation

| Document | Purpose |
|---|---|
| [Feature spec](docs/specs/source-mapping/spec.md) | User stories, observable acceptance criteria, scope, and unresolved decisions |
| [Artifact and integration contracts](docs/specs/source-mapping/contracts.md) | Static SVG, mapping integrity, and activation boundaries |
| [Markdown integration](docs/markdown-integration.md) | Renderer investigation, adapter choices, extraction mapping, and VS Code constraints |
| [Markdown provenance](docs/specs/markdown-provenance/spec.md) | markdown-it adapter and exact bidirectional original-document ranges |
| [Document selection](docs/specs/document-selection/spec.md) | Rendered Markdown blocks, headings, text drags and whole-diagram selection |
| [Merman migration](docs/specs/merman-backend/spec.md) | Native backend migration history |
| [Native sequence mapping](docs/specs/sequence-mapping/spec.md) | Exact sequence selection and future dynamic Rust/WASM rendering |
| [Diagram coverage](docs/specs/diagram-coverage/spec.md) | Required all-family coverage and release acceptance |
| [Watch CLI](docs/specs/watch-cli/spec.md) | Live Markdown/Mermaid preview without source or debug UI |
| [SVG activation](docs/specs/svg-activation/spec.md) | Browser API, selection policy, lifecycle and verification |
| [Native flowchart mapping](docs/specs/flowchart-mapping/spec.md) | Supported syntax, parser integration, experimental metadata, and verification |
| [SVG baselines](docs/specs/svg-baselines/spec.md) | Upstream fixtures, deterministic rendering, and verification |
| [Toolchain](docs/specs/toolchain/spec.md) | Pinned tools, setup contract, and verification |
| [Roadmap](docs/ROADMAP.md) | Milestones, dependencies, and completion evidence |
| [Design](docs/DESIGN.md) | Architecture and TypeScript/thi.ng implementation direction |
| [Agent guidance](AGENTS.md) | Entry point for project work and SDD routing |

The spec supersedes the initial `mermaid-source-mapping-requirements.md` draft and incorporates the subsequent language, library, and static-artifact decisions. Original input: the requirements file supplied in the project discussion; no external local path is required to use these documents.

## Development

Use Rust 1.95+ and Node.js 24.x, as declared in `mermaid-trace-ts/package.json` engines, installed however you prefer. pnpm 11.28.0 is selected by `packageManager`; TypeScript and Node types are locked dependencies. With Corepack available, run from the repository root:

Reference-baseline tests use the pinned, unmodified Mermaid npm release. `make test` fetches and builds the pinned native fork automatically; no separately prepared checkout is needed.

```sh
cd mermaid-trace-ts
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
cd ..
make test
```

Alternatively, use pnpm 11.28.0 directly. Corepack and pnpm use their standard user-level caches. No runtime version manager is required; `mermaid-trace-ts/mise.toml` is an ignored local preference.

`make typecheck` runs `tsc --noEmit`; `make build` builds the native executable and compiles TypeScript into `mermaid-trace-ts/dist/`; `make test` runs native integration tests and compares raw SVG against checked-in upstream baselines across three fresh Chromium processes. It also checks exact parser-derived source spans, metadata round-trips, unsupported input, invalid mappings, Markdown provenance and browser interaction. Tests never update expected output.

After building, run the saved-SVG and sequence interaction suites in Firefox from `mermaid-trace-ts/`:

```sh
TRACE_TEST_BROWSER=firefox node --test --test-concurrency=1 dist/test/svg-activation.test.js dist/test/sequence-activation.test.js
```

These suites default to Chromium. Install the pinned Firefox runtime with `corepack pnpm exec playwright install firefox` if needed. On macOS, the launcher isolates test application data without changing your Firefox profile or OS permissions. Tests use the real clipboard; run browser suites sequentially to avoid competing clipboard writes. Other suites have not yet adopted this browser selector.

To deliberately regenerate baselines after reviewing fixture or rendering changes:

```sh
make snapshots-update
```

The update command verifies three identical rendering passes before writing. Review the SVG and environment diff before committing. Mermaid, Playwright/Chromium, configuration, viewport, IDs, and packaged font are pinned; no SVG normalization is applied. Current references were verified on macOS ARM64. A different platform or rendering configuration fails the recorded-environment check and needs an explicit compatibility decision, not an automatic baseline refresh. See [baseline details and fixture attribution](docs/specs/svg-baselines/spec.md).

The production producer uses Merman’s native parser, preprocessing map and SVG identities. Rust embeds inert source/AST metadata in experimental `mermaid-trace/1` SVG. TypeScript activates saved artifacts and translates locations back to the original Markdown. Chromium remains test tooling for upstream SVG baselines and browser interaction.

## Watch a document

After the development setup above:

```sh
make preview ARGS='watch docs/examples/watch-preview.md'
# Optional source pane with synchronized native text selection:
make preview ARGS='watch docs/examples/watch-preview.md --source'
# Or a standalone Mermaid file:
make preview ARGS='watch /path/to/diagram.mmd --port 0'
```

Open the printed localhost URL. Saves and atomic replacements rerender and reload the page. Invalid Mermaid edits leave the last good preview visible and report the error in the terminal; a valid save recovers. Ctrl+C stops the server and watcher. The default port is 5173; use `--port N` if occupied, or `--port 0` to choose an available port.

By default, the page contains only rendered Markdown/diagrams and selection highlighting. Add `--source` for a read-only source pane: preview selections select and reveal the original text, and source selections highlight matching visuals. Normal Copy in that pane copies selected text. Click a block, diagram background, mapped node/connector/label, or finish a text drag to copy its source location. Focus selects; Enter/Space copies. Locations use the absolute input filename and one-based line/UTF-16 columns, with an exclusive end. Clipboard failures are reported in the browser console, without adding UI.

Use standard fenced `mermaid` blocks, as supported by Mermaid CLI and Markdown renderers. The existing markdown-it provenance adapter and CommonMark mdast/hast view preserve original file locations; relative images resolve beside the document. `.md`, `.markdown`, `.mmd`, and `.mermaid` inputs are supported. External Mermaid include syntax and GFM extensions are not introduced.

Flowchart nodes/references, connectors and labels, plus sequence participants, messages, notes, activations, boxes and nested controls select exact source ranges. Clicking copies the location immediately. Background activation selects the full fenced block. The CLI runs one native Rust process under Node and reuses its renderer across saves; it uses neither WASM nor Chromium. Other diagram families remain explicitly diagram-only until their native provenance is implemented. All-family mapping remains a release requirement.

Future browser rendering will compile the same Rust core to WASM, optionally in a Worker. Static SVG and separate activation remain available independently; see [BROWSER-1](docs/specs/sequence-mapping/spec.md#browser-1-future-dynamic-rust-browser-renderer).

The package declares a `mermaid-trace` executable for future installation. In this unpublished checkout, `make preview ARGS='watch /path/to/file.md'` builds and runs it; after `make build`, `node /absolute/path/to/mermaid-trace/mermaid-trace-ts/dist/src/cli.js watch /path/to/file.md` works from another directory. [WATCH-1](docs/specs/watch-cli/spec.md) records the contract and verification.

## Try the example document

```sh
make preview ARGS='watch docs/examples/interactive.md --source'
```

Open the printed localhost URL. The native preview renders [the example Markdown](docs/examples/interactive.md) with static SVGs and an optional read-only source pane. The browser loads only activation and coordinate modules; it does not load Mermaid or markdown-it. Diagram and Markdown selection, clipboard locations, native text dragging and source highlighting follow the [watch CLI behavior](#watch-a-document). Diagrams remain visible with JavaScript disabled.

`activateSvg(svg, { source, onSelect })` accepts a safe inline SVG and returns its decoded `mapping`, `highlight(ranges)`, `select(pieceId)` and `dispose()`. Source spans are zero-based UTF-16, end-exclusive. Labels select their label text; node groups prefer a declaration, then the first occurrence. `data-mt-selected` provides a styling hook. Activation supplies visible focus and selection styles. Dispose before replacing or changing an SVG; duplicate attachment rejects. Source-selection gestures suppress hyperlink navigation.

Diagram clicks and keyboard activation automatically copy the selected location, using one-based lines/UTF-16 columns with an exclusive end. Source-view selection does not overwrite the clipboard. Clipboard failures are logged in the browser console.

Keyboard focus is the diagram selection: Tab/Shift+Tab updates highlights, source and location while keeping focus in the diagram. Enter/Space copies the current location. Focus navigation alone does not overwrite the clipboard. Native text dragging inside SVG is disabled; rendered Markdown and source text remain normally selectable. Completing a rendered-text drag copies its source location.

Connectors have an invisible 12-pixel click target while activated. Clicking the line selects its connector syntax (`-->` or `-->|review|`); clicking just a label selects and highlights only that label. The same distinction applies to source-view highlighting. Disposal removes the extra hit targets, leaving the original static SVG intact.

Hosts own sanitization before insertion, document identity/revision and editor selection. Activation validates mappings but is not a sanitizer. `prepareMarkdown(document, namespace)` returns blocks and a synchronous renderer consuming trusted prepared SVGs. `toMarkdown` returns exact segments plus an enclosing editor range; `fromMarkdown` performs reverse lookup. Expanded indentation tabs that cannot be mapped exactly fail explicitly. The preview uses `renderMarkdownView(document, blocks, svgs)`, a CommonMark producer built on unified’s mdast/hast utilities. It sanitizes ordinary HTML before inserting trusted SVGs, retains block/text positions, and reuses markdown-it fence provenance. Entities, escapes and line endings map back to their original spelling; transformed text without exact correspondence is explicitly reported as an enclosing construct. Native drags retain their own highlight; source-view ranges identify the enclosing Markdown block and matching diagram elements. No arbitrary SVG upload UI, source editing, GFM plugin support or VS Code extension is included yet.

Follow [SDD.md](docs/SDD.md): select a ready delivery slice within the full requested scope, state its acceptance and brief plan, write a failing behavior test, implement and verify. Add a separate contract or test matrix only when it clarifies a real boundary. Read [SDD-PLANNING.md](docs/SDD-PLANNING.md) for planning and [SDD-DELIVERY.md](docs/SDD-DELIVERY.md) before implementation. Planned checks are not passing tests.
