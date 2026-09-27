import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Locator } from 'playwright';
import { createMermanProducer } from '../src/producer/merman.js';
import { watchPreview } from '../src/watch.js';
import { formatLocation } from '../src/markdown-source.js';

async function clickExposedTarget(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const position = await target.evaluate(element => {
    const box = element.getBoundingClientRect();
    for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const y of [0.1, 0.5, 0.9]) {
      const hit = element.ownerDocument.elementFromPoint(box.x + box.width * x, box.y + box.height * y);
      if (hit?.closest('[data-mt-role]') === element.closest('[data-mt-role]')) return { x: box.width * x, y: box.height * y };
    }
    throw new Error('mapped visual has no exposed pointer target');
  });
  await target.click({ position });
}

async function noteConnectorPoint(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  return target.evaluate(element => {
    const path = element as SVGGeometryElement;
    for (const fraction of [0.2, 0.4, 0.6, 0.8]) {
      const point = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(path.getScreenCTM()!);
      const hit = element.ownerDocument.elementFromPoint(point.x, point.y);
      if (hit === element || (hit === element.previousElementSibling && hit?.getAttribute('aria-hidden') === 'true')) return { x: point.x, y: point.y };
    }
    throw new Error('note connector has no exposed pointer target');
  });
}

const gantt = 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  todayMarker off\n  section Build\n  Same 😀 :a, 2026-01-01, 2d\n  Same 😀 :b, after a, 1d\n  Ship :milestone, c, after b, 0d\n';

test('OWN-FLOW-ENDPOINT: saved and live references select owning connection groups', { timeout: 240_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-flow-owner-'));
  const filename = join(directory, 'flow.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await chromium.launch();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const look of ['classic', 'neo', 'handDrawn']) {
      for (const html of [false, true]) for (const nested of [false, true]) {
        for (const [statement, counts, visualCounts] of [
          ['A --> B', [1, 1], [1, 1]],
          ['A & B --> C & D', [2, 2, 2, 2], [4, 4, 4, 4]],
          ['A --> B --> C', [1, 2, 1], [1, 2, 1]],
          ['A & A --> B', [1, 1, 2], [2, 2, 2]],
          ['A --> B\r\nA --> B', [1, 1, 1, 1], [1, 1, 1, 1]],
          ['H --> B', [1, 1], [1, 1]],
          ['E --> B', [1, 1], [1, 1]],
        ] as const) {
          const body = `A[Alpha 😀]\r\nB[Beta]\r\nC[Gamma]\r\nD[Delta]\r\nstyle E fill:red\r\nsubgraph H\r\nI[Inside]\r\nend\r\n${statement}\r\n`;
          const source = `---\r\nconfig:\r\n  look: ${look}\r\n  handDrawnSeed: 42\r\n  htmlLabels: ${html}\r\n---\r\n${header}\r\n` + (nested ? `subgraph G\r\n${body}end\r\n` : body);
          const { svg } = await producer.render('own-flow', source);
          const offsets = [...statement.matchAll(/[ABCDEH]/g)].map(match => source.indexOf(statement) + match.index);
          await page.setContent(svg + svg.replaceAll('own-flow', 'own-copy'));
          await page.evaluate(async activation => {
            const { activateSvg } = await import(activation);
            Object.assign(window, { handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect() {} })) });
          }, activation);
          const first = page.locator('svg').first();
          for (const [index, start] of offsets.entries()) {
            const pieces = await page.evaluate(span => (window as any).handles[0].highlight([span]), { start, end: start + 1 });
            assert.equal(pieces.length, counts[index], source);
            assert.ok(pieces.every((piece: any) => piece.kind === 'edge' && piece.relation === 'endpoint-reference'));
            assert.equal(await first.locator('[data-mt-role=edge][data-mt-selected=true]').count(), visualCounts[index], 'equal-span connection parts stay consolidated');
            assert.equal(await first.locator('[data-mt-role^=node][data-mt-selected=true]').count(), 0);
            assert.equal(await first.getAttribute('data-mt-selected'), null);
            assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
          }
          await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
          assert.equal(await page.locator('[tabindex], [data-mt-selected]').count(), 0);
          const markdown = '# Flow\r\n\r\n```mermaid\r\n' + source + '```\r\n';
          await writeFile(filename, markdown);
          preview = await watchPreview(filename, { port: 0, sourceView: true });
          await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
          const original = page.frameLocator('#source-frame').locator('#source');
          for (const [index, offset] of offsets.entries()) {
            const start = markdown.indexOf(source) + offset;
            await original.evaluate((element, span) => {
              const range = element.ownerDocument.createRange();
              range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
              const selection = element.ownerDocument.getSelection()!;
              selection.removeAllRanges(); selection.addRange(range);
            }, { start, end: start + 1 });
            await page.waitForFunction(count => document.querySelectorAll('[data-mt-role=edge][data-mt-selected=true]').length === count, visualCounts[index]);
            assert.equal(await page.locator('[data-mt-role^=node][data-mt-selected=true]').count(), 0);
          }
          const edge = page.locator('[data-mt-role=edge]').first();
          await edge.focus(); await edge.press('Enter');
          assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), '-->');
          const arrow = markdown.indexOf(statement) + statement.indexOf('-->');
          await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start: arrow, end: arrow + 3 }));
          await preview.close(); preview = undefined;
        }
      }
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('OWN-STATE-ENDPOINT: saved and live references select their transition owner', { timeout: 240_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-state-owner-'));
  const filename = join(directory, 'states.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await chromium.launch();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    for (const header of ['stateDiagram', 'stateDiagram-v2']) {
      for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
        for (const nested of [false, true]) for (const prefix of [
          'state "Alpha 😀" as A\r\nstate "Beta" as B\r\n',
          'A --> B : create\r\n',
          'note right of A : Before creation\r\nA --> B : create\r\n',
        ]) {
          const statements = ['A --> B : go', 'B --> A : return', 'A --> A : self', 'A --> B : parallel'];
          const body = prefix + statements.join('\r\n') + '\r\n';
          const source = `---\r\nconfig:\r\n  look: ${look}\r\n  handDrawnSeed: 42\r\n  htmlLabels: ${html}\r\n---\r\n${header}\r\n` + (nested ? `state Outer {\r\n${body}}\r\n` : body);
          const { svg, mapping } = await producer.render('own-state', source);
          await page.setContent(svg + svg.replaceAll('own-state', 'own-copy'));
          await page.evaluate(async activation => {
            const { activateSvg } = await import(activation);
            Object.assign(window, { handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect() {} })) });
          }, activation);
          const first = page.locator('svg').first();
          const owners = statements.map(statement => mapping.pieces.find(piece => piece.kind === 'edge' && source.slice(piece.span.start, piece.span.end) === statement)!);
          for (const [index, statement] of statements.entries()) for (const offset of [0, 6]) {
            const start = source.indexOf(statement) + offset;
            await page.evaluate(span => (window as any).handles[0].highlight([span]), { start, end: start + 1 });
            assert.equal(await first.locator(`[data-mt-key="${owners[index]!.domId}"][data-mt-role=edge][data-mt-selected=true]`).count(), 1, source);
            assert.equal(await first.locator('[data-mt-role^=node][data-mt-selected=true]').count(), 0, 'an endpoint reference must not navigate to a state');
            assert.equal(await first.getAttribute('data-mt-selected'), null, 'a mapped reference must not fall back to the diagram');
            assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
          }
          await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
          assert.equal(await page.locator('[tabindex], [data-mt-selected]').count(), 0);
          const markdown = '# States\r\n\r\n```mermaid\r\n' + source + '```\r\n';
          await writeFile(filename, markdown);
          preview = await watchPreview(filename, { port: 0, sourceView: true });
          await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
          const original = page.frameLocator('#source-frame').locator('#source');
          for (const [index, statement] of statements.entries()) {
            const owner = owners[index]!;
            const edge = page.locator(`[data-mt-key="${owner.domId}"][data-mt-role=edge]`);
            for (const offset of [0, 6]) {
              const start = markdown.indexOf(statement) + offset;
              await original.evaluate((element, span) => {
                const range = element.ownerDocument.createRange();
                range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
                const selection = element.ownerDocument.getSelection()!;
                selection.removeAllRanges(); selection.addRange(range);
              }, { start, end: start + 1 });
              await page.waitForFunction(key => document.querySelector(`[data-mt-key="${key}"][data-mt-role=edge]`)?.getAttribute('data-mt-selected') === 'true', owner.domId);
              assert.equal(await page.locator('[data-mt-role^=node][data-mt-selected=true]').count(), 0);
            }
            await edge.focus(); await edge.press('Enter');
            assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), statement);
            const start = markdown.indexOf(statement);
            await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start, end: start + statement.length }));
            const label = page.locator(`[data-mt-key="${owner.domId}"][data-mt-role=edge-label], [data-mt-key="${owner.domId}"] [data-mt-role=edge-label]`).first();
            await label.focus(); await label.press('Enter');
            assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), statement.split(' : ')[1]);
            assert.equal(await edge.getAttribute('data-mt-selected'), null, 'a distinct transition label remains separately selectable');
          }
          await preview.close(); preview = undefined;
        }
      }
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

