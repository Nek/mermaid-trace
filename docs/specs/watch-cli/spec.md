# WATCH-1 — file preview CLI

Status: preview infrastructure implemented and verified (2026-09-26); element coverage is incomplete. The user subsequently clarified that all diagram types require element mapping; [S6/C8](../diagram-coverage/spec.md) supersedes diagram-only selection as product acceptance. As a diagram/document author, I want a CLI to watch a Markdown or Mermaid file and refresh a browser preview after saves, with selection highlighting and no editor/debug UI.

Scope: `mermaid-trace watch <file.md|file.mmd> [--port N]`, localhost-only preview, standard fenced `mermaid` Markdown integration, existing mapping and clipboard behavior. Decision: view either input type directly. The optional clarification received no answer; external `.mmd` embedding is outside this story. No export/publishing or new Markdown syntax.

## Contracts

- **WATCH-AC1:** The CLI accepts `.md`, `.markdown`, `.mmd`, `.mermaid`; `--help` documents usage. Port 0 can request an available port. Invalid arguments/files fail with a useful terminal diagnostic. It runs from another working directory using installed/compiled runtime paths.
- **WATCH-AC2:** Saving or atomically replacing the input rerenders and reloads the open page, including Mermaid changes. Rebuilds are serialized and outdated results are not published. Invalid edits preserve the last good page, report errors in the terminal and recover on the next valid save. SIGINT/SIGTERM close watchers/server and renderer resources.
- **WATCH-AC3:** Page contains only rendered document/diagram and highlighting. No source pane, toolbar, filename/status widgets, occurrence buttons, or error overlay. Block/heading and precise mapped flowchart node/connector/label focus/click update one selection; native rendered-text drags highlight text. Click/Enter/Space/drag completion still copies its original location. No clipboard writes on focus alone. Local Markdown assets retain normal renderer behavior.
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
