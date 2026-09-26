# Feature: source-mapped Mermaid diagrams

Status: behavioral baseline; the [MAP-1 proof](../flowchart-mapping/spec.md), [MD-1 adapter](../markdown-provenance/spec.md) and [ACT-1 demo](../svg-activation/spec.md) implement experimental flowchart/Markdown slices. All built-in Mermaid diagram types are required for the first usable release. The current slices are feasibility evidence, not completed product coverage. Per-type implementation stories need a plan before coding; see [diagram coverage](../diagram-coverage/spec.md). Contracts live in [contracts.md](contracts.md); milestones live in [ROADMAP.md](../../ROADMAP.md).

## Problem, users, and goals

Diagram readers and editor users need to identify the source behind a visual element. Library authors need a reusable source ↔ AST ↔ visual mapping without coupling their application to a particular viewer or file-reading workflow.

Produce static annotated SVG first, then provide optional interaction that works on that artifact. Markdown adapters are part of initial delivery; the first browser demonstration uses real Markdown input. See the [integration investigation](../../markdown-integration.md). Support labels, nodes, cards, links, and equivalent source-backed pieces across every built-in Mermaid diagram type, including syntax and renderer variants in the selected Mermaid version. Preserve provenance rather than guessing locations from repeated display text.

## Constraints and non-goals

- One TypeScript host/activation implementation, with Clojure-inspired data transformations and thi.ng preferred as described in [DESIGN.md](../../DESIGN.md). Merman supplies the Rust rendering core through a native Node binding. Trace-owned Rust integration belongs in `mermaid-trace-rs/`; TypeScript lives in `mermaid-trace-ts/`.
- Core/rendering accept source text; the host owns document paths, Markdown extraction provenance, and source-file access.
- All built-in Mermaid diagram types are mandatory release scope, not a later extension. The flowchart subset is an implementation slice only. Rendering or whole-diagram fallback does not establish element mapping support. Unsupported syntax must be reported; it must not produce confident but incorrect mappings.
- No collaboration, CRDTs, visual source rewriting, AST mutation API, round-trip formatter, complete IDE, or production VS Code extension in the initial release.
- No custom Mermaid parser/layout engine unless feasibility proves reuse unsuitable. SVG serialization libraries alone do not establish Mermaid support.

## User stories and acceptance criteria

### S1 — Export an independently displayable mapped SVG

As a renderer consumer, I want SVG containing source-mapping data so I can display or save a diagram without an interactive runtime.

- **S1-AC1:** Given supported Mermaid text, when rendered, then the SVG displays with JavaScript disabled and contains no scripts, event-handler attributes, executable URLs, or automatic animation. It needs no runtime network fetches for essential visual content.
- **S1-AC2:** Given a mapped visual piece, when its metadata is read, then its AST reference(s) and exact Mermaid-local span(s) can be resolved, including repeated labels and multiple occurrences.
- **S1-AC3:** Given Unicode, tabs, CRLF, or comment-delimiter text in the source, when exported and read back, then spans and any included source text remain exact.
- **S1-AC4:** Given an exported SVG saved and reloaded separately, when its metadata is decoded, then mapping works without rerunning Mermaid or opening the originating Markdown file.
- **S1-AC5:** Given invalid or unsupported input, when rendering is requested, then diagnostics distinguish failure/unsupported coverage from unmapped generated decoration; no fabricated span is returned.

### S2 — Activate an existing SVG

As a host developer, I want to attach interaction to a supplied SVG so I can use artifacts generated elsewhere without shipping the renderer.

- **S2-AC1:** Given a compatible inline SVG, when activated, then selecting a mapped descendant by click or keyboard identifies its nearest applicable mapping and emits the AST reference(s), source span(s), and deterministic primary selection.
- **S2-AC2:** Given a source range, when the host requests reverse selection, then matching visuals are highlighted and all matching AST references are available.
- **S2-AC3:** Given multiple SVG instances with identical internal IDs, when one is selected, then lookup, callbacks, and highlights stay scoped to that instance.
- **S2-AC4:** Given an activated SVG, when disposed, then added handlers and library-owned selection/accessibility state are removed without deleting the original diagram. Reactivation must not duplicate handlers.
- **S2-AC5:** Given missing, malformed, incompatible, or stale mapping/source data, when activated or selected, then an explicit unavailable/error result is exposed and unrelated source is never selected. A safe displayable diagram remains displayable.
- **S2-AC6:** Given a visual hyperlink, when a source-selection gesture occurs, then it does not also navigate. Keyboard controls and visible focus/selection are documented.