async function verifyNative(source: string, key: string, expected: string, label: string, controls: readonly (readonly [string, string, string?])[] = [], reverseNodeSource?: string | { start: number; end: number }, reverseKeys: readonly string[] = [], reversePrimaryKey = key, expectedTextColour?: string, reverseWholeOwner = false) {
  const directory = await mkdtemp(join(tmpdir(), 'trace-native-'));
  const filename = join(directory, 'plan.md');
  const markdown = '# Plan\n\n> ```mermaid\n' + source.split('\n').filter(Boolean).map(line => '> ' + line + '\n').join('') + '> ```\n';
  const toMarkdown = (offset: number) => markdown.indexOf('> ' + source.split('\n')[0]) + 2 + offset + (source.slice(0, offset).match(/\n/g)?.length ?? 0) * 2;
  const toMarkdownEnd = (offset: number) => toMarkdown(offset) - (source[offset - 1] === '\n' ? 2 : 0);
  const markdownSelection = (text: string) => text.replace(/\n(?!$)/g, '\n> ');
  const reverseRole = reversePrimaryKey === key ? 'node' : reversePrimaryKey.startsWith('edge:') ? 'edge' : 'control';
  const reverseSpan = typeof reverseNodeSource === 'string'
    ? { start: source.indexOf(reverseNodeSource), end: source.indexOf(reverseNodeSource) + reverseNodeSource.length }
    : reverseNodeSource;
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
    const boundsBefore = await page.locator('[data-mt-generated="bounds"]').evaluateAll(elements => elements.map(element => element.getAttribute('pointer-events')));
    await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      const events: unknown[] = [];
      const handles = [...document.querySelectorAll('svg[data-mt-map]')].map(svg => activateSvg(svg, { onSelect: (event: unknown) => events.push(event) }));
      Object.assign(window, { events, handles });
    }, activation);
    const first = page.locator('svg[data-mt-map]').first();
    const configEvidence = (element: Element) => JSON.parse(element.querySelector('[data-mt-native]')?.getAttribute('data-mt-native') ?? '[]').filter((piece: { classification?: string }) => ['frontmatter', 'source-directive', 'configuration-key'].includes(piece.classification ?? ''));
    const savedConfig = await first.evaluate(configEvidence);
    // Markdown normalizes CRLF in logical fence input; native evidence uses that input's byte offsets.
    const markdownConfig = structuredClone(savedConfig);
    const sourceBytes = new TextEncoder().encode(source);
    for (const piece of markdownConfig) for (const field of ['span', 'labelSpan']) {
      if (!piece[field]) continue;
      for (const bound of ['start', 'end']) {
        const prefix = sourceBytes.slice(0, piece[field][bound]);
        piece[field][bound] -= prefix.reduce((count, byte, index) => count + Number(byte === 13 && sourceBytes[index + 1] === 10), 0);
      }
    }
    assert.equal(await first.locator('title[tabindex], desc[tabindex], title[data-mt-role], desc[data-mt-role]').count(), 0, 'nonvisual accessibility text must not become a selectable control');
    const shape = first.locator(`[data-mt-key="${key}"][data-mt-role=node]`);
    const cardRect = shape.first().locator(':scope > rect');
    const asset = shape.first().locator(':scope:is(.icon-shape, .image-shape) > image, :scope:is(.icon-shape, .image-shape) > g:not(.label) svg');
    const ellipse = shape.first().locator(':scope > ellipse');
    const rough = shape.first().locator(':scope > g.basic.label-container > path').last();
    const consoleBody = shape.first().locator(':scope > g.basic.label-container > rect');
    const taskLine = shape.first().locator('line.task-line');
    if (!await cardRect.count() && await taskLine.count()) {
      const point = await taskLine.evaluate(element => {
        const line = element as SVGGeometryElement;
        for (const fraction of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
          const point = line.getPointAtLength(line.getTotalLength() * fraction).matrixTransform(line.getScreenCTM()!);
          if (element.ownerDocument.elementFromPoint(point.x, point.y)?.closest('[data-mt-role]') === element.closest('[data-mt-role]')) return { x: point.x, y: point.y };
        }
        throw new Error('task line has no exposed painted pointer target');
      });
      await page.mouse.click(point.x, point.y);
    } else if (await asset.count()) {
      await asset.first().click({ position: { x: 3, y: 3 } });
    } else if (await ellipse.count()) {
      await ellipse.click({ position: { x: 3, y: (await ellipse.boundingBox())!.height / 2 } });
    } else if (await consoleBody.count()) {
      await consoleBody.click({ position: { x: 3, y: (await consoleBody.boundingBox())!.height / 2 } });
    } else if (await rough.count()) {
      const point = await rough.evaluate(element => {
        const path = element as SVGGeometryElement;
        const point = path.getPointAtLength(path.getTotalLength() * 0.2).matrixTransform(path.getScreenCTM()!);
        return { x: point.x, y: point.y };
      });
      await page.mouse.click(point.x, point.y);
    } else {
      if (key.startsWith('journey:') && await cardRect.count()) await clickExposedTarget(cardRect.first());
      else await (await cardRect.count() ? cardRect.first() : shape.first()).click({ position: { x: key.startsWith('kanban:') ? 10 : 3, y: 3 } });
    }
    let event = await page.evaluate(() => (window as any).events.at(-1));
    const nodeSpan = event.span;
    assert.equal(source.slice(event.span.start, event.span.end), expected);
    const defaultFace = shape.first().locator('circle.face:not([data-mt-key])');
    if (await defaultFace.count()) {
      await defaultFace.click({ position: { x: 15, y: 3 } });
      assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), nodeSpan, 'a generated default face belongs to its task');
    }
    for (const actor of await shape.first().locator('circle[class^="actor-"]:not([data-mt-key])').all()) {
      await actor.click();
      assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), nodeSpan, 'an empty generated actor circle belongs to its task');
    }
    if (key.startsWith('state:node:')) {
      await shape.first().focus(); await shape.first().press('Enter');
      assert.equal(await shape.first().getAttribute('data-mt-selected'), 'true', 'state node keyboard activation keeps node selection');
    }
    const consoleGlyph = shape.first().locator('.console-glyph');
    if (await consoleGlyph.count()) {
      await consoleGlyph.click();
      const glyphEvent = await page.evaluate(() => (window as any).events.at(-1));
      assert.equal(glyphEvent.role, 'node', 'generated glyph clicks select their enclosing node');
      assert.equal(source.slice(glyphEvent.span.start, glyphEvent.span.end), expected);
    }
    await clickExposedTarget(first.locator(labelSelector).first());
    event = await page.evaluate(() => (window as any).events.at(-1));
    assert.equal(source.slice(event.span.start, event.span.end), label);
    const labelSpan = event.span;
    if (expectedTextColour !== undefined) {
      const labelGroup = first.locator(labelSelector).first();
      assert.equal(await labelGroup.evaluate(element => element.querySelectorAll('text').length || Number(element.tagName === 'text')), source.includes('textPlacement: old') ? 1 : 2);
      const lines = labelGroup.locator('text');
      for (const line of await lines.all()) {
        assert.equal(await line.evaluate(element => getComputedStyle(element).fill), expectedTextColour);
        await line.click();
        assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), labelSpan, 'every rendered line owns the same authored label');
        assert.equal(await labelGroup.getAttribute('data-mt-selected'), 'true');
        assert.equal(await line.getAttribute('tabindex'), null, 'lines must not create competing keyboard targets');
      }
    }
    const sharedLabelSpan = nodeSpan.start === labelSpan.start && nodeSpan.end === labelSpan.end;
    await page.evaluate(() => (window as any).handles[0].highlight([(window as any).events.at(-1).span]));
    assert.equal(await first.locator('[data-mt-role=node][data-mt-selected=true]').count(), sharedLabelSpan ? 1 : 0, 'equal-span node and label form one selection; distinct labels remain separate');
    assert.equal(await first.locator(labelSelector).first().getAttribute('data-mt-selected'), 'true', 'the authored label remains selected');
    assert.equal(await page.locator('svg[data-mt-map]').nth(1).locator('[data-mt-selected=true]').count(), 0);
    const controlSpans: { start: number; end: number }[] = [];
    for (const [controlKey, text, role = 'control'] of controls) {
      const target = controlKey === "state:note:first" ? first.locator("path.note-edge").first() : controlKey === "state:note:last" ? first.locator("path.note-edge").last() : controlKey === "state:region:last" ? first.locator("g:has(> g > rect.divider)").last() : first.locator(`[data-mt-key="${controlKey}"][data-mt-role="${role}"], [data-mt-key="${controlKey}"] [data-mt-role="${role}"]`).first();
      const background = target.locator(':scope > rect[width], :scope > g > rect.outer, :scope > g > rect.divider, :scope > g > path[fill]:not([fill=none])');
      if (await target.evaluate(element => ['line', 'path'].includes(element.tagName))) {
        const point = controlKey.startsWith('state:note:') ? await noteConnectorPoint(target) : await target.evaluate(element => {
          const shape = element as SVGGeometryElement;
          const point = shape.getPointAtLength(shape.getTotalLength() * (element.tagName === 'path' ? 0.2 : 0.5)).matrixTransform(shape.getScreenCTM()!);
          return { x: point.x, y: point.y };
        });
        await page.mouse.click(point.x, point.y);
      } else {
        const shape = await background.count() ? background.first() : target;
        const centered = role === 'node' && await shape.evaluate(element => element.tagName === 'path');
        await shape.click(controlKey.startsWith('journey:score:') ? { position: { x: 15, y: 3 } } : await background.count() && !centered ? { position: { x: 1, y: (await shape.boundingBox())!.height / 2 } } : {});
      }
      const control = await page.evaluate(() => (window as any).events.at(-1));
      assert.equal(source.slice(control.span.start, control.span.end), text, `control ${controlKey} ${role} in ${source}`);
      controlSpans.push(control.span);
      if (controlKey.startsWith('journey:score:')) {
        const bindings = first.locator(`[data-mt-key="${controlKey}"][data-mt-role=control]`);
        assert.equal(await bindings.count(), 2, 'face and expression retain their native bindings');
        const assertScoreGroup = async () => {
          assert.equal(await bindings.locator(':scope[data-mt-selected=true]').count(), 2, 'the whole score visual is selected');
          assert.equal(await bindings.locator(':scope[tabindex="0"]').count(), 1, 'one score keyboard stop');
          for (const binding of await bindings.all()) assert.equal(await binding.evaluate(element => getComputedStyle(element).outlineStyle), 'none', 'score focus must not add a competing rectangle');
          assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), control.span);
        };
        await assertScoreGroup();
        await bindings.nth(1).locator('circle').first().click();
        await assertScoreGroup();
        await bindings.locator(':scope[tabindex="0"]').focus();
        await page.keyboard.press('Enter');
        await assertScoreGroup();
        await page.evaluate(span => (window as any).handles[0].highlight([span]), control.span);
        assert.equal(await bindings.locator(':scope[data-mt-selected=true]').count(), 2);
      }
      if (controlKey.startsWith('state:note:')) {
        const body = first.locator(`[data-mt-role=control][data-mt-start="${control.span.start}"][data-mt-end="${control.span.end}"]`);
        assert.equal(await body.getAttribute('data-mt-selected'), 'true', 'connector click selects the whole note');
        await body.scrollIntoViewIfNeeded();
        const point = await body.evaluate(element => {
          const box = element.getBoundingClientRect();
          for (const x of [0.1, 0.5, 0.9]) for (const y of [0.1, 0.5, 0.9]) {
            const point = { x: box.x + box.width * x, y: box.y + box.height * y };
            if (element.ownerDocument.elementFromPoint(point.x, point.y)?.closest('[data-mt-role]') === element) return point;
          }
          throw new Error('note body has no exposed pointer target');
        });
        await page.mouse.click(point.x, point.y);
        assert.equal(await target.getAttribute('data-mt-selected'), 'true', 'note body click selects its connector too');
        assert.equal(await body.getAttribute('data-mt-selected'), 'true');
        assert.equal(await body.evaluate(element => Number(element.getAttribute('tabindex') === '0')), 1);
        assert.equal(await target.getAttribute('tabindex'), '-1', 'one keyboard stop for the note object');
        const group = await page.evaluate(() => (window as any).events.at(-1).pieces);
        assert.ok(group.some((piece: any) => piece.kind === 'edge') && group.some((piece: any) => piece.kind === 'control'), 'the selection keeps both native AST bindings');
        await page.evaluate(span => (window as any).handles[0].highlight([span]), control.span);
        assert.equal(await target.getAttribute('data-mt-selected'), 'true', 'full note source selects its connector');
        const attachmentStart = control.span.start + source.slice(control.span.start, control.span.end).indexOf(' of ') + 4;
        const attachment = source.slice(attachmentStart).split(/\s/)[0]!;
        for (const span of [{ start: attachmentStart, end: attachmentStart + attachment.length }, { start: control.span.start + 5, end: attachmentStart }]) {
          await page.evaluate(span => (window as any).handles[0].highlight([span]), span);
          assert.equal(await first.locator('[data-mt-role=node][data-mt-selected=true], [data-mt-role=node-label][data-mt-selected=true]').count(), 0, 'note properties belong to the note, not the attachment state');
          assert.equal(await first.locator('[data-mt-role=control][data-mt-selected=true]').count(), 1, 'note attachment and placement select the note');
        }
        const noteLabel = await page.evaluate(span => (window as any).handles[0].mapping.pieces.find((piece: any) => piece.kind === 'control' && piece.span.start === span.start && piece.span.end === span.end)?.labelSpan, control.span);
        assert.ok(noteLabel, 'the note retains its own text range');
        await page.evaluate(span => (window as any).handles[0].highlight([span]), noteLabel);
        assert.equal(await first.locator('[data-mt-role=edge][data-mt-selected=true]').count(), 0, 'note text source selection must not select its connector');
        assert.ok(await first.locator('[data-mt-role=control-label][data-mt-selected=true]').count());
      }
      if (controlKey === 'state:region:last') {
        assert.equal(control.role, 'node');
        assert.equal(await first.getAttribute('data-mt-selected'), null, 'region click must not select the diagram');
        await page.evaluate(span => (window as any).handles[0].highlight([span]), control.span);
        assert.equal(await target.getAttribute('data-mt-selected'), 'true', 'region source block selects its rectangle');
        assert.equal(await first.getAttribute('data-mt-selected'), null);
      }
    }
    if (reverseSpan !== undefined) {
      await page.evaluate(span => (window as any).handles[0].highlight([span]), reverseSpan);
      if (reversePrimaryKey === key) {
        assert.equal(await shape.locator(':scope[data-mt-selected=true]').count(), 1, 'source occurrence maps to its semantic node');
      } else {
        assert.equal(await first.locator(`[data-mt-key="${reversePrimaryKey}"][data-mt-role=${reverseRole}][data-mt-selected=true]`).count(), reversePrimaryKey.startsWith('journey:score:') ? 2 : 1, 'source occurrence selects every binding of its owning object');
        assert.equal(await shape.locator(':scope[data-mt-selected=true]').count(), 0, 'an owning object must not select a merely referenced node');
      }
      assert.equal(await first.locator(labelSelector).first().getAttribute('data-mt-selected'), (sharedLabelSpan || reverseWholeOwner) && reversePrimaryKey === key ? 'true' : null, 'node references highlight an equal-span visual group, while distinct labels retain their own binding');
      for (const targetKey of reverseKeys) assert.ok(await first.locator(`[data-mt-key="${targetKey}"][data-mt-selected=true]`).count(), `related visual ${targetKey}`);
    }
    await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
    assert.deepEqual(await page.locator('[data-mt-generated="bounds"]').evaluateAll(elements => elements.map(element => element.getAttribute('pointer-events'))), boundsBefore, 'dispose must restore generated bounds hit behavior');
    await writeFile(filename, markdown);
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    const original = page.frameLocator('#source-frame').locator('#source');
    assert.deepEqual(await page.locator('svg[data-mt-map]').first().evaluate(configEvidence), markdownConfig, 'native configuration evidence must survive saved SVG and normalized Markdown insertion');
    assert.equal(await page.locator('svg title[tabindex], svg desc[tabindex], svg title[data-mt-role], svg desc[data-mt-role]').count(), 0);
    const liveDefaultFace = page.locator(`svg[data-mt-map] [data-mt-key="${key}"][data-mt-role=node] circle.face:not([data-mt-key])`).first();
    if (await liveDefaultFace.count()) {
      await liveDefaultFace.click({ position: { x: 15, y: 3 } });
      assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), markdownSelection(expected));
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start: toMarkdown(nodeSpan.start), end: toMarkdownEnd(nodeSpan.end) }));
    }
    await clickExposedTarget(page.locator(labelSelector).first());
    assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), markdownSelection(label));
    if (expectedTextColour !== undefined) {
      const labelGroup = page.locator(labelSelector).first();
      for (const line of await labelGroup.locator('text').all()) {
        await line.click();
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), markdownSelection(label));
        await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start: toMarkdown(labelSpan.start), end: toMarkdownEnd(labelSpan.end) }));
      }
    }
    const start = toMarkdown(labelSpan.start);
    const end = toMarkdownEnd(labelSpan.end);
    await page.locator(labelSelector).first().focus();
    await page.locator(labelSelector).first().press('Enter');
    assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), markdownSelection(label));
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start, end }));
    await original.evaluate((element, span) => {
      const doc = element.ownerDocument; const range = doc.createRange();
      range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
      doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
    }, { start, end });
    await page.waitForSelector('[data-mt-role=node-label][data-mt-selected=true]');
    assert.equal(await page.locator('[data-mt-role=node][data-mt-selected=true]').count(), sharedLabelSpan ? 1 : 0, 'original source respects equal-span visual equivalence');
    if (reverseSpan !== undefined) {
      await original.evaluate((element, span) => {
        const doc = element.ownerDocument; const range = doc.createRange();
        range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
        doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
      }, { start: toMarkdown(reverseSpan.start), end: toMarkdownEnd(reverseSpan.end) });
      // A straight SVG connector can have a zero-width bounding box while its stroke is rendered.
      await page.waitForSelector(`[data-mt-key="${reversePrimaryKey}"][data-mt-role=${reverseRole}][data-mt-selected=true]`, { state: 'attached' });
      if (reversePrimaryKey !== key) assert.equal(await page.locator(`[data-mt-key="${key}"][data-mt-role=node][data-mt-selected=true]`).count(), 0);
      assert.equal(await page.locator(labelSelector).first().getAttribute('data-mt-selected'), (sharedLabelSpan || reverseWholeOwner) && reversePrimaryKey === key ? 'true' : null, 'live node references preserve equal-span visual grouping');
      for (const targetKey of reverseKeys) assert.ok(await page.locator(`[data-mt-key="${targetKey}"][data-mt-selected=true]`).count(), `live related visual ${targetKey}`);
    }
    for (const [index, [controlKey, text, role = 'control']] of controls.entries()) {
      const target = controlKey === "state:note:first" ? page.locator("path.note-edge").first() : controlKey === "state:note:last" ? page.locator("path.note-edge").last() : controlKey === "state:region:last" ? page.locator("g:has(> g > rect.divider)").last() : page.locator(`[data-mt-key="${controlKey}"][data-mt-role="${role}"], [data-mt-key="${controlKey}"] [data-mt-role="${role}"]`).first();
      if (role.endsWith('-label')) {
        await target.click();
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), markdownSelection(text));
      }
      if (controlKey.startsWith('state:note:')) {
        const local = controlSpans[index]!;
        const attachmentStart = local.start + source.slice(local.start, local.end).indexOf(' of ') + 4;
        const attachment = source.slice(attachmentStart).split(/\s/)[0]!;
        await original.evaluate((element, span) => {
          const doc = element.ownerDocument, range = doc.createRange();
          range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
          doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
        }, { start: toMarkdown(attachmentStart), end: toMarkdown(attachmentStart + attachment.length) });
        await page.waitForSelector('[data-mt-role=control][data-mt-selected=true]');
        assert.equal(await page.locator('[data-mt-role=node][data-mt-selected=true], [data-mt-role=node-label][data-mt-selected=true]').count(), 0, 'source note attachment must not select its referenced state');
        const point = await noteConnectorPoint(target);
        await page.mouse.click(point.x, point.y);
        const body = page.locator(`[data-mt-role=control][data-mt-selected=true]`);
        assert.equal(await body.count(), 1, 'live connector activation selects the note body');
        assert.equal(await body.evaluate(element => getComputedStyle(element).outlineStyle), 'none', 'selection has one visual treatment');
        assert.equal(await target.getAttribute('data-mt-selected'), 'true');
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), markdownSelection(text));
      }
      if (controlKey === 'state:region:last') {
        const rect = target.locator(':scope > g > rect.divider');
        await rect.click({ position: { x: 1, y: (await rect.boundingBox())!.height / 2 } });
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), markdownSelection(text));
        assert.equal(await page.locator('svg[data-mt-map]').getAttribute('data-mt-selected'), null);
      }
      if (controlKey.startsWith('journey:score:')) {
        const bindings = page.locator(`svg[data-mt-map] [data-mt-key="${controlKey}"][data-mt-role=control]`);
        for (const [partIndex, part] of [bindings.first(), bindings.nth(1).locator('circle').first()].entries()) {
          await part.click(partIndex === 0 ? { position: { x: 15, y: 3 } } : {});
          assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), markdownSelection(text));
          assert.equal(await bindings.locator(':scope[data-mt-selected=true]').count(), 2, 'live score parts select the complete group');
          assert.equal(await bindings.locator(':scope[tabindex="0"]').count(), 1);
          const span = controlSpans[index]!;
          await page.waitForFunction(expected => navigator.clipboard.readText().then(value => value === expected), formatLocation({ id: filename, source: markdown }, { start: toMarkdown(span.start), end: toMarkdownEnd(span.end) }));
        }
      }
      const before = await page.evaluate(() => navigator.clipboard.readText());
      await target.focus();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), before, 'focus must not copy');
      await target.press(index % 2 ? 'Space' : 'Enter');
      if (controlKey.startsWith('journey:score:')) {
        assert.equal(await page.locator(`svg[data-mt-map] [data-mt-key="${controlKey}"][data-mt-role=control][data-mt-selected=true]`).count(), 2, 'live keyboard selects the complete score group');
        assert.equal(await target.evaluate(element => getComputedStyle(element).outlineStyle), 'none');
      }
      assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), markdownSelection(text));
      const span = controlSpans[index]!;
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start: toMarkdown(span.start), end: toMarkdownEnd(span.end) }));
      if (controlKey === 'journey:title') {
        await original.evaluate((element, span) => {
          const doc = element.ownerDocument, range = doc.createRange();
          range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
          doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
        }, { start: toMarkdown(span.start), end: toMarkdownEnd(span.end) });
        await target.locator(':scope[data-mt-selected=true]').waitFor();
        assert.equal(await page.locator('[data-mt-role^=node][data-mt-selected=true]').count(), 0, 'title source selection must stay with its title');
        await target.click();
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), markdownSelection(text));
        await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start: toMarkdown(span.start), end: toMarkdownEnd(span.end) }));
        if (role === 'control') {
          const field = source.indexOf('title:');
          await original.evaluate((element, span) => {
            const doc = element.ownerDocument, range = doc.createRange();
            range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
            doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
          }, { start: toMarkdown(field), end: toMarkdown(field + "title: 'Configured 😀'".length) });
          await page.waitForFunction(() => document.querySelector('[data-mt-key="journey:title"]')?.getAttribute('data-mt-selected') !== 'true');
        }
      }
    }
    await page.locator('svg[data-mt-map]').focus(); await page.keyboard.press('Enter');
    assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), markdown.slice(markdown.indexOf('> ```')));
    await writeFile(filename, markdown.replaceAll(markdownSelection(label), 'Changed'));
    await page.locator('[data-mt-role=node-label]').filter({ hasText: 'Changed' }).first().waitFor();
    return savedConfig;
  } finally { await browser.close(); await preview?.close(); await rm(directory, { recursive: true, force: true }); }
}

