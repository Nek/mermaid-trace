# MAP-1: flowchart source provenance in static SVG

Status: original proof implemented and verified on 2026-09-26. Its private-parser adapter has since been replaced by [FORK-1](../mermaid-fork/spec.md). The findings below record the original experiment; the fork spec describes the current producer and supported input. The SVG format and reader remain in use.

## Findings and decision

Mermaid 12's Jison parser has UTF-16 reduction ranges, but FlowDB discards them. Create an isolated parser and FlowDB from the already loaded flowchart implementation, enable ranges, and capture vertex/link reductions and their semantic identities. Reuse Mermaid's grammar and layout; no parser fork, copied grammar, or label-text search. Do not install hooks on Mermaid's shared parser/database; instrument newly constructed instances only.

Mermaid normalizes CR/CRLF and removes line comments. Prepare the same logical input with an explicit original-offset map, then parse it directly to avoid the flowParser wrapper's additional whitespace rewrite. Reject unsupported preprocessing and syntax explicitly. Match visual elements using FlowDB node DOM IDs and layout edge IDs, never visible text or element order.

Supported initial subset: ASCII node IDs, bare references, square/round/diamond nodes, single-line plain or quoted labels, `-->` with optional pipe label, chained/parallel edges, ordinary nested subgraphs and accessibility title/description. Group/title visuals remain unmapped. More than one explicit label declaration for one node, HTML/Markdown labels, entities, frontmatter/directives, styling/click statements, shape metadata, other shapes/arrows, and compound node lists are unsupported in this slice.

## Contract and acceptance

`traceFlowchart` returns immutable-by-convention source occurrence projections, not a full grammar AST. Each piece has a stable ID within the result, kind, semantic identity, exact source span and optional label span; edges retain endpoints. Repeated references remain separate pieces. Coordinates are zero-based UTF-16 offsets, end-exclusive, in the original Mermaid input. CRLF and comments must not shift selections.

Experimental format `mermaid-trace/0`: root `data-mt-map` contains URI-encoded JSON with exact source and projections. Mapped node/edge and label tags carry `data-mt-refs`, `data-mt-role`, `data-mt-start`, and `data-mt-end`. A node's explicit label declaration is primary, otherwise its first reference; all occurrences remain discoverable. Edge spans select the arrow/label syntax. Format 0 is not a stable public wire format.

The SVG writer adds attributes without reserializing existing markup. Removing only those attributes must recover the raw baseline bytes. The independent reader validates format, spans, unique IDs and element references against the embedded source. Source supplied by a host must match exactly. Invalid or unsupported input throws an explicit diagnostic; no partial map is returned. These functions do not sanitize SVG insertion.

| ID | Acceptance / check | Status |
|---|---|---|
| MAP-AC1 | Parser-derived node/edge/label slices match independent expectations; repeated labels/references and CRLF/Unicode/comments covered | Passed, 2026-09-26 |
| MAP-AC2 | Annotate each reference fixture; removal of our attributes equals its unchanged baseline byte-for-byte | Passed, 2026-09-26 |
| MAP-AC3 | Save/reload SVG in a fresh consumer page without Mermaid; recover matching pieces/source; reject malformed metadata, references, bounds and stale external source | Passed, 2026-09-26 |
| MAP-AC4 | Unsupported syntax fails explicitly; tracing does not alter subsequent reference rendering or shared parser state | Passed, 2026-09-26 |

## Plan

Write failing integration tests first. Add a browser adapter for isolated parser tracing and a renderer-independent SVG metadata module, then exercise both through the existing pinned browser harness. Reuse baseline fixtures unchanged. Validate exact source ranges independently, round-trip saved artifacts, and byte-preserving annotation. Update docs and commit the verified slice. Markdown translation, activation, group mapping, general AST editing and stable format v1 remain later work.

Source inspection used the installed Mermaid 12.0.0 source map: `flow.jison`, `flowParser.ts`, `flowDb.ts`, `flowRenderer-v3-unified.ts`, `preprocess.ts`, and `diagram-api/comments.ts`. Upstream commit and MIT notice are recorded in the [baseline spec](../svg-baselines/spec.md); the small comment-cleanup rule follows that MIT-licensed implementation.

## Implementation and verification

- Original adapter: isolated Jison reductions became source-occurrence projections. [The current adapter](../../../mermaid-trace-ts/src/flowchart-source.ts) instead consumes the fork's explicit render result, with no private parser access.
- [SVG writer/reader](../../../mermaid-trace-ts/src/svg-mapping.ts): DOM identity checks plus insertion into original start tags preserve raw SVG bytes. The independent reader imports no renderer and verifies spans, IDs, element identity and optional external source.
- TDD: tests first failed on the missing mapping path. A further negative test exposed acceptance of a mismatched node DOM identity; it failed before the validation fix and passes afterward.
- All six integration tests pass: four mapping tests and two unchanged reference tests. All four original SVG baselines are unchanged. CRLF/comment/astral-Unicode offsets and duplicate node/edge labels have independently specified expected ranges. Saved SVG was read in a new page without Mermaid; invalid payload, out-of-bounds range, unknown reference, wrong DOM identity, stale source and unsupported syntax were rejected.
- [Annotated example](../../examples/repeated-labels.svg) contains the exact Mermaid source and mapped pieces. It is generated from the existing repeated-label fixture; stripping only `data-mt-*` attributes recovers the original reference bytes.

