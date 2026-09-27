import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createMermanProducer } from '../src/producer/merman.js';
import { watchPreview } from '../src/watch.js';
import { formatLocation } from '../src/markdown-source.js';

const gantt = 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  todayMarker off\n  section Build\n  Same 😀 :a, 2026-01-01, 2d\n  Same 😀 :b, after a, 1d\n  Ship :milestone, c, after b, 0d\n';

async function verifyNative(source: string, key: string, expected: string, label: string, controls: readonly (readonly [string, string, string?])[] = []) {
  const directory = await mkdtemp(join(tmpdir(), 'trace-native-'));
  const filename = join(directory, 'plan.md');
  const markdown = '# Plan\n\n> ```mermaid\n' + source.split('\n').filter(Boolean).map(line => '> ' + line + '\n').join('') + '> ```\n';
  const browser = await chromium.launch();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const producer = await createMermanProducer();
    let svg: string;
    try { svg = (await producer.render('planning-saved', source)).svg; }
    finally { await producer.close(); }
    const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
    const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    await page.setContent(svg! + svg!.replaceAll('planning-saved', 'planning-copy'));
    await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      const events: unknown[] = [];
      const handles = [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect: (event: unknown) => events.push(event) }));
      Object.assign(window, { events, handles });
    }, activation);
    const first = page.locator('svg').first();
    const shape = first.locator(`[data-mt-key="${key}"][data-mt-role=node]`);
    const cardRect = shape.first().locator(':scope > rect');
    await (await cardRect.count() ? cardRect.first() : shape.first()).click({ position: { x: key.startsWith('kanban:') ? 10 : 3, y: 3 } });
    let event = await page.evaluate(() => (window as any).events.at(-1));
    assert.equal(source.slice(event.span.start, event.span.end), expected);
    await first.locator(`[data-mt-key="${key}"][data-mt-role=node-label], [data-mt-key="${key}"] [data-mt-role=node-label]`).first().click();
    event = await page.evaluate(() => (window as any).events.at(-1));
    assert.equal(source.slice(event.span.start, event.span.end), label);
    await page.evaluate(() => (window as any).handles[0].highlight([(window as any).events.at(-1).span]));
    assert.equal(await first.locator('[data-mt-role=node][data-mt-selected=true]').count(), 0, 'a source label selection must not select enclosing nodes');
    assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
    for (const [controlKey, text, role = 'control'] of controls) {
      const target = first.locator(`[data-mt-key="${controlKey}"][data-mt-role="${role}"], [data-mt-key="${controlKey}"] [data-mt-role="${role}"]`).first();
      const background = target.locator(':scope > rect[width], :scope > g > rect.outer, :scope > g > path[fill]:not([fill=none])');
      if (await target.evaluate(element => ['line', 'path'].includes(element.tagName))) {
        const point = await target.evaluate(element => {
          const shape = element as SVGGeometryElement;
          const point = shape.getPointAtLength(shape.getTotalLength() * (element.tagName === 'path' ? 0.2 : 0.5)).matrixTransform(shape.getScreenCTM()!);
          return { x: point.x, y: point.y };
        });
        await page.mouse.click(point.x, point.y);
      } else {
        await (await background.count() ? background.first() : target).click(await background.count() ? { position: { x: 10, y: 3 } } : {});
      }
      const control = await page.evaluate(() => (window as any).events.at(-1));
      assert.equal(source.slice(control.span.start, control.span.end), text);
    }
    await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
    await writeFile(filename, markdown);
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    const original = page.frameLocator('#source-frame').locator('#source');
    await page.locator(`[data-mt-key="${key}"][data-mt-role=node-label], [data-mt-key="${key}"] [data-mt-role=node-label]`).first().click();
    assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), label);
    const start = markdown.indexOf(label);
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start, end: start + label.length }));
    await original.evaluate((element, span) => {
      const doc = element.ownerDocument; const range = doc.createRange();
      range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
      doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
    }, { start, end: start + label.length });
    await page.waitForSelector('[data-mt-role=node-label][data-mt-selected=true]');
    await page.locator('svg').focus(); await page.keyboard.press('Enter');
    assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), markdown.slice(markdown.indexOf('> ```')));
    await writeFile(filename, markdown.replaceAll(label, 'Changed'));
    await page.locator('[data-mt-role=node-label]').filter({ hasText: 'Changed' }).first().waitFor();
  } finally { await browser.close(); await preview?.close(); await rm(directory, { recursive: true, force: true }); }
}

test('GANTT PLAN-AC2/3: saved native SVG and live Markdown selection, clipboard, source and saves', { timeout: 60_000 }, async () => {
  await verifyNative(gantt, 'gantt:task:a', 'Same 😀 :a, 2026-01-01, 2d', 'Same 😀', [['gantt:section:Build', 'section Build'], ['gantt:title', 'title Plan']]);
});

test('JOURNEY PLAN-AC2/3: native cards, labels and original Markdown selection', { timeout: 60_000 }, async () => {
  await verifyNative('journey\n  title Trip\n  section Morning\n  Same 😀 : 5 : Alice, Bob\n  Same 😀 : 2 : Alice\n', 'journey:task:0', 'Same 😀 : 5 : Alice, Bob', 'Same 😀', [['journey:score:0', '5'], ['journey:actor:1:Alice', 'Alice'], ['journey:actor:Alice', 'Alice']]);
});

test('KANBAN PLAN-AC2/3: columns, cards, metadata and original Markdown selection', { timeout: 60_000 }, async () => {
  await verifyNative("kanban\n  todo[Todo]\n    a[Same 😀]@{ ticket: 'T-1', assigned: 'Alice', priority: 'High' }\n    b[Same 😀]\n  done[Done]\n    c[Ship]\n", 'kanban:card:a', "a[Same 😀]@{ ticket: 'T-1', assigned: 'Alice', priority: 'High' }", 'Same 😀', [['kanban:column:todo', 'todo[Todo]'], ['kanban:field:a:ticket', 'T-1'], ['kanban:field:a:assigned', 'Alice'], ['kanban:field:a:priority', 'High']]);
});


test('STATE STRUCT-AC2/3: saved native SVG and original Markdown state selection', { timeout: 60_000 }, async () => {
  const block = 'state Group {\nstate "Same 😀" as A\nstate "Same 😀" as B\nA --> B : review\nB --> A\nnote right of A : Annotation\n}';
  await verifyNative('stateDiagram-v2\n' + block + '\n', 'state:node:A', 'state "Same 😀" as A', 'Same 😀', [
    ['state:edge:edge0', 'A --> B : review', 'edge'],
    ['state:edge:edge0', 'review', 'edge-label'],
    ['state:edge:edge1', 'B --> A', 'edge'],
    ['state:node:A----note-2', 'Annotation', 'control-label'],
    ['state:node:A----note-2', 'note right of A : Annotation'],
    ['state:node:Group', 'Group', 'node-label'],
    ['state:node:Group', block, 'node'],
  ]);
});
