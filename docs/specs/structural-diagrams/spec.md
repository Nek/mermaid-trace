# Structural diagram mappings

Delivery order: state → class → ER, following the completed planning diagram slices. These stories extend native source mapping; full syntax/renderer conformance for every family remains the release gate.

As a diagram author, I want to select structural diagram pieces and locate their exact original source, including in Markdown and saved SVG.

## Current feature: state diagrams (incomplete)

Decision, 2026-09-27: implementing diagram support means the complete family, not a representative slice. STATE-1 below records the delivered mapping slice, not completion of state support. Close state occurrence, concurrency and syntax/configuration/renderer gaps before CLASS-1 or ER-1. Enumerate remaining constructs and variants from the native grammar, renderer and upstream fixtures, give each exact-source and interaction expectations, then implement them through failing acceptance tests. Full state support requires every applicable coverage check to pass; wider syntax is not deferred work.

### Delivered slice: STATE-1

Scope: state declarations and references, quoted aliases, start/end/choice/fork/join states, composite states, transitions with or without labels, and attached notes. A node selects its declaration (or first reference); its label selects the authored label. A transition selects its complete statement; its label selects the description. Attached notes select their statement or note text. Generated note connectors and layout decorations have no fabricated source. Repeated declarations/descriptions and concurrency variants need explicit occurrence conformance before claiming the family complete.

- **STRUCT-AC1:** Given repeated labels, references, nesting, Unicode, CRLF, comments or frontmatter, native parser spans and semantic identities retain the correct original statement, label and relationships. No parallel parser, label matching or separately produced ordinal join.
- **STRUCT-AC2:** Given mapped SVG, it displays without scripts or activation. Removing inert mapping metadata preserves plain native SVG output. Activating saved SVG permits precise node/label/edge/note selection and reverse lookup, with separate diagram instances isolated. Reverse-selecting a nested piece selects its specific visuals without highlighting enclosing source ranges; selecting the complete composite remains a block selection.
- **STRUCT-AC3:** Given Markdown embedding, clicks and Enter/Space copy original locations; focus selects without copying. Optional native source selection, background selection, saves and invalid-edit recovery retain existing behavior. Existing family acceptance tests remain mandatory.

Plan: extend the existing state grammar AST with statement and label spans. Carry occurrences through native semantic construction while assigning existing node, note and edge identities; remap through shared preprocessing provenance. Bind at native SVG emission and reuse the artifact, activation and watch host. Write failing range and production SVG tests first; verify native family tests, mapped/plain bytes, saved SVG and nested-Markdown interaction before an atomic commit.

### Full state coverage: STATE-2

Scope: complete state-family provenance and interaction, retaining STATE-1. Inventory: bare and implicit states, quoted/multiline aliases, colon and repeated descriptions (including compact alias-plus-description), repeated declarations/references, nested/reopened composites, concurrency regions, choice/fork/join/start/end, self/parallel/cross-boundary transitions, inline/multiline and composite notes, styling/classes/inline classes, link directives, accessibility metadata, comments, separators, direction/scale/hide directives, frontmatter titles and configuration. Include both headers and applicable native look/theme/layout/label variants. Upstream syntax that produces no visual must be explicitly classified; it must not receive invented mappings.

- **STATE-AC4:** Every displayed title/description row retains its own native source identity and exact authored range, including identical text and multiline labels. Merged state visuals retain every declaration/reference occurrence. No valid repeated description is rejected by the artifact adapter.
- **STATE-AC5:** Every source-backed state visual in the pinned upstream fixture corpus is mapped. Concurrency dividers and title text are mapped; generated region/note scaffolding is classified separately. Styles, directions, metadata and links retain their source relationships without replacing the primary state selection or creating fake visible controls.
- **STATE-AC6:** Both headers and native renderer/configuration variants satisfy STRUCT-AC1–3 and STATE-AC4–5. Independent exact-span cases cover syntax inventory and source preprocessing; saved-SVG/browser checks verify description rows, concurrency, special states, composite frames, notes and edges. Corpus checks compare mapped and plain SVG bytes and reject missing provenance. Upstream parser/render acceptance and existing family tests remain mandatory.

Plan: inventory the official Mermaid grammar/docs and pinned Merman fixtures; add failing exact-range and corpus tests first. Keep label provenance alongside the native semantic builder's accumulated label rows and bind it during SVG emission, without text matching or separate ordinal reconstruction. Reuse preprocessing evidence for title/configuration locations and existing activation contracts. Verify original spans, saved artifacts and the production Markdown route before marking the family complete. If the inventory exposes a native parser/renderer gap, fix it and add an acceptance case rather than exclude it.

## Following stories

**CLASS-1:** class declarations/labels, members and methods, relationships/labels, namespaces and notes. **ER-1:** entities/aliases, attributes and relationships/labels. Define and verify each native statement/value contract before entering implementation. No new dependencies or browser rendering fallback are planned.

## Verification

STATE-1 implemented. Native tests cover original UTF-16 ranges through CRLF/frontmatter/comments, repeated Unicode aliases, transitions and endpoint relationships, nested composite states, start/end/choice/fork/join states, inline and multiline notes, both state headers and mapped/plain SVG equality. Saved-SVG pointer checks cover nodes/labels, labeled and unlabeled transition strokes, notes/text and composite frames/labels. Nested reverse selection excludes enclosing nodes. The live nested-Markdown route verifies source selection, clipboard, background selection and saves; existing invalid-edit recovery checks remain mandatory.

| Contract | Evidence |
|---|---|
| STRUCT-AC1 | Two tests in `mermaid-trace-rs/tests/structural.rs` |
| STRUCT-AC2 | Native SVG equality and `STATE STRUCT-AC2/3` in `mermaid-trace-ts/test/native-diagrams.test.ts` |
| STRUCT-AC3 | Same production watch/browser test plus the mandatory existing watch/activation suite |

Verification: `make typecheck`, `make test` (12 Rust, 28 TypeScript/browser tests), 184 native state parser/render checks, 35 native ASCII state-model checks and generated-parser verification pass. The shared containment check currently scans matching pieces; an interval index is warranted only if large artifacts show a performance issue.

CLASS-1 and ER-1 follow complete state support; they are not implemented yet. Repeated state descriptions/declarations, concurrency and wider syntax/configuration/renderer conformance are unfinished state requirements. STATE-1 does not close the state-family or all-family gate.
