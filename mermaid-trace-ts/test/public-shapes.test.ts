import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { createMermanProducer } from '../src/producer/merman.js';
import { watchPreview } from '../src/watch.js';
import { formatLocation } from '../src/markdown-source.js';
import type { Span } from '../src/source-mapping.js';

// Find a real painted body hit, excluding labels and other diagrams. Never force a click.
async function bodyPoint(page: Page, key: string) {
  const node = page.locator('svg[data-mt-map]').first().locator(`[data-mt-key="${key}"][data-mt-role=node]`);
  await node.scrollIntoViewIfNeeded();
  return node.evaluate(node => {
    for (const geometry of node.querySelectorAll<SVGGraphicsElement>('path, rect, circle, ellipse, polygon, polyline, line, text, image')) {
      if (geometry.closest('[data-mt-refs]') !== node) continue;
      const box = geometry.getBBox(), matrix = geometry.getScreenCTM()!;
      const points = [0.1, 0.5, 0.9].flatMap(x => [0.1, 0.5, 0.9].map(y => new DOMPoint(box.x + x * box.width, box.y + y * box.height)));
      if (geometry instanceof SVGGeometryElement) {
        const length = geometry.getTotalLength();
        if (length > 0) for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) points.push(geometry.getPointAtLength(length * fraction));
      }
      for (const point of points) {
        const screen = point.matrixTransform(matrix);
        if (document.elementFromPoint(screen.x, screen.y)?.closest('[data-mt-refs]') === node) return { x: screen.x, y: screen.y };
      }
    }
    return null;
  });
}

