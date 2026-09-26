# WATCH-1 — file preview CLI

Status: preview infrastructure implemented and verified (2026-09-26); element coverage is incomplete. The user subsequently clarified that all diagram types require element mapping; [S6/C8](../diagram-coverage/spec.md) supersedes diagram-only selection as product acceptance. As a diagram/document author, I want a CLI to watch a Markdown or Mermaid file and refresh a browser preview after saves, with selection highlighting and no editor/debug UI.

Scope: `mermaid-trace watch <file.md|file.mmd> [--port N]`, localhost-only preview, standard fenced `mermaid` Markdown integration, existing mapping and clipboard behavior. Decision: view either input type directly. The optional clarification received no answer; external `.mmd` embedding is outside this story. No export/publishing or new Markdown syntax.

## Contracts

- **WATCH-AC1:** The CLI accepts `.md`, `.markdown`, `.mmd`, `.mermaid`; `--help` documents usage. Port 0 can request an available port. Invalid arguments/files fail with a useful terminal diagnostic. It runs from another working directory using installed/compiled runtime paths.
- **WATCH-AC2:** Saving or atomically replacing the input rerenders and reloads the open page, including Mermaid changes. Rebuilds are serialized and outdated results are not published. Invalid edits preserve the last good page, report errors in the terminal and recover on the next valid save. SIGINT/SIGTERM close watchers/server and renderer resources.
- **WATCH-AC3:** By default, page contains only rendered document/diagram and highlighting. Without `--source`, no source pane; no toolbar, filename/status widgets, occurrence buttons, or error overlay. Block/heading and precise mapped flowchart node/connector/label focus/click update one selection; native rendered-text drags highlight text. Click/Enter/Space/drag completion still copies its original location. No clipboard writes on focus alone. Local Markdown assets retain normal renderer behavior.
- **WATCH-AC4:** Standard Mermaid fenced code works through the existing stock Markdown adapters. Browser activation loads no Mermaid/parser. SVG is static before activation. IDs stay scoped. HTML input remains safe.
- **WATCH-AC5:** Sequence diagrams render in Markdown and standalone Mermaid files. Check actual upstream/fork support: the current fork rejects `{sourceMap:true}` for sequence diagrams. The current prototype is explicitly diagram-only for these types, an incomplete state rather than supported element mapping; no guessed participant/message locations. Record this limit in terminal/docs and verify rendering/background selection separately from precise flowchart mapping.

## Plan / research

