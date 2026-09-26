# Planning diagram mappings

Decision, 2026-09-26: implement **Gantt → user journey → Kanban** before state, class and ER diagrams. This changes delivery order, not the all-family release gate. Preserve all existing flowchart, sequence, Markdown and saved-artifact behavior.

As an author, I want to select planning diagram pieces and locate their exact original source, including through Markdown embedding.

## Stories and scope

| Story | Source-backed visuals |
|---|---|
| GANTT-1 | Task bars, milestones/vertical markers and task labels; section labels and diagram title |
| JOURNEY-1 | Task cards/labels, scores/faces, actor references and legend, sections and title |
| KANBAN-1 | Columns, cards and their labels; displayed ticket/assignee metadata and priority indicators |

Generated axes, ticks, today's date, layout lines, marker shapes and backgrounds have no invented source pieces. An authored configuration that affects decoration is not automatically a selectable visual. Whole-diagram selection stays a background gesture. Broader syntax and interaction conformance remains required before claiming a family complete.

## Acceptance contracts (apply to each story)

- **PLAN-AC1:** Native parser occurrences retain exact original statement and label/value spans, semantic identities and relationships. Repeated labels/sections, Unicode, CRLF, comments and frontmatter remain distinguishable. Capture before merging; reuse existing grammar/scanners and preprocessing provenance. No parallel parser, SVG text matching or positional join between separately produced results.
- **PLAN-AC2:** Static SVG contains inert mappings and renderer-owned identities. Each listed source-backed visual selects its statement or precise label/value; reverse selection identifies the corresponding visuals. Saved SVG activates without a renderer. Adding provenance preserves visual output and default upstream rendering stays unannotated.
- **PLAN-AC3:** Click and Enter/Space copy exact original Markdown locations; focus selects without copying. Optional native source selection, multiple diagrams, save/reload and invalid-edit recovery work through the production Rust route. Existing acceptance tests stay mandatory.

## Selected plan

Implement one story at a time in the stated order. Extend the existing Merman parser/semantic/SVG paths and Trace's pinned native patch. Gantt and journey already have spanned native statements; Kanban retains node and metadata spans. Carry source occurrences in native render context/models and remap them through the shared original-source transformation. Bind native task/section/card identities at SVG emission; reuse the portable artifact, activation and watch host. No new dependency, browser rendering fallback or source rewriting.

Before each implementation, run failing exact-span tests and a production mapping assertion. Verify mapped versus plain static SVG, native parser family tests, saved SVG browser selection/clipboard/reverse lookup and nested Markdown source ranges. Update this spec and coverage checklist with actual results; commit each verified family atomically. Dynamic WASM and full-family conformance remain separate work.

## Verification

GANTT-1 implemented: two native tests verify original UTF-16 spans through frontmatter/CRLF/Unicode, repeated task labels, dependencies, milestones, sections/title, determinism and mapped/plain SVG byte equality after removing inert trace attributes. Saved SVG and the production nested-Markdown test verify task/label selection, instance isolation, clipboard, reverse source selection, background selection and saves. Full suite: 8 Rust and 25 TypeScript/browser tests pass; 86 upstream Gantt parser checks pass. Full Gantt syntax/configuration conformance is not yet claimed. JOURNEY-1 and KANBAN-1 remain next.