test('GANTT PLAN-AC2/3: saved native SVG and live Markdown selection, clipboard, source and saves', { timeout: 60_000 }, async () => {
  await verifyNative(gantt, 'gantt:task:a', 'Same 😀 :a, 2026-01-01, 2d', 'Same 😀', [['gantt:section:Build', 'section Build'], ['gantt:title', 'title Plan']]);
});

test('JOURNEY PLAN-AC2/3: native cards, labels and original Markdown selection', { timeout: 60_000 }, async () => {
  await verifyNative('journey\n  title Trip\n  section Morning\n  Same 😀 : 5 : Alice, Bob\n  Same 😀 : 2 : Alice\n', 'journey:task:0', 'Same 😀 : 5 : Alice, Bob', 'Same 😀', [['journey:score:0', '5'], ['journey:actor:1:0', 'Alice'], ['journey:actor:Alice', 'Alice']]);
});

test('OWN-JOURNEY-ACTOR: saved and live actor slots preserve local ownership and legend grouping', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-journey-owner-'));
  const filename = join(directory, 'journey.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await chromium.launch();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) for (const sectionMode of [0, 1, 2, 3]) {
      const source = `---\r\nconfig:\r\n  look: ${look}\r\n  htmlLabels: ${html}\r\n---\r\njourney\r\n%% 😀\r\n${sectionMode === 1 || sectionMode === 2 ? 'section Day\r\n' : ''}First : 5 : Alice 😀, Alice 😀, , Bob, Alice 😀\r\n${sectionMode >= 2 ? 'section Day\r\n' : ''}Second : 2 : Alice 😀, Bob, Carol : Ignored\r\nThird : 3 : Carol\r\n`;
      const { svg, mapping } = await producer.render('journey-owner', source);
      const actors = mapping.pieces.filter((piece: any) => piece.relation === 'actor-reference');
      assert.equal(actors.length, 8);
      const groupSize = (piece: typeof actors[number]) => source.indexOf(source.slice(piece.span.start, piece.span.end)) === piece.span.start ? 3 : 1;
      await page.setContent(svg + svg.replaceAll('journey-owner', 'journey-copy'));
      await page.evaluate(async activation => {
        const { activateSvg } = await import(activation);
        Object.assign(window, { events: [], handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect: (event: unknown) => (window as any).events.push(event) })) });
      }, activation);
      const first = page.locator('svg').first();
      for (const piece of actors) {
        const target = first.locator(`[data-mt-key="${piece.domId}"]`);
        const related = await page.evaluate(span => (window as any).handles[0].highlight([span]), piece.span);
        assert.equal(related.length, groupSize(piece) === 3 ? 2 : 1, 'reference and implicit declaration retain separate AST identities');
        assert.equal(await first.locator('[data-mt-selected=true]').count(), groupSize(piece));
        assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
        await target.click();
        let event = await page.evaluate(() => (window as any).events.at(-1));
        assert.deepEqual(event.span, piece.span);
        assert.equal(await first.locator('[data-mt-selected=true]').count(), groupSize(piece));
        if (groupSize(piece) === 3) {
          const group = first.locator(`[data-mt-start="${piece.span.start}"][data-mt-end="${piece.span.end}"]`);
          assert.equal(await group.locator(':scope[tabindex="0"]').count(), 1, 'one keyboard stop for legend and first circle');
          for (const member of await group.all()) {
            await member.click();
            assert.equal(await first.locator('[data-mt-selected=true]').count(), 3, 'every constituent selects the complete group');
          }
        }
        await target.focus(); await target.press('Enter');
        event = await page.evaluate(() => (window as any).events.at(-1));
        assert.deepEqual(event.span, piece.span);
      }
      await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
      assert.equal(await page.locator('[tabindex], [data-mt-selected]').count(), 0);
      const fence = '```mermaid\r\n' + source + '```\r\n';
      const markdown = '# Journey\r\n\r\n' + fence + '\r\n' + fence;
      await writeFile(filename, markdown);
      preview = await watchPreview(filename, { port: 0, sourceView: true });
      await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
      const original = page.frameLocator('#source-frame').locator('#source');
      for (const piece of actors) {
        const span = { start: markdown.indexOf(source) + piece.span.start, end: markdown.indexOf(source) + piece.span.end };
        await original.evaluate((element, span) => {
          const doc = element.ownerDocument, range = doc.createRange();
          range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
          doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
        }, span);
        await page.waitForFunction(count => document.querySelector('svg[data-mt-map]')!.querySelectorAll('[data-mt-selected=true]').length === count, groupSize(piece));
        const diagrams = page.locator('svg[data-mt-map]');
        assert.equal(await diagrams.nth(1).locator('[data-mt-selected=true]').count(), 0);
        const target = diagrams.first().locator(`[data-mt-key="${piece.domId}"]`);
        await target.click();
        await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, span));
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), source.slice(piece.span.start, piece.span.end));
        const before = await page.evaluate(() => navigator.clipboard.readText());
        await target.focus();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), before, 'focus does not copy');
        await target.press(piece.span.start % 2 ? 'Space' : 'Enter');
        assert.equal(await diagrams.first().locator('[data-mt-selected=true]').count(), groupSize(piece));
      }
      await preview.close(); preview = undefined;
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('JOURNEY-2-LEGEND: every wrapped line shares saved/live actor ownership and focus', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-journey-legend-'));
  const filename = join(directory, 'legend.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await chromium.launch();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) for (const [limit, margin, font, actor, expected] of [
      [0, 0, 16, 'Alpha', ['-', 'A-', 'l-', 'p-', 'h-', 'a']],
      [-1, 0, 16, 'Alpha', ['-', 'A-', 'l-', 'p-', 'h-', 'a']],
      [1, 0, 16, 'Alpha', ['-', 'A-', 'l-', 'p-', 'h-', 'a']],
      [360, 0, 16, 'Alpha', ['Alpha']],
      [0, 0, 1, '.', ['-', '.']],
      [0, 9, 24, 'Al pha', ['-', 'A-', 'l', '-', 'p-', 'h-', 'a']],
      [360, 9, 12, 'Alpha 😀', ['Alpha 😀']],
      [0, 0, 16, 'A😀', ['-', 'A�-', '😀']],
      [360, 0, 12, 'Alpha', ['Alpha']],
      [360, 0, 24, 'Alpha', ['Alpha']],
    ] as const) {
      const source = `---\r\nconfig:\r\n  look: ${look}\r\n  htmlLabels: ${html}\r\n  fontFamily: Arial\r\n  themeVariables:\r\n    fontSize: ${font}px\r\n  journey:\r\n    maxLabelWidth: ${limit}\r\n    boxTextMargin: ${margin}\r\n    leftMargin: 150\r\n---\r\njourney\r\n%% 😀\r\nFirst : 5 : ${actor}\r\nSecond : 3 : ${actor}\r\n`;
      const { svg, mapping } = await producer.render('journey-legend', source);
      const origin = mapping.pieces.find(piece => piece.domId === `journey:actor:${actor}`)!.span;
      const later = mapping.pieces.find(piece => piece.domId === 'journey:actor:1:0')!.span;
      const groupCount = expected.length + 2;
      await page.setContent(svg + svg.replaceAll('journey-legend', 'journey-copy'));
      const savedMarkup = await page.locator('svg').evaluateAll(elements => elements.map(element => element.outerHTML));
      await page.evaluate(async activation => {
        const { activateSvg } = await import(activation);
        Object.assign(window, { events: [], handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect: (event: unknown) => (window as any).events.push(event) })) });
      }, activation);
      const first = page.locator('svg').first();
      assert.deepEqual(await first.locator('text.legend').allTextContents(), [...expected]);
      assert.equal(await first.locator('text.legend').first().evaluate(element => getComputedStyle(element).fontSize), `${font}px`);
      const group = first.locator(`[data-mt-start="${origin.start}"][data-mt-end="${origin.end}"]`);
      assert.equal(await group.count(), groupCount);
      assert.equal(await group.locator(':scope[tabindex="0"]').count(), 1);
      for (const member of await group.all()) {
        await clickExposedTarget(member);
        assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), origin);
        assert.equal(await first.locator('[data-mt-selected=true]').count(), groupCount);
        assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
      }
      await page.evaluate(span => (window as any).handles[0].highlight([span]), later);
      assert.equal(await first.locator('[data-mt-selected=true]').count(), 1, 'later actor references stay local');
      await page.evaluate(span => (window as any).handles[0].highlight([span]), origin);
      assert.equal(await first.locator('[data-mt-selected=true]').count(), groupCount, 'reverse selection restores the whole first-origin group');
      await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
      assert.equal(await page.locator('[tabindex], [data-mt-selected], style[data-mt-runtime]').count(), 0);
      assert.deepEqual(await page.locator('svg').evaluateAll(elements => elements.map(element => element.outerHTML)), savedMarkup, 'disposal restores the exact host SVG');
      const fence = '```mermaid\r\n' + source + '```\r\n';
      const markdown = '# Legend\r\n\r\n' + fence + '\r\n' + fence;
      await writeFile(filename, markdown);
      preview = await watchPreview(filename, { port: 0, sourceView: true });
      await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
      const original = page.frameLocator('#source-frame').locator('#source');
      const diagrams = page.locator('svg[data-mt-map]');
      const span = { start: markdown.indexOf(source) + origin.start, end: markdown.indexOf(source) + origin.end };
      const liveGroup = diagrams.first().locator(`[data-mt-key="journey:actor:${actor}"], [data-mt-key="journey:actor:0:0"]`);
      assert.equal(await liveGroup.count(), groupCount, 'the live click loop includes every first-origin constituent');
      assert.deepEqual(await diagrams.first().locator('text.legend').allTextContents(), [...expected]);
      assert.equal(await liveGroup.locator(':scope[tabindex="0"]').count(), 1);
      for (const member of await liveGroup.all()) {
        await clickExposedTarget(member);
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), actor);
        await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, span));
        assert.equal(await diagrams.first().locator('[data-mt-selected=true]').count(), groupCount);
        assert.equal(await diagrams.nth(1).locator('[data-mt-selected=true]').count(), 0);
      }
      const focus = liveGroup.locator(':scope[tabindex="0"]');
      await diagrams.first().focus();
      await page.evaluate(() => navigator.clipboard.writeText('before-legend-keyboard'));
      await focus.focus();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'before-legend-keyboard', 'focus selects without copying');
      await focus.press(limit < 0 ? 'Space' : 'Enter');
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, span));
      for (const [owner, count] of [[later, 1], [origin, groupCount]] as const) {
        const selection = { start: markdown.indexOf(source) + owner.start, end: markdown.indexOf(source) + owner.end };
        await original.evaluate((element, span) => {
          const doc = element.ownerDocument, range = doc.createRange();
          range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
          doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
        }, selection);
        await page.waitForFunction(count => document.querySelector('svg[data-mt-map]')!.querySelectorAll('[data-mt-selected=true]').length === count, count);
        if (count === 1) assert.equal(await diagrams.first().locator('[data-mt-key="journey:actor:1:0"]').getAttribute('data-mt-selected'), 'true');
        assert.equal(await diagrams.nth(1).locator('[data-mt-selected=true]').count(), 0);
      }
      await preview.close(); preview = undefined;
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('JOURNEY-2-LEGEND-EMPTY: generated empty actor circles retain saved/live task selection', { timeout: 60_000 }, async () => {
  for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
    const source = `---\r\nconfig:\r\n  look: ${look}\r\n  htmlLabels: ${html}\r\n  journey:\r\n    maxLabelWidth: -1\r\n---\r\njourney\r\nFirst : 5 :\r\n`;
    await verifyNative(source, 'journey:task:0', 'First : 5 :', 'First', [], 'First : 5 :', [], 'journey:task:0', undefined, true);
  }
});

