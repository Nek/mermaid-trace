import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareMarkdown } from '../src/markdown-it.js';
import { renderMarkdownView } from '../src/markdown-view.js';

test('DOC-AC6: tables retain alignment, nested cell/text provenance and safe inline content', () => {
  const source = '> | Name | Status | Code |\r\n> | :--- | :---: | ---: |\r\n> | **same** | same &amp; 😀 | `a\\|b` |\r\n> | x\\|y | [unsafe](javascript:alert(1)) | <script>bad()</script> |\r\n\r\n```mermaid\r\nflowchart LR\r\nA --> B\r\n```\r\n';
  const document = { id: 'table.md', revision: '1', source };
  const { blocks } = prepareMarkdown(document, 'table');
  const view = renderMarkdownView(document, blocks, new Map([[blocks[0]!.id, '<svg></svg>']]));
  assert.match(view.html, /<table\b/);
  assert.match(view.html, /<th align="left"/);
  assert.match(view.html, /<th align="center"/);
  assert.match(view.html, /<th align="right"/);
  assert.doesNotMatch(view.html, /<script|href="javascript:/);
  assert.match(view.html, /data-mt-block="table-0"/);
  assert.equal(view.targets.filter(t => t.kind === 'table').length, 1);
  assert.equal(view.targets.filter(t => t.kind === 'tr').length, 3);
  assert.equal(view.targets.filter(t => t.kind === 'th').length, 3);
  assert.equal(view.targets.filter(t => t.kind === 'td').length, 6);
  const cell = view.targets.find(t => t.kind === 'td' && source.slice(t.span.start, t.span.end).includes('**same**'))!;
  assert.equal(source.slice(cell.span.start, cell.span.end), '| **same** ');
  assert.ok(view.texts.every(t => t.exact && t.origins.length === t.value.length));
  for (const value of ['a|b', 'x|y']) {
    const text = view.texts.find(t => t.value === value)!;
    assert.ok(text, value);
    const pipe = text.origins[1]!;
    assert.equal(source.slice(pipe.start, pipe.end), '\\|');
  }
  const repeated = view.texts.filter(t => t.value.startsWith('same'));
  assert.equal(repeated.length, 2);
  assert.notEqual(repeated[0]!.origins[0]!.start, repeated[1]!.origins[0]!.start);
});

test('DOC-AC6: table boundaries, missing cells, lists and invalid tables keep honest source ranges', () => {
  for (const source of ['A | B\n--- | ---\none\n', '- A | B\n  --- | ---\n  one | two | ignored\n']) {
    const view = renderMarkdownView({ id: 'table.md', revision: '1', source }, [], new Map());
    assert.match(view.html, /<table\b/);
    assert.ok(view.targets.every(t => t.span.start < t.span.end && t.span.end <= source.length));
    assert.ok(view.texts.every(t => t.exact));
    assert.doesNotMatch(view.html, /ignored/);
  }
  const view = renderMarkdownView({ id: 'plain.md', revision: '1', source: 'A | B\n---\none | two\n' }, [], new Map());
  assert.doesNotMatch(view.html, /<table\b/);
});

test('DOC-AC6: code cell pipe escapes preserve literal backslash pairs and character offsets', () => {
  for (const count of [1, 3, 5]) {
    const raw = 'a' + '\\'.repeat(count) + '|b';
    const source = '| Code |\n| --- |\n| `' + raw + '` |\n\n`a\\|b`';
    const view = renderMarkdownView({ id: 'code-table.md', revision: '1', source }, [], new Map());
    const code = view.texts[1]!;
    assert.equal(code.value, 'a' + '\\'.repeat(count - 1) + '|b');
    assert.ok(code.exact);
    assert.equal(source.slice(code.origins[count]!.start, code.origins[count]!.end), '\\|');
    for (let i = 1; i < count; i++) assert.equal(code.origins[i]!.end - code.origins[i]!.start, 1);
    assert.equal(view.texts.at(-1)!.value, 'a\\|b', 'ordinary code keeps its backslash');
  }
});

test('DOC-AC1/2/3: Markdown AST positions preserve text, heading and fence provenance safely', () => {
  const source = '# First\r\n\r\n> same **same** &amp; 😀\r\n> next \\*word\\* and `code`\r\n\r\n```mermaid\r\nflowchart LR\r\nA --> B\r\n```\r\n\r\n# Second\r\n\r\n[unsafe](javascript:alert(1))\r\n\r\n<script>alert(1)</script>';
  const document = { id: 'notes.md', revision: '1', source };
  const { blocks } = prepareMarkdown(document, 'doc');
  const view = renderMarkdownView(document, blocks, new Map([[blocks[0]!.id, '<svg></svg>']]));
  assert.doesNotMatch(view.html, /<script|href="javascript:/);
  assert.match(view.html, /data-mt-block="doc-0"/);
  const heading = view.targets.find(t => t.span.start === 0)!;
  assert.equal(heading.kind, 'h1');
  assert.deepEqual(heading.span, { start: 0, end: '# First'.length });
  const repeated = view.texts.filter(t => t.value.includes('same'));
  assert.equal(repeated.length, 2);
  assert.notEqual(repeated[0]!.origins[0]!.start, repeated[1]!.origins[0]!.start);
  const entity = view.texts.find(t => t.value.includes('&'))!;
  const amp = entity.origins[entity.value.indexOf('&')]!;
  assert.equal(source.slice(amp.start, amp.end), '&amp;');
  const next = entity.value.indexOf('next');
  assert.equal(source.slice(entity.origins[next]!.start, entity.origins[next + 3]!.end), 'next');
  const escaped = view.texts.find(t => t.value.includes('*word*'))!;
  assert.equal(source.slice(escaped.origins[escaped.value.indexOf('*')]!.start, escaped.origins[escaped.value.indexOf('*')]!.end), '\\*');
  const code = view.texts.find(t => t.value === 'code')!;
  assert.equal(source.slice(code.origins[0]!.start, code.origins.at(-1)!.end), 'code');
  assert.ok(view.texts.every(t => t.value.length === t.origins.length && t.exact));
  assert.throws(() => renderMarkdownView(document, blocks, new Map()), /missing.*artifact/i);
});

test('DOC-AC2: ordinary code lines and entities map to their original source units', () => {
  const source = '```js\r\na < b\r\n```\r\n\r\n&#x1F600; and `a\nb`';
  const view = renderMarkdownView({ id: 'code.md', revision: '1', source }, [], new Map());
  const code = view.texts.find(t => t.value === 'a < b\n')!;
  assert.ok(code.exact);
  assert.equal(source.slice(code.origins[0]!.start, code.origins[4]!.end), 'a < b');
  const emoji = view.texts.find(t => t.value.startsWith('😀'))!;
  assert.deepEqual(emoji.origins[0], emoji.origins[1]);
  assert.equal(source.slice(emoji.origins[0]!.start, emoji.origins[1]!.end), '&#x1F600;');
  const inline = view.texts.find(t => t.value === 'a b')!;
  assert.ok(inline.exact);
  assert.equal(source.slice(inline.origins[1]!.start, inline.origins[1]!.end), '\n');
});