### S3 — Embed in Markdown and VS Code

As a Markdown/editor host author, I want block-local selections translated into my document so I can use Mermaid Trace alongside my editor.

- **S3-AC1:** Given several Markdown Mermaid blocks, when a local span is selected, then the host adapter selects the correct document/block using explicit identity and extraction provenance, including any stripped prefixes or normalized newlines.
- **S3-AC2:** Given an edited source block, when an older diagram remains visible, then the adapter rejects stale source selection until the mapping is refreshed or matched to its original source.
- **S3-AC3:** Given a VS Code webview and its host editor, when a selection is emitted, then a demonstration adapter selects the corresponding range through the host boundary; the core does not access VS Code APIs.

- **S3-AC4:** Given markdown-it and unified/remark/rehype pipelines, when Mermaid fences are processed, then adapters insert annotated inline SVG while preserving other fences and surrounding content. Disabling activation leaves static diagrams.
- **S3-AC5:** Given nested/list/blockquote fences, tabs, Unicode, or CRLF, when translating a logical source span, then exact original-document segments and a documented primary editor range are returned, or unsupported mapping is explicitly reported. Repeated block text is never located by substring guessing.
- **S3-AC6:** Given sanitized or replaced preview HTML and repeated diagrams, when activated, then retained metadata validates, SVG references remain instance-correct, and old activations are disposed. Missing mapping data leaves static output with an unavailable result.

### S4 — Basic viewer

As a diagram reader, I want a diagram and source view so I can inspect where visual pieces came from.

- **S4-AC1:** Given a mapped SVG plus embedded or supplied matching source, when selecting a visual, then the viewer visibly selects the exact source range; selecting source highlights corresponding visuals.
- **S4-AC2:** Given multiple candidate spans, when selecting, then the viewer shows the documented primary selection and allows access to the alternatives.
- **S4-AC3:** Given an artifact without source text, when displayed, then the viewer can expose locations and report source as unavailable; it does not guess or read a file implicitly.

### S5 — Rust producer and mapping core

As a Rust host author, I want native mapping and SVG generation so I can embed the functionality without a JavaScript rendering dependency.

- **S5-AC1:** Given shared supported fixtures, when processed by either implementation, then semantic mapping results and format compatibility agree; SVG layout need not be byte-identical.
- **S5-AC2:** Given a Rust-produced artifact, when opened by the same JS activation library, then S2 behavior works without a Rust-specific frontend.
- **S5-AC3:** Given performance claims, when published, then reproducible workload, environment, time, and memory measurements accompany them; faster performance is not assumed.

### S6 — Complete Mermaid diagram coverage

As a Mermaid author, I want the same source-mapping interactions for every built-in diagram type, so that using another Mermaid DSL does not remove the purpose of Mermaid Trace.

- **S6-AC1:** Every detector/diagram family in the selected upstream registry has an explicit coverage entry and executable fixtures. Syntax aliases, alternate renderers, and experimental built-ins remain in scope. New registry entries cannot silently disappear from the coverage inventory.
- **S6-AC2:** Every source-backed semantic visual element and label resolves to parser/AST provenance and exact original source spans. Source ranges resolve back to all corresponding visuals. Repeated visible text is not used to infer identity or location.
- **S6-AC3:** Each diagram family passes static SVG, saved-artifact round-trip, click/keyboard, reverse highlighting, repeated-instance and Markdown provenance checks. A successful render with diagram-only metadata fails element-coverage acceptance.
- **S6-AC4:** Generated decoration is distinguished from source-backed elements. It may resolve to a documented enclosing AST construct when that relationship exists; a genuinely generated piece has an explicit unmapped result. No fabricated exact position or automatic whole-diagram selection hides a missing source map.
- **S6-AC5:** All family coverage gates pass before declaring the first usable release complete. Partial implementation may be committed and demonstrated as a prototype, with its gaps explicit.

## Clarification decisions