test('KANBAN PLAN-AC2/3: columns, cards, metadata and original Markdown selection', { timeout: 60_000 }, async () => {
  await verifyNative("kanban\n  todo[Todo]\n    a[Same 😀]@{ ticket: 'T-1', assigned: 'Alice', priority: 'High' }\n    b[Same 😀]\n  done[Done]\n    c[Ship]\n", 'kanban:card:a', "a[Same 😀]@{ ticket: 'T-1', assigned: 'Alice', priority: 'High' }", 'Same 😀', [['kanban:column:todo', 'todo[Todo]'], ['kanban:field:a:ticket', 'T-1'], ['kanban:field:a:assigned', 'Alice'], ['kanban:field:a:priority', 'High']]);
});

test('OWN-JOURNEY-SECTION: saved and live section runs keep distinct source owners', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-section-owner-'));
  const filename = join(directory, 'sections.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await chromium.launch();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) for (const [body, owners] of [
      ['section Day 😀\r\nFirst : 5 : Alice\r\nsection Night\r\nSecond : 2 : Bob\r\nsection Day 😀\r\nThird : 3 : Carol\r\n', [0, 1, 2]],
      ['section Day 😀\r\nFirst : 5 : Alice\r\nsection Day 😀\r\nSecond : 2 : Bob\r\n', [0, 0]],
      ['section Unused\r\nsection Day 😀\r\nFirst : 5 : Alice\r\n', [null, 1]],
      ['section \r\nFirst : 5 : Alice\r\n', [null]],
      ['First : 5 : Alice\r\nsection Day 😀\r\nSecond : 2 : Bob\r\n', [0]],
      ['section Day 😀\r\nFirst : 5 : Alice\r\nsection Unused\r\nsection Day 😀\r\nSecond : 2 : Bob\r\n', [0, null, 0]],
      ['section Day 😀\r\nFirst : 5 : Alice\r\nsection \r\nSecond : 2 : Bob\r\nsection Day 😀\r\nThird : 3 : Carol\r\n', [0, 1, 2]],
      ['section Day 😀\r\nsection Day 😀\r\nFirst : 5 : Alice\r\n', [null, 1]],
    ] as const) {
      const source = `---\r\nconfig:\r\n  look: ${look}\r\n  htmlLabels: ${html}\r\n---\r\njourney\r\n%% 😀\r\n` + body;
      const declarations = [...body.matchAll(/^section[^\n]*/gm)].map(match => ({ start: source.indexOf(body) + match.index, end: source.indexOf(body) + match.index + match[0].trimEnd().length }));
      const { svg } = await producer.render('section-owner', source);
      await page.setContent(svg + svg.replaceAll('section-owner', 'section-copy'));
      await page.evaluate(async activation => {
        const { activateSvg } = await import(activation);
        Object.assign(window, { events: [], handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect: (event: unknown) => (window as any).events.push(event) })) });
      }, activation);
      const first = page.locator('svg').first();
      for (const [index, span] of declarations.entries()) {
        const owner = owners[index];
        assert.ok(owner !== undefined, "every authored section has an expected owner classification");
        const pieces = await page.evaluate(span => (window as any).handles[0].highlight([span]), span);
        if (owner === null) {
          assert.equal(pieces.length, 0, 'unused declarations have no phantom visual');
          assert.equal(await first.locator('[data-mt-selected=true]').count(), 0);
          continue;
        }
        assert.ok(pieces.some((piece: any) => piece.sectionIndex === index));
        const key = `journey:section:${owner}`;
        const frame = first.locator(`[data-mt-key="${key}"][data-mt-role=control]`);
        assert.equal(await frame.getAttribute('data-mt-selected'), 'true');
        assert.equal(await first.locator('[data-mt-role=control][data-mt-selected=true]').count(), 1, 'only the actual owning frame selects');
        assert.equal(await first.locator('[data-mt-role=control-label][data-mt-selected=true]').count(), owner === index && source.slice(span.start, span.end).trim() !== 'section' ? 1 : 0, 'a full owner includes its label; aliases do not claim another declaration’s label');
        await frame.locator(':scope > rect').click({ position: { x: 1, y: 1 } });
        assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), declarations[owner]);
        await frame.focus(); await frame.press(index % 2 ? 'Space' : 'Enter');
        assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), declarations[owner]);
        const label = first.locator(`[data-mt-key="${key}"][data-mt-role=control-label]`);
        if (await label.count()) {
          await label.first().click();
          const event = await page.evaluate(() => (window as any).events.at(-1));
          const start = declarations[owner]!.start + 'section '.length;
          assert.deepEqual(event.span, { start, end: declarations[owner]!.end });
          assert.equal(await frame.getAttribute('data-mt-selected'), null, 'label has its own authored span');
          await page.evaluate(span => (window as any).handles[0].highlight([span]), { start: span.start + 'section '.length, end: span.end });
          assert.equal(await frame.getAttribute('data-mt-selected'), index === owner ? null : 'true', 'only the effective declaration owns the displayed label');
          assert.equal(await label.first().getAttribute('data-mt-selected'), index === owner ? 'true' : null);
        }
        assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
      }
      await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
      assert.equal(await page.locator('[tabindex], [data-mt-selected]').count(), 0);
      const fence = '```mermaid\r\n' + source + '```\r\n';
      const markdown = '# Sections\r\n\r\n' + fence + '\r\n' + fence;
      await writeFile(filename, markdown);
      preview = await watchPreview(filename, { port: 0, sourceView: true });
      await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
      const original = page.frameLocator('#source-frame').locator('#source');
      const diagrams = page.locator('svg[data-mt-map]');
      for (const [index, local] of declarations.entries()) {
        const owner = owners[index];
        assert.ok(owner !== undefined, "every authored section has an expected owner classification");
        if (owner === null) await diagrams.first().locator('[data-mt-role=node]').first().press('Enter');
        const span = { start: markdown.indexOf(source) + local.start, end: markdown.indexOf(source) + local.end };
        await original.evaluate((element, span) => {
          const doc = element.ownerDocument, range = doc.createRange();
          range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
          doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
        }, span);
        if (owner === null) {
          await page.waitForFunction(() => document.querySelector('svg[data-mt-map]')!.querySelectorAll('[data-mt-selected=true]').length === 0);
          continue;
        }
        const key = `journey:section:${owner}`;
        const frame = diagrams.first().locator(`[data-mt-key="${key}"][data-mt-role=control]`);
        await frame.locator(':scope[data-mt-selected=true]').waitFor();
        assert.equal(await diagrams.first().locator('[data-mt-role=control][data-mt-selected=true]').count(), 1);
        assert.equal(await diagrams.nth(1).locator('[data-mt-selected=true]').count(), 0);
        await frame.locator(':scope > rect').click({ position: { x: 1, y: 1 } });
        const primary = declarations[owner]!;
        const primarySpan = { start: markdown.indexOf(source) + primary.start, end: markdown.indexOf(source) + primary.end };
        await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, primarySpan));
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), source.slice(primary.start, primary.end));
        const before = await page.evaluate(() => navigator.clipboard.readText());
        await frame.focus();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), before);
        await frame.press(index % 2 ? 'Space' : 'Enter');
        const label = diagrams.first().locator(`[data-mt-key="${key}"][data-mt-role=control-label]`);
        if (await label.count()) {
          await label.first().press('Enter');
          await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start: primarySpan.start + 'section '.length, end: primarySpan.end }));
          assert.equal(await frame.getAttribute('data-mt-selected'), null);
          if (index === owner) await frame.press('Enter');
          await original.evaluate((element, span) => {
            const doc = element.ownerDocument, range = doc.createRange();
            range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
            doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
          }, { start: span.start + 'section '.length, end: span.end });
          await page.waitForFunction(({ key, isOwner }) => {
            const svg = document.querySelector('svg[data-mt-map]')!;
            return svg.querySelector(`[data-mt-key="${key}"][data-mt-role=control]`)?.getAttribute('data-mt-selected') === (isOwner ? null : 'true')
              && svg.querySelector(`[data-mt-key="${key}"][data-mt-role=control-label]`)?.getAttribute('data-mt-selected') === (isOwner ? 'true' : null);
          }, { key, isOwner: index === owner });
          assert.equal(await frame.getAttribute('data-mt-selected'), index === owner ? null : 'true');
          assert.equal(await label.first().getAttribute('data-mt-selected'), index === owner ? 'true' : null);
        }
      }
      await preview.close(); preview = undefined;
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('JOURNEY-2-TITLE: YAML titles keep saved and live source ownership and body precedence', { timeout: 180_000 }, async () => {
  for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
    for (const bodyTitle of [false, true]) {
      const source = `---\ntitle: 'Configured 😀'\nconfig:\n  look: ${look}\n  htmlLabels: ${html}\n---\njourney\n${bodyTitle ? 'title Body 😀\n' : ''}Task : 5 : Alice\n`;
      await verifyNative(source, 'journey:task:0', 'Task : 5 : Alice', 'Task', [['journey:title', bodyTitle ? 'title Body 😀' : 'Configured 😀', bodyTitle ? 'control' : 'control-label']]);
    }
  }
  await verifyNative('---\ntitle: >-\n  First 😀\n  Second\n---\njourney\nTask : 5 : Alice\n', 'journey:task:0', 'Task : 5 : Alice', 'Task', [['journey:title', 'First 😀\n  Second', 'control-label']]);
  await verifyNative('---\ntitle: >-\n  First 😀\n  Second\nconfig:\n  htmlLabels: false\n---\njourney\nTask : 5 : Alice\n', 'journey:task:0', 'Task : 5 : Alice', 'Task', [['journey:title', 'First 😀\n  Second\n', 'control-label']]);
});