Original lifecycle: one fresh Mermaid page per artifact, using `getDiagramFromText` to load the flowchart definition. FORK-1 removes this bootstrap and uses Mermaid's queued public render API; repeated mapped and unmapped renders are now tested.

The original adapter recognized named grammar symbols, node delimiters and arrow semantics rather than hardcoded production numbers. FORK-1 moves provenance into Mermaid's grammar and database. Neither the fork API nor format 0 is a stable upstream contract. URI-encoded root metadata can be larger than the diagram; compaction belongs to the format-v1 decision.

## MAP-NATIVE-1: restore flowchart behavior in Rust

Ready regression story: as an existing preview user, I want flowchart node/reference, connector and label selections to survive the native renderer migration. All-family coverage stays mandatory for release; this story restores previously working behavior.

- **MAP-NATIVE-AC1:** Existing flowchart fixtures and graph/flowchart syntax retain exact original node/reference, arrow and label spans, endpoints and distinct parallel/chained edge identities. CRLF, comments, Unicode, quoted labels and nested groups preserve coordinates. Node occurrences remain separate; the explicit label declaration is primary for clicking its visual, otherwise the first reference.
- **MAP-NATIVE-AC2:** Native SVG embeds inert mappings and renderer-owned identities. Saved artifacts activate without any producer; node shapes, node labels, connectors (including unlabelled ones), edge labels, background and reverse source selections keep the established behavior. Annotation does not alter visual rendering.
- **MAP-NATIVE-AC3:** The production watch route uses Rust for mapped flowcharts and sequences. Optional source selection, copied original Markdown locations and save/reload remain correct. Existing flowchart assertions remain requirements, never expected absence.

Plan: reuse Merman's grammar locations, existing AST/build and semantic identities. Retain all node occurrences before semantic merging and capture each link segment's range in the grammar; carry these in parser-owned render context through the existing preprocessing map. Bind renderer-owned node/edge/label identities and reuse Trace's artifact/activation/Markdown machinery. Reuse the established primary-occurrence policy. Extend the pinned source patch; no parallel parser, text matching, browser producer fallback or new dependency. Tests first: restored preview assertion, native range/fixture tests, saved SVG interactions and real watch/source/clipboard behavior.

Verification, 2026-09-26: the missing native node/edge projections and original preview assertion failed before implementation. Three native flowchart tests verify exact original/UTF-16 ranges, repeated occurrences, four unchanged upstream-derived fixtures, preprocessing, chains, nested groups, deterministic SVG and byte-identical rendering after removing inert metadata. The production Chromium test verifies shape/label/unlabelled connector clicks, clipboard locations in a nested Markdown fence, reverse source selection, full-background selection and save/reload. Existing sequence and source-pane acceptance tests remain mandatory. The upstream flowchart/sequence provenance tests and 192 upstream flowchart checks pass; generated parsers verify. A fresh pinned archive applies the combined patch and reproduces all changed native files byte-for-byte.

This restores the formerly working node/edge projection; it does not complete flowchart conformance. Group/title/style pieces, broader syntax and alternate renderers remain in the all-family release gate. Multiple explicit labels on one node retain the established explicit rejection. The full suite passes: 6 Rust and 24 TypeScript/browser tests, plus TypeScript typechecking and Rust formatting checks. No working feature test was relaxed.

Live preview verification: port 5174 was restarted with the rebuilt native producer and `--source`. In-app keyboard activation of `review` copied `watch-preview.md:7:16-7:22`; the unlabelled A→C connector copied `watch-preview.md:9:5-9:8`. Both visibly selected the matching original source. Pointer gestures are covered by the production Chromium regression above.

## FLOW-2: complete flowchart-family coverage

Ready story, 2026-09-27: as an author, I want every source-backed flowchart visual and label to retain exact provenance and interaction, across the native family’s valid syntax and renderers. Scope includes all node shapes and shape-data values, repeated/replaced declarations, grouped/chained/parallel/self edges and IDs, nested/anonymous/empty/reopened subgraphs, titles, classes/styles/links/directions/accessibility, Markdown/HTML/math labels, configuration and Dagre/ELK variants. Preserve existing behavior; full coverage remains incomplete until this inventory passes.

- **FLOW-AC4:** Native accumulation retains every authored occurrence and the effective displayed label’s source. Subgraph frames select their complete block; titles select their authored payload. Empty/generated visuals have explicit classifications, never invented spans.
- **FLOW-AC5:** All 1,158 pinned upstream flowchart fixtures render through the production native path, with every source-backed semantic visual and label mapped and mapped/plain SVG equality. Independent exact-range cases and renderer/configuration cases cover the inventory; no excluded fixtures or text/ordinal reconstruction.
- **FLOW-AC6:** Saved SVG and nested Markdown support pointer/keyboard/reverse selection, clipboard locations, optional source, isolation, saves and invalid-input recovery for the full inventory. Existing family acceptance remains mandatory.

Plan: audit the native grammar, semantic builder and render boundaries against the pinned corpus. Start with failing subgraph-frame/title and frontmatter-title tests; capture block spans in grammar and title selections in the existing lexer, export occurrences where the native subgraph ID is assigned, and bind at cluster/title emission. Then close shape-data, repeated-label, directive and alternate-renderer gaps using failing exact-range and corpus cases. Reuse preprocessing evidence, projection and activation; no new parser, label matching or dependency. Each verified atomic change includes its acceptance evidence; it does not mark FLOW-2 complete early.

Delivery order for the active existing-family goal: finish FLOW-2, then complete sequence, Gantt, journey and Kanban inventories. State acceptance remains mandatory throughout.
