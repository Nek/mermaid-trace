import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareMarkdown } from '../src/markdown-it.js';
import { toMarkdown, fromMarkdown, formatLocation } from '../src/markdown-source.js';

test('LOC-AC1: locations use original one-based lines and UTF-16 columns with exclusive ends', () => {
  const document = { id: 'notes.md', source: '😀 title\r\nA\tB\rnext\n' };
  assert.equal(formatLocation(document, { start: 0, end: 2 }), 'notes.md:1:1-1:3');
  assert.equal(formatLocation(document, { start: 10, end: 15 }), 'notes.md:2:1-3:2');
  assert.equal(formatLocation(document, { start: 10, end: 10 }), 'notes.md:2:1');
  assert.equal(formatLocation(document, { start: document.source.length, end: document.source.length }), 'notes.md:4:1');
  assert.equal(formatLocation({ id: 'empty.md', source: '' }, { start: 0, end: 0 }), 'empty.md:1:1');
  for (const span of [{ start: -1, end: 1 }, { start: 2, end: 1 }, { start: 0, end: 50 }, { start: 0.5, end: 1 }]) {
    assert.throws(() => formatLocation(document, span), /range/i);
  }
});

test('MD-AC1/2: nested repeated fences preserve exact original segments and reverse selections', () => {
  const source = '# 😀\r\n\r\n> - ```mermaid\r\n>   flowchart LR\r\n>   A["same"] --> B\r\n>   ```\r\n\r\n```mermaid\r\nflowchart LR\r\nA["same"] --> B\r\n```';
  const document = { id: 'notes', revision: 'one', source };
  const prepared = prepareMarkdown(document, 'page');
  assert.equal(prepared.blocks.length, 2);
  const [first, second] = prepared.blocks;
  assert.notEqual(first!.id, second!.id);
  assert.equal(first!.source, 'flowchart LR\nA["same"] --> B\n');
  assert.equal(first!.source, second!.source);
  const start = source.indexOf('flowchart LR');
  const node = source.indexOf('A["same"]');
  assert.deepEqual(toMarkdown(first!, { start: 0, end: 22 }, document), {
    segments: [{ start, end: start + 14 }, { start: node, end: node + 9 }],
    envelope: { start, end: node + 9 },
  });
  assert.deepEqual(fromMarkdown(first!, { start: node + 3, end: node + 7 }, document), [{ start: 16, end: 20 }]);
  assert.deepEqual(fromMarkdown(first!, { start: node - 4, end: node }, document), []);
  assert.deepEqual(fromMarkdown(first!, { start: node + 3, end: node + 3 }, document), [{ start: 16, end: 16 }]);
  assert.equal(toMarkdown(second!, { start: 16, end: 20 }, document).envelope.start, source.lastIndexOf('same'));
  for (const changed of [{ ...document, id: 'other' }, { ...document, revision: 'two' }, { ...document, source: source + '!' }]) {
    assert.throws(() => toMarkdown(first!, { start: 0, end: 1 }, changed), /stale/i);
  }
  assert.throws(() => toMarkdown(first!, { start: -1, end: 2 }, document), /range/i);
  assert.throws(() => fromMarkdown(first!, { start: 0, end: source.length + 1 }, document), /range/i);
});

test('MD-AC1/4: indentation, tabs, CR, NUL and unclosed fences have exact provenance or explicit failure', () => {
  for (const source of ['  ```mermaid\n  flowchart LR\n  A\t--> B\n  ```', '```mermaid\rflowchart LR\rA[😀\0]\r```', '```mermaid\nflowchart LR\nA --> B']) {
    const document = { id: 'notes', revision: 'one', source };
    const block = prepareMarkdown(document, 'test').blocks[0]!;
    const logical = block.source.indexOf('A');
    const original = source.indexOf('A');
    assert.deepEqual(toMarkdown(block, { start: logical, end: logical + 1 }, document).segments, [{ start: original, end: original + 1 }]);
    assert.deepEqual(fromMarkdown(block, { start: original, end: original + 1 }, document), [{ start: logical, end: logical + 1 }]);
  }
  assert.throws(() => prepareMarkdown({ id: 'x', revision: '1', source: '  ```mermaid\n\tflowchart LR\n  ```' }, 'test'), /unsupported.*provenance/i);
});

test('MD-AC3: sync rendering consumes prepared artifacts, preserves other fences, and escapes source HTML', () => {
  const document = { id: 'notes', revision: 'one', source: '<script>alert(1)</script>\n\n```js\nx < y\n```\n\n```mermaid\nflowchart LR\nA --> B\n```' };
  const prepared = prepareMarkdown(document, 'page');
  assert.throws(() => prepared.render(new Map()), /missing.*artifact/i);
  const html = prepared.render(new Map([[prepared.blocks[0]!.id, '<svg></svg>']]));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<pre><code class="language-js">x &lt; y\n<\/code><\/pre>/);
  assert.match(html, /<div data-mt-block="page-0"><svg><\/svg><\/div>/);
  assert.throws(() => prepareMarkdown(document, 'bad"id'), /namespace/i);
});
