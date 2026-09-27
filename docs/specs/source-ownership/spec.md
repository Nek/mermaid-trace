# Source ownership and coherent selection

## OWN-1: authored objects versus entity references

Ready story: as an author, I want source selection to identify the object whose syntax I am editing, so references inside another object do not unexpectedly select their destination. [C2-OWN](../source-mapping/contracts.md#c2-own--syntax-ownership-versus-semantic-references) and [development principles](../../DESIGN.md#source-ownership-and-selection) apply to every family.

- **OWN-AC1:** Parser/semantic ownership and entity references are distinct. Selecting a reference-only property resolves to its owning object's visual bindings, retaining its relationship to the referenced entity as data. Explicit and legitimate implicit declarations retain their own provenance.
- **OWN-AC2:** A property has a separate target only when it corresponds to a distinct editable visual part. Note text can select its label; placement and attachment select the note. Native note syntax supports text, left/right placement and attachment target; there is no separately authored connector label.
- **OWN-AC3:** Visual bindings with the same exact owned source span are one logical pointer/keyboard/source selection target per SVG. They highlight together, expose their constituent AST references and use one keyboard stop. Distinct spans/instances remain separate.
- **OWN-AC4:** All currently mapped families have an independent ownership inventory and exact native/saved/live tests. Future families must satisfy this contract before support is complete. Preserve static SVG parity, source/clipboard, invalid-input recovery and disposal.

## Plan and current findings

Audit source-occurrence emission at each owning native semantic boundary: state note attachments; sequence message endpoints/notes; flowchart endpoints, grouped/chained occurrences and directives; Gantt dependencies; journey actor properties; Kanban metadata. Record whether each token is an actual declaration, a reference-only property or an independently editable visual part. Keep style relationships that bind the visual appearance they modify. Correct wrong ownership at the producer boundary, using native AST identities and ranges; do not add a parallel parser or infer owners by span length.

Start with the reported state note regression. The native state parser shares a statement structure between state declarations and notes; mapping currently exports the note attachment ID as a state occurrence. That is incorrect provenance ownership, not a viewer styling issue. The exact-range project regression fails before implementation. Next verify other reference positions against the generic contract, then consolidate same-span controls in shared activation with failing real pointer/keyboard/reverse tests. The earlier implicit-state label-only policy is superseded for equal-span visuals by the user's explicit consolidation decision; retain label-only behavior when its span differs from the containing object.

User delivery decision: fix state diagrams first. Audit and apply this rule to every previously implemented family and every family covered by the existing-family goal when the user resumes that goal. Unsupported renderer families and an editor capable of transforming ASTs remain outside the immediate state fix. The broader existing-family goal remains paused while this requested correction is addressed. No ownership or consolidation implementation is declared complete yet.