test('JOURNEY-2-TEXT: every label line remains one saved and live source target across text modes', { timeout: 300_000 }, async () => {
  for (const br of ['<br>', '<BR>', '<br/>', '<br />']) for (const mode of ['fo', 'old', 'tspan', 'other']) for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
    const source = `---\nconfig:\n  look: ${look}\n  htmlLabels: ${html}\n  journey:\n    textPlacement: ${mode}\n    taskFontSize: 18\n---\njourney\n%% 😀\nsection Day${br}Line\nTask${br}Line :5: Alice\n`;
    await verifyNative(source, 'journey:task:0', `Task${br}Line :5: Alice`, `Task${br}Line`, [['journey:section:0', `Day${br}Line`, 'control-label']], undefined, [], 'journey:task:0', mode === 'fo' || mode === 'old' ? 'rgb(51, 51, 51)' : 'rgb(255, 255, 255)');
  }
  for (const mode of ['tspan', 'other']) for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
    const source = `---\nconfig:\n  look: ${look}\n  htmlLabels: ${html}\n  journey:\n    textPlacement: ${mode}\n    taskFontSize: 18\n    sectionColours: ['#123456']\n---\njourney\nsection First\nBefore :5: Alice\nsection Second\nTask<br>Line :5: Alice\n`;
    await verifyNative(source, 'journey:task:1', 'Task<br>Line :5: Alice', 'Task<br>Line', [['journey:section:1', 'Second', 'control-label']], undefined, [], 'journey:task:1', 'rgb(18, 52, 86)');
  }
});

