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

async function verifyNative(source: string, key: string, expected: string, label: string, controls: readonly (readonly [string, string, string?])[] = [], reverseNodeSource?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'trace-native-'));
  const filename = join(directory, 'plan.md');
  const markdown = '# Plan\n\n> ```mermaid\n' + source.split('\n').filter(Boolean).map(line => '> ' + line + '\n').join('') + '> ```\n';
  const toMarkdown = (offset: number) => markdown.indexOf('> ' + source.split('\n')[0]) + 2 + offset + (source.slice(0, offset).match(/\n/g)?.length ?? 0) * 2;
  const labelKey = key.startsWith('state:node:') ? key.replace('state:node:', 'state:label:') + ':0' : key;
  const labelSelector = `[data-mt-key="${labelKey}"][data-mt-role=node-label], [data-mt-key="${key}"] [data-mt-role=node-label]`;
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
      const handles = [...document.querySelectorAll('svg[data-mt-map]')].map(svg => activateSvg(svg, { onSelect: (event: unknown) => events.push(event) }));
      Object.assign(window, { events, handles });
    }, activation);
    const first = page.locator('svg[data-mt-map]').first();
    const shape = first.locator(`[data-mt-key="${key}"][data-mt-role=node]`);
    const cardRect = shape.first().locator(':scope > rect');
    const ellipse = shape.first().locator(':scope > ellipse');
    const rough = shape.first().locator(':scope > g.basic.label-container > path').last();
    if (await ellipse.count()) {
      await ellipse.click({ position: { x: 3, y: (await ellipse.boundingBox())!.height / 2 } });
    } else if (await rough.count()) {
      const point = await rough.evaluate(element => {
        const path = element as SVGGeometryElement;
        const point = path.getPointAtLength(path.getTotalLength() * 0.2).matrixTransform(path.getScreenCTM()!);
        return { x: point.x, y: point.y };
      });
      await page.mouse.click(point.x, point.y);
    } else {
      await (await cardRect.count() ? cardRect.first() : shape.first()).click({ position: { x: key.startsWith('kanban:') ? 10 : 3, y: 3 } });
    }
    let event = await page.evaluate(() => (window as any).events.at(-1));
    assert.equal(source.slice(event.span.start, event.span.end), expected);
    await first.locator(labelSelector).first().click();
    event = await page.evaluate(() => (window as any).events.at(-1));
    assert.equal(source.slice(event.span.start, event.span.end), label);
    const labelSpan = event.span;
    await page.evaluate(() => (window as any).handles[0].highlight([(window as any).events.at(-1).span]));
    assert.equal(await first.locator('[data-mt-role=node][data-mt-selected=true]').count(), 0, 'a source label selection must not select enclosing nodes');
    assert.equal(await page.locator('svg[data-mt-map]').nth(1).locator('[data-mt-selected=true]').count(), 0);
    const controlSpans: { start: number; end: number }[] = [];
    for (const [controlKey, text, role = 'control'] of controls) {
      const target = first.locator(`[data-mt-key="${controlKey}"][data-mt-role="${role}"], [data-mt-key="${controlKey}"] [data-mt-role="${role}"]`).first();
      const background = target.locator(':scope > rect[width], :scope > g > rect.outer, :scope > g > rect.divider, :scope > g > path[fill]:not([fill=none])');
      if (await target.evaluate(element => ['line', 'path'].includes(element.tagName))) {
        const point = await target.evaluate(element => {
          const shape = element as SVGGeometryElement;
          const point = shape.getPointAtLength(shape.getTotalLength() * (element.tagName === 'path' ? 0.2 : 0.5)).matrixTransform(shape.getScreenCTM()!);
          return { x: point.x, y: point.y };
        });
        await page.mouse.click(point.x, point.y);
      } else {
        const shape = await background.count() ? background.first() : target;
        const centered = role === 'node' && await shape.evaluate(element => element.tagName === 'path');
        await shape.click(await background.count() && !centered ? { position: { x: 1, y: (await shape.boundingBox())!.height / 2 } } : {});
      }
      const control = await page.evaluate(() => (window as any).events.at(-1));
      assert.equal(source.slice(control.span.start, control.span.end), text, `control ${controlKey} ${role} in ${source}`);
      controlSpans.push(control.span);
    }
    if (reverseNodeSource !== undefined) {
      const start = source.indexOf(reverseNodeSource);
      await page.evaluate(span => (window as any).handles[0].highlight([span]), { start, end: start + reverseNodeSource.length });
      assert.equal(await shape.locator(':scope[data-mt-selected=true]').count(), 1, 'source occurrence maps to its semantic node');
      assert.equal(await first.locator(labelSelector).first().getAttribute('data-mt-selected'), null, 'a source occurrence without this label binding must not select the displayed label');
    }
    await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
    await writeFile(filename, markdown);
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    const original = page.frameLocator('#source-frame').locator('#source');
    await page.locator(labelSelector).first().click();
    assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), label);
    const start = toMarkdown(labelSpan.start);
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start, end: start + label.length }));
    await original.evaluate((element, span) => {
      const doc = element.ownerDocument; const range = doc.createRange();
      range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
      doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
    }, { start, end: start + label.length });
    await page.waitForSelector('[data-mt-role=node-label][data-mt-selected=true]');
    if (reverseNodeSource !== undefined) {
      const offset = source.indexOf(reverseNodeSource);
      await original.evaluate((element, span) => {
        const doc = element.ownerDocument; const range = doc.createRange();
        range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
        doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
      }, { start: toMarkdown(offset), end: toMarkdown(offset + reverseNodeSource.length) });
      await page.waitForSelector(`[data-mt-key="${key}"][data-mt-role=node][data-mt-selected=true]`);
      assert.equal(await page.locator(labelSelector).first().getAttribute('data-mt-selected'), null);
    }
    for (const [index, [controlKey, text, role = 'control']] of controls.entries()) {
      const target = page.locator(`[data-mt-key="${controlKey}"][data-mt-role="${role}"], [data-mt-key="${controlKey}"] [data-mt-role="${role}"]`).first();
      if (role.endsWith('-label')) {
        await target.click();
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), text.replaceAll('\n', '\n> '));
      }
      const before = await page.evaluate(() => navigator.clipboard.readText());
      await target.focus();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), before, 'focus must not copy');
      await target.press(index % 2 ? 'Space' : 'Enter');
      assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), text.replaceAll('\n', '\n> '));
      const span = controlSpans[index]!;
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start: toMarkdown(span.start), end: toMarkdown(span.end) }));
    }
    await page.locator('svg[data-mt-map]').focus(); await page.keyboard.press('Enter');
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

