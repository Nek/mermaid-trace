# Mermaid Trace

Connect Mermaid source, its AST, and diagram elements so a visual selection can identify the exact source that produced it.

**Status:** experimental flowchart source-mapping proof with static SVG metadata and an independent reader. No viewer, published package, or Rust crate yet. TypeScript is selected, with Clojure-inspired functional design and a preference for individual thi.ng libraries.

## Products and boundaries

- **Mapping core:** source spans, AST identities, provenance, and bidirectional lookups. Independent of the DOM and file system.
- **Static SVG renderer:** accepts Mermaid source and produces a displayable SVG containing mapping data. The artifact needs no JavaScript or Mermaid runtime to display.
- **Interactivity library:** accepts an existing annotated inline SVG and adds selection, highlighting, and host callbacks. It does not parse or render Mermaid to activate that SVG.
- **Viewer/widget:** a small consumer combining an SVG, source view, and the interactivity library. Hosts can supply their own editor instead.

These are logical boundaries in one project, not a requirement for four packages. Rust will provide native core/rendering capabilities using the same artifact contract; the JavaScript interactivity library must accept compatible SVG from either implementation.

Markdown integration is part of initial delivery: markdown-it first, unified/remark/rehype next, with VS Code preview hooks investigated early. Other targets include JavaScript applications and native Rust hosts. Multiuser editing is a later possibility, not part of the initial release.

## Documentation

| Document | Purpose |
|---|---|
| [Feature spec](docs/specs/source-mapping/spec.md) | User stories, observable acceptance criteria, scope, and unresolved decisions |
| [Artifact and integration contracts](docs/specs/source-mapping/contracts.md) | Static SVG, mapping integrity, and activation boundaries |
| [Markdown integration](docs/markdown-integration.md) | Renderer investigation, adapter choices, extraction mapping, and VS Code constraints |
| [Flowchart mapping proof](docs/specs/flowchart-mapping/spec.md) | Supported syntax, parser integration, experimental metadata, and verification |
| [Mermaid fork](docs/specs/mermaid-fork/spec.md) | Explicit render API, local fork setup, upstream patch and verification |
| [SVG baselines](docs/specs/svg-baselines/spec.md) | Upstream fixtures, deterministic rendering, and verification |
| [Toolchain](docs/specs/toolchain/spec.md) | Pinned tools, setup contract, and verification |
| [Roadmap](docs/ROADMAP.md) | Milestones, dependencies, and completion evidence |
| [Design](docs/DESIGN.md) | Architecture and TypeScript/thi.ng implementation direction |
| [Agent guidance](AGENTS.md) | Entry point for project work and SDD routing |

The spec supersedes the initial `mermaid-source-mapping-requirements.md` draft and incorporates the subsequent language, library, and static-artifact decisions. Original input: the requirements file supplied in the project discussion; no external local path is required to use these documents.

## Development

Use Node.js 24.x, as declared in `package.json` engines, installed however you prefer. pnpm 11.28.0 is selected by `packageManager`; TypeScript and Node types are locked dependencies. With Corepack available, run from the repository root:

First build the sibling Mermaid fork using the [fork setup instructions](docs/specs/mermaid-fork/spec.md#local-setup). Mapping tests use `../mermaid/packages/mermaid/dist/mermaid.min.js`; set `MERMAID_TRACE_BUNDLE` to use another checkout. Reference-baseline tests continue to use the pinned, unmodified npm release.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
corepack pnpm test
```

Alternatively, use pnpm 11.28.0 directly. Corepack and pnpm use their standard user-level caches. No runtime version manager is required; `mise.toml` is an ignored local preference.

`typecheck` runs `tsc --noEmit`; `build` compiles the reference-rendering harness and tests into `dist/`; `test` builds and compares raw SVG against checked-in upstream baselines across three fresh Chromium processes. It also checks exact parser-derived source spans, metadata round-trips, unsupported input and invalid mappings. Tests never update expected output.

To deliberately regenerate baselines after reviewing fixture or rendering changes:

```sh
corepack pnpm snapshots:update
```

The update command verifies three identical rendering passes before writing. Review the SVG and environment diff before committing. Mermaid, Playwright/Chromium, configuration, viewport, IDs, and packaged font are pinned; no SVG normalization is applied. Current references were verified on macOS ARM64. A different platform or rendering configuration fails the recorded-environment check and needs an explicit compatibility decision, not an automatic baseline refresh. See [baseline details and fixture attribution](docs/specs/svg-baselines/spec.md).

The producer calls the fork's explicit `mermaid.render(..., { sourceMap: true })` option; it does not intercept private parser methods. Removing our metadata recovers the original SVG bytes. See the [annotated SVG example](docs/examples/repeated-labels.svg). Activation and Markdown adapters remain unimplemented. The render API and artifact format are experimental; see the fork spec for supported input and limitations.

Follow [SDD.md](docs/SDD.md): select one ready story, define its contracts and plan, derive tests, implement, verify, and record results. Read [SDD-PLANNING.md](docs/SDD-PLANNING.md) for planning and [SDD-DELIVERY.md](docs/SDD-DELIVERY.md) before implementation. Planned checks are not passing tests.
