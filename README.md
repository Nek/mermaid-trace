# Mermaid Trace

Connect Mermaid source, its AST, and diagram elements so a visual selection can identify the exact source that produced it.

**Status:** native Rust/Merman sequence mapping, independent SVG activation, and a live Markdown/Mermaid CLI. Work is underway on `feat/merman-backend`; no Trace package or crate is published yet. TypeScript is selected, with Clojure-inspired functional design and a preference for individual thi.ng libraries.

**Required release scope:** source ↔ AST ↔ visual mapping for all built-in Mermaid diagram types, including experimental types and renderer variants. Rendering alone or whole-diagram fallback does not count as element support. The native preview maps sequence participants, messages/labels, notes, activations and control blocks. Other families currently have whole-diagram selection only; [the coverage checklist](docs/specs/diagram-coverage/spec.md) tracks the unfinished requirement.

## Products and boundaries

- **Mapping core:** source spans, AST identities, provenance, and bidirectional lookups. Independent of the DOM and file system.
- **Static SVG renderer:** accepts Mermaid source and produces a displayable SVG containing mapping data. The artifact needs no JavaScript or Mermaid runtime to display.
- **Interactivity library:** accepts an existing annotated inline SVG and adds selection, highlighting, and host callbacks. It does not parse or render Mermaid to activate that SVG.
- **Viewer/widget:** a small consumer combining an SVG, source view, and the interactivity library. Hosts can supply their own editor instead.

These are logical boundaries in one project, not a requirement for four packages. Rust supplies native core/rendering capabilities using the same artifact contract; the JavaScript interactivity library must accept compatible SVG from either implementation.

Markdown integration is part of initial delivery: markdown-it fence provenance and a unified mdast/hast document view, with VS Code preview hooks investigated early. Other targets include JavaScript applications and native Rust hosts. Multiuser editing is a later possibility, not part of the initial release.

## Repository layout

- `mermaid-trace-ts/`: TypeScript libraries, viewer, CLI, tests and package manifest. Its producer communicates with the Rust executable over JSON lines.
- `mermaid-trace-rs/`: Rust library/executable, Cargo lockfile and a pinned Merman source patch. The upstream checkout is generated into ignored `vendor/merman/`.
- `docs/`: shared requirements, contracts, roadmap and examples.

Root commands build Rust and TypeScript. Each language owns its manifest; pnpm and Cargo lockfiles pin their dependencies. Shared docs and artifact contracts govern both. See [native setup](docs/native-renderer.md).

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
| [SVG activation and demo](docs/specs/svg-activation/spec.md) | Browser API, selection policy, lifecycle and verification |
| [Flowchart mapping proof](docs/specs/flowchart-mapping/spec.md) | Supported syntax, parser integration, experimental metadata, and verification |
| [Mermaid fork](docs/specs/mermaid-fork/spec.md) | Explicit render API, local fork setup, upstream patch and verification |
| [SVG baselines](docs/specs/svg-baselines/spec.md) | Upstream fixtures, deterministic rendering, and verification |
| [Toolchain](docs/specs/toolchain/spec.md) | Pinned tools, setup contract, and verification |
| [Roadmap](docs/ROADMAP.md) | Milestones, dependencies, and completion evidence |
| [Design](docs/DESIGN.md) | Architecture and TypeScript/thi.ng implementation direction |
| [Agent guidance](AGENTS.md) | Entry point for project work and SDD routing |

The spec supersedes the initial `mermaid-source-mapping-requirements.md` draft and incorporates the subsequent language, library, and static-artifact decisions. Original input: the requirements file supplied in the project discussion; no external local path is required to use these documents.

## Development

Use Rust 1.95+ and Node.js 24.x, as declared in `package.json` engines, installed however you prefer. pnpm 11.28.0 is selected by `packageManager`; TypeScript and Node types are locked dependencies. With Corepack available, run from the repository root:

