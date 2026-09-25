import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { readFixtures, renderReferences } from '../scripts/svg-baselines.js';

const strip = (svg: string) => svg.replace(/ data-mt-[a-z-]+="[^"]*"/g, '');
const decode = (svg: string) => JSON.parse(decodeURIComponent(svg.match(/ data-mt-map="([^"]*)"/)![1]!));

test('MAP-AC1/2/4: trace real parser occurrences while preserving upstream SVG bytes', async () => {
  const fixtures = await readFixtures();
  const result = await renderReferences(fixtures, true);
  for (const { id, source } of fixtures) {
    const svg = result.svgs[id]!;
    assert.equal(strip(svg), await readFile(`test/baselines/${id}.svg`, 'utf8'), id);
    const mapping = decode(svg);
    assert.equal(mapping.source, source);
    assert.ok(mapping.pieces.some((piece: { kind: string }) => piece.kind === 'edge'));
    assert.match(svg, /data-mt-refs=/);
  }
});

test('MAP-AC1: repeated labels have independent exact UTF-16 ranges after CRLF and comments', async () => {
  const source = 'flowchart LR\r\n%% 😀 comment\r\nA["same"] -->|same| B["same"]\r\nA -->|same| B';
  const result = await renderReferences([{ id: 'ranges', source }], true);
  const mapping = decode(result.svgs.ranges!);
  const nodes = mapping.pieces.filter((p: { kind: string }) => p.kind === 'node');
  const edges = mapping.pieces.filter((p: { kind: string }) => p.kind === 'edge');
  assert.deepEqual(nodes.map((p: { semanticId: string }) => p.semanticId), ['A', 'B', 'A', 'B']);
  assert.deepEqual(nodes.map((p: { span: { start: number; end: number } }) => source.slice(p.span.start, p.span.end)), ['A["same"]', 'B["same"]', 'A', 'B']);
  assert.deepEqual(nodes.slice(0, 2).map((p: { labelSpan: unknown }) => p.labelSpan), [{ start: 32, end: 36 }, { start: 52, end: 56 }]);
  assert.deepEqual(edges.map((p: { labelSpan: unknown }) => p.labelSpan), [{ start: 43, end: 47 }, { start: 66, end: 70 }]);
  assert.deepEqual(edges.map((p: { from: string; to: string }) => [p.from, p.to]), [['A', 'B'], ['A', 'B']]);
  assert.notEqual(edges[0].domId, edges[1].domId);
});

test('MAP-AC3: saved SVG decodes without Mermaid and rejects bad mappings or stale source', async () => {
  const source = 'flowchart LR\nA["<not HTML>"] --> B';
  const validSource = 'flowchart LR\nA["same"] -->|same| B["same"]';
  const result = await renderReferences([{ id: 'saved', source: validSource }], true);
  const directory = await mkdtemp(join(tmpdir(), 'mermaid-trace-'));
  const browser = await chromium.launch();
  try {
    await writeFile(join(directory, 'saved.svg'), result.svgs.saved!);
    const svg = await readFile(join(directory, 'saved.svg'), 'utf8');
    const module = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
    const page = await browser.newPage();
    const outcome = await page.evaluate(async ({ module, svg, validSource, source }) => {
      const { readSvgMapping } = await import(module);
      const mapping = readSvgMapping(svg, validSource);
      const failures = [];
      const changed = structuredClone(mapping);
      changed.pieces[0].span.end = validSource.length + 1;
      const swapped = structuredClone(mapping);
      swapped.pieces[0].domId = 'flowchart-B-1';
      for (const [text, external] of [
        [svg, source],
        [svg.replace(/data-mt-map="[^"]*"/, 'data-mt-map="%invalid"'), undefined],
        [svg.replace(/data-mt-map="[^"]*"/, `data-mt-map="${encodeURIComponent(JSON.stringify(changed))}"`), undefined],
        [svg.replace(/data-mt-refs="[^"]*"/, 'data-mt-refs="missing"'), undefined],
        [svg.replace(/data-mt-map="[^"]*"/, `data-mt-map="${encodeURIComponent(JSON.stringify(swapped))}"`), undefined],
      ]) {
        try { readSvgMapping(text, external); failures.push(false); } catch { failures.push(true); }
      }
      const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const labels = [...document.querySelectorAll('.node .label')].map(element => [
        element.getAttribute('data-mt-start'), element.getAttribute('data-mt-end'),
      ]);
      return { mapping, failures, labels, hasMermaid: 'mermaid' in window };
    }, { module, svg, validSource, source });
    assert.equal(outcome.hasMermaid, false);
    assert.deepEqual(outcome.mapping, decode(svg));
    assert.deepEqual(outcome.failures, [true, true, true, true, true]);
    assert.deepEqual(outcome.labels, [['16', '20'], ['36', '40']]);
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('MAP-AC4: unsupported mapping syntax produces explicit errors', async () => {
  for (const source of ['flowchart LR\nA((circle)) --> B', 'flowchart LR\nA["`markdown`"] --> B', 'flowchart LR\nA[x]\nA[y] --> B']) {
    await assert.rejects(renderReferences([{ id: 'unsupported', source }], true), /Unsupported mapping/);
  }
});
