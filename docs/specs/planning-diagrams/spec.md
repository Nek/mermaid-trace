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

Implement one story at a time in the existing Merman parser, semantic model and SVG renderer. Capture original source occurrences at their native boundaries and reuse the shared artifact, activation and Markdown host. Each new family change starts with a failing exact-span or interaction regression and retains mapped/plain SVG parity.

## Verification

Current checks live in [native planning tests](../../../mermaid-trace-rs/tests/planning.rs), [native Journey tests](../../../mermaid-trace-rs/tests/journey.rs), [saved/live browser tests](../../../mermaid-trace-ts/test/native-diagrams.test.ts) and [watch tests](../../../mermaid-trace-ts/test/watch-cli.test.ts). Run `make test typecheck` for the project gate. Gantt's 157 and Journey's 26 pinned fixtures have independent provenance/static-parity assertions. Full Gantt, Journey and Kanban conformance remains open; the completed sub-stories below do not close those family gates.

### KANBAN-2-OCCURRENCES (implemented)

Audit K1: repeated authored IDs must retain distinct column/card occurrences and their label/metadata ranges, including identical labels, cross-column cards, Unicode and CRLF. Clicking or reverse-selecting one occurrence must not select another merely because their IDs or text match. Preserve rendered geometry, authored semantic IDs, metadata values and plain/mapped SVG parity. Saved and live Markdown pointer, keyboard, source selection, clipboard and instance isolation remain mandatory.

Plan: first reproduce the collision in native and saved/live acceptance. Assign a parser-owned occurrence identity, carry it on the render model through preparation, and use it for column/card/metadata bindings. Reuse shared activation; do not relax its duplicate-label guard. Verify the pinned Kanban corpus and existing family regressions. This fixes K1 without claiming complete Kanban support or resolving the audit's open browser/fidelity decisions.

Verification: native and browser regressions first failed with the duplicate-label error. Distinct/equal labels, cross-column cards, repeated column IDs and metadata now retain separate origins. All 87 pinned Kanban fixtures render with mapped/plain SVG parity; saved/live pointer, keyboard, reverse-source, clipboard and isolation checks pass. Authored semantic IDs and SVG appearance remain unchanged; internal Kanban mapping keys now use parser occurrence identities. Existing Rust tests, 42 native core and 26 native renderer Kanban checks pass; the patch applies cleanly to the pinned archive.

