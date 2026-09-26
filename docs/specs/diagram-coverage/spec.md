# All Mermaid diagram coverage

Decision: mandatory for the first usable release, clarified by the user on 2026-09-26. Rendering another DSL while selecting only its whole diagram does not satisfy this project's purpose. This requirement supersedes earlier wording that deferred broader Mermaid coverage beyond the initial release.

Contracts: [S6](../source-mapping/spec.md#s6--complete-mermaid-diagram-coverage) and [C8](../source-mapping/contracts.md#c8--all-diagram-coverage-s6-ac1ac5). No runtime support is added by this documentation change.

## Definition of support

Every source-backed semantic piece and label must map through native parser/AST provenance to exact original source, and source selection must identify corresponding visuals. Verify click/keyboard selection, copied original locations, multiple occurrences/instances, Markdown embedding and saved static SVG consumption without the renderer. Include valid syntax variants and relevant nested constructs for each family. Distinguish genuinely generated decoration from a source-backed visual whose mapping is missing. Whole-diagram selection belongs to the background gesture.

A diagram family is complete only when those checks pass. A render smoke test is insufficient; all rows must pass before the first usable release. The diagnostic `info` diagram has no ordinary node/edge DSL, so its generated version text needs explicit generated-content classification rather than invented source spans. Broken-input error diagrams and the `---` frontmatter sentinel are diagnostics, not authoring DSLs.

## Registry inventory

Source: the locally inspected fork's `packages/mermaid/src/diagram-api/diagram-orchestration.ts` and its imported detector modules, at Mermaid commit `f9387456a1e27315e325ada0d8a1cc583ecdf95b`. There are 37 detector entries. This includes large-feature entries, experimental built-ins and alternate railroad grammars; those are not optional exclusions. C4/state/class/flowchart aliases and subvariants must be covered within their corresponding rows. Refresh and compare the inventory when changing the Mermaid version.

| Registry entry | Element mapping status |
|---|---|
| `flowchart-v2` | Partial: documented flowchart subset, experimental format 0 |
| `sequence` | Missing: current viewer renders with whole-diagram metadata only |
| `flowchart-elk` | Not verified through mapped viewer; required |
| `classDiagram` | Missing |
| `stateDiagram` | Missing |
| `er` | Missing |
| `c4` | Missing |
| `gitGraph` | Missing |
| `gantt` | Missing |
| `journey` | Missing |
| `pie` | Missing |
| `quadrantChart` | Missing |
| `xychart` | Missing |
| `requirement` | Missing |
| `timeline` | Missing |
| `mindmap` | Missing |
| `kanban` | Missing |
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
2. Complete native sequence provenance and viewer integration first: participant declarations/references/aliases, message arrows and labels, self/repeated messages, notes, activation/lifeline visuals and nested control structures. Capture grammar locations and bind native DB/render identities; never match repeated display text to source.
3. Add the remaining families through their native Jison/Langium/custom parser and renderer paths. Share original-coordinate transformation and artifact/activation infrastructure; type-specific syntax and semantic relationships stay explicit. Per-family stories must define exact constructs, generated pieces and test expectations before coding.
4. Maintain executable upstream-derived fixtures plus independent expected source spans, and compare mapped/unmapped rendering to catch visual regressions. Gate the release on actual conformance for every registry entry, including variant renderers and preprocess transformations. Partial patches remain prototype work, not a completed all-diagram feature.

## Verification

Registry inventory checked against the current local detector modules. Existing tests verify the flowchart slice and sequence rendering/whole-diagram selection only. They do not establish S6/C8 conformance. Native sequence implementation and every remaining family are outstanding; no all-diagram acceptance suite has passed.