test('STATE AC4/6: repeated description rows, concurrency and HTML variants retain keyboard and clipboard selection', { timeout: 120_000 }, async () => {
  for (const html of [false, true]) {
    const source = `---\nconfig:\n  htmlLabels: ${html}\n  look: handDrawn\n  handDrawnSeed: 42\n---\nstateDiagram-v2\nstate "Title 😀" as A: Compact\nA : Repeated\nA : Repeated\nA --> A : again\nstate Parallel {\n  B\n  --\n  C\n}\n`;
    await verifyNative(source, 'state:node:A', 'state "Title 😀" as A: Compact', 'Title 😀', [
      ['state:label:A:1', 'Compact', 'node-label'],
      ['state:label:A:2', 'Repeated', 'node-label'],
      ['state:label:A:3', 'Repeated', 'node-label'],
      ['state:node:divider-id-1', '--', 'node'],
      ['state:edge:edge0', 'A --> A : again', 'edge'],
      ['state:edge:edge0', 'again', 'edge-label'],
    ]);
  }
});

test('STATE AC5/6: title, special states and HTML notes remain selectable in saved and live Markdown', { timeout: 60_000 }, async () => {
  const source = '---\ntitle: "Mapped state"\nconfig:\n  htmlLabels: true\n---\nstateDiagram\nstate "Actor 😀" as A\nstate Decision <<choice>>\nstate Fork <<fork>>\nstate Join <<join>>\n[*] --> A\nA --> Decision\nDecision --> Fork\nFork --> Join\nJoin --> [*]\nnote right of A : Annotation\n';
  await verifyNative(source, 'state:node:A', 'state "Actor 😀" as A', 'Actor 😀', [
    ['state:title', 'Mapped state', 'control-label'],
    ['state:node:Decision', 'state Decision <<choice>>', 'node'],
    ['state:node:Fork', 'state Fork <<fork>>', 'node'],
    ['state:node:Join', 'state Join <<join>>', 'node'],
    ['state:node:root_start', '[*]', 'node'],
    ['state:node:root_end', '[*]', 'node'],
    ['state:node:A----note-5', 'Annotation', 'control-label'],
    ['state:node:A----note-5', 'note right of A : Annotation'],
  ]);
});

