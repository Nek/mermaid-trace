# Goal reassessment and estimation

Agreed process, 2026-09-28. Read this before reassessing or resuming the existing-family goal, including after context compaction.

## Current position

- The user resumed `existing families` on 2026-09-29 under the unchanged completion boundary below. The goal tool still reports blocked and exposes no resume operation; that stale tool status does not replace the user’s instruction. Browser/fidelity decisions were settled on 2026-09-29.
- The boundary is full support for flowchart (including ELK), sequence, Gantt, user journey, Kanban and state under the audit's finite completion contract. Accept Merman's visual interpretation while preserving required content, relationships, features and exact source mapping; no pixel match to official Mermaid is required. Chromium, Safari and Firefox must pass interaction acceptance. This must not silently expand into the separate [all-family release gate](specs/diagram-coverage/spec.md), Class/ER work or other milestones.
- The [bounded audit](specs/diagram-coverage/existing-families-audit.md) records the pinned references, coverage evidence, four baseline sequence/Kanban defects and remaining unverified areas. Following the instruction to proceed, all four defects have focused passing regressions; its implementation checkpoints retain measured timing and verification. State's pinned inventory gate remains valid; it does not establish every Mermaid 12 configuration. This is an evidence summary, not a completion percentage.
- The earlier 80–160 and 150–300+ AI wall-clock-hour forecasts, and the 8–16-hour inventory estimate, were withdrawn as unsupported. Do not reuse them as a baseline. There is no credible remaining-hours forecast yet.
- Resumption adds no families, native GUI, WASM or other milestones.

## Reduce uncertainty

1. **Freeze the reference and finish line.** Record exact Mermaid and Merman revisions, the pinned fork commit, the six-family boundary, required syntax/configuration, renderer/browser variants and source-selection behavior. Explain any differences between reference versions. New upstream features do not automatically expand scope.
2. **Inventory existing evidence.** Compare the pinned grammars, configuration schemas and renderer paths with existing tests and feature criteria. Reuse upstream fixtures. Separate missing functionality from missing test evidence; an unverified case may already work.
3. **Probe unknowns in batches.** Use the existing artifact, mapping and saved/live interaction checks. Give each failure independent expected behavior. Group failures by demonstrated root cause and identify the responsible layer: mapping, native rendering, activation/Markdown integration or test harness. Do not count every failing fixture as a separate implementation task.
4. **Calibrate after implementation resumes.** Close representative gaps through TDD and record investigation, implementation and verification time separately. Estimate comparable remaining work from those observations; disclose unresolved risks instead of assigning arbitrary hours to each family.

## One audit artifact

Keep one compact coverage table alongside the relevant specs. Link to existing requirements and tests rather than duplicating their prose.

| Requirement / construct and variants | Status | Evidence or concrete missing check | Responsible layer / shared cause |
| --- | --- | --- | --- |

Use **verified**, **confirmed broken**, or **unverified**. Verified entries identify the revision, check and observed result. Confirmed failures retain a reproducer and expected behavior. Unverified entries explain what evidence is missing; a test name alone is not a passing result. Record any uncertainty in the inventory's completeness explicitly.

The audit ends after one defined pass through the named pinned sources and existing tests, plus targeted probes declared for that pass. Deliver the table, unresolved questions and grouped gaps even if some entries remain unverified. Do not turn the audit into an implementation marathon or claim an incomplete inventory proves full support.

## Checkpoints and scope control

- At checkpoints, report remaining gaps, newly discovered gaps and closed gaps against the same baseline. Include unresolved risks and actual elapsed work; distinguish AI agent wall-clock time from human effort. Fixture counts alone are not a progress percentage.
- If discoveries outpace closures or measured work invalidates an estimate, report it promptly and explain why. Do not silently replace the forecast.
- A newly discovered bug within agreed behavior remains part of the work. If resolving a discovery requires changing the agreed goal or acceptance boundary, stop implementation immediately and discuss the scope with the user before proceeding.
- Preserve full-feature coverage, source ownership, migration acceptance, TDD and atomic commits. Missing or failing acceptance must remain visible until resolved; do not weaken it to close a gate.

Current work: continue under these agreed boundaries, finishing FLOW-2's syntax/configuration inventory and closing its gaps before moving to another family. Use the four measured fixes when classifying comparable remaining work, not as a uniform per-family rate. Browser acceptance still needs evidence; agreeing its scope does not mark it passed.
