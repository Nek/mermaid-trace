import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createMermanProducer } from '../src/producer/merman.js';
import { watchPreview } from '../src/watch.js';
import { formatLocation } from '../src/markdown-source.js';

test('OWN-CONFIG: all mapped families preserve nonvisual evidence through saved and live activation', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-config-'));
  const filename = join(directory, 'configuration.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await chromium.launch();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    const evidence = (element: Element) => JSON.parse(element.querySelector('[data-mt-native]')!.getAttribute('data-mt-native')!).filter((piece: { classification?: string }) => ['frontmatter', 'source-directive', 'configuration-key'].includes(piece.classification ?? ''));
    for (const body of [
      'flowchart LR\nA[Actor] --> B\n',
      'stateDiagram-v2\nstate "Actor" as A\nA --> B\n',
      'sequenceDiagram\nparticipant A as Actor\nparticipant B as Other\nA->>B: Message\n',
      'gantt\ndateFormat YYYY-MM-DD\ntodayMarker off\nsection Build\nActor :a, 2026-01-01, 2d\n',
      'journey\nsection Build\nActor : 5 : Alice\n',
      'kanban\ntodo[Todo]\n  a[Actor]\n',
    ]) for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
      const source = `\uFEFF---\nconfig:\n  look: ${look}\n  unknown:\n    nested: 'Value 😀'\n---\n%%{init: { values: [{ nested: 'First 😀' }] }}%%\n%%{initialize: { "html\\u004cabels": ${html}, values: [{ nested: 'Last 😀' }] }}%%\n` + body;
      const { svg, mapping } = await producer.render('config-saved', source);
      await page.setContent(svg + svg.replaceAll('config-saved', 'config-copy'));
      const first = page.locator('svg').first();
      const saved = await first.evaluate(evidence);
      assert.equal(saved.filter((piece: any) => piece.classification === 'frontmatter').length, 1, body);
      assert.equal(saved.filter((piece: any) => piece.classification === 'source-directive').length, 2, body);
      const values = saved.filter((piece: any) => JSON.stringify(piece.path) === JSON.stringify(['values', 0, 'nested']));
      assert.deepEqual(values.map((piece: any) => Buffer.from(source).subarray(piece.labelSpan.start, piece.labelSpan.end).toString()), ['First 😀', 'Last 😀']);
      assert.ok(saved.every((piece: any) => piece.kind === 'nonvisual' && piece.domId === undefined));
      assert.ok(mapping.pieces.every(piece => String(piece.kind) !== 'nonvisual'));
      const before = await page.locator('[tabindex], [aria-pressed]').evaluateAll(elements => elements.map(element => element.outerHTML));
      await page.evaluate(async activation => {
        const { activateSvg } = await import(activation);
        Object.assign(window, { handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect() {} })) });
      }, activation);
      const savedTarget = first.locator('[data-mt-role=node-label]').filter({ hasText: /^\s*Actor\s*$/ }).first();
      assert.equal(await savedTarget.count(), 1, `${body}/${look}/${html}: ${await first.locator('[data-mt-role=node-label]').allTextContents()}`);
      await savedTarget.click();
      assert.equal((await first.locator('[data-mt-role=node-label][data-mt-selected=true]').first().textContent())?.trim(), 'Actor');
      assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
      await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
      assert.deepEqual(await page.locator('[tabindex], [aria-pressed]').evaluateAll(elements => elements.map(element => element.outerHTML)), before);
      const markdown = '# Configuration\n\n```mermaid\n' + source + '```\n';
      await writeFile(filename, markdown);
      preview = await watchPreview(filename, { port: 0, sourceView: true });
      await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
      assert.deepEqual(await page.locator('svg[data-mt-map]').evaluate(evidence), saved);
      const target = page.locator('[data-mt-role=node-label]').filter({ hasText: /^\s*Actor\s*$/ }).first();
      await target.click();
      const original = page.frameLocator('#source-frame').locator('#source');
      assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), 'Actor');
      const start = markdown.indexOf('Actor');
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start, end: start + 5 }));
      const configStart = markdown.indexOf('Value 😀');
      await original.evaluate((element, span) => {
        const doc = element.ownerDocument, range = doc.createRange();
        range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
        doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
      }, { start: configStart, end: configStart + 'Value 😀'.length });
      await page.waitForFunction(() => document.querySelectorAll('svg [data-mt-selected=true], svg[data-mt-selected=true]').length === 0);
      await target.focus(); await target.press('Enter');
      assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), 'Actor');
      await preview.close(); preview = undefined;
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});
