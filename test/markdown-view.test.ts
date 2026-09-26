import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareMarkdown } from '../src/markdown-it.js';
import { renderMarkdownView } from '../src/markdown-view.js';

test('DOC-AC1/2/3: Markdown AST positions preserve text, section and fence provenance safely', () => {
  const source = '# First\r\n\r\n> same **same** &amp; 😀\r\n> next \\*word\\* and `code`\r\n\r\n```mermaid\r\nflowchart LR\r\nA --> B\r\n```\r\n\r\n# Second\r\n\r\n[unsafe](javascript:alert(1))\r\n\r\n<script>alert(1)</script>';
  const document = { id: 'notes.md', revision: '1', source };
  const { blocks } = prepareMarkdown(document, 'doc');
  const view = renderMarkdownView(document, blocks, new Map([[blocks[0]!.id, '<svg></svg>']]));
  assert.doesNotMatch(view.html, /<script|href="javascript:/);
  assert.match(view.html, /data-mt-block="doc-0"/);
  const section = view.targets.find(t => t.kind === 'section')!;
  assert.deepEqual(section.span, { start: 0, end: source.indexOf('# Second') });
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
