# Source ownership and coherent selection

## OWN-1: authored objects versus entity references

Ready story: as an author, I want source selection to identify the object whose syntax I am editing, so references inside another object do not unexpectedly select their destination. [C2-OWN](../source-mapping/contracts.md#c2-own--syntax-ownership-versus-semantic-references) and [development principles](../../DESIGN.md#source-ownership-and-selection) apply to every family.

- **OWN-AC1:** Parser/semantic ownership and entity references are distinct. Selecting a reference-only property resolves to its owning object's visual bindings, retaining its relationship to the referenced entity as data. Explicit and legitimate implicit declarations retain their own provenance.
- **OWN-AC2:** A property has a separate target only when it corresponds to a distinct editable visual part. Note text can select its label; placement and attachment select the note. Native note syntax supports text, left/right placement and attachment target; there is no separately authored connector label.
- **OWN-AC3:** Visual bindings with the same exact owned source span are one logical pointer/keyboard/source selection target per SVG. Activation of any constituent highlights the entire group, selects the same source range and copies the same location. They expose their constituent AST references and use one keyboard stop; focus does not add a competing selection rectangle around a constituent. This applies to every diagram family, not only state notes. Distinct spans/instances remain separate.
- **OWN-AC4:** All currently mapped families have an independent ownership inventory and exact native/saved/live tests. Future families must satisfy this contract before support is complete. Preserve static SVG parity, source/clipboard, invalid-input recovery and disposal.

## Plan and current findings

Audit source-occurrence emission at each owning native semantic boundary: state note attachments; sequence message endpoints/notes; flowchart endpoints, grouped/chained occurrences and directives; Gantt dependencies; journey actor properties; Kanban metadata. Record whether each token is an actual declaration, a reference-only property or an independently editable visual part. Keep style relationships that bind the visual appearance they modify. Correct wrong ownership at the producer boundary, using native AST identities and ranges; do not add a parallel parser or infer owners by span length.

Start with the reported state note regression. The native state parser shares a statement structure between state declarations and notes; mapping currently exports the note attachment ID as a state occurrence. That is incorrect provenance ownership, not a viewer styling issue. The exact-range project regression fails before implementation. Audit other reference positions against the generic contract when the goal resumes. The requested same-span consolidation is delivered in shared activation with failing real pointer/keyboard/reverse tests. The earlier implicit-state label-only policy is superseded for equal-span visuals by the user's explicit consolidation decision; retain label-only behavior when its span differs from the containing object.

User delivery decision: fix state diagrams first. Audit and apply this rule to every previously implemented family and every family covered by the existing-family goal when the user resumes that goal. Unsupported renderer families and an editor capable of transforming ASTs remain outside the immediate state fix. The broader goal was paused for the reported state correction and resumed for the ownership audit below. State note ownership is delivered below; the other-family ownership audit remains pending; shared same-span activation is delivered below.

## State-first delivery

OWN-AC1/2 for attached state notes: native semantic construction no longer exports attachment tokens as state occurrences or state-label origins. Notes retain their target and placement as reference data; the note statement and its connector own placement/attachment selection, while the authored text retains its label range. Notes preceding a real state declaration/reference do not steal its title provenance. Note-only anchors are explicitly generated, without invented state declarations; later authored style relationships still bind that visual.

Regression evidence: exact original CRLF/Unicode ranges and mapped/plain parity cover 48 header/look/HTML/placement/inline-or-multiline combinations. Saved/live source selection of attachment and placement selects the note without selecting the referenced state; note-text selection remains distinct. The 286-fixture state corpus, existing interaction checks and native state provenance checks remain mandatory. Other reference positions and OWN-AC4 are not declared complete; audit them when the user resumes the goal. OWN-AC3 activation is delivered separately below.

## OWN-AC3 activation delivery plan (ready)

Clicking either a state note body or its connector must highlight both, preserve both AST bindings and copy the same note location. Exact-span visual bindings share one keyboard stop and one selection treatment; distinct note-label spans remain separately selectable. Implement equivalence in shared SVG activation using embedded visual selection spans, retaining static SVG bytes and restoring all host attributes on disposal. Update the superseded equal-span state-label expectations to the agreed consolidation policy; verify saved/live pointer, keyboard, source, clipboard, instance isolation and disposal. Other-family semantic ownership audits remain paused.

Consolidation clarification: selecting another legitimate source occurrence of an object also highlights its grouped visuals uniformly. This does not invent a label span on that occurrence: authored mappings remain unchanged. A distinct authored label range still has its separate label-only target. The prior bare-ID expectation that highlighted the body without its equal-span label is superseded by this grouping decision.

OWN-AC3 delivery: shared activation groups embedded visual selection spans, preserving all native identities and one focus representative. Pointer, keyboard and source selection highlight the group uniformly. Distinct label ranges remain separate. Saved/live tests cover 48 note variants and 12 implicit-state variants, including physical body/connector clicks, one keyboard stop, AST bindings, source/clipboard, isolation and disposal. Host focus styling uses the selection highlight instead of an extra rectangle around one constituent. Static SVG data is unchanged.

Verification: the reported connector/body regression failed first. The final implementation passed 52 tests in the complete 53-test browser suite, including all 2,340 operator and 1,752 public-shape combinations. The remaining bare-ID case still asserted the superseded split highlight in its live counterpart; after that test-only correction, its four saved/live header/HTML cases pass in a focused run. Type checking and documentation links pass. The complete suite was not repeated after this test-only correction; no implementation changed. The broader semantic ownership audit resumed under OWN-SEQ below.

## Resumed audit: OWN-SEQ (ready)

The existing-family goal resumed. Audit all six currently implemented families; then retain ownership/consolidation gates for the remaining goal families. State note ownership and shared activation are already delivered. First regression: sequence notes implicitly ensure participants in the semantic DB, and currently export their attachment tokens as participant declarations/label origins.

OWN-SEQ scope: left/right/over notes with one or two attachments, declared participants, note-only anchors, notes before later declarations/messages, repeated notes, Unicode and CRLF. Attachment and placement select the owning note; note text remains distinct. Preserve attachment relationships as note metadata. Only real declarations or legitimate message-based implicit declarations own participant spans; a note-only anchor is explicitly generated. Keep native geometry, saved/static SVG, source/clipboard and shared selection behavior. Plan: test exact native/portable ownership first, suppress note-owned EnsureParticipant provenance at the existing semantic boundary, retain note relationship data, and verify saved/live reverse selection. This does not declare complete sequence conformance or the other-family audit.

### Remaining ownership inventory

Current native output was inspected with independent original token offsets; these samples locate work and do not prove full-family conformance.

| Family | Observed source ownership | Required next evidence |
|---|---|---|
| Flowchart | A bare `B` endpoint in `A --> B` after explicit declarations still exports a node occurrence | Separate declarations/first implicit creation from reference-only endpoints; define owning edge bindings for grouped/chained/self/parallel forms without changing geometry or losing reference data |
| State | A declared `B` endpoint in `A --> B : transfer` exports both a node occurrence and the whole transition | Reference-only tokens must select the transition, preserving genuine implicit state creation and standalone declarations; all STATE-2 gates stay mandatory |
| Gantt | `after a` inside task `b` is contained by task `b`, without overlapping task `a` provenance | Dependency/constraint/ID inventories and relationship-data retention; source, saved and live acceptance remain required |
| Journey | Repeated `Writer` in a second task has local actor-circle and global legend bindings | Distinguish first implicit actor declaration from task-local editable references and their aggregate legend; verify consistent pointer/source selection and duplicate actors |
| Kanban | An assigned-name value remains within its card/field, rather than selecting a similarly named card | Exact field/key/value ownership, duplicate names, parents and metadata variants; distinguish independently displayed fields from nonvisual properties |
| Sequence | Declared message endpoints already stay inside their message; undeclared note attachments previously claimed actor origins | OWN-SEQ regression closes the note case; lifecycle/menu/control and implicit-declaration ownership inventories remain required |

The goal still includes complete FLOW-2, sequence/Gantt/journey/Kanban conformance, state preservation, and the planned class/ER work. This audit does not replace those inventories or narrow the completion gate.

OWN-SEQ verification: the project regression failed first because the note attachment emitted a node occurrence. The native fix passes 16 original-range/static-parity cases and 12 saved/live browser cases. `make test typecheck` passes all 53 Rust and 54 TypeScript/browser tests, retaining the state corpus, shared grouping, operator/public-shape matrices and watch gates. All 1,553 native core tests and the public native sequence provenance test pass. The pinned patch applies cleanly and reproduces all 106 changed files. Declared endpoint and journey ownership work remains pending; no full-family or goal completion is claimed.