[markdown-it's CLI](https://github.com/markdown-it/markdown-it/blob/master/bin/markdown-it.mjs) is one-shot and has no watch option. [Mermaid CLI](https://github.com/mermaid-js/mermaid-cli#transforming-a-markdown-document-with-mermaid-diagrams) uses fenced `mermaid` blocks and renders through Mermaid. Reuse our standard markdown-it/mdast provenance path, explicit Mermaid public API, and installed [Vite middleware/watcher](https://vite.dev/guide/api-javascript.html) for file events and full reloads. Disable Vite error overlays. No parallel file watcher, regex Markdown parser or extra runtime dependency.

Extract the existing pinned browser render backend for CLI reuse without changing baseline rendering. A viewer mode detects diagrams using Mermaid's public detector: flowcharts require the fork's exact mapping; sequence/other types render normally with explicit diagram-only metadata. Keep strict mapped-test mode unchanged. Add a small browser consumer of existing activation/mapping modules with no demo controls. Serve generated HTML and bounded runtime modules with a Vite plugin. A Node HTTP server owns listening/shutdown; Vite middleware mode avoids Vite's process-exit handler interrupting renderer cleanup. The initial render does not broadcast a reload: Vite buffers it for the first client and would cause an unnecessary startup navigation.

Tests first: CLI argument failures and real browser/file integration; Markdown + standalone sequence; selection clipboard with no UI; successful saves, rename saves, failure/recovery, local assets and shutdown. Preserve baseline tests. Verify and commit renderer extraction and CLI stories atomically when complete.

## Verification

TDD: new CLI/integration tests failed before implementation because the entry points did not exist. Additional real checks caught Vite's SIGTERM exit handler, buffered startup reload, and Copy being overwritten by a keyup handler; each was corrected before delivery.

| Contract | Evidence | Result |
|---|---|---|
| WATCH-AC1 | CLI help/invalid arguments/missing file; actual CLI from temporary cwd with compiled runtime | Passed |
| WATCH-AC2 | Real file saves, atomic rename, overlapping Mermaid rebuilds, parse failure/last-good retention/recovery, plain Markdown saves, server closure and SIGTERM | Passed |
| WATCH-AC3 | Chromium heading, native text drag + normal Copy, unlabeled edge hit target, label clipboard range, no source/status/control UI | Passed |
| WATCH-AC4 | Standard fences, local image, scripting-disabled SVG display, loopback-only requests and no parser/renderer in browser; existing isolation/sanitization tests | Passed |
| WATCH-AC5 | Sequence SVG in Markdown and standalone `.mmd`, whole-fence/file location selection | Passed; element mappings unavailable |

`corepack pnpm test`: 18/18 passed. `corepack pnpm run typecheck` and `git diff --check`: passed. Existing raw SVG baselines and environment are unchanged. Sequence probe: normal SVG rendering succeeds; strict fork mapped render fails with `Source maps are not supported for sequence`. Manual in-app inspection verified the minimal document, both diagrams and keyboard label highlighting at `http://127.0.0.1:5174/`. Pointer/clipboard checks are automated in Chromium; browser permission policies may deny clipboard writes, which are logged in its console. Broader browser acceptance remains pending.

The source-view demo remains available separately. No new dependency, external include convention, GFM support, sequence AST/participant/message mapping or browser-free renderer was added.

## Merman migration (2026-09-26)

[MERMAN-1](../merman-backend/spec.md) now owns producer routing. Non-flowchart diagrams use the pinned Merman native Node addon and safe static SVG pipeline. Flowcharts keep the legacy mapped producer until native source-map parity. One engine is reused across rebuilds and disposed during preview shutdown, including initialization errors. Runtime browser modules remain unchanged. The native binding does not expose occurrence spans; exact sequence/all-family selection remains incomplete. The earlier browser-detector viewer mode has been removed.

The live preview, original-file clipboard selections, static display, save/rename/recovery and actual CLI shutdown tests pass after migration. Current full suite: 20/20 tests. The new native producer test also proves the sequence SVG bytes come from Merman and that retained flowcharts still contain mapped labels.

## WATCH-SOURCE-1: optional source selection

As a preview user, I want an optional original-source pane so I can see exactly what a selected Markdown or diagram piece refers to and select source to highlight matching visuals. Ready story; applies to the native Rust preview.

- **WATCH-SOURCE-AC1:** `watch <file> --source` and `watchPreview(file, { sourceView: true })` show a read-only source pane for Markdown and standalone Mermaid. Default output stays minimal. No copy button or editing controls.
- **WATCH-SOURCE-AC2:** Preview focus/click/text selection selects the exact original range using native text selection, scrolling it into view without stealing preview focus. Source selection highlights matching diagram pieces or the smallest enclosing Markdown block. Ordinary Copy in the source pane copies selected text; preview activation still copies its location.
- **WATCH-SOURCE-AC3:** Saves reload both views with current source and mappings. Source is escaped as text, preserves exact UTF-16 offsets (including CRLF), and cannot execute markup.

Plan: extract the existing demo's native iframe selection helper and reuse it in both consumers; add an opt-in pane to the watch host and CLI boolean. Keep producer and SVG artifact unchanged. Browser regression checks cover default absence, optional pane, bidirectional selection, scrolling/focus, native Copy, safe exact source and saves; actual CLI checks cover flag wiring. No new dependencies.

Verification: CLI help/unknown-option tests and the source-pane regression failed before implementation (missing flag/pane). A visual check exposed vertical centering; a failing layout assertion now prevents it. `corepack pnpm test` passed 3 Rust integration and 22 TypeScript/browser tests; after the final CSS fix all 22 TypeScript/browser tests passed again. Typecheck passed. The existing demo also passes with the shared helper.

| Contract | Evidence | Result |
|---|---|---|
| WATCH-SOURCE-AC1 | Actual CLI `--source`, opt-in Markdown and standalone Mermaid; existing default absence check | Passed |
| WATCH-SOURCE-AC2 | Native label range, source scroll and retained preview focus, normal Copy, reverse label/heading selection, whole-file range | Passed |
| WATCH-SOURCE-AC3 | Escaped script-like text, CRLF/Unicode offsets, source refresh after save | Passed |

Manual in-app inspection at port 5174 verified the pane and visible source highlighting; preview remains running with `--source`. Clipboard and precise sequence ranges are verified in Chromium. No Rust/producer changes, dependencies or editing UI.

## Shutdown regression

WATCH-AC2 also requires shutdown to terminate outstanding HTTP connections, including incomplete browser requests during reload. A source-pane regression intermittently hung while closing its preview. A bounded raw-client test reproduced the root cause: `http.close()` waited for an unfinished request. Stop accepting connections, then use Node's `closeAllConnections()` to release them before closing the renderer. Existing browser save/reload/shutdown assertions remain mandatory. The bounded regression failed before the fix and now passes; browser save/reload and source-pane shutdown checks also pass.

## WATCH-CACHE-1: leave document directories unchanged

After language tooling separation, previews must not create JS tooling beside the input. The existing live acceptance test asserts the document directory retains exactly its Markdown and asset files. It fails with an unexpected `.vite` directory. Plan: disable Vite dependency discovery using its existing `optimizeDeps.noDiscovery` option; the browser uses only Trace modules and Vite’s own client, with no bare dependencies to optimize. Keep asset resolution, watching and reload behavior unchanged. Verification: the existing regression failed with `.vite` present before the fix. `make typecheck test` then passed all 6 Rust and 24 TypeScript/browser tests, including assets, clipboard, saves/recovery and optional source selection.