test('FLOW AC4/6: nested subgraph frames, repeated titles and YAML title work in saved SVG and Markdown', { timeout: 120_000 }, async () => {
  for (const html of [false, true]) {
    const inner = 'subgraph "Same 😀"\nA["Actor 😀"] -->|go| B\nend';
    const group = 'subgraph G["Same 😀"]\n' + inner + '\nend';
    const source = `---\ntitle: "Whole 😀"\nconfig:\n  htmlLabels: ${html}\n---\nflowchart LR\n${group}\n`;
    await verifyNative(source, 'node:A', 'A["Actor 😀"]', 'Actor 😀', [
      ['flowchart:subgraph:G', group],
      ['flowchart:subgraph:G', 'Same 😀', 'control-label'],
      ['flowchart:subgraph:subGraph0', inner],
      ['flowchart:subgraph:subGraph0', 'Same 😀', 'control-label'],
      ['flowchart:title', 'Whole 😀', 'control-label'],
      ['edge:L_A_B_0', 'go', 'edge-label'],
    ]);
  }
});

test('FLOW AC5/6: native ELK header and configuration retain saved and live selections', { timeout: 120_000 }, async () => {
  for (const config of [false, true]) {
    const group = 'subgraph G[Group]\nA["Actor 😀"] -->|go| B\nend';
    const source = (config ? '---\nconfig:\n  layout: elk\n  htmlLabels: true\n---\nflowchart LR\n' : 'flowchart-elk LR\n') + group + '\n';
    await verifyNative(source, 'node:A', 'A["Actor 😀"]', 'Actor 😀', [
      ['flowchart:subgraph:G', group],
      ['flowchart:subgraph:G', 'Group', 'control-label'],
      ['edge:L_A_B_0', 'go', 'edge-label'],
    ]);
  }
});


test('FLOW AC5/6: formula glyphs retain saved and live label selection', { timeout: 120_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) {
    const source = `---\nconfig:\n  htmlLabels: true\n---\n${header}\nA["$$x^2$$"] -->|"$$\\sqrt{x}$$"| B\n`;
    await verifyNative(source, 'node:A', 'A["$$x^2$$"]', '$$x^2$$', [
      ['edge:L_A_B_0', '$$\\sqrt{x}$$', 'edge-label'],
    ]);
  }
});


test('FLOW AC4/6: repeated declarations select the effective native occurrence and preserve reverse lookup', { timeout: 120_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) {
    for (const html of [false, true]) {
      const source = `---\nconfig:\n  htmlLabels: ${html}\n---\n${header}\nA["Previous 😀"]\nA["Current 😀"]\nA["Current 😀"] -->|go| B\nA --> B\n`;
      await verifyNative(source, 'node:A', 'A["Current 😀"]', 'Current 😀', [['edge:L_A_B_0', 'go', 'edge-label']], 'Current 😀');
    }
  }
});


test('FLOW AC5/6: ellipse silhouettes, labels and connectors remain selectable in saved and live SVG', { timeout: 120_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) {
    for (const html of [false, true]) {
      for (const look of ['classic', 'handDrawn']) {
        const source = `---\nconfig:\n  htmlLabels: ${html}\n  look: ${look}\n  handDrawnSeed: 42\n---\n${header}\nA(-Actor 😀-) -->|go| B\n`;
        await verifyNative(source, 'node:A', 'A(-Actor 😀-)', 'Actor 😀', [['edge:L_A_B_0', 'go', 'edge-label']]);
      }
    }
  }
});


test('FLOW AC4/6: empty and collapsed subgraphs retain saved and live frame/title selection', { timeout: 120_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) {
    for (const html of [false, true]) {
      for (const content of ['', 'b\n', 'C --> D\n']) {
        const block = `subgraph G["Empty 😀"]\n${content}end`;
        const source = `---\nconfig:\n  htmlLabels: ${html}\n---\n${header}\nsubgraph A\na["Actor 😀"] --> b\nend\n${block}\n` + (content.startsWith('C') ? 'G@{ view: collapsed }\n' : '');
        await verifyNative(source, 'node:a', 'a["Actor 😀"]', 'Actor 😀', [
          ['flowchart:subgraph:G', block],
          ['flowchart:subgraph:G', 'Empty 😀', 'control-label'],
        ]);
      }
    }
  }
});


test('FLOW AC4/6: style-created nodes and style source relationships work in saved SVG and Markdown', { timeout: 120_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) {
    for (const html of [false, true]) {
      const source = `---\nconfig:\n  htmlLabels: ${html}\n---\n${header}\nstyle Q fill:#fff\nstyle Q stroke:#333\nQ --> A["Actor 😀"]\nstyle A fill:#eee\nsubgraph G[Group]\nC --> D\nend\nstyle G fill:#bbb\n`;
      await verifyNative(source, 'node:Q', 'style Q fill:#fff', 'Q', [
        ['node:Q', 'style Q fill:#fff', 'node'],
        ['node:A', 'A["Actor 😀"]', 'node'],
        ['flowchart:subgraph:G', 'subgraph G[Group]\nC --> D\nend'],
      ], 'style Q stroke:#333');
    }
  }
});