test('JOURNEY-2-SCORE-NUMBERS: numeric score parts share saved/live selection and unrenderable arithmetic selects the task', { timeout: 300_000 }, async () => {
  for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
    for (const score of ['3.5', '0x5', '0X05', '0b11', '0B11', '0o3', '0O3', '3e-1', '+3.5', '3.00000001', '-0', '.5', '5.', '0003', '\ufeff3.5\ufeff']) {
      const source = `---\nconfig:\n  look: ${look}\n  htmlLabels: ${html}\n---\njourney\nTask 😀 : ${score} : Alice\n`;
      const text = score.trim();
      const start = source.indexOf('Task 😀 : ') + 'Task 😀 : '.length + score.indexOf(text);
      await verifyNative(source, 'journey:task:0', `Task 😀 : ${score} : Alice`, 'Task 😀', [['journey:score:0', text]], { start, end: start + text.length }, [], 'journey:score:0');
    }
    for (const score of ['1e307', '1.7976931348623157e308', '+Infinity', 'inf', '-0x5', '\u00853\u0085']) {
      const source = `---\nconfig:\n  look: ${look}\n  htmlLabels: ${html}\n---\njourney\nTask 😀 : ${score} : Alice\n`;
      const start = source.indexOf('Task 😀 : ') + 'Task 😀 : '.length;
      await verifyNative(source, 'journey:task:0', `Task 😀 : ${score} : Alice`, 'Task 😀', [], { start, end: start + score.length }, [], 'journey:task:0', undefined, true);
    }
  }
});

