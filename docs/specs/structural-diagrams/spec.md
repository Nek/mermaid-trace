# Structural diagram mappings

Delivery order: state → class → ER, following the completed planning diagram slices. These stories extend native source mapping; full syntax/renderer conformance for every family remains the release gate.

As a diagram author, I want to select structural diagram pieces and locate their exact original source, including in Markdown and saved SVG.

## Ready story: STATE-1

Scope: state declarations and references, quoted aliases, start/end/choice/fork/join states, composite states, transitions with or without labels, and attached notes. A node selects its declaration (or first reference); its label selects the authored label. A transition selects its complete statement; its label selects the description. Attached notes select their statement or note text. Generated note connectors and layout decorations have no fabricated source. Repeated declarations/descriptions and concurrency variants need explicit occurrence conformance before claiming the family complete.

- **STRUCT-AC1:** Given repeated labels, references, nesting, Unicode, CRLF, comments or frontmatter, native parser spans and semantic identities retain the correct original statement, label and relationships. No parallel parser, label matching or separately produced ordinal join.
- **STRUCT-AC2:** Given mapped SVG, it displays without scripts or activation. Removing inert mapping metadata preserves plain native SVG output. Activating saved SVG permits precise node/label/edge/note selection and reverse lookup, with separate diagram instances isolated. Reverse-selecting a nested piece selects its specific visuals without highlighting enclosing source ranges; selecting the complete composite remains a block selection.
- **STRUCT-AC3:** Given Markdown embedding, clicks and Enter/Space copy original locations; focus selects without copying. Optional native source selection, background selection, saves and invalid-edit recovery retain existing behavior. Existing family acceptance tests remain mandatory.

Plan: extend the existing state grammar AST with statement and label spans. Carry occurrences through native semantic construction while assigning existing node, note and edge identities; remap through shared preprocessing provenance. Bind at native SVG emission and reuse the artifact, activation and watch host. Write failing range and production SVG tests first; verify native family tests, mapped/plain bytes, saved SVG and nested-Markdown interaction before an atomic commit.

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

CLASS-1 and ER-1 follow STATE-1; they are not implemented yet. Repeated state descriptions/declarations, concurrency and wider syntax/configuration conformance remain pending; STATE-1 does not close the all-family gate.
