import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