[OWN-GANTT-DEPENDENCY](../source-ownership/spec.md#own-gantt-dependency-ready) retains each authored `after`/`until` ID as an exact task-owned reference with target and constraint data; selecting it does not navigate to the referenced task. Full Gantt syntax/configuration conformance remains open.

### GANTT-2-SECTION-OWNERSHIP (implemented)

As a Gantt author, I want a rendered section title to select the declaration that first contributes a visible task to that section, so an earlier unused declaration cannot claim its source. Given repeated names, noncontiguous runs, compact/default display modes, vertical-only and empty sections, each declaration retains its own original span and identity. Used same-name declarations alias the one renderer-owned title; declarations with no rendered section contribution remain nonvisual. Selecting any used declaration highlights that title, while clicking or focusing the title selects its effective declaration and copies its exact Markdown location. Do not create another title, keyboard stop or source span for the merged category. Preserve Unicode/CRLF, multiline labels, mapped/plain SVG parity, saved/live activation, instance isolation and disposal.

### GANTT-2-TITLE-ORIGINS (implemented)

As a Gantt author, I want the visible title to select the statement or frontmatter field that supplies it, while every repeated body-title statement retains its own source occurrence. Given multiple visible body titles, the last owns the displayed label and earlier statements select that same title without claiming its label. Given no body title, a visible frontmatter title owns the title. A final whitespace-only body title suppresses frontmatter fallback and has no visual selection target; retain it and earlier titles as nonvisual evidence. Preserve exact Unicode/CRLF statement and label ranges, unchanged static SVG, saved/live pointer, keyboard, source, clipboard, instance isolation and disposal. Do not make empty titles into invisible controls.

### GANTT-2-ACCESSIBILITY (implemented)

As a Gantt author, I want every `accTitle:` and `accDescr:` statement, including repeated and multiline descriptions, retained with its exact source and payload range, so the source map explains the SVG accessibility text. The last statement of each kind is effective, including an empty replacement. Accessibility records are nonvisual and create no pointer or keyboard target; source selection of one must not select an unrelated task or the whole diagram. Preserve original Unicode/CRLF spans, safe SVG accessibility output, mapped/plain static parity, saved/live metadata and existing task selection.

### GANTT-2-DIRECTIVE-ORIGINS (implemented)

As a Gantt author, I want each accepted `dateFormat`, `inclusiveEndDates`, `topAxis`, `axisFormat`, `tickInterval`, `includes`, `excludes`, `todayMarker`, `weekday` and `weekend` statement retained with its exact source and value range. Repeated statements remain distinct. These diagram-level settings shape tasks or generated axes, ticks and markers; they do not by themselves create an independently selectable visual. Selecting their source in a saved or live SVG must therefore create no phantom control or whole-diagram highlight. Exclude suffix comments from directive spans where the native parser excludes them; preserve Unicode/CRLF positions, parsed rendering behavior, mapped/plain SVG parity and existing task interaction.

### GANTT-2-CLICK-ORIGINS (implemented)

As a Gantt author, I want `click` syntax to resolve to the task interaction it edits. Retain every accepted statement with its exact original range and every parsed target ID, link URL, callback name/arguments and quoted tooltip range. For an empty quoted URL or tooltip, the quote pair is its selectable source token; do not invent value text. A target ID selects only its existing task; shared action syntax selects every existing task named by that statement. Unknown and not-yet-created IDs remain explicit nonvisual evidence and must not accidentally select another target. Repeated statements keep distinct identities. Pointer/keyboard activation of a task still selects its task declaration, and source selection of a `click` property finds its task without adding a new SVG control. Preserve native strict/loose security behavior, Unicode/CRLF positions, mapped/plain SVG parity, saved/live Markdown selection, clipboard, instance isolation and disposal. This story does not claim full Gantt syntax/configuration conformance.

### GANTT-2-TASK-FIELDS (implemented)

As a Gantt author, I want the parts of a task declaration to retain their parsed roles and exact source ranges. Each accepted leading `active`, `done`, `crit`, `milestone` or `vert` tag, explicit task ID, start field and end field belongs to that task. Selecting any such field highlights its existing task visual, without a second focus stop or an invented independent visual. `after` and `until` references inside start/end fields keep their narrower task-owned ranges and target relationships; selecting one must not navigate to the referenced task. Repeated tags retain separate occurrences. An auto-generated ID has no invented source range. Ignored suffix comments are excluded from the task statement and cannot select it. Preserve task-bar/label pointer and keyboard selection, exact Unicode/CRLF locations, saved/live Markdown selection, clipboard, mapped/plain SVG parity and the existing security/renderer behavior. This field-provenance story does not establish full Gantt syntax/configuration conformance.

### GANTT-2-REPEATED-IDS (implemented)

As a Gantt author, I want two rendered tasks with the same authored ID to remain separately selectable, because they are distinct declarations even though Mermaid's task lookup resolves the ID to the latest declaration. Clicking each bar/label selects its own statement or label and copies its own Markdown location; focus selects without copying. Selecting one declaration or its tag/date/constraint fields highlights only that task. An `after`/`until` reference remains owned by the task containing it; a later `click` statement targets the latest existing declaration of the repeated ID. Preserve parser-derived source identity across model, layout and SVG without matching display text or joining independent arrays by position. Keep the authored ID available as relationship data, emit distinct visual keys only where needed, and preserve raw SVG output after stripping inert trace attributes. Saved/live Markdown, keyboard, clipboard, multiple diagrams and disposal must pass. This story does not claim full Gantt conformance.

### GANTT-2-REPEATED-STYLES (implemented)

As a Gantt author, I want tasks with the same ID but different `done`, `active`, `crit` and `vert` tags to keep their own label styles, so their visual state does not change when another declaration reuses the ID. The pinned Mermaid 12 renderer emits `doneText`, `activeText`, `critText` and `vertText` on the respective labels, including when vertical markers draw after ordinary tasks. Preserve each task's existing source identity and raw geometry; mapped and plain SVG must agree after removing inert trace attributes. Ordinary unique-ID tasks and saved/live selection remain unchanged. This story corrects one confirmed rendering defect and does not complete Gantt conformance.

### GANTT-2-PINNED-CORPUS (implemented)

As a Gantt author, I want every task and visible title in the pinned upstream fixture corpus to retain its authored source and visual binding, so a renderer or parser change cannot silently leave a valid diagram partly selectable. For all 157 pinned Gantt fixtures, compare task count and label spans with the independently checked-in semantic goldens; require a distinct visual identity for each task declaration and bindings on every emitted task bar and nonempty task, section and diagram title. Empty generated title placeholders have no invented source. Mapped SVG must equal plain SVG after removing inert trace attributes. This corpus gate supplements exact-span, saved/live and configuration tests; it does not by itself complete Gantt conformance.

### GANTT-2-SECTION-FONT-SIZE (implemented)

As a Gantt author, I want accepted CSS-valued `sectionFontSize` settings to reach rendered section titles without losing their source bindings. Given a numeric value or an accepted string such as `1.5em`, the section title uses that value in its SVG `font-size` attribute, while its label still selects the authored section and mapped/plain SVG remains equal after removing trace metadata. This does not change task font size or layout geometry.

### GANTT-2-TICK-INTERVAL-CONFIG (implemented)

As a Gantt author, I want a configured `gantt.tickInterval` to control generated date ticks when the diagram has no `tickInterval` statement, while an authored statement still takes precedence. Given a valid configured interval and a task spanning several dates, both bottom and enabled top axes use that interval. Task, section and title source bindings, saved/live selection and mapped/plain SVG parity remain unchanged. Generated ticks have no invented source selection. Pinned Mermaid 12 uses `db.getWeekday() || conf.weekday`; its database defaults to Sunday, so a config-only `weekday: monday` does not change weekly ticks. Preserve that observed behavior in this story.

### GANTT-2-ROOT-SIZING (implemented)

As a Markdown reader, I want Gantt's `useMaxWidth` setting to survive static SVG export and embedding. With a configured `useWidth`, responsive mode uses `width="100%"` and a maximum width, while `useMaxWidth: false` emits numeric width and height; both keep the same viewBox and diagram source bindings. In a narrow Markdown container, fixed width remains fixed and can scroll, while responsive width fits the container. Saved/live pointer, keyboard, reverse-source and clipboard selection remain valid in either mode. Mapped/plain SVG bytes remain equal after removing inert trace metadata.

Safe boundary: pinned Mermaid 12 accepts `gantt.useWidth: 0` and `-1`, emitting nonpositive roots in both sizing modes. Merman's validator requires a positive root, so GANTT-2-CLIPPED-VIEWPORT uses a blank one-pixel SVG with native source evidence and no visual mapping for those inputs. This is an explicit safe-SVG root-attribute divergence, not a claim of byte parity with pinned Mermaid.

### GANTT-2-SUBPIXEL-TEXT (implemented)

As a Gantt author, I want accepted zero and subpixel `fontSize` values to measure task labels at their actual size, so a narrow bar does not move a visible small label outside it. At `useWidth: 153` and `fontSize: 0.5`, the label remains inside the bar as in pinned Mermaid 12; at `fontSize: 0`, measured label width is zero and the invisible label adds no keyboard target. Exact task/label source spans, saved/live pointer, keyboard, source and clipboard behavior, mapped/plain SVG parity and ordinary font sizes remain valid.

### GANTT-2-CROSS-LINE-TITLE-SECTION (implemented)

As a Gantt author, I want a bare `title` or `section` keyword followed by a nonempty value line to map as the single construct Mermaid actually parses, so its rendered title or section selects the original cross-line statement and the value line is not misidentified as another directive or task. Pinned Mermaid 12's Jison rules use `\\s` between these keywords and their value; with a line feed as that separator, the next ordinary line becomes the value. Full-line `%%` comments may intervene and remain inside the original statement span while the label span names only the value. This applies to LF and CRLF source. A blank next line or end of input remains invalid; a same-line value retains its existing behavior. Saved/live pointer, keyboard, source and clipboard selection and mapped/plain SVG parity must survive. This story covers these two rendered labels; the other cross-line keyword rules still require an inventory before full Gantt conformance.

### GANTT-2-CROSS-LINE-DIRECTIVES (implemented)

As a Gantt author, I want a bare `dateFormat`, `axisFormat`, `tickInterval`, `includes`, `excludes`, `todayMarker`, `weekday` or `weekend` followed by a value line to have Mermaid's accepted effect while retaining one exact, nonvisual source occurrence for the whole construct. Pinned Mermaid 12 accepts all eight with LF or CRLF and skips intervening full-line `%%` comments; the payload span selects only the actual value. The value line must not become a separate task or directive. Rendering and task ownership match the corresponding same-line form. Blank/EOF forms remain invalid, and weekday/weekend values retain their existing validation. Source selection of these settings creates no phantom SVG target; saved/live task pointer, keyboard, source and clipboard selection, and mapped/plain SVG parity remain intact.

### GANTT-2-CLICK-LINEBREAKS (implemented)

As a Gantt author, I want Mermaid-accepted line breaks within a `click` statement to retain one interaction and exact source ownership. Pinned Mermaid 12 accepts LF/CRLF between `click` and its target, between a target and `href`/`call` action, after either action keyword, between a callback name and its opening parenthesis, and inside a quoted URL or callback argument list; full-line comments can intervene where preprocessing removes them. A blank line after `click` or before a callback's opening parenthesis can still be part of the statement. The statement and each target, keyword, URL, callback and argument retain original spans. Existing-target actions select only their task; unresolved targets remain nonvisual. Rendered effect and mapped/plain SVG agree with the corresponding inline statement, and saved/live pointer, keyboard, reverse-source and clipboard behavior survives. A trailing space after the target before a line break, an incomplete statement, and a following independent task must not be silently consumed as a valid click.

### GANTT-2-ACCESSIBILITY-BLOCK-OPEN (implemented)

As a Gantt author, I want `accDescr` followed by a brace on a later physical line to remain one multiline accessibility statement, with its exact original range and description payload. Pinned Mermaid 12 accepts LF/CRLF, blank lines and intervening full-line comments between the keyword and `{`. The description is nonvisual, with no SVG keyboard or pointer target; its `<desc>` text and the following task render as in the same-line form. Source selection of the block leaves task visuals unselected, while task pointer, keyboard, source and clipboard behavior remains intact. An unrelated following task or EOF must not be consumed as a block opener. The separate `accTitle:`/`accDescr:` empty-value conflict awaits the recorded user decision and is outside this story.

### GANTT-2-SINGLE-PERCENT-COMMENTS (implemented)

As a Gantt author, I want `%` comments after the header or on its line to be ignored without losing the task or label source locations that follow them. Pinned Mermaid 12 accepts `%`, `% text`, indented `% text`, `%{invalid}` and `gantt % text`; a single-percent line before the header remains invalid. Comments create no source-backed visual or activation target. Inline `%` in a title is not silently converted to a comment. Preserve exact Unicode/CRLF task spans, mapped/plain SVG parity, and saved/live task pointer, keyboard, source and clipboard selection.

### GANTT-2-NARROW-PLOT-WIDTH (implemented)

As a Gantt reader, I want a positive configured width at or below the sum of side paddings to avoid a fabricated one-pixel task bar. Pinned Mermaid 12 computes signed plot and bar widths: `useWidth: 149` yields `-1`, `150` yields `0`, and `151` yields `1` with default paddings. Trace's safe SVG drops nonpositive rectangles while retaining the source-backed task label where it is visible; the label's class and x-position follow the signed layout, and its pointer, keyboard, reverse-source and clipboard selection remain intact in saved and live Markdown. No invisible rectangle receives a keyboard stop. Mapped/plain static output must agree after removing trace metadata. The zero-width root safety boundary is specified below.

### GANTT-2-CLIPPED-VIEWPORT (implemented)

As a Markdown reader, I want an authored nonpositive-width Gantt to stay visually empty, and any source-backed visual wholly clipped by the SVG viewport to stay out of keyboard selection. Pinned Mermaid 12 accepts `useWidth: 0` and `-1`, emitting nonpositive roots whose content cannot be seen. The safe static SVG keeps a positive one-pixel root to satisfy the existing validator, but emits no fabricated visible axis or task geometry; parser provenance remains in native metadata while the public visual map has no pieces. At a positive narrow width, source-backed labels fully outside a clipped viewport remain in the artifact but have no pointer or keyboard target. A label that intersects the viewport remains selectable with exact source and clipboard location. This exposure rule applies to saved SVG activation across diagram families; an explicitly visible-overflow root does not clip its targets. Source selection never highlights an invisible target, and the diagram background still selects the diagram.

### GANTT-2-LATE-EXPOSURE (implemented)

As a host embedding a saved SVG, I want target exposure to follow the diagram's current layout even if activation starts while the SVG is hidden or detached. When a narrow Gantt becomes visible, its clipped task and section labels have no keyboard stop or selection highlight; when overflow is explicitly made visible, those labels become selectable, and hiding overflow removes their stops again. A visible task label still has one focus representative and exact source/clipboard location. Source mappings remain available throughout, and disposal restores original attributes and stops observing changes. The same rule applies to every diagram through the shared activator, including live Markdown previews.

### GANTT-2-TICK-INTERVAL-LEXICAL (implemented)

As a Gantt author, I want axis ticks to follow Mermaid's exact `tickInterval` syntax, so a malformed configured interval falls back to automatic ticks without changing my task's source mapping. Pinned Mermaid 12 accepts `1day` and `2day`, but rejects a leading zero or surrounding spaces. For a fixed fifteen-day task at width 600, `1day` yields 16 ticks while `2day`, `01day`, ` 1day` and `1day ` yield eight. Ticks are generated decoration with no source target; the authored configuration retains exact nonvisual provenance. Mapped/plain SVG parity and saved/live task selection remain mandatory.

Kanban currently maps columns, cards and metadata through native source ownership, with saved/live activation. Its full syntax/configuration inventory remains open.

[OWN-JOURNEY-ACTOR](../source-ownership/spec.md#own-journey-actor-ready) supersedes name-only task-circle identities and automatic selection of the legend from later actor references. Native people-property slots remain distinct, including repeated actors within a task; the first implicit declaration owns the legend and its same-span local circle as one group. Sectionless tasks and tasks before sections remain rendered/selectable. Full journey syntax/configuration conformance is still required.

[OWN-JOURNEY-SECTION](../source-ownership/spec.md#own-journey-section-ready) preserves distinct parser-backed section runs when names repeat, retaining contiguous merging, effective label ownership, empty frames and explicit nonvisual declarations. Section layout semantics and plain SVG geometry are unchanged.

## JOURNEY-2: full family conformance

As an author, I want every supported journey construct and configuration to preserve its original source ownership through rendering and activation. Completion requires all 26 pinned journey fixtures, independent semantic expectations, and the complete grammar/configuration inventory; representative rendering alone is insufficient.

Inventory: header/empty diagrams; body and YAML titles (including precedence and repeated declarations); accessibility title and single/multiline descriptions; section declarations, aliases and empty/unused sections; task labels and HTML line breaks; numeric, empty and nonnumeric scores; duplicate/empty actor slots and wrapped legends; comments, directives, frontmatter, Unicode and CRLF. Configuration coverage includes margins, dimensions, fonts, title styles, actor/section palettes, `sectionColours`, `textPlacement`, maximum width, themes, looks and HTML labels. Distinguish options actually consumed by the pinned renderer from schema fields with no journey behavior. Preserve exact authored occurrences, classify generated/nonvisual parts honestly, and verify plain/static parity plus saved/live pointer, keyboard, source, clipboard, isolation and disposal.

The selected Mermaid 11.17.2 [schema](https://raw.githubusercontent.com/mermaid-js/mermaid/mermaid%4011.17.2/packages/mermaid/src/schemas/config.schema.yaml) permits zero `width`/`height` and signed numeric `taskMargin`. The inventory below tracks the complete configuration requirement; corrected boundary cases do not establish full conformance:

| Configuration | Drawing behavior / remaining evidence |
| --- | --- |
| `leftMargin`, `maxLabelWidth`, `boxTextMargin` | LEGEND below covers zero/negative/narrow/wide wrapping, configured text margins and effective font sizing; the wider font/theme inventory remains required. |
| `diagramMarginX`, `diagramMarginY`, `taskMargin`, `width`, `height` | Section/task geometry, activity line and root bounds; GEO below verifies boundaries and combined values, with upstream clipping kept explicit. |
| `taskFontSize`, `taskFontFamily`, `titleFontSize`, `titleFontFamily`, `titleColor`, root/theme fonts | Text mode/style behavior is covered by JOURNEY-2-FONTS; combined palette/theme presentation remains under PALETTE. |
| `actorColours`, `sectionFills`, `sectionColours`, theme variables/themes | Effective palette cycles and CSS precedence; text story covers section text palettes, PALETTE below covers the combined theme/actor matrix. |
| `textPlacement`, `useMaxWidth`, look, HTML labels | Text story covers modes and look/HTML variants; ROOT below covers responsive/fixed root behavior in saved SVG and Markdown. |
| `boxMargin`, `noteMargin`, `messageMargin`, `messageAlign`, `bottomMarginAdj`, `rightAngles`, `activationWidth` | Present in the journey schema but without visual effect in the pinned renderer; IGNORED below verifies output and authored nonvisual configuration provenance. `boxMargin` is read only by a bounds loop whose item list stays empty for Journey. |

### JOURNEY-2-PALETTE (implemented)

As an author, I want Journey colors to follow the selected theme and accepted palette configuration while visual/source ownership remains stable. **PALETTE-AC1:** computed actor, task/section, legend, face and line colors match the pinned renderer across all five supported themes, with and without explicit theme-variable overrides. Compare computed CSS, not only SVG `fill` attributes. **PALETTE-AC2:** effective `actorColours`, `sectionFills` and `sectionColours` append unique configured values to Mermaid's default arrays and cycle by native actor and section-run identity; theme `actorN` and `fillTypeN` CSS overrides retain their documented precedence over paint attributes. Source-only configuration remains nonvisual. **PALETTE-AC3:** mapped/plain SVG parity and exact actor/section/task ownership survive saved and live Markdown selection, pointer, keyboard, clipboard, isolation and disposal across looks, HTML labels and text modes.

### JOURNEY-2-ROOT (implemented)

As a Markdown reader, I want Journey's `useMaxWidth` setting to survive embedding, so a fixed-width diagram stays fixed and a responsive diagram fits its container. **ROOT-AC1:** both modes retain the pinned renderer's root width, height, viewBox and aspect-ratio attributes across configured dimensions, title presence, looks and HTML settings; mapped and plain SVG remain visually identical. **ROOT-AC2:** in the live Markdown preview, fixed width remains its emitted numeric width even in a narrow container, which can scroll horizontally; responsive width follows the container up to the emitted maximum. The SVG's emitted height remains effective. **ROOT-AC3:** resizing does not alter exact task/section/actor source ownership, pointer or keyboard selection, clipboard location, reverse source selection, instance isolation or saved-SVG activation.

### JOURNEY-2-IGNORED (implemented)

As an author, I want accepted Journey configuration to retain its exact source even when it does not affect the diagram. **IGNORED-AC1:** each of the seven options above, individually and combined, leaves pinned Mermaid 11.17.2 SVG unchanged across looks and HTML settings; Trace preserves the same visible result and mapped/plain parity. **IGNORED-AC2:** original frontmatter and directive key/value occurrences retain exact spans, origin and source order as nonvisual metadata, with no invented SVG target. **IGNORED-AC3:** saved/live diagrams retain task, section and actor pointer/keyboard/reverse-source/clipboard behavior, and selecting one of these configuration values does not select a diagram object.

### JOURNEY-2-ACTOR-UNICODE (implemented)

As an author, I want actor identities and visual ownership to retain Mermaid's Unicode semantics. **ACTOR-AC1:** trim each people slot using ECMAScript whitespace, including BOM and excluding NEL; sort unique legend names by UTF-16 code units. Task order and duplicate/empty slots remain unchanged. **ACTOR-AC2:** model, typed layout, actor colours, SVG bindings and exact original UTF-16/CRLF ranges agree. Each later slot stays local; the first real occurrence and its legend form one selection group. Empty slots get no invented source range. **ACTOR-AC3:** saved/live pointer, keyboard, reverse-source, automatic clipboard, isolation and disposal pass across renderer looks/HTML settings, with plain/static parity and all project gates retained.

Reference: the pinned Mermaid 11.17.2 journey DB uses `split(',').map(s => s.trim())` and `[...new Set(names)].sort()`. It retains NEL around a name, removes BOM, and orders ASCII → NEL → astral emoji → BMP private-use. Exact ownership and saved/live selection remain required for those forms.

### JOURNEY-2-LEGEND (implemented)

As an author, I want wrapped actor legends to preserve configured widths and exact actor ownership. **LEGEND-AC1:** retain `maxLabelWidth`, including zero and negative values admitted by the pinned schema, and the pinned word/hyphen wrapping algorithm. Preserve configured text margins, root/theme font measurement and legend/task positioning; do not silently drop generated lines. Browser font measurement remains a documented native residual. **LEGEND-AC2:** every wrapped line, legend circle and first task-local actor circle forms the same source-owned group and keyboard stop. Later actor references remain task-local. Preserve exact Unicode/CRLF source, automatic clipboard, saved/live pointer and reverse selection, instance isolation and disposal. **LEGEND-AC3:** retain mapped/plain parity and all existing fixture/project gates.

### JOURNEY-2-FONTS (implemented)

As an author, I want journey task, section and title fonts to honour their accepted configuration while source selection continues to identify actual visible parts. **FONT-AC1:** `taskFontSize` retains zero, fractional and signed numbers, numeric strings and CSS-sized strings. `tspan` and `fo` fallback text use its CSS size and native JavaScript-number line offsets; `old` ignores the task font settings. Preserve the accepted `taskFontFamily`, root/theme font inheritance, title size/family/colour and their precedence. **FONT-AC2:** the safe static SVG must display CSS-unit labels that the pinned browser renders despite its `dy="NaN"`: use the browser's effective zero offset instead of dropping the text through invalid-geometry sanitation. Do not invent glyphs for a genuinely zero-size fallback label; source selection of an invisible label resolves to the owning task/section, while independently visible labels remain selectable. A zero-size title retains source provenance without an invisible keyboard target. **FONT-AC3:** require exact original source ownership, mapped/plain static parity and saved/live pointer, reverse-source, keyboard, clipboard, isolation and disposal across looks, HTML labels and text modes. Browser font measurement and foreignObject-versus-fallback glyph metrics remain measured residuals, not permission to lose semantic controls.

Reference: pinned Mermaid 11.17.2 styles tspan/fallback task text with `taskFontSize` and `taskFontFamily`, computes line `dy` using JavaScript multiplication, ignores task fonts in `old`, and writes title font attributes directly. Zero has no glyph bounds; CSS sizes such as `24px`, `1em` and `120%` can yield `dy="NaN"` while retaining visible glyphs. Mode-specific SVG attributes and browser-computed visibility remain part of acceptance.

### JOURNEY-2-GEOMETRY-CONFIG (implemented)

As an author, I want journey dimensions and task spacing to retain their configured meaning instead of being silently enlarged. **GEO-AC1:** zero width/height remain zero in typed layout, raw task/section rectangles, score centers and the activity line; signed `taskMargin` shifts subsequent tasks using `i * (width + taskMargin)`. Positive and combined margins/dimensions follow the pinned drawing formulas. Preserve existing defaults and nonnegative-dimension guards; this story does not change the accepted configuration contract. **GEO-AC2:** safe export continues to omit zero-area rectangles, retaining native source identities on visible task lines and labels/score controls; no fabricated geometry or diagram-only fallback. Saved/live pointer, keyboard, reverse-source selection and clipboard remain coherent and isolated. **GEO-AC3:** mapped/plain SVG stays equal, existing fixtures remain unchanged, and full project checks pass.

Viewport audit: the pinned journey formulas can clip section labels at strongly negative spacing and task labels at large heights. Root artifact tests retain these cases and assert the original bounds; interaction cases use margins that keep their targets exposed. Covered or clipped regions must not receive forced clicks or invented hit geometry. This upstream geometry limitation remains explicit in the full configuration audit; these checks establish mapping of visible parts, not absence of upstream clipping.

### JOURNEY-2-TITLE (implemented)

A visible YAML title selects its exact parser-backed value range; reverse selection of its field/value identifies that title. A body title retains precedence and its own source mapping. Absent/empty titles create no invisible keyboard control. Cover plain/quoted/escaped/alias/literal/folded YAML, CRLF/Unicode, all three looks and both HTML-label settings, preserving unannotated SVG output.

Title replacement and accessibility provenance are specified under JOURNEY-2-OCCURRENCES below. Shared configuration evidence applies across mapped families under [OWN-CONFIG](../source-ownership/spec.md#own-config-ready).

### JOURNEY-2-OCCURRENCES (implemented)

Retain every body-title/accessibility statement with exact original statement and payload spans, including repeats, empty values, keyword-shaped payloads, comments, Unicode/CRLF and inline/multiline descriptions. The latest body title owns displayed text; earlier nonempty declarations may select the same title object but never own its current label. When the final body title has no visible text, retain body-title records as nonvisual and let a visible YAML fallback own itself. Preserve native precedence: an empty body title permits YAML fallback, while a whitespace body title suppresses it. Accessibility statements remain nonvisual with independent last-write origins for title and description, including empty values; no invisible keyboard targets. Preserve native parsing, sanitization, geometry and error handling.

### JOURNEY-2-TEXT (implemented)

Journey text placement follows Merman's selected Mermaid 11.17.2 source: default `fo` keeps its foreignObject/SVG fallback; `old` emits a single text node with literal break markup; `tspan` and other mode strings split `<br>` variants into positioned SVG text lines. Each authored label remains one source target across its lines, with exact node/section ownership and saved/live interaction. Safe export retains the wrapper's label identity and all native fallback lines; mapped/plain parity remains mandatory.

Use effective native configuration and the existing merge/sanitization rules. In tspan mode, sections/tasks receive the section-run colour palette, independently of fill-palette length; unsectioned tasks start black. Preserve source behavior: FO/old do not apply the colour argument; section CSS can override the tspan fill attribute. Native palette arrays merge with defaults through the existing effective-configuration path, including accepted per-diagram overrides; preserve this working behavior and test its actual merge order. The pinned Mermaid renderer instead captures palette arrays at module load, so its per-diagram palette changes do not reach drawing. This upstream lifecycle difference is not array sanitization and must not be emulated with process-global cached palettes. Do not infer a new array replacement policy or override the CSS cascade to make colours appear different.

### JOURNEY-2-SCORE-GEOMETRY (implemented)

An accepted score whose face cannot render must not create default-position face/eye/mouth shapes during safe export or invisible score controls. Retain its exact authored property and owning-task identity as explicitly unrenderable provenance; selecting that source selects the task, whose editable label remains separate. Empty scores retain their existing default face without an invented property span. Preserve finite score behavior and raw rendering, including generated defaults.

### JOURNEY-2-SCORE-NUMBERS (implemented)

As an author, I want every accepted journey score to retain the pinned renderer's `Number(...)` semantics and exact source ownership. **SCORE-AC1:** preserve fractions, signs, decimal/exponent and unsigned binary/octal/hexadecimal forms, JS whitespace, empty/default values, NaN, infinity, overflow and IEEE rounding. Compute face placement and mouth from the original numeric value; never truncate or clamp it. **SCORE-AC2:** renderable score visuals form one source group; unrenderable derived geometry retains nonvisual provenance and selects the complete owning task. Labels and actor properties keep their distinct ownership. **SCORE-AC3:** preserve integer fixture serialization and plain/static parity; require independent semantic/coordinate expectations plus saved/live source, pointer, keyboard, clipboard, isolation and disposal checks.

Numeric reference: Merman’s selected Mermaid 11.17.2 journey `addTask` calls `Number`, and `drawTasks` computes `300 + (5 - score) * 30`. The checked-in score corpus records Node 24.19.0 expectations for the [ECMAScript StringToNumber grammar](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-stringtonumber), including exact IEEE bits; tests do not derive expectations from the implementation.

### JOURNEY-2-DELIMITERS (implemented)

As an author, I want Journey punctuation to follow the pinned Mermaid grammar so that accepted accessibility text and source ownership are preserved without silently accepting invalid diagram statements. **DELIM-AC1:** `#` starts an inline comment in journey headers, titles, sections and tasks; `;` there is a syntax error, including at end of line. **DELIM-AC2:** inline `accTitle:` and `accDescr:` payloads retain literal `#` and `;` in their semantic values and exact nonvisual source occurrences. A `#` comment before a `;` hides the suffix. Preserve full-line comments, multiline accessibility descriptions, existing valid visuals and mapped/plain parity.

### JOURNEY-2-PERCENT-COMMENTS (implemented)

As an author, I want the pinned Journey comment grammar to accept `%` or `%%` after the `journey` header and on full comment lines without changing visible text that contains percent signs. **PERCENT-AC1:** both comment forms render and contribute no invented selectable objects; a `%{` sequence remains invalid unless handled as a valid Mermaid directive by preprocessing. **PERCENT-AC2:** percent signs inside title, section, task and accessibility payloads remain literal and keep exact source spans. Existing valid SVG, source selection and mapped/plain parity must survive.

### JOURNEY-2-SECTION-SYNTAX (implemented)

As an author, I want a Journey `section` line with a colon to fail like pinned Mermaid, so Trace never renders a different diagram after silently discarding part of my source. **SECTION-SYNTAX-AC1:** `section Work: Zone`, `section Work:` and their whitespace variants are syntax errors, with the offending colon identified. **SECTION-SYNTAX-AC2:** ordinary sections, repeated section runs and comment-trimmed suffixes retain their current identities, source spans and static output; no invalid line acquires a selectable section.