For historical flowchart reference tests, first build the sibling Mermaid fork using the [fork setup instructions](docs/specs/mermaid-fork/spec.md#local-setup). Mapping tests use `../mermaid/packages/mermaid/dist/mermaid.min.js`; set `MERMAID_TRACE_BUNDLE` to use another checkout. Reference-baseline tests continue to use the pinned, unmodified npm release.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --dir mermaid-trace-ts exec playwright install chromium
corepack pnpm test
```

Alternatively, use pnpm 11.28.0 directly. Corepack and pnpm use their standard user-level caches. No runtime version manager is required; `mise.toml` is an ignored local preference.

`typecheck` runs `tsc --noEmit`; `build` builds the native executable and compiles TypeScript into `mermaid-trace-ts/dist/`; `test` runs native integration tests and compares raw SVG against checked-in upstream baselines across three fresh Chromium processes. It also checks exact parser-derived source spans, metadata round-trips, unsupported input, invalid mappings, Markdown provenance and browser interaction. Tests never update expected output.

To deliberately regenerate baselines after reviewing fixture or rendering changes:

```sh
corepack pnpm snapshots:update
```

The update command verifies three identical rendering passes before writing. Review the SVG and environment diff before committing. Mermaid, Playwright/Chromium, configuration, viewport, IDs, and packaged font are pinned; no SVG normalization is applied. Current references were verified on macOS ARM64. A different platform or rendering configuration fails the recorded-environment check and needs an explicit compatibility decision, not an automatic baseline refresh. See [baseline details and fixture attribution](docs/specs/svg-baselines/spec.md).

The production producer uses Merman’s native parser, preprocessing map and SVG identities. Rust embeds inert source/AST metadata in experimental `mermaid-trace/1` SVG. TypeScript activates saved artifacts and translates locations back to the original Markdown. Chromium and the earlier Mermaid fork remain reference test tooling.

## Watch a document

After the development setup above:

```sh
corepack pnpm preview watch docs/examples/watch-preview.md
# Optional source pane with synchronized native text selection:
corepack pnpm preview watch docs/examples/watch-preview.md --source
# Or a standalone Mermaid file:
corepack pnpm preview watch /path/to/diagram.mmd --port 0
```

Open the printed localhost URL. Saves and atomic replacements rerender and reload the page. Invalid Mermaid edits leave the last good preview visible and report the error in the terminal; a valid save recovers. Ctrl+C stops the server and watcher. The default port is 5173; use `--port N` if occupied, or `--port 0` to choose an available port.

By default, the page contains only rendered Markdown/diagrams and selection highlighting. Add `--source` for a read-only source pane: preview selections select and reveal the original text, and source selections highlight matching visuals. Normal Copy in that pane copies selected text. Click a block, diagram background, mapped node/connector/label, or finish a text drag to copy its source location. Focus selects; Enter/Space copies. Locations use the absolute input filename and one-based line/UTF-16 columns, with an exclusive end. Clipboard failures are reported in the browser console, without adding UI.

Use standard fenced `mermaid` blocks, as supported by Mermaid CLI and Markdown renderers. The existing markdown-it provenance adapter and CommonMark mdast/hast view preserve original file locations; relative images resolve beside the document. `.md`, `.markdown`, `.mmd`, and `.mermaid` inputs are supported. External Mermaid include syntax and GFM extensions are not introduced.

Sequence participants, message connectors and labels, notes, activations, boxes and nested controls select exact source ranges. Clicking copies the location immediately. Background activation selects the full fenced block. The CLI runs one native Rust process under Node and reuses its renderer across saves; it uses neither WASM nor Chromium. Other diagram families remain explicitly diagram-only until their native provenance is implemented. All-family mapping remains a release requirement.

Future browser rendering will compile the same Rust core to WASM, optionally in a Worker. Static SVG and separate activation remain available independently; see [BROWSER-1](docs/specs/sequence-mapping/spec.md#browser-1-future-dynamic-rust-browser-renderer).

The package declares a `mermaid-trace` executable for future installation. In this unpublished checkout, `preview` builds and runs it; after `pnpm build`, `node /absolute/path/to/mermaid-trace/mermaid-trace-ts/dist/src/cli.js watch /path/to/file.md` works from another directory. [WATCH-1](docs/specs/watch-cli/spec.md) records the contract and verification.

## Try the Markdown demo

```sh
corepack pnpm demo
```

Open the local URL printed by Vite. The command renders [the example Markdown](docs/examples/interactive.md) once and generates a page containing static SVGs. The browser loads only the interaction/coordinate modules; it does not load Mermaid or markdown-it. Click a node, edge or label (or focus it and press Enter/Space) to select its original Markdown. Click diagram background to select its whole fenced block. Click prose/code/list blocks to select their source; click a heading to select only that heading, including its Markdown syntax. Drag rendered text to select characters across formatting or blocks. Occurrence buttons expose repeated references; selecting text highlights matching visuals. The source view is readonly. Its selected range stays visibly highlighted while focus remains in the preview, and the selection start is scrolled into view. The source pane uses a real native text selection in a frame containing only source text and styles, so source and rendered-text selections can coexist. There is no overlay or synchronized text mirror. Diagrams remain visible with JavaScript disabled.

`activateSvg(svg, { source, onSelect })` accepts a safe inline SVG and returns its decoded `mapping`, `highlight(ranges)`, `select(pieceId)` and `dispose()`. Source spans are zero-based UTF-16, end-exclusive. Labels select their label text; node groups prefer a declaration, then the first occurrence. `data-mt-selected` provides a styling hook. The demo supplies visible focus and selection styles. Dispose before replacing or changing an SVG; duplicate attachment rejects. Source-selection gestures suppress hyperlink navigation.

Diagram clicks, keyboard activation and occurrence choices automatically copy the selected location, for example `interactive.md:18:10-18:15`. The visible location uses one-based lines/UTF-16 columns with an exclusive end. Source-view selection updates the location without overwriting the clipboard. If the browser denies clipboard access, the demo reports it and keeps the location selectable for manual copying.

Keyboard focus is the diagram selection: Tab/Shift+Tab updates highlights, source and location while keeping focus in the diagram. Enter/Space copies the current location. Focus navigation alone does not overwrite the clipboard. Native text dragging inside SVG is disabled; rendered Markdown and source text remain normally selectable. Completing a rendered-text drag copies its source location.

Connectors have an invisible 12-pixel click target while activated. Clicking the line selects its connector syntax (`-->` or `-->|review|`); clicking just a label selects and highlights only that label. The same distinction applies to source-view highlighting. Disposal removes the extra hit targets, leaving the original static SVG intact.

Hosts own sanitization before insertion, document identity/revision and editor selection. Activation validates mappings but is not a sanitizer. `prepareMarkdown(document, namespace)` returns blocks and a synchronous renderer consuming trusted prepared SVGs. `toMarkdown` returns exact segments plus an enclosing editor range; `fromMarkdown` performs reverse lookup. Expanded indentation tabs that cannot be mapped exactly fail explicitly. The demo uses `renderMarkdownView(document, blocks, svgs)`, a CommonMark producer built on unified’s mdast/hast utilities. It sanitizes ordinary HTML before inserting trusted SVGs, retains block/text positions, and reuses markdown-it fence provenance. Entities, escapes and line endings map back to their original spelling; transformed text without exact correspondence is explicitly reported as an enclosing construct. Native drags retain their own highlight; source-view ranges identify the enclosing Markdown block and matching diagram elements. No arbitrary SVG upload UI, source editing, GFM plugin support or VS Code extension is included yet.

Follow [SDD.md](docs/SDD.md): select one ready story, define its contracts and plan, derive tests, implement, verify, and record results. Read [SDD-PLANNING.md](docs/SDD-PLANNING.md) for planning and [SDD-DELIVERY.md](docs/SDD-DELIVERY.md) before implementation. Planned checks are not passing tests.
