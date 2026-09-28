# All Mermaid diagram coverage

Decision: mandatory for the first usable release, clarified by the user on 2026-09-26. Rendering another DSL while selecting only its whole diagram does not satisfy this project's purpose. This requirement supersedes earlier wording that deferred broader Mermaid coverage beyond the initial release.

Contracts: [S6](../source-mapping/spec.md#s6--complete-mermaid-diagram-coverage) and [C8](../source-mapping/contracts.md#c8--all-diagram-coverage-s6-ac1ac5). The [Merman migration](../merman-backend/spec.md) changes the producer direction without weakening this gate.

## Definition of support

User clarification, 2026-09-27: “implement diagram support” requests the complete family by default. A narrower slice requires explicit user agreement. Deliver in small verified commits, but keep the family incomplete until all required coverage passes; close its known gaps before starting another family unless the user explicitly changes priority. See [full feature coverage](../../DESIGN.md#full-feature-coverage).

Every source-backed semantic piece and label must map through native parser/AST provenance to exact original source, and source selection must identify corresponding visuals. Verify click/keyboard selection, copied original locations, multiple occurrences/instances, Markdown embedding and saved static SVG consumption without the renderer. Include valid syntax variants and relevant nested constructs for each family. Distinguish genuinely generated decoration from a source-backed visual whose mapping is missing. Whole-diagram selection belongs to the background gesture.

A diagram family is complete only when those checks pass. A render smoke test is insufficient; all rows must pass before the first usable release. The diagnostic `info` diagram has no ordinary node/edge DSL, so its generated version text needs explicit generated-content classification rather than invented source spans. Broken-input error diagrams and the `---` frontmatter sentinel are diagnostics, not authoring DSLs.

## Registry inventory

Source: the locally inspected fork's `packages/mermaid/src/diagram-api/diagram-orchestration.ts` and its imported detector modules, at Mermaid commit `f9387456a1e27315e325ada0d8a1cc583ecdf95b`. There are 37 detector entries. This includes large-feature entries, experimental built-ins and alternate railroad grammars; those are not optional exclusions. C4/state/class/flowchart aliases and subvariants must be covered within their corresponding rows. Refresh and compare the inventory when changing the Mermaid version.

| Registry entry | Element mapping status |
|---|---|
| `flowchart-v2` | Native nodes/references, connectors, labels, subgraph frames/titles and YAML titles mapped; effective repeated/default-ID labels, style relationships, static math and empty/collapsed groups implemented; shape-data, class/link directives, scoped directions and nonvisual accessibility provenance implemented; configuration construct and exact YAML/JSON5 key/value evidence implemented, including typed array paths; icon/image and multiline SVG label identities, plus generated artwork/bounds/console-glyph classification implemented; 146 public shape names pass native binding/parity across both layouts, all three looks and HTML modes; full syntax/configuration/variant conformance pending |
| `sequence` | Native participants/messages/labels/notes/activations/controls implemented; complete syntax/occurrence conformance pending |
| `flowchart-elk` | Native ELK capability enabled; saved/live frame, node, connector and label selection verified; complete family conformance pending |
| `classDiagram` | Missing |
| `stateDiagram` | Pinned native state inventory verified: declarations/references, repeated descriptions, composites/concurrency, special states, transitions, notes, titles and directive relationships; 286 fixtures, 48 variants and saved/live interaction checks (STATE-2) |
| `er` | Missing |
| `c4` | Missing |
| `gitGraph` | Missing |
| `gantt` | Native task bars/milestones/labels and title mapped; `after`/`until` references retain task ownership; repeated section names retain distinct declarations and one effective rendered title, with unrendered sections nonvisual; repeated body titles retain their source and visible frontmatter fallback owns its title; accessibility statements and ten diagram directives retain exact nonvisual origins; complete syntax/configuration conformance pending |
| `journey` | Native tasks/labels, scores, actor references/legend, sections and title implemented; complete conformance pending |
| `pie` | Missing |
| `quadrantChart` | Missing |
| `xychart` | Missing |
| `requirement` | Missing |
| `timeline` | Missing |
| `mindmap` | Missing |
| `kanban` | Native columns/cards/labels, ticket/assigned values and priority indicators implemented; complete conformance pending |
| `sankey` | Missing |
| `packet` | Missing |
| `radar` | Missing |
| `block` | Missing |
| `treeView` | Missing |
| `architecture` | Missing |
| `agentflow` | Missing |
| `swimlane` | Missing |
| `eventmodeling` | Missing |
| `ishikawa` | Missing |
| `venn` | Missing |
| `treemap` | Missing |
| `usecase` | Missing |
| `wardley` | Missing |
| `cynefin` | Missing |
| `railroad` | Missing |
| `railroadEbnf` | Missing |
| `railroadAbnf` | Missing |
| `railroadPeg` | Missing |
| `info` | Generated-content classification/conformance missing |

“Missing” reports source-map coverage, not upstream rendering capability. No unsupported family is claimed as mapped because its SVG displays.

## Implementation direction

1. Generalize the projection and SVG visual-binding contract beyond flowchart-only node/edge selectors, using real parser semantic kinds and renderer identities. Preserve the existing mapping core, static artifact and optional activation split.
2. [Gantt, user journey and Kanban](../planning-diagrams/spec.md) mapping slices are implemented; extend their conformance coverage. Retain outstanding sequence conformance: participant declarations/references/aliases, message arrows and labels, self/repeated messages, notes, activation/lifeline visuals and nested control structures. Capture Merman parser locations and bind native semantic/render identities; never match repeated display text to source.
3. Add the remaining families through Merman native parser and renderer paths, adding missing Mermaid 12 families explicitly. Share original-coordinate transformation and artifact/activation infrastructure; type-specific syntax and semantic relationships stay explicit. Per-family stories must define exact constructs, generated pieces and test expectations before coding.
4. Maintain executable upstream-derived fixtures plus independent expected source spans, and compare mapped/unmapped rendering to catch visual regressions. Gate the release on actual conformance for every registry entry, including variant renderers and preprocess transformations. Partial patches remain prototype work, not a completed all-diagram feature.

## Verification

Registry inventory checked against the current local detector modules. Existing tests verify historical references, native flowchart, sequence and planning diagram source ranges, saved SVG selection, and live Markdown clipboard/watch behavior. They do not establish S6/C8 conformance. Complete flowchart/sequence conformance and every remaining family are outstanding; no all-diagram acceptance suite has passed.

Merman migration: keep this Mermaid-version inventory as the required scope. Its advertised type counts do not replace it. Production uses the Trace-owned native Rust integration. The earlier Node addon and legacy production route have been removed.
