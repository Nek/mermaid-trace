import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchPreview } from '../src/watch.js';
import { formatLocation } from '../src/markdown-source.js';
import test from 'node:test';
import { chromium } from 'playwright';
import { createMermanProducer } from '../src/producer/merman.js';

const source = 'sequenceDiagram\r\n%% 😀 same\r\nparticipant A as Same\r\nactor B as Same\r\nloop outer\r\nA->>+B: same😀\r\nnote over B: same\r\nopt inner\r\nB-->>-A: same😀\r\nend\r\nend\r\nA->>A: \r\n';

test('SEQ-AC2/3: saved native SVG selects sequence pieces, labels and unlabeled connectors without a renderer', async () => {
  const producer = await createMermanProducer();
  const { svg } = await producer.render('sequence-native', source);
  await producer.close();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8'))
    .replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(svg + svg.replaceAll('sequence-native', 'sequence-copy'));
    await page.evaluate(async ({ activation }) => {
      const { activateSvg } = await import(activation);
      const events: any[] = [];
      const handles = [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect: (event: any) => events.push(event) }));
      Object.assign(window, { events, handles });
    }, { activation });
    const first = page.locator('svg').first();
    for (const role of ['node-label', 'edge-label', 'note-label', 'activation', 'control-label']) {
      await first.locator(`[data-mt-role="${role}"]`).first().click();
      const event = await page.evaluate(() => (window as any).events.at(-1));
      assert.equal(event.role, role);
      assert.equal(event.trigger, 'activation');
      if (role === 'edge-label') assert.equal(source.slice(event.span.start, event.span.end), 'same😀');
      if (role === 'control-label') assert.equal(source.slice(event.span.start, event.span.end), 'inner');
      assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
    }
    const line = first.locator('line[data-mt-role="edge"]').first();
    const point = await line.evaluate((element: SVGGeometryElement) => {
      const local = element.getPointAtLength(element.getTotalLength() / 2);
      const screen = new DOMPoint(local.x, local.y).matrixTransform(element.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    });
    await page.mouse.click(point.x, point.y + 3);
    let event = await page.evaluate(() => (window as any).events.at(-1));
    assert.equal(event.role, 'edge');
    assert.equal(source.slice(event.span.start, event.span.end), 'A->>+B: same😀');
    assert.equal(await first.locator('[data-mt-role^=control][data-mt-selected=true]').count(), 0, 'connector focus must not select enclosing controls');
    const self = first.locator('path[data-mt-role="edge"]').last();
    await self.focus();
    await page.keyboard.press('Enter');
    event = await page.evaluate(() => (window as any).events.at(-1));
    assert.equal(source.slice(event.span.start, event.span.end), 'A->>A: ');
    await first.focus();
    await page.keyboard.press('Space');
    event = await page.evaluate(() => (window as any).events.at(-1));
    assert.equal(event.role, 'diagram');
    assert.deepEqual(event.span, { start: 0, end: source.length });
    await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
    assert.equal(await page.locator('[tabindex], [data-mt-selected]').count(), 0);
  } finally { await browser.close(); }
});


