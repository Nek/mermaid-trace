# Markdown provenance

**MD-1 — implemented:** As a Markdown viewer user, I want diagram selections to refer to the original document, including nested fences, so my editor selects the right text.

Scope: markdown-it adapter and DOM-free bidirectional offsets. Out of scope: unified, VS Code messaging, editing, artifact v1, and rendering additional diagram types. Depends on the existing static producer and experimental format. No blocking questions.

## Contracts and acceptance

- **MD-AC1:** Parse with pinned markdown-it, retaining document ID, revision, original text, and separate block IDs. Plain, indented, list and blockquote fences preserve exact UTF-16 offsets, Unicode, tabs retained in content, and CRLF/CR normalization. Identical blocks remain distinct.
- **MD-AC2:** A logical selection maps to exact original segments, excluding stripped Markdown prefixes, plus an explicitly enclosing editor range. Original selections map back to logical spans; selecting only a stripped prefix yields nothing. Ranges are end-exclusive; invalid bounds and stale document identity/revision/text fail explicitly.
- **MD-AC3:** Render prepared, trusted SVG artifacts synchronously through markdown-it after asynchronous production. Ordinary fences retain markdown-it rendering; source HTML stays disabled. Missing artifacts fail. Host supplies a safe, page-unique namespace and is responsible for sanitizing untrusted SVG before insertion.
- **MD-AC4:** Mapping uses parser-provided line numbers and verified line suffix correspondence, never a document-wide text search. If indentation expands tabs into synthetic spaces, report unsupported provenance; do not guess. Unterminated fences are supported when their content corresponds exactly to original lines. NUL normalization preserves offsets.

## Plan and decisions

Use markdown-it's public token content/map and default fence renderer. Its published v15.0.2 `normalize`, `fence`, and `StateBlock.getLines` implementations establish line preservation and prefix removal. Keep pure coordinate translation in `markdown-source.ts`, separate from `markdown-it.ts`, so the browser consumer need not load Markdown parsing. Store contiguous text runs and newline runs (one logical LF may correspond to two original CRLF units). Merge adjacent result spans. Empty selections are carets with half-open containment; end-of-input has no containing character.

Tests first: real parser integration with nested/repeated blocks and independently calculated spans; negative/stale inputs; normal fence and HTML escaping. Then implement, run typecheck and targeted tests, update docs, inspect and commit. No additional utility dependency is needed; markdown-it 15 supplies its own types.

| Criterion | Check | Status |
|---|---|---|
| MD-AC1/2 | Exact forward/reverse offsets, containers, repeated blocks, Unicode/newlines | Pass: `test/markdown.test.ts` |
| MD-AC3 | Prepared SVG consumption, ordinary fences, escaped HTML, missing artifacts | Pass: `test/markdown.test.ts` |
| MD-AC4 | Unsupported expansion, NUL and unterminated input | Pass: `test/markdown.test.ts` |

Verification: three behavior tests failed against unimplemented functions, then passed after implementation; TypeScript build passed. Browser integration is the next story. `prepareMarkdown(document, namespace)` returns readonly blocks and a synchronous `render(artifacts)` closure. `toMarkdown`/`fromMarkdown` require the current document for stale checks. The adapter uses the stock parser; third-party Markdown plugins are not yet an API surface.