- **D1 — Static artifact:** accepted from the user. SVG contains data; interaction belongs to a separately consumable JS library.
- **D2 — Logical split:** core + producer + activation library + thin viewer. Recommended starting structure in one repository; package extraction follows demonstrated boundaries.
- **D3 — Source packaging:** propose embedded inert SVG metadata as the standalone artifact's canonical payload. A preceding encoded comment remains an optional HTML-fragment export for the original use case; it cannot be the only source payload for a self-contained `.svg`. Exact encoding remains open.
- **D4 — AST availability:** a saved SVG must carry enough serialized AST identity, kind, and provenance to resolve selections. It need not contain the entire parser AST. Core APIs expose actual AST pieces when available; activation returns explicit references/projections, never claims those are a full AST.
- **D6 — All diagram types:** required by the user on 2026-09-26. Rendering alone and whole-diagram fallback are insufficient. The coverage inventory and release gate are defined in S6 and [C8](contracts.md#c8--all-diagram-coverage-s6-ac1ac5).
- **D5 — Coordinates:** propose zero-based UTF-16 offsets with exclusive end, plus one-based lines/columns for display. This fits JS editor boundaries; Rust must convert explicitly. Final decision and Unicode examples required at M1.

## Open questions and readiness

- Initial proof: the flowchart subset in [MAP-1](../flowchart-mapping/spec.md). Full S1/S6 coverage is mandatory; per-family implementation plans and format-v1 guarantees remain unfinished.
- Backend decision: [Merman](../merman-backend/spec.md) supplies native rendering and semantic JSON. The [Mermaid fork](../mermaid-fork/spec.md) remains the explicit transitional mapped-flowchart path. The pinned Merman binding lacks native source occurrence/visual exports; adding those is the next required story. All-family mapping is still unimplemented; native static rendering is verified independently of mapping.
- [NEEDS CLARIFICATION: Exact v1 attribute names, span units, metadata/source encoding, AST projection, source-version check, and size limits?] Resolve before S1/S2 format implementation; do not promise a stable wire format yet.
- ACT-1 resolves the experimental selection policy: declarations first, otherwise first occurrence; labels select label spans; half-open overlap returns all matching projections. Occurrence alternatives are exposed. Stable v1 should retain or explicitly revise this policy.
- ACT-1 is verified in pinned Chromium; wider browser support remains open. Click/Enter/Space selects source and suppresses hyperlink navigation. markdown-it is implemented first; unified/rehype follows before the integration milestone closes.
- Public package names, distribution layout, and project license remain undecided. Do not publish under an assumed license.

## Verification matrix

| Criteria | Planned checks | Status |
|---|---|---|
| S1-AC1 | Browser with scripts disabled; artifact inspection and offline/resource check | Demo fixture passes; comprehensive export-security acceptance pending |
| S1-AC2–AC4 | Source-span fixtures, Unicode/CRLF boundaries, repeated occurrences, serialized artifact round-trip | MAP-1 passes supported subset |
| S1-AC5 | Invalid/unsupported inputs and generated decoration diagnostics | MAP-1 negative inputs pass; richer decoration diagnostics pending |
| S2-AC1–AC2 | Real browser click/keyboard and reverse-selection checks | ACT-1 passes format 0 in Chromium |
| S2-AC3–AC4 | Duplicate IDs across instances, dispose/reactivate lifecycle | ACT-1 passes |
| S2-AC5–AC6 | Invalid metadata/stale source, safe link handling, keyboard acceptance | ACT-1 passes; wider accessibility/browser acceptance pending |
| S3-AC1–AC6 | Both Markdown adapters, extraction provenance, sanitization/replacement, edits, and VS Code host demonstration | MD-1/ACT-1 pass markdown-it slice; unified, sanitization and VS Code integration pending |
| S4-AC1–AC3 | Viewer selection, alternatives, and source-unavailable behavior | ACT-1 demo passes selections/alternatives; format 0 requires embedded source, missing-source artifacts unsupported |
| S6-AC1–AC5 | Registry inventory plus native-parser and artifact/browser conformance for every family | Required; incomplete, see diagram coverage |
| S5-AC1–AC3 | Cross-language fixtures, Rust artifact activation, reproducible benchmarks | Not implemented / not run |

Individual criteria and executable checks live in each selected story's spec. Experimental slices are complete as recorded there; broader release conformance remains open.
