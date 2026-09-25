# MAP-1: flowchart source provenance in static SVG

Status: implemented and verified on 2026-09-26. Scope: prove parser → source → SVG for the existing flowchart fixtures, before a public renderer API.

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

- [Parser adapter](../../../src/flowchart-source.ts): isolated Jison reductions become source-occurrence projections; no Mermaid/Markdown fork or copied grammar. Native arrays, Maps and WeakMaps suffice for this slice; no additional dependencies were added.
- [SVG writer/reader](../../../src/svg-mapping.ts): DOM identity checks plus insertion into original start tags preserve raw SVG bytes. The independent reader imports no renderer and verifies spans, IDs, element identity and optional external source.
- TDD: tests first failed on the missing mapping path. A further negative test exposed acceptance of a mismatched node DOM identity; it failed before the validation fix and passes afterward.
- All six integration tests pass: four mapping tests and two unchanged reference tests. All four original SVG baselines are unchanged. CRLF/comment/astral-Unicode offsets and duplicate node/edge labels have independently specified expected ranges. Saved SVG was read in a new page without Mermaid; invalid payload, out-of-bounds range, unknown reference, wrong DOM identity, stale source and unsupported syntax were rejected.
- [Annotated example](../../examples/repeated-labels.svg) contains the exact Mermaid source and mapped pieces. It is generated from the existing repeated-label fixture; stripping only `data-mt-*` attributes recovers the original reference bytes.

Current lifecycle: one fresh Mermaid page per artifact, as in the reference harness. The bootstrap uses `getDiagramFromText` to load the flowchart definition, which has Mermaid's normal shared registry effects. This adapter is not a reentrant wrapper for an application concurrently using that registry. The capture itself uses separate parser/DB objects. Repeated rendering on a reused page and nondefault render configuration require a later integration story.

The adapter recognizes named grammar symbols, supported node delimiters and arrow semantics, without hardcoded production numbers. It still depends on private Jison/FlowDB interfaces in the pinned Mermaid release; upgrades must rerun and review the integration tests. This is a feasibility proof, not a supported upstream source-location API or a stable public package API. URI-encoded root metadata is deliberately simple and can be larger than the diagram; payload compaction belongs to the format-v1 decision.