test('FLOW AC4/5/6: every public shape has saved SVG pointer/keyboard/reverse selection and Markdown locations', { timeout: 600_000 }, async () => {
  const inventory: { shapes: string[]; withoutLabels: string[] } = JSON.parse(await readFile('test/fixtures/flowchart/public-shapes.json', 'utf8'));
  assert.equal(inventory.shapes.length, 146);
  const statementFor = (shape: string, i: number) => `S${i}@{shape: ${shape}${shape === 'icon' ? ", icon: 'missing:icon'" : ''}, label: 'Same 😀'}`;
  const sourceFor = (shapes: readonly string[], header: string, look: string, html: boolean) => {
    const statements = shapes.map(statementFor);
    return `---\nconfig:\n  htmlLabels: ${html}\n  look: ${look}\n  handDrawnSeed: 42\n---\n${header}\n%% 😀\n` + statements.join('\n') + '\n' + statements.map((_, i) => `S${i} --> Final`).join('\n') + '\n';
  };
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const directory = await mkdtemp(join(tmpdir(), 'trace-public-shapes-'));
  const filename = join(directory, 'shapes.md');
  const browser = await chromium.launch();
  const producer = await createMermanProducer();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
      // Bound each aggregate fixture by the renderer's existing resource policy.
      for (let offset = 0; offset < inventory.shapes.length; offset += 20) {
        const shapes = inventory.shapes.slice(offset, offset + 20);
        const statements = shapes.map(statementFor);
        const source = sourceFor(shapes, header, look, html);
        const { svg } = await producer.render('shape-saved', source);
        await page.setContent(svg + svg.replaceAll('shape-saved', 'shape-copy'));
        const originals = await page.locator('svg[data-mt-map]').evaluateAll(roots => roots.map(root => {
          const svg = root as SVGSVGElement;
          svg.style.width = `${svg.viewBox.baseVal.width}px`;
          svg.style.height = `${svg.viewBox.baseVal.height}px`;
          svg.style.maxWidth = 'none';
          return svg.outerHTML;
        }));
        await page.evaluate(async activation => {
          const { activateSvg } = await import(activation);
          const events: unknown[] = [];
          const handles = [...document.querySelectorAll('svg[data-mt-map]')].map(svg => activateSvg(svg, { onSelect: (event: unknown) => events.push(event) }));
          Object.assign(window, { events, handles });
        }, activation);
        const first = page.locator('svg[data-mt-map]').first();
        for (const [i, shape] of shapes.entries()) {
          const key = `node:S${i}`;
          const statement = statements[i]!;
          const start = source.indexOf(statement);
          const span = { start, end: start + statement.length };
          const description = `${shape}/${header}/${look}/${html}`;
          const node = first.locator(`[data-mt-key="${key}"][data-mt-role=node]`);
          if (shape !== 'text') {
            const point = await bodyPoint(page, key);
            assert.ok(point, `painted body hit for ${description}`);
            const before = await page.evaluate(() => (window as any).events.length);
            await page.mouse.click(point.x, point.y);
            const event = await page.evaluate(() => ({ event: (window as any).events.at(-1), count: (window as any).events.length }));
            assert.ok(event.count > before, `real pointer activation for ${description}`);
            assert.equal(event.event.trigger, 'activation');
            assert.equal(event.event.role, 'node', description);
            assert.deepEqual(event.event.span, span, description);
          }
          await node.focus();
          await node.press(i % 2 ? 'Space' : 'Enter');
          const keyboard = await page.evaluate(() => (window as any).events.at(-1));
          assert.equal(keyboard.role, 'node', description);
          assert.deepEqual(keyboard.span, span, description);
          const bare = source.indexOf(`S${i} --> Final`);
          await page.evaluate(span => (window as any).handles[0].highlight([span]), { start: bare, end: bare + `S${i}`.length });
          assert.equal(await node.getAttribute('data-mt-selected'), 'true', description);
          const label = first.locator(`[data-mt-key="${key}"][data-mt-role=node-label]`);
          const hasLabel = !inventory.withoutLabels.includes(shape);
          assert.equal(await label.count(), Number(hasLabel), description);
          if (hasLabel) {
            const labelStart = start + statement.indexOf('Same 😀');
            const labelSpan = { start: labelStart, end: labelStart + 'Same 😀'.length };
            await label.click();
            const event = await page.evaluate(() => (window as any).events.at(-1));
            assert.equal(event.role, 'node-label', description);
            assert.deepEqual(event.span, labelSpan, description);
            await label.focus(); await label.press('Enter');
            assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), labelSpan, description);
            await page.evaluate(span => (window as any).handles[0].highlight([span]), labelSpan);
            assert.equal(await node.getAttribute('data-mt-selected'), null, description);
            assert.equal(await label.getAttribute('data-mt-selected'), 'true', description);
          }
          assert.equal(await page.locator('svg[data-mt-map]').nth(1).locator('[data-mt-selected=true]').count(), 0, description);
        }
        assert.equal(await page.evaluate(() => 'mermaid' in window), false, 'saved SVG activation must not load a renderer');
        await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
        assert.deepEqual(await page.locator('svg[data-mt-map]').evaluateAll(roots => roots.map(root => root.outerHTML)), originals);
      }
      process.stdout.write(`Verified 146 saved shapes: ${header}/${look}/htmlLabels=${html}\n`);
    }

    const markdownSource = sourceFor(inventory.shapes, 'flowchart LR', 'classic', false);
    const markdown = '# Shapes\n\n> ```mermaid\n' + markdownSource.split('\n').filter(Boolean).map(line => `> ${line}\n`).join('') + '> ```\n';
    const origin = markdown.indexOf('> ---') + 2;
    const toMarkdown = (span: Span) => {
      const offset = (position: number) => origin + position + (markdownSource.slice(0, position).match(/\n/g)?.length ?? 0) * 2;
      return { start: offset(span.start), end: offset(span.end) };
    };
    await writeFile(filename, markdown);
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    const original = page.frameLocator('#source-frame').locator('#source');
    for (const [i, shape] of inventory.shapes.entries()) {
      const key = `node:S${i}`;
      const statement = statementFor(shape, i);
      const start = markdownSource.indexOf(statement);
      const span = toMarkdown({ start, end: start + statement.length });
      const node = page.locator(`[data-mt-key="${key}"][data-mt-role=node]`);
      if (shape !== 'text') {
        const point = await bodyPoint(page, key);
        assert.ok(point, `live painted body hit for ${shape}`);
        await page.mouse.click(point.x, point.y);
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), statement, shape);
        await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, span));
      }
      await node.focus(); await node.press(i % 2 ? 'Space' : 'Enter');
      assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), statement, shape);
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, span));
      if (!inventory.withoutLabels.includes(shape)) {
        const label = page.locator(`[data-mt-key="${key}"][data-mt-role=node-label]`);
        await label.click();
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), 'Same 😀', shape);
        const labelStart = start + statement.indexOf('Same 😀');
        const labelSpan = toMarkdown({ start: labelStart, end: labelStart + 'Same 😀'.length });
        await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, labelSpan));
        await original.evaluate((element, span) => {
          const doc = element.ownerDocument, range = doc.createRange();
          range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
          doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
        }, labelSpan);
        await page.waitForSelector(`[data-mt-key="${key}"][data-mt-role=node-label][data-mt-selected=true]`);
        assert.equal(await node.getAttribute('data-mt-selected'), null, shape);
      }
    }
  } finally {
    await preview?.close(); await producer.close(); await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
