import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, type Page } from 'playwright';
import { createMermanProducer } from '../src/producer/merman.js';
import { watchPreview } from '../src/watch.js';
import { formatLocation } from '../src/markdown-source.js';

async function connectorPoint(page: Page, key: string) {
  const path = page.locator('svg[data-mt-map]').first().locator(`[data-mt-key="${key}"][data-mt-role=edge]`).first();
  await path.scrollIntoViewIfNeeded();
  return path.evaluate(element => {
    const path = element as SVGGeometryElement;
    for (const fraction of [0.2, 0.4, 0.6, 0.8]) {
      const point = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(path.getScreenCTM()!);
      const hit = element.ownerDocument.elementFromPoint(point.x, point.y);
      if (hit === element || (hit === element.previousElementSibling && hit?.getAttribute('aria-hidden') === 'true')) return { x: point.x, y: point.y };
    }
    throw new Error(`No exposed connector hit for ${element.getAttribute('data-mt-key')}`);
  });
}

test('FLOW AC4/6: layout links retain source without invisible pointer or keyboard controls', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-connectors-'));
  const filename = join(directory, 'connectors.md');
  const browser = await chromium.launch();
  const producer = await createMermanProducer();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
    const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
    for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
      const source = `---\nconfig:\n  look: ${look}\n  handDrawnSeed: 42\n  htmlLabels: ${html}\n---\n${header}\n%% 😀\nA[Actor] ghost@~~~ B\nB labeled@~~~|Same 😀| C\nC painted@~~~ D\nD markers@--> E\nE hidden@--> F\nlinkStyle 2 stroke:#123,stroke-width:3px\nlinkStyle 3 stroke-width:0px\nlinkStyle 4 opacity:0\n`;
      const { svg, mapping } = await producer.render('connector-saved', source);
      const ghost = mapping.pieces.find(piece => piece.domId === 'edge:ghost')!;
      assert.equal(source.slice(ghost.span.start, ghost.span.end), 'ghost@~~~', 'layout syntax remains source-backed');
      await page.setContent(svg + svg.replaceAll('connector-saved', 'connector-copy'));
      const original = await page.locator('svg[data-mt-map]').evaluateAll(roots => roots.map(root => root.outerHTML));
      const point = await page.locator('svg[data-mt-map]').first().locator('[data-mt-key="edge:ghost"][data-mt-role=edge]').evaluate(element => {
        const path = element as SVGGeometryElement;
        const point = path.getPointAtLength(path.getTotalLength() * 0.5).matrixTransform(path.getScreenCTM()!);
        const owner = document.elementFromPoint(point.x, point.y)?.closest('[data-mt-refs]');
        return { x: point.x, y: point.y, role: owner?.getAttribute('data-mt-role') ?? 'diagram' };
      });
      await page.evaluate(async activation => {
        const { activateSvg } = await import(activation);
        const events: any[] = [];
        const handles = [...document.querySelectorAll('svg[data-mt-map]')].map(svg => activateSvg(svg, { onSelect: (event: unknown) => events.push(event) }));
        Object.assign(window, { events, handles });
      }, activation);
      const first = page.locator('svg[data-mt-map]').first();
      for (const id of ['ghost', 'labeled', 'hidden']) {
        const path = first.locator(`[data-mt-key="edge:${id}"][data-mt-role=edge]`);
        assert.equal(await path.getAttribute('tabindex'), null, `unpainted ${id}/${header}/${look}/${html} must not be a keyboard stop`);
        assert.equal(await path.evaluate(element => element.previousElementSibling?.getAttribute('aria-hidden') ?? null), null, 'no widened hidden stroke');
      }
      for (const id of ['painted', 'markers']) {
        const path = first.locator(`[data-mt-key="edge:${id}"][data-mt-role=edge]`);
        assert.equal(await path.getAttribute('tabindex'), '0', `painted ${id} remains interactive`);
        await path.focus(); await path.press('Enter');
        assert.equal(await page.evaluate(() => (window as any).events.at(-1).role), 'edge');
      }
      await page.mouse.click(point.x, point.y);
      assert.equal(await page.evaluate(() => (window as any).events.at(-1).role), point.role, 'invisible connector must not intercept the actual painted target or background');
      await first.locator('[data-mt-key="edge:labeled"][data-mt-role=edge-label]').click();
      let event = await page.evaluate(() => (window as any).events.at(-1));
      assert.equal(source.slice(event.span.start, event.span.end), 'Same 😀');
      await page.evaluate(id => (window as any).handles[0].select(id), ghost.id);
      event = await page.evaluate(() => (window as any).events.at(-1));
      assert.deepEqual(event.span, ghost.span, 'programmatic layout occurrence selection remains available');
      assert.equal(await page.locator('svg[data-mt-map]').nth(1).locator('[data-mt-selected=true]').count(), 0);
      await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
      assert.deepEqual(await page.locator('svg[data-mt-map]').evaluateAll(roots => roots.map(root => root.outerHTML)), original);

      const markdown = '# Connectors\n\n> ```mermaid\n' + source.split('\n').filter(Boolean).map(line => '> ' + line + '\n').join('') + '> ```\n';
      await writeFile(filename, markdown);
      preview = await watchPreview(filename, { port: 0, sourceView: true });
      await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
      assert.equal(await page.locator('[data-mt-key="edge:ghost"][data-mt-role=edge][tabindex]').count(), 0);
      const label = page.locator('[data-mt-key="edge:labeled"][data-mt-role=edge-label]');
      await label.click();
      const originalSource = page.frameLocator('#source-frame').locator('#source');
      assert.equal(await originalSource.evaluate(element => element.ownerDocument.getSelection()!.toString()), 'Same 😀');
      const start = markdown.indexOf('Same 😀');
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start, end: start + 'Same 😀'.length }));
      await preview.close(); preview = undefined;
    }
  } finally {
    await preview?.close(); await producer.close(); await browser.close(); await rm(directory, { recursive: true, force: true });
  }
});

