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

GANTT-1 implemented: two native tests verify original UTF-16 spans through frontmatter/CRLF/Unicode, repeated task labels, dependencies, milestones, sections/title, determinism and mapped/plain SVG byte equality after removing inert trace attributes. Saved SVG and the production nested-Markdown test verify task/label selection, instance isolation, clipboard, reverse source selection, background selection and saves. Full suite: 8 Rust and 25 TypeScript/browser tests pass; 86 upstream Gantt parser checks pass. Full Gantt syntax/configuration conformance is not yet claimed.

JOURNEY-1 verification: native ranges cover repeated Unicode labels, CRLF, separate task identities, section/title, scores and actor references; mapped/plain SVG bytes remain equal after stripping inert trace attributes. Saved-artifact clicks verify task/label, score and actor/legend selection, and the live nested-Markdown test verifies clipboard/source/reverse/background/save behavior. Full suite: 9 Rust and 26 TypeScript/browser tests; 16 upstream journey parser checks pass. Wider syntax/configuration and repeated actors within one task still need conformance cases.

KANBAN-1 implemented: native tests verify columns/cards, parent relationships, repeated Unicode labels, frontmatter/CRLF, precise ticket/assigned/priority values and mapped/plain SVG equality. Renderer-owned label identities survive the existing safe SVG text conversion. Saved-artifact pointer checks cover cards, labels, columns, metadata and priority strokes; live nested-Markdown checks cover clipboard, source selection, reverse selection, background selection and saves. Full suite: 10 Rust and 27 TypeScript/browser tests pass. 69 upstream Kanban parser/render checks and 58 SVG fallback checks pass; wider family conformance remains pending.

[OWN-JOURNEY-ACTOR](../source-ownership/spec.md#own-journey-actor-ready) supersedes name-only task-circle identities and automatic selection of the legend from later actor references. Native people-property slots remain distinct, including repeated actors within a task; the first implicit declaration owns the legend and its same-span local circle as one group. Sectionless tasks and tasks before sections remain rendered/selectable. Full journey syntax/configuration conformance is still required.

[OWN-JOURNEY-SECTION](../source-ownership/spec.md#own-journey-section-ready) preserves distinct parser-backed section runs when names repeat, retaining contiguous merging, effective label ownership, empty frames and explicit nonvisual declarations. Section layout semantics and plain SVG geometry are unchanged.

## JOURNEY-2: full family conformance

As an author, I want every supported journey construct and configuration to preserve its original source ownership through rendering and activation. Completion requires all 26 pinned journey fixtures, independent semantic expectations, and the complete grammar/configuration inventory; representative rendering alone is insufficient.

Inventory: header/empty diagrams; body and YAML titles (including precedence and repeated declarations); accessibility title and single/multiline descriptions; section declarations, aliases and empty/unused sections; task labels and HTML line breaks; numeric, empty and nonnumeric scores; duplicate/empty actor slots and wrapped legends; comments, directives, frontmatter, Unicode and CRLF. Configuration coverage includes margins, dimensions, fonts, title styles, actor/section palettes, `sectionColours`, `textPlacement`, maximum width, themes, looks and HTML labels. Distinguish options actually consumed by the pinned renderer from schema fields with no journey behavior. Preserve exact authored occurrences, classify generated/nonvisual parts honestly, and verify plain/static parity plus saved/live pointer, keyboard, source, clipboard, isolation and disposal.

### JOURNEY-2-TITLE (ready)

YAML titles already render but lack journey provenance. A visible YAML title must select its exact parser-backed value range; reverse selection of its field/value identifies that title. A body title retains precedence and its own source mapping. Absent/empty titles create no invisible keyboard control. Cover plain/quoted/escaped/alias/literal/folded YAML, CRLF/Unicode, all three looks and both HTML-label settings, preserving unannotated SVG output.

Plan: reuse the common preprocessing title evidence hook for journey only when the native semantic title is absent; emit the existing title label identity for a metadata title. Start with a failing project artifact regression, then saved/live activation through the existing native helper. No alternate parser, text matching or viewer exception. This atomic correction does not close repeated-title, accessibility, configuration or the full-family gate.

Remaining confirmed inventory gaps: the native journey parser currently drops superseded body-title occurrences; accessibility facts are not exported as nonvisual provenance; common configuration evidence is still limited to flowcharts. The installed Mermaid renderer consumes `sectionColours` and switches text emission for `textPlacement` (`tspan`, `fo`, `old`), while the native journey path currently uses theme text colour and a fixed text candidate. Accepted nonnumeric scores produce NaN face coordinates and need honest source/visual classification and interaction checks. These behaviors require failing project regressions and native corrections before JOURNEY-2 can close.

JOURNEY-2-TITLE delivered: the original missing-title regression failed first. Native preprocessing evidence now supplies YAML title ownership only when the body title is absent; the renderer marks that visible title as its label. Exact UTF-16/CRLF/Unicode and plain-SVG equality pass across 72 YAML/body/look/HTML combinations plus 12 absent/empty cases. All 26 pinned fixtures pass independent task-label and authored-title expectations with static parity. Fourteen saved/live browser variants pass physical clicks, native source selection, keyboard, clipboard, precedence, instance isolation and disposal; folded scalars include their exact lexical newline ranges. The nested-Markdown test helper now excludes the next line's quote prefix at a terminal-newline range boundary. Native commit `3b6ed914` passes all 1,553 core tests and three public journey provenance checks. Pinned patch reproduction verifies all 109 changed files. `make test typecheck` passes all 60 Rust and 59 TypeScript/browser tests, retaining the full state/flowchart corpus, 2,340 operator cases, 1,752 public-shape variants, baselines and watch/recovery gates. JOURNEY-2 and the existing-family goal remain incomplete; continue with superseded title and nonvisual provenance coverage.