test('OWN-SEQ: saved and live note attachment selection stays with the note', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-seq-owner-'));
  const filename = join(directory, 'notes.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await chromium.launch();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    for (const attachment of ['left of A', 'right of A', 'over A', 'over A,B']) {
      for (const suffix of ['', 'A->>B: message\n', 'participant A\nparticipant B\n']) {
        const note = `note ${attachment}: Available 😀`;
        const source = `sequenceDiagram\n%% 😀\n${note}\n${suffix}`;
        const start = source.indexOf(note) + note.indexOf('A');
        const { svg } = await producer.render('own-seq', source);
        await page.setContent(svg + svg.replaceAll('own-seq', 'own-copy'));
        await page.evaluate(async activation => {
          const { activateSvg } = await import(activation);
          Object.assign(window, { handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect() {} })) });
        }, activation);
        await page.evaluate(span => (window as any).handles[0].highlight([span]), { start, end: start + 1 });
        const first = page.locator('svg').first();
        assert.equal(await first.locator('[data-mt-role=note][data-mt-selected=true]').count(), 1);
        assert.equal(await first.locator('[data-mt-role^=node][data-mt-selected=true]').count(), 0, 'note attachment is not a participant selection');
        assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
        await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
        assert.equal(await page.locator('[tabindex], [data-mt-selected]').count(), 0);
        const markdown = '# Notes\n\n```mermaid\n' + source + '```\n';
        await writeFile(filename, markdown);
        preview = await watchPreview(filename, { port: 0, sourceView: true });
        await page.goto(preview.url);
        const original = page.frameLocator('#source-frame').locator('#source');
        const offset = markdown.indexOf(note) + note.indexOf('A');
        await original.evaluate((element, span) => {
          const range = element.ownerDocument.createRange();
          range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
          const selection = element.ownerDocument.getSelection()!;
          selection.removeAllRanges(); selection.addRange(range);
        }, { start: offset, end: offset + 1 });
        await page.waitForSelector('[data-mt-role=note][data-mt-selected=true]');
        assert.equal(await page.locator('[data-mt-role^=node][data-mt-selected=true]').count(), 0);
        const label = page.locator('[data-mt-role=note-label]').first();
        await label.click(); await label.press('Enter');
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), 'Available 😀');
        const labelStart = markdown.indexOf(note) + note.indexOf('Available 😀');
        const location = formatLocation({ id: filename, source: markdown }, { start: labelStart, end: labelStart + 'Available 😀'.length });
        await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), location);
        assert.equal(await page.locator('[data-mt-role=note][data-mt-selected=true]').count(), 0, 'distinct note text remains its own selection');
        await preview.close(); preview = undefined;
      }
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('SEQ-TITLE: saved and live titles retain effective and earlier source ownership', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-seq-title-'));
  const filename = join(directory, 'title.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await chromium.launch();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    for (const source of [
      'sequenceDiagram\ntitle First\ntitle: Visible 😀\nA->>B: Hello\n',
      "---\ntitle: 'Visible 😀'\n---\nsequenceDiagram\nA->>B: Hello\n",
      "---\ntitle: 'Visible 😀'\n---\nsequenceDiagram\ntitle: \nA->>B: Hello\n",
    ]) {
      const { svg } = await producer.render('seq-title', source);
      await page.setContent(svg + svg.replaceAll('seq-title', 'seq-copy'));
      await page.evaluate(async activation => {
        const { activateSvg } = await import(activation);
        const events: any[] = [];
        Object.assign(window, { events, handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect: (event: any) => events.push(event) })) });
      }, activation);
      const first = page.locator('svg').first();
      const title = first.locator('[data-mt-key="sequence:title"]');
      assert.equal(await title.count(), 1);
      await title.click(); await title.press('Enter');
      const span = { start: source.indexOf('Visible 😀'), end: source.indexOf('Visible 😀') + 'Visible 😀'.length };
      assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), span);
      const ownerStart = source.indexOf('title');
      await page.evaluate(span => (window as any).handles[0].highlight([span]), { start: ownerStart, end: ownerStart + 5 });
      assert.equal(await title.getAttribute('data-mt-selected'), 'true');
      assert.equal(await first.locator('[data-mt-role^=node][data-mt-selected=true]').count(), 0);
      assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
      await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
      assert.equal(await page.locator('[tabindex], [data-mt-selected]').count(), 0);
      const markdown = '# Title\n\n```mermaid\n' + source + '```\n';
      await writeFile(filename, markdown);
      preview = await watchPreview(filename, { port: 0, sourceView: true });
      await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
      const original = page.frameLocator('#source-frame').locator('#source');
      const liveTitle = page.locator('[data-mt-key="sequence:title"]');
      await liveTitle.click(); await liveTitle.press('Enter');
      assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), 'Visible 😀');
      const offset = markdown.indexOf(source);
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start: offset + span.start, end: offset + span.end }));
      await original.evaluate((element, start) => {
        const range = element.ownerDocument.createRange(); range.setStart(element.firstChild!, start); range.setEnd(element.firstChild!, start + 5);
        const selection = element.ownerDocument.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      }, offset + ownerStart);
      await page.waitForSelector('[data-mt-key="sequence:title"][data-mt-selected=true]');
      assert.equal(await page.locator('[data-mt-role^=node][data-mt-selected=true]').count(), 0);
      await preview.close(); preview = undefined;
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('SEQ-PARTICIPANT-ORIGINS: aliases and earlier declarations retain saved/live ownership', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-seq-participants-'));
  const filename = join(directory, 'participants.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await chromium.launch();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    for (const [first, declaration, expected] of [
      ['', 'participant A@{ alias: "Client 😀", type: boundary }', 'Client 😀'],
      ['participant A as Old\n', 'participant A@{ alias: "Cli\\u0065nt" }', 'Cli\\u0065nt'],
      ['participant A as Current\n', 'participant A as Current', 'Current'],
      ['A->>B: Initial\n', 'actor A@{alias: Ignored} as Explicit', 'Explicit'],
    ] as const) {
      const source = `sequenceDiagram\n${first}${declaration}\nA->>B: Hello\n`;
      const { svg } = await producer.render('seq-origin', source);
      await page.setContent(svg + svg.replaceAll('seq-origin', 'seq-copy'));
      await page.evaluate(async activation => {
        const { activateSvg } = await import(activation);
        const events: any[] = [];
        Object.assign(window, { events, handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect: (event: any) => events.push(event) })) });
      }, activation);
      const pieces = await page.evaluate(() => (window as any).handles[0].mapping.pieces.filter((p: any) => p.domId === 'actor:A'));
      assert.equal(pieces.length, first ? 2 : 1);
      const current = pieces.at(-1);
      const labelSelector = `[data-mt-role=node-label][data-mt-refs="${current.id}"]`;
      const saved = page.locator('svg').first();
      const span = { start: source.lastIndexOf(expected), end: source.lastIndexOf(expected) + expected.length };
      for (const label of await saved.locator(labelSelector).all()) {
        await label.click(); await label.press('Enter');
        assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), span);
      }
      assert.ok(await saved.locator(labelSelector).count());
      const oldStart = source.indexOf(first ? first.trimEnd() : declaration);
      await page.evaluate(span => (window as any).handles[0].highlight([span]), { start: oldStart, end: oldStart + 1 });
      assert.ok(await saved.locator('[data-mt-key="actor:A"][data-mt-role=node][data-mt-selected=true]').count());
      assert.equal(await saved.locator('[data-mt-key="actor:B"][data-mt-selected=true]').count(), 0);
      assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
      await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
      const markdown = '# Participants\n\n```mermaid\n' + source + '```\n';
      await writeFile(filename, markdown);
      preview = await watchPreview(filename, { port: 0, sourceView: true });
      await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
      const original = page.frameLocator('#source-frame').locator('#source');
      const label = page.locator(labelSelector).first();
      await label.click(); await label.press('Enter');
      assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), expected);
      const offset = markdown.indexOf(source);
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start: offset + span.start, end: offset + span.end }));
      await original.evaluate((element, start) => {
        const range = element.ownerDocument.createRange(); range.setStart(element.firstChild!, start); range.setEnd(element.firstChild!, start + 1);
        const selection = element.ownerDocument.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      }, offset + oldStart);
      await page.waitForSelector('[data-mt-key="actor:A"][data-mt-role=node][data-mt-selected=true]:visible');
      assert.equal(await page.locator('[data-mt-key="actor:B"][data-mt-selected=true]').count(), 0);
      await preview.close(); preview = undefined;
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});
