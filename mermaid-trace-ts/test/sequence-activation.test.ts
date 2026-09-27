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
