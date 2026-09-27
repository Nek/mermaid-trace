import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { createMermanProducer } from '../src/producer/merman.js';
import { watchPreview } from '../src/watch.js';
import { formatLocation } from '../src/markdown-source.js';

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