test('JOURNEY-2-GEOMETRY-CONFIG: zero-area tasks and signed spacing retain saved/live selection', { timeout: 180_000 }, async () => {
  for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
    for (const [width, height, margin] of [[0, 50, 70], [150, 0, 50], [0, 0, 70], [150, 50, -25.5], [150, 50, -75], [150, 50, -250]]) {
      const source = `---\r\nconfig:\r\n  look: ${look}\r\n  htmlLabels: ${html}\r\n  journey:\r\n    width: ${width}\r\n    height: ${height}\r\n    taskMargin: ${margin}\r\n    leftMargin: ${margin === -250 ? 400 : 150}\r\n---\r\njourney\r\nsection S 😀\r\nFirst : 5\r\nSecond : 3\r\n`;
      for (const [index, name, score] of [[0, 'First', '5'], [1, 'Second', '3']] as const) {
        const key = `journey:task:${index}`;
        const statement = `${name} : ${score}`;
        await verifyNative(source, key, statement, name, [[`journey:score:${index}`, score], ['journey:section:0', 'S 😀', 'control-label']], statement, [], key, undefined, true);
      }
    }
  }
});

test('JOURNEY-2-SCORE-GEOMETRY: unrenderable score source selects its task and empty-score default faces remain clickable', { timeout: 180_000 }, async () => {
  for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) for (const score of ['bad 😀', 'Task', 'NaN', 'Infinity', '-Infinity', '1e309', '']) {
    const source = `---\nconfig:\n  look: ${look}\n  htmlLabels: ${html}\n---\njourney\nTask : ${score} : Alice\n`;
    const scoreStart = source.indexOf('Task : ') + 'Task : '.length;
    await verifyNative(source, 'journey:task:0', `Task : ${score} : Alice`, 'Task', [], score ? { start: scoreStart, end: scoreStart + score.length } : undefined, [], 'journey:task:0', undefined, true);
  }
});

test('JOURNEY-2-OCCURRENCES: saved and live titles retain effective ownership through replacement and clearing', { timeout: 180_000 }, async () => {
  for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
    for (const finalTitle of ['title Last 😀', 'title title', 'title ']) {
      const cleared = finalTitle === 'title ';
      const source = `---\ntitle: 'Configured 😀'\nconfig:\n  look: ${look}\n  htmlLabels: ${html}\n---\njourney\ntitle First 😀\n${finalTitle}\naccTitle: Earlier\naccTitle: accTitle\naccDescr: Earlier\naccDescr {\n  First 😀\n  second\n}\nTask : 5 : Alice\n`;
      await verifyNative(source, 'journey:task:0', 'Task : 5 : Alice', 'Task', [['journey:title', cleared ? 'Configured 😀' : finalTitle, cleared ? 'control-label' : 'control']], cleared ? undefined : 'title First 😀', [], 'journey:title');
    }
  }
});


test('STATE STRUCT-AC2/3: saved native SVG and original Markdown state selection', { timeout: 60_000 }, async () => {
  const block = 'state Group {\nstate "Same 😀" as A\nstate "Same 😀" as B\nA --> B : review\nB --> A\nnote right of A : Annotation\n}';
  await verifyNative('stateDiagram-v2\n' + block + '\n', 'state:node:A', 'state "Same 😀" as A', 'Same 😀', [
    ['state:edge:edge0', 'A --> B : review', 'edge'],
    ['state:edge:edge0', 'review', 'edge-label'],
    ['state:edge:edge1', 'B --> A', 'edge'],
    ['state:node:A----note-2', 'Annotation', 'control-label'],
    ['state:node:A----note-2', 'note right of A : Annotation'],
    ['state:note:last', 'note right of A : Annotation', 'edge'],
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
      ['state:node:divider-id-1', 'B', 'node'],
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


test('FLOW AC4/6: bare default ID labels preserve saved and live exact selection', { timeout: 120_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) {
    for (const html of [false, true]) {
      const source = `---\nconfig:\n  htmlLabels: ${html}\n---\n${header}\n%% 😀\nBareA --> BareB\nBareB --> BareC\nstyle Styled fill:#fff\nStyled --> BareA\n`;
      await verifyNative(source, 'node:BareA', 'BareA', 'BareA', [
        ['node:BareB', 'BareB', 'node-label'],
        ['node:Styled', 'style Styled fill:#fff', 'node'],
        ['node:Styled', 'Styled', 'node-label'],
      ], 'BareA\n', [], 'edge:L_Styled_BareA_0');
    }
  }
});


test('FLOW AC4/6: shape-data labels and properties preserve saved and live source selection', { timeout: 120_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) {
    for (const html of [false, true]) {
      const source = `---\nconfig:\n  htmlLabels: ${html}\n---\n${header}\nA@{shape: rounded, label: "Earlier 😀"} --> B\nA@{label: "Final 😀"}\nM@{label: "First\n   second 😀"}\nP@{label: "Before"}\nP["Last 😀"]\n`;
      await verifyNative(source, 'node:A', 'A@{label: "Final 😀"}', 'Final 😀', [
        ['node:M', 'First\n   second 😀', 'node-label'],
        ['node:P', 'P["Last 😀"]', 'node'],
        ['node:P', 'Last 😀', 'node-label'],
      ], 'rounded');
      await verifyNative(source, 'node:A', 'A@{label: "Final 😀"}', 'Final 😀', [], 'Earlier 😀');
    }
  }
});


test('FLOW AC4/6: classes, links and identified connectors retain saved and live selection', { timeout: 120_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) {
    for (const html of [false, true]) {
      const source = `---\nconfig:\n  htmlLabels: ${html}\n---\n${header}\nclassDef hot fill:#eee\nA["Actor 😀"]:::hot --> B\nA e1@--> B\nsubgraph G[Group]\nC --> D\nend\nclass A,G,e1 hot\nclick A href "https://example.com" "go"\nlinkStyle 0 stroke:#f00\nlinkStyle default stroke-width:2px\n`;
      await verifyNative(source, 'node:A', 'A["Actor 😀"]:::hot', 'Actor 😀', [
        ['edge:e1', 'e1@-->', 'edge'],
        ['flowchart:subgraph:G', 'subgraph G[Group]\nC --> D\nend'],
      ], 'class A,G,e1 hot', ['edge:e1', 'flowchart:subgraph:G']);
      await verifyNative(source, 'node:A', 'A["Actor 😀"]:::hot', 'Actor 😀', [], 'classDef hot fill:#eee', ['edge:e1', 'flowchart:subgraph:G']);
      await verifyNative(source, 'node:A', 'A["Actor 😀"]:::hot', 'Actor 😀', [], 'click A href "https://example.com" "go"');
    }
  }
});


test('FLOW AC4/6: scoped directions select their group in saved and live Markdown', { timeout: 120_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const html of [false, true]) {
    const group = 'subgraph G[Group]\ndirection TB\nA["Actor 😀"] --> B\ndirection RL\nend';
    const source = `---\nconfig:\n  htmlLabels: ${html}\n---\n${header}\n${group}\n`;
    await verifyNative(source, 'node:A', 'A["Actor 😀"]', 'Actor 😀', [['flowchart:subgraph:G', group]], 'direction RL', [], 'flowchart:subgraph:G');
    const collapsed = 'subgraph H[Collapsed]\ndirection BT\nC --> D\nend';
    await verifyNative(source + collapsed + '\nH@{view: collapsed}\n', 'node:A', 'A["Actor 😀"]', 'Actor 😀', [['flowchart:subgraph:H', collapsed]], 'direction BT', [], 'flowchart:subgraph:H');
  }
});