test('FLOW AC4/5/6: pinned operator inventory retains saved/live connector selection and original locations', { timeout: 600_000 }, async () => {
  const inventory: { operators: string[] } = JSON.parse(await readFile('test/fixtures/flowchart/operators.json', 'utf8'));
  assert.equal(inventory.operators.length, 195);
  const directory = await mkdtemp(join(tmpdir(), 'trace-operators-'));
  const filename = join(directory, 'operators.md');
  const browser = await chromium.launch();
  const producer = await createMermanProducer();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
    const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
    for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
      for (let offset = 0; offset < inventory.operators.length; offset += 16) {
        const operators = inventory.operators.slice(offset, offset + 16);
        const source = `---\nconfig:\n  look: ${look}\n  handDrawnSeed: 42\n  htmlLabels: ${html}\n---\n${header}\n%% 😀\n` + operators.map((op, i) => `A${i} e${i}@${op} B${i}\n`).join('');
        const { svg, mapping } = await producer.render('operator-saved', source);
        await page.setContent(svg + svg.replaceAll('operator-saved', 'operator-copy'));
        const originals = await page.locator('svg[data-mt-map]').evaluateAll(roots => roots.map(root => root.outerHTML));
        await page.evaluate(async activation => {
          const { activateSvg } = await import(activation);
          const events: any[] = [];
          const handles = [...document.querySelectorAll('svg[data-mt-map]')].map(svg => activateSvg(svg, { onSelect: (event: unknown) => events.push(event) }));
          Object.assign(window, { events, handles });
        }, activation);
        const first = page.locator('svg[data-mt-map]').first();
        for (const [i, operator] of operators.entries()) {
          const key = `edge:e${i}`, text = `e${i}@${operator}`, start = source.indexOf(text), span = { start, end: start + text.length };
          const piece = mapping.pieces.find(piece => piece.domId === key && piece.kind === 'edge')!;
          assert.deepEqual(piece.span, span, `${operator}/${header}/${look}/${html}`);
          const path = first.locator(`[data-mt-key="${key}"][data-mt-role=edge]`).first();
          if (operator.startsWith('~')) {
            assert.equal(await path.getAttribute('tabindex'), null);
            await page.evaluate(id => (window as any).handles[0].select(id), piece.id);
          } else {
            const point = await connectorPoint(page, key); await page.mouse.click(point.x, point.y);
            assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), span);
            await path.focus(); await path.press(i % 2 ? 'Space' : 'Enter');
            assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), span);
            await page.evaluate(span => (window as any).handles[0].highlight([span]), span);
            assert.equal(await path.getAttribute('data-mt-selected'), 'true');
          }
          assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), span);
          assert.equal(await page.locator('svg[data-mt-map]').nth(1).locator('[data-mt-selected=true]').count(), 0);
        }
        await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
        assert.deepEqual(await page.locator('svg[data-mt-map]').evaluateAll(roots => roots.map(root => root.outerHTML)), originals);

        const markdown = '# Operators\n\n> ```mermaid\n' + source.split('\n').filter(Boolean).map(line => '> ' + line + '\n').join('') + '> ```\n';
        await writeFile(filename, markdown); preview = await watchPreview(filename, { port: 0, sourceView: true });
        await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
        const original = page.frameLocator('#source-frame').locator('#source');
        for (const [i, operator] of operators.entries()) {
          const key = `edge:e${i}`, text = `e${i}@${operator}`, start = markdown.indexOf(text), span = { start, end: start + text.length };
          const path = page.locator(`[data-mt-key="${key}"][data-mt-role=edge]`).first();
          if (operator.startsWith('~')) { assert.equal(await path.getAttribute('tabindex'), null); continue; }
          const point = await connectorPoint(page, key); await page.mouse.click(point.x, point.y);
          assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), text);
          await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, span));
          await path.focus(); await path.press(i % 2 ? 'Space' : 'Enter');
          assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), text);
          await original.evaluate((element, span) => {
            const doc = element.ownerDocument, range = doc.createRange();
            range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
            doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
          }, span);
          await page.waitForSelector(`[data-mt-key="${key}"][data-mt-role=edge][data-mt-selected=true]`, { state: 'attached' });
        }
        await preview.close(); preview = undefined;
      }
      process.stdout.write(`Verified 195 saved/live operators: ${header}/${look}/htmlLabels=${html}\n`);
    }
  } finally {
    await preview?.close(); await producer.close(); await browser.close(); await rm(directory, { recursive: true, force: true });
  }
});