test('FLOW AC4/6: accessibility metadata preserves saved/live selection without invisible controls', { timeout: 120_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const html of [false, true]) {
    const source = `---\nconfig:\n  htmlLabels: ${html}\n---\n${header}\naccTitle: Accessible diagram\naccDescr {\n  First line\n  second line\n}\nA["Actor 😀"] --> B\n`;
    await verifyNative(source, 'node:A', 'A["Actor 😀"]', 'Actor 😀', [['edge:L_A_B_0', '-->', 'edge']]);
  }
});


test('FLOW AC4/6: configuration provenance survives saved SVG and live Markdown without adding controls', { timeout: 120_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const html of [false, true]) {
    const source = `---\ntitle: Configured\nconfig:\n  flowchart:\n    nodeSpacing: 60\n---\n%%{init: { flowchart: { nodeSpacing: 70 } }}%%\n%%{initialize: { htmlLabels: ${html}, flowchart: { \"html\\u004cabels\": ${html} }, values: [{ nested: 'Value 😀' }] }}%%\n${header}\nA["Actor 😀"] --> B\n`;
    const evidence = await verifyNative(source, 'node:A', 'A["Actor 😀"]', 'Actor 😀', [['flowchart:title', 'Configured', 'control-label']]);
    assert.equal(evidence.filter((piece: { classification: string }) => piece.classification === 'frontmatter').length, 1);
    assert.equal(evidence.filter((piece: { classification: string }) => piece.classification === 'source-directive').length, 2);
    type ConfigPiece = { path?: (string | number)[]; span: { start: number; end: number }; labelSpan?: { start: number; end: number } };
    const nativeSlice = (span: { start: number; end: number }) => Buffer.from(source).subarray(span.start, span.end).toString();
    const escaped = (evidence as ConfigPiece[]).find(piece => JSON.stringify(piece.path) === JSON.stringify(['flowchart', 'htmlLabels']));
    assert.ok(escaped?.labelSpan, 'escaped keys must retain scalar source ranges in saved and live SVG');
    assert.equal(nativeSlice(escaped.span), `html\\u004cabels": ${html}`);
    assert.equal(nativeSlice(escaped.labelSpan), String(html));
    const nested = (evidence as ConfigPiece[]).find(piece => JSON.stringify(piece.path) === JSON.stringify(['values', 0, 'nested']));
    assert.ok(nested?.labelSpan, 'array indices must remain typed in saved and live SVG');
    assert.equal(nativeSlice(nested.labelSpan), 'Value 😀');
  }
});

test('FLOW AC4/6: icon and image labels retain saved/live pointer, keyboard and source selection', { timeout: 180_000 }, async () => {
  const image = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCI+PHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiBmaWxsPSJyZWQiLz48L3N2Zz4=';
  for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const html of [false, true]) {
    for (const properties of ["icon: 'missing:icon'", "icon: 'missing:icon', form: circle", "icon: 'missing:icon', form: rounded", "icon: 'missing:icon', form: square", `img: '${image}', w: 48, h: 48, constraint: on`]) {
      for (const pos of ['t', 'b']) {
        const statement = `A@{ ${properties}, pos: ${pos}, label: 'Asset 😀' }`;
        const source = `---\nconfig:\n  htmlLabels: ${html}\n---\n${header}\n${statement}\nA --> B\n`;
        await verifyNative(source, 'node:A', statement, 'Asset 😀', []);
      }
    }
  }
});


test('FLOW AC4/6: native SVG labels group multiline text and keep console glyphs non-labels', { timeout: 120_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const look of ['classic', 'handDrawn']) {
    const statements = [
      ["A@{ shape: console, label: 'Console 😀' }", 'Console 😀'],
      ['A["First 😀<br/>second"]', 'First 😀<br/>second'],
      ['A["`First **bold** 😀\nsecond`"]', 'First **bold** 😀\nsecond'],
    ] as const;
    for (const [statement, label] of statements) {
      const source = `---\nconfig:\n  htmlLabels: false\n  look: ${look}\n  handDrawnSeed: 42\n---\n${header}\n${statement}\nA --> B\n`;
      await verifyNative(source, 'node:A', statement, label);
    }
  }
});

test('FLOW AC5/6: state shape retains finite saved/live geometry and selections', { timeout: 120_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const look of ['classic', 'neo', 'handDrawn']) for (const htmlLabels of [false, true]) {
    const statement = "A@{ shape: state, label: 'State 😀' }";
    const source = `---\nconfig:\n  htmlLabels: ${htmlLabels}\n  look: ${look}\n  handDrawnSeed: 42\n---\n${header}\n${statement}\nA --> B\n`;
    await verifyNative(source, 'node:A', statement, 'State 😀', [], 'state');
  }
});


test('STATE REGION: grey right region selects its own source block in saved SVG and Markdown', { timeout: 120_000 }, async () => {
  const right = '[*] --> Indexing\n    Indexing --> [*] : indexed';
  const source = 'stateDiagram-v2\n  [*] --> Editing\n  state Editing {\n    state "Draft" as Draft: Editable content\n    Draft : Can be revised\n    Draft : Can be revised\n    state "Review" as Review\n    [*] --> Draft\n    Draft --> Review : submit\n    Review --> Draft : revise\n    Review --> [*] : approve\n    --\n    ' + right + '\n  }\n  Editing --> Published : publish\n  Published --> [*]\n  note right of Published : Available to readers\n';
  await verifyNative(source, 'state:node:Draft', 'state "Draft" as Draft: Editable content', 'Draft', [['state:region:last', right, 'node']]);
});


test('STATE NOTE: dashed connectors preserve saved/live source and clipboard across note variants', { timeout: 180_000 }, async () => {
  for (const header of ['stateDiagram', 'stateDiagram-v2']) for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) for (const position of ['left', 'right']) for (const multiline of [false, true]) {
    const note = multiline ? `note ${position} of A\n  Same 😀\n  second row\nend note` : `note ${position} of A : Same 😀`;
    const composite = `note ${position} of Group : Same 😀`;
    const source = `---\nconfig:\n  look: ${look}\n  handDrawnSeed: 42\n  htmlLabels: ${html}\n---\n${header}\nstate "Actor 😀" as A\nstate Group {\n  B\n}\n${note}\n${composite}\n`;
    await verifyNative(source, 'state:node:A', 'state "Actor 😀" as A', 'Actor 😀', [['state:note:first', note, 'edge'], ['state:note:last', composite, 'edge']]);
  }
});


test('STATE AC4/6: implicit state bodies and labels share selection when their ranges are equal', { timeout: 120_000 }, async () => {
  for (const header of ['stateDiagram', 'stateDiagram-v2']) for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
    const source = `---\nconfig:\n  look: ${look}\n  handDrawnSeed: 42\n  htmlLabels: ${html}\n---\n${header}\n%% 😀\n[*] --> Indexing\nIndexing --> [*] : indexed\n`;
    await verifyNative(source, 'state:node:Indexing', 'Indexing', 'Indexing');
  }
});
