import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Locator } from 'playwright';
import { launchBrowser, clipboardPermissions } from './browser.js';
import { createMermanProducer } from '../src/producer/merman.js';
import { watchPreview } from '../src/watch.js';
import { formatLocation } from '../src/markdown-source.js';

async function clickExposedTarget(target: Locator) {
  // Nested formula SVGs can inflate Firefox's group bounds; use the actual hit surface.
  const hitRect = target.locator(':scope > rect[aria-hidden="true"]');
  if (await hitRect.count() === 1) target = hitRect;
  await target.scrollIntoViewIfNeeded();
  const position = await target.evaluate(element => {
    const box = element.getBoundingClientRect();
    for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const y of [0.1, 0.5, 0.9]) {
      // Firefox delivers integer pointer coordinates; hit-test the pixel we actually click.
      const point = { x: Math.round(box.x + box.width * x), y: Math.round(box.y + box.height * y) };
      const hit = element.ownerDocument.elementFromPoint(point.x, point.y);
      if (hit?.closest('[data-mt-role]') === element.closest('[data-mt-role]')) return point;
    }
    throw new Error('mapped visual has no exposed pointer target');
  });
  await target.page().mouse.click(position.x, position.y);
}

async function connectorPoint(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  return target.evaluate(element => {
    const path = element as SVGGeometryElement, matrix = path.getScreenCTM()!;
    const length = path.getTotalLength();
    // Merged routes can expose only a short terminal; sample rendered pixels, not path percentages.
    const step = 1 / Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
    for (let distance = 0; distance <= length; distance += step) {
      const screen = path.getPointAtLength(distance).matrixTransform(matrix);
      const point = { x: Math.round(screen.x), y: Math.round(screen.y) };
      const hit = element.ownerDocument.elementFromPoint(point.x, point.y);
      if (hit === element || (hit === element.previousElementSibling && hit?.getAttribute('aria-hidden') === 'true')) return { x: point.x, y: point.y };
    }
    throw new Error(`connector ${element.getAttribute('data-mt-key')} has no exposed pointer target`);
  });
}

const gantt = 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  todayMarker off\n  section Build\n  Same 😀 :a, 2026-01-01, 2d\n  Same 😀 :b, after a, 1d\n  Ship :milestone, c, after b, 0d\n';

test('OWN-FLOW-ENDPOINT: saved and live references select owning connection groups', { timeout: 240_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-flow-owner-'));
  const filename = join(directory, 'flow.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: clipboardPermissions });
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

test('FLOW-2-SUBGRAPH-ID-SHADOW: unrendered node source stays nonvisual while the subgraph selects', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-subgraph-shadow-'));
  const filename = join(directory, 'groups.md');
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8'))
    .replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage();
    for (const header of ['flowchart LR', 'flowchart-elk LR']) {
      const source = `${header}\na --> b\nsubgraph A\nB\nend\nsubgraph B\nb\nend\n`;
      const shadowStart = source.indexOf('\nB\n') + 1;
      const groupText = 'subgraph B\nb\nend';
      const { svg } = await producer.render('shadowed-group', source);
      await page.setContent(svg);
      const originalSvg = await page.locator('svg').evaluate(element => element.outerHTML);
      await page.evaluate(async activation => {
        const { activateSvg } = await import(activation);
        const events: any[] = [];
        Object.assign(window, { events, handle: activateSvg(document.querySelector('svg')!, { onSelect: (event: unknown) => events.push(event) }) });
      }, activation);
      assert.equal(await page.locator('[data-mt-key="node:B"][data-mt-role=node]').count(), 0);
      const group = page.locator('[data-mt-key="flowchart:subgraph:B"][data-mt-role=control]');
      assert.equal(await group.count(), 1);
      await page.evaluate(start => (window as any).handle.highlight([{ start, end: start + 1 }]), shadowStart);
      assert.deepEqual(await page.locator('[data-mt-selected=true]').evaluateAll(elements => [...new Set(elements.map(element => element.getAttribute('data-mt-key')))]),
        ['flowchart:subgraph:A'], 'shadowed source may select its enclosing block, not subgraph B');
      await clickExposedTarget(group);
      const span = await page.evaluate(() => (window as any).events.at(-1).span);
      assert.equal(source.slice(span.start, span.end), groupText);
      await page.evaluate(() => (window as any).handle.dispose());
      assert.equal(await page.locator('svg').evaluate(element => element.outerHTML), originalSvg);

      const markdown = `# Groups\n\n\`\`\`mermaid\n${source}\`\`\`\n`;
      await writeFile(filename, markdown);
      preview = await watchPreview(filename, { port: 0, sourceView: true });
      await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
      const original = page.frameLocator('#source-frame').locator('#source');
      await original.evaluate((element, start) => {
        const range = element.ownerDocument.createRange();
        range.setStart(element.firstChild!, start); range.setEnd(element.firstChild!, start + 1);
        const selection = element.ownerDocument.getSelection()!;
        selection.removeAllRanges(); selection.addRange(range);
      }, markdown.indexOf(source) + shadowStart);
      await page.waitForFunction(() => !document.querySelector('[data-mt-key="flowchart:subgraph:B"][data-mt-selected=true]'));
      assert.equal(await page.locator('[data-mt-key="node:B"][data-mt-selected=true]').count(), 0);
      const liveGroup = page.locator('[data-mt-key="flowchart:subgraph:B"][data-mt-role=control]');
      await clickExposedTarget(liveGroup);
      assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), groupText);
      const start = markdown.indexOf(groupText);
      await page.waitForFunction(expected => navigator.clipboard.readText().then(value => value === expected),
        formatLocation({ id: filename, source: markdown }, { start, end: start + groupText.length }));
      await preview.close(); preview = undefined;
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('FLOW-2-EDGE-OCCURRENCES: grouped and repeated connectors retain one source selection per operator', { timeout: 240_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-edge-occurrences-'));
  const filename = join(directory, 'edges.md');
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8'))
    .replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage();
    for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
      const source = `---\nconfig:\n  look: ${look}\n  htmlLabels: ${html}\n  handDrawnSeed: 42\n---\n${header}\nA["Actor 😀"] & B -->|Group 😀| C & D\nA --> B --> C\nA -->|first| B\nA -->|second| B\nA e1@--> B\nA e1@--> B\nA --> A\nA --> A\n`;
      const groupStart = source.indexOf('-->|Group 😀|');
      const labelStart = groupStart + 4;
      const repeated = [...source.matchAll(/e1@-->/g)].map(match => match.index);
      const { svg } = await producer.render('edge-occurrences', source);
      await page.setContent(svg + svg.replaceAll('edge-occurrences', 'edge-copy'));
      const original = await page.locator('svg').first().evaluate(element => element.outerHTML);
      await page.evaluate(async activation => {
        const { activateSvg } = await import(activation);
        const events: any[] = [];
        Object.assign(window, { events, handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect: (event: unknown) => events.push(event) })) });
      }, activation);
      const first = page.locator('svg').first();
      const group = first.locator(`[data-mt-role=edge][data-mt-start="${groupStart}"]`);
      const labels = first.locator(`[data-mt-role=edge-label][data-mt-start="${labelStart}"]`);
      assert.equal(await group.count(), 4, `${header} ${look} ${html}`);
      assert.equal(await labels.count(), 4);
      assert.equal(await group.evaluateAll(elements => elements.filter(element => element.getAttribute('tabindex') === '0').length), 1);
      { const point = await connectorPoint(group.first()); await page.mouse.click(point.x, point.y); }
      assert.equal(await first.locator('[data-mt-role=edge][data-mt-selected=true]').count(), 4);
      assert.equal(await first.locator('[data-mt-role=node][data-mt-selected=true]').count(), 0);
      assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), { start: groupStart, end: groupStart + '-->|Group 😀|'.length });
      await group.first().focus(); await group.first().press('Enter');
      assert.equal(await first.locator('[data-mt-role=edge][data-mt-selected=true]').count(), 4);
      await group.first().press('Space');
      assert.equal(await first.locator('[data-mt-role=edge][data-mt-selected=true]').count(), 4);
      await clickExposedTarget(labels.first());
      assert.equal(await first.locator('[data-mt-role=edge-label][data-mt-selected=true]').count(), 4);
      assert.equal(await first.locator('[data-mt-role=edge][data-mt-selected=true]').count(), 0);
      await page.evaluate(start => (window as any).handles[0].highlight([{ start, end: start + 1 }]), labelStart);
      assert.equal(await first.locator('[data-mt-role=edge-label][data-mt-selected=true]').count(), 4);
      for (const start of repeated) {
        const edge = first.locator(`[data-mt-role=edge][data-mt-start="${start}"]`);
        assert.equal(await edge.count(), 1);
        { const point = await connectorPoint(edge); await page.mouse.click(point.x, point.y); }
        assert.equal(await first.locator('[data-mt-role=edge][data-mt-selected=true]').count(), 1);
        assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), { start, end: start + 6 });
      }
      assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
      await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
      assert.equal(await first.evaluate(element => element.outerHTML), original);

      if (look === 'classic' && !html) {
        const markdown = `# Edges\n\n\`\`\`mermaid\n${source}\`\`\`\n`;
        await writeFile(filename, markdown);
        preview = await watchPreview(filename, { port: 0, sourceView: true });
        await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
        const originalSource = page.frameLocator('#source-frame').locator('#source');
        const liveGroup = page.locator(`[data-mt-role=edge][data-mt-start="${groupStart}"]`);
        assert.equal(await liveGroup.count(), 4);
        { const point = await connectorPoint(liveGroup.first()); await page.mouse.click(point.x, point.y); }
        assert.equal(await originalSource.evaluate(element => element.ownerDocument.getSelection()!.toString()), '-->|Group 😀|');
        const start = markdown.indexOf('-->|Group 😀|');
        await page.waitForFunction(expected => navigator.clipboard.readText().then(value => value === expected),
          formatLocation({ id: filename, source: markdown }, { start, end: start + '-->|Group 😀|'.length }));
        const later = [...markdown.matchAll(/e1@-->/g)][1]!.index;
        const laterEdge = page.locator(`[data-mt-role=edge][data-mt-start="${repeated[1]}"]`);
        { const point = await connectorPoint(laterEdge); await page.mouse.click(point.x, point.y); }
        assert.equal(await originalSource.evaluate(element => element.ownerDocument.getSelection()!.toString()), 'e1@-->');
        await page.waitForFunction(expected => navigator.clipboard.readText().then(value => value === expected),
          formatLocation({ id: filename, source: markdown }, { start: later, end: later + 6 }));
        await originalSource.evaluate((element, start) => {
          const range = element.ownerDocument.createRange();
          range.setStart(element.firstChild!, start); range.setEnd(element.firstChild!, start + 1);
          const selection = element.ownerDocument.getSelection()!;
          selection.removeAllRanges(); selection.addRange(range);
        }, markdown.indexOf(source) + labelStart);
        await page.waitForFunction(() => document.querySelectorAll('[data-mt-role=edge-label][data-mt-selected=true]').length === 4);
        assert.equal(await page.locator('[data-mt-role=edge][data-mt-selected=true]').count(), 0);
        await preview.close(); preview = undefined;
      }
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('FLOW-2-NONBREAKING-LABELS: saved and live HTML labels retain exact source selection', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-nbsp-labels-'));
  const filename = join(directory, 'labels.md');
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8'))
    .replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage();
    const cases = [
      ['node:A', 'node-label', '&nbsp;', '\u00A0'],
      ['node:B', 'node-label', 'X&nbsp;', 'X\u00A0'],
      ['edge:L_A_B_0', 'edge-label', '&nbsp;', '\u00A0'],
      ['flowchart:subgraph:G', 'control-label', 'Group\u00A0name', 'Group\u00A0name'],
    ] as const;
    for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const look of ['classic', 'neo', 'handDrawn']) {
      const source = `---\r\nconfig:\r\n  htmlLabels: true\r\n  look: ${look}\r\n  handDrawnSeed: 42\r\n---\r\n${header}\r\n%% 😀\r\nA["&nbsp;"] -->|&nbsp;| B["X&nbsp;"]\r\nsubgraph G["Group\u00A0name"]\r\nC --> D\r\nend\r\n`;
      const { svg } = await producer.render('nbsp-labels', source);
      await page.setContent(svg);
      const original = await page.locator('svg').evaluate(element => element.outerHTML);
      await page.evaluate(async activation => {
        const { activateSvg } = await import(activation);
        const events: any[] = [];
        Object.assign(window, { events, handle: activateSvg(document.querySelector('svg')!, { onSelect: (event: unknown) => events.push(event) }) });
      }, activation);
      for (const [key, role, text, visual] of cases) {
        const label = page.locator(`[data-mt-key="${key}"][data-mt-role="${role}"]`);
        assert.equal(await label.count(), 1, `${header} ${look} ${key}`);
        assert.equal(await label.textContent(), visual);
        await clickExposedTarget(label);
        const span = await page.evaluate(() => (window as any).events.at(-1).span);
        assert.equal(source.slice(span.start, span.end), text);
        await label.focus(); await label.press('Enter');
        assert.equal(await label.getAttribute('data-mt-selected'), 'true');
        await page.evaluate(span => (window as any).handle.highlight([{ start: span.start, end: span.end }]), span);
        assert.equal(await label.getAttribute('data-mt-selected'), 'true');
      }
      await page.evaluate(() => (window as any).handle.dispose());
      assert.equal(await page.locator('svg').evaluate(element => element.outerHTML), original);

      if (look === 'classic') {
        const markdown = `# Labels\n\n\`\`\`mermaid\n${source}\`\`\`\n`;
        await writeFile(filename, markdown);
        preview = await watchPreview(filename, { port: 0, sourceView: true });
        await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
        const originalSource = page.frameLocator('#source-frame').locator('#source');
        for (const [key, role, text] of cases) {
          const label = page.locator(`[data-mt-key="${key}"][data-mt-role="${role}"]`);
          await clickExposedTarget(label);
          assert.equal(await originalSource.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), text);
          const start = key === 'node:A' ? markdown.indexOf('A["&nbsp;"]') + 3
            : key === 'node:B' ? markdown.indexOf('B["X&nbsp;"]') + 3
              : key.startsWith('edge:') ? markdown.indexOf('-->|&nbsp;|') + 4
                : markdown.indexOf('subgraph G["Group\u00A0name"]') + 'subgraph G["'.length;
          await page.waitForFunction(expected => navigator.clipboard.readText().then(value => value === expected),
            formatLocation({ id: filename, source: markdown }, { start, end: start + text.length }));
        }
        await preview.close(); preview = undefined;
      }
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('FLOW-2-EDGE-LABEL-FORMS: saved and live connector labels select authored payloads', { timeout: 240_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-edge-labels-'));
  const filename = join(directory, 'labels.md');
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8'))
    .replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const forms = [
    ['A0 -->|plain| B0', '-->|plain|', 'plain'],
    ['A1 -- split text --> B1', '-- split text -->', 'split text'],
    ['A2 -- "quoted text" --> B2', '-- "quoted text" -->', 'quoted text'],
    ['A3 -- "`**marked**`" --> B3', '-- "`**marked**`" -->', '**marked**'],
    ['A4 -->|"`**pipe markdown**`"| B4', '-->|"`**pipe markdown**`"|', '**pipe markdown**'],
    ['A5 -->|first<br/>second| B5', '-->|first<br/>second|', 'first<br/>second'],
    ['A6 -->|A&amp;B| B6', '-->|A&amp;B|', 'A&amp;B'],
    ['A7 -->|😀 A| B7', '-->|😀 A|', '😀 A'],
    ['A8 -->|$$x^2$$| B8', '-->|$$x^2$$|', '$$x^2$$'],
    ['A9 -->|   | B9', '-->|   |', null],
    ['A10 -->|<br/>| B10', '-->|<br/>|', '<br/>'],
    ['A11 -- No--> B11', '-- No-->', 'N'],
    ['A12 -->|first\r\nsecond| B12', '-->|first\r\nsecond|', 'first\r\nsecond'],
    ['A13 == thick ==> B13', '== thick ==>', 'thick'],
    ['A14 -. dotted .-> B14', '-. dotted .->', 'dotted'],
    ['A15 ==>|thick pipe| B15', '==>|thick pipe|', 'thick pipe'],
    ['A16 -.->|dotted pipe| B16', '-.->|dotted pipe|', 'dotted pipe'],
    ['A17 -- circle --o B17', '-- circle --o', 'circle'],
    ['A18 -- cross --x B18', '-- cross --x', 'cross'],
    ['A19 o-- round --> B19', 'o-- round -->', 'round'],
    ['A20 x-- crossed --> B20', 'x-- crossed -->', 'crossed'],
    ['A21 <-- backward --> B21', '<-- backward -->', 'backward'],
  ] as const;
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) {
      for (let first = 0; first < forms.length; first += 11) {
        const chunk = forms.slice(first, first + 11);
        const source = `---\r\nconfig:\r\n  look: ${look}\r\n  htmlLabels: ${html}\r\n  handDrawnSeed: 42\r\n---\r\n${header}\r\n${chunk.map(([line]) => line).join('\r\n')}\r\n`;
        const { svg } = await producer.render('edge-labels', source);
        await page.setContent(svg);
        const original = await page.locator('svg').first().evaluate(element => element.outerHTML);
        await page.evaluate(async activation => {
          const { activateSvg } = await import(activation);
          const events: any[] = [];
          Object.assign(window, { events, handle: activateSvg(document.querySelector('svg')!, { onSelect: (event: unknown) => events.push(event) }) });
        }, activation);
        for (const [offset, [statement, operator, label]] of chunk.entries()) {
          const index = first + offset;
          const key = `edge:L_A${index}_B${index}_0`;
          const start = source.indexOf(statement) + statement.indexOf(operator);
          const labelStart = label === null ? -1 : start + operator.indexOf(label);
          const visual = page.locator(`[data-mt-key="${key}"][data-mt-role="edge-label"]`);
          if (label === null || (html && index === 10)) {
            assert.equal(await visual.count(), 0, `${header} ${look} ${html} ${index}`);
            const range = label === null ? { start: start + operator.indexOf('   '), end: start + operator.indexOf('   ') + 3 }
              : { start: labelStart, end: labelStart + label.length };
            await page.evaluate(range => (window as any).handle.highlight([range]), range);
            assert.equal(await page.locator(`[data-mt-key="${key}"][data-mt-role="edge"][data-mt-selected="true"]`).count(), 1);
            continue;
          }
          assert.equal(await visual.count(), 1, `${header} ${look} ${html} ${index}`);
          await clickExposedTarget(visual);
          assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), { start: labelStart, end: labelStart + label.length });
          await visual.focus(); await visual.press('Enter');
          await page.evaluate(range => (window as any).handle.highlight([range]), { start: labelStart, end: labelStart + label.length });
          assert.equal(await visual.getAttribute('data-mt-selected'), 'true');
        }
        await page.evaluate(() => (window as any).handle.dispose());
        assert.equal(await page.locator('svg').first().evaluate(element => element.outerHTML), original);

        if (look === 'classic') {
          const markdown = `# Labels\n\n\`\`\`mermaid\n${source}\`\`\`\n`;
          await writeFile(filename, markdown);
          preview = await watchPreview(filename, { port: 0, sourceView: true });
          await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
          for (const index of [0, 3, 5, 8, 11, 13, 14].filter(index => index >= first && index < first + chunk.length)) {
            const [statement, operator, label] = forms[index]!;
            const key = `edge:L_A${index}_B${index}_0`;
            const visual = page.locator(`[data-mt-key="${key}"][data-mt-role="edge-label"]`);
            await clickExposedTarget(visual);
            const selected = await page.frameLocator('#source-frame').locator('#source')
              .evaluate(element => element.ownerDocument.getSelection()!.toString());
            assert.equal(selected, label);
            const start = markdown.indexOf(source) + source.indexOf(statement) + statement.indexOf(operator) + operator.indexOf(label!);
            await page.waitForFunction(expected => navigator.clipboard.readText().then(value => value === expected),
              formatLocation({ id: filename, source: markdown }, { start, end: start + label!.length }));
          }
          await preview.close(); preview = undefined;
        }
      }
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('FLOW-2-LOCAL-LAYOUT-BUDGET: moderate ELK document renders with saved and live label selection', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-elk-budget-'));
  const filename = join(directory, 'graph.md');
  const source = `---\r\nconfig:\r\n  look: classic\r\n  htmlLabels: false\r\n---\r\nflowchart-elk LR\r\n${Array.from({ length: 22 }, (_, index) => `A${index} -->|label${index}| B${index}\r\n`).join('')}`;
  const markdown = `# Graph\n\n\`\`\`mermaid\n${source}\`\`\`\n`;
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage();
    const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
    const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8'))
      .replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
    const { svg } = await producer.render('moderate-elk', source);
    await page.setContent(svg);
    await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      Object.assign(window, { handle: activateSvg(document.querySelector('svg')!, { onSelect() {} }) });
    }, activation);
    assert.equal(await page.locator('[data-mt-role="edge-label"]').count(), 22);
    const label = page.locator('[data-mt-key="edge:L_A21_B21_0"][data-mt-role="edge-label"]');
    await clickExposedTarget(label);
    assert.equal(await label.getAttribute('data-mt-selected'), 'true');
    await page.evaluate(() => (window as any).handle.dispose());

    await writeFile(filename, markdown);
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    assert.equal(await page.locator('[data-mt-role="edge-label"]').count(), 22);
    const liveLabel = page.locator('[data-mt-key="edge:L_A21_B21_0"][data-mt-role="edge-label"]');
    await clickExposedTarget(liveLabel);
    assert.equal(await page.frameLocator('#source-frame').locator('#source')
      .evaluate(element => element.ownerDocument.getSelection()!.toString()), 'label21');
    const start = markdown.indexOf('label21');
    await page.waitForFunction(expected => navigator.clipboard.readText().then(value => value === expected),
      formatLocation({ id: filename, source: markdown }, { start, end: start + 'label21'.length }));
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('OWN-STATE-ENDPOINT: saved and live references select their transition owner', { timeout: 240_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-state-owner-'));
  const filename = join(directory, 'states.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: clipboardPermissions });
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

async function verifyNative(source: string, key: string, expected: string, label: string, controls: readonly (readonly [string, string, string?, number?])[] = [], reverseNodeSource?: string | { start: number; end: number }, reverseKeys: readonly string[] = [], reversePrimaryKey = key, expectedTextColour?: string, reverseWholeOwner = false, unmappedSpans: readonly { start: number; end: number }[] = [], labelViaKeyboard = false) {
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
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const producer = await createMermanProducer();
    let svg: string;
    try { svg = (await producer.render('planning-saved', source)).svg; }
    finally { await producer.close(); }
    const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
    const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
    const context = await browser.newContext({ permissions: clipboardPermissions });
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
    } else {
      const body = await asset.count() ? asset.first() : await ellipse.count() ? ellipse
        : await consoleBody.count() ? consoleBody : await rough.count() ? rough
        : await cardRect.count() ? cardRect.first() : shape.first();
      await clickExposedTarget(body);
    }
    let event = await page.evaluate(() => (window as any).events.at(-1));
    const nodeSpan = event.span;
    assert.equal(source.slice(event.span.start, event.span.end), expected);
    if (key.startsWith('gantt:task:')) {
      assert.equal(await shape.locator(':scope[tabindex="0"]').count(), 1, 'dependencies add no task keyboard stop');
      await shape.first().focus(); await shape.first().press('Enter');
      const keyboardSpan = await page.evaluate(() => (window as any).events.at(-1).span);
      assert.equal(source.slice(keyboardSpan.start, keyboardSpan.end), expected);
    }
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
    if (labelViaKeyboard) {
      await first.locator(labelSelector).first().focus();
      await first.locator(labelSelector).first().press('Enter');
    } else await clickExposedTarget(first.locator(labelSelector).first());
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
    for (const [controlKey, text, role = 'control', expectedStart] of controls) {
      const target = controlKey === "state:note:first" ? first.locator("path.note-edge").first() : controlKey === "state:note:last" ? first.locator("path.note-edge").last() : controlKey === "state:region:last" ? first.locator("g:has(> g > rect.divider)").last() : first.locator(`[data-mt-key="${controlKey}"][data-mt-role="${role}"], [data-mt-key="${controlKey}"] [data-mt-role="${role}"]`).first();
      const background = target.locator(':scope > rect[width], :scope > g > rect.outer, :scope > g > rect.divider, :scope > g > path[fill]:not([fill=none])');
      if (await target.evaluate(element => ['line', 'path'].includes(element.tagName))) {
        const point = role === 'edge' || controlKey.startsWith('state:note:') ? await connectorPoint(target) : await target.evaluate(element => {
          const shape = element as SVGGeometryElement;
          const point = shape.getPointAtLength(shape.getTotalLength() * (element.tagName === 'path' ? 0.2 : 0.5)).matrixTransform(shape.getScreenCTM()!);
          return { x: point.x, y: point.y };
        });
        await page.mouse.click(point.x, point.y);
      } else if (controlKey.startsWith("flowchart:subgraph:")) {
        await clickExposedTarget(target);
      } else {
        const shape = await background.count() ? background.first() : target;
        if (controlKey.startsWith('journey:score:')) await shape.click({ position: { x: 15, y: 3 } });
        else await clickExposedTarget(shape);
      }
      const control = await page.evaluate(() => (window as any).events.at(-1));
      assert.equal(source.slice(control.span.start, control.span.end), text, `control ${controlKey} ${role} in ${source}`);
      if (expectedStart !== undefined) assert.equal(control.span.start, expectedStart, 'a merged title selects its effective declaration');
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
        assert.match(await target.evaluate(element => getComputedStyle(element).filter), /drop-shadow/, 'connector has the same visible selection cue');
        assert.match(await body.evaluate(element => getComputedStyle(element).filter), /drop-shadow/, 'note body has the same visible selection cue');
        assert.equal(await target.evaluate(element => getComputedStyle(element).outlineStyle), 'none', 'focus does not add a second constituent outline');
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
        if (key.startsWith('gantt:task:')) assert.equal(await first.locator('[data-mt-role=node][data-mt-selected=true]').count(), 1, 'dependency reference must not select its target task');
      } else {
        assert.equal(await first.locator(`[data-mt-key="${reversePrimaryKey}"][data-mt-role=${reverseRole}][data-mt-selected=true]`).count(), reversePrimaryKey.startsWith('journey:score:') ? 2 : 1, 'source occurrence selects every binding of its owning object');
        assert.equal(await shape.locator(':scope[data-mt-selected=true]').count(), 0, 'an owning object must not select a merely referenced node');
      }
      assert.equal(await first.locator(labelSelector).first().getAttribute('data-mt-selected'), (sharedLabelSpan || reverseWholeOwner) && reversePrimaryKey === key ? 'true' : null, 'node references highlight an equal-span visual group, while distinct labels retain their own binding');
      for (const targetKey of reverseKeys) assert.ok(await first.locator(`[data-mt-key="${targetKey}"][data-mt-selected=true]`).count(), `related visual ${targetKey}`);
    }
    for (const span of unmappedSpans) {
      await page.evaluate(span => (window as any).handles[0].highlight([span]), span);
      assert.equal(await first.locator('[data-mt-selected=true]').count(), 0, 'unrendered section source has no visual target');
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
    if (labelViaKeyboard) {
      await page.locator(labelSelector).first().focus();
      await page.locator(labelSelector).first().press('Enter');
    } else await clickExposedTarget(page.locator(labelSelector).first());
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
      if (key.startsWith('gantt:task:') && reversePrimaryKey === key) assert.equal(await page.locator('[data-mt-role=node][data-mt-selected=true]').count(), 1, 'live dependency reference must not select its target task');
      if (reversePrimaryKey !== key) assert.equal(await page.locator(`[data-mt-key="${key}"][data-mt-role=node][data-mt-selected=true]`).count(), 0);
      assert.equal(await page.locator(labelSelector).first().getAttribute('data-mt-selected'), (sharedLabelSpan || reverseWholeOwner) && reversePrimaryKey === key ? 'true' : null, 'live node references preserve equal-span visual grouping');
      for (const targetKey of reverseKeys) assert.ok(await page.locator(`[data-mt-key="${targetKey}"][data-mt-selected=true]`).count(), `live related visual ${targetKey}`);
    }
    for (const span of unmappedSpans) {
      await original.evaluate((element, range) => {
        const doc = element.ownerDocument, selection = doc.getSelection()!, sourceRange = doc.createRange();
        sourceRange.setStart(element.firstChild!, range.start); sourceRange.setEnd(element.firstChild!, range.end);
        selection.removeAllRanges(); selection.addRange(sourceRange);
      }, { start: toMarkdown(span.start), end: toMarkdownEnd(span.end) });
      await page.waitForFunction(() => !document.querySelector('svg[data-mt-map] [data-mt-selected=true]'));
      assert.equal(await page.locator('svg[data-mt-map]').getAttribute('data-mt-selected'), null, 'live unrendered section must not select the diagram');
    }
    for (const [index, [controlKey, text, role = 'control', expectedStart]] of controls.entries()) {
      const target = controlKey === "state:note:first" ? page.locator("path.note-edge").first() : controlKey === "state:note:last" ? page.locator("path.note-edge").last() : controlKey === "state:region:last" ? page.locator("g:has(> g > rect.divider)").last() : page.locator(`[data-mt-key="${controlKey}"][data-mt-role="${role}"], [data-mt-key="${controlKey}"] [data-mt-role="${role}"]`).first();
      if (role.endsWith('-label')) {
        await clickExposedTarget(target);
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
        const point = await connectorPoint(target);
        await page.mouse.click(point.x, point.y);
        const body = page.locator(`[data-mt-role=control][data-mt-selected=true]`);
        assert.equal(await body.count(), 1, 'live connector activation selects the note body');
        assert.equal(await body.evaluate(element => getComputedStyle(element).outlineStyle), 'none', 'selection has one visual treatment');
        assert.equal(await target.getAttribute('data-mt-selected'), 'true');
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).cloneContents().textContent), markdownSelection(text));
      }
      if (controlKey === 'state:region:last') {
        const rect = target.locator(':scope > g > rect.divider');
        await clickExposedTarget(rect);
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
      if (expectedStart !== undefined) assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.getRangeAt(0).startOffset), toMarkdown(expectedStart));
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

test('FLOW-2-MAX-EDGES: secure source overrides preserve saved and live selection', { timeout: 60_000 }, async () => {
  for (const layout of ['dagre', 'elk']) {
    const source = `---\nconfig: ${JSON.stringify({ layout, maxEdges: 0 })}\n---\nflowchart LR\nA[Alpha] ab@-->|next| B[Beta]`;
    await verifyNative(source, 'node:A', 'A[Alpha]', 'Alpha', [['edge:ab', 'ab@-->|next|', 'edge'], ['edge:ab', 'next', 'edge-label']]);
  }
});

test('GANTT PLAN-AC2/3: saved native SVG and live Markdown selection, clipboard, source and saves', { timeout: 60_000 }, async () => {
  await verifyNative(gantt, 'gantt:task:a', 'Same 😀 :a, 2026-01-01, 2d', 'Same 😀', [['gantt:section:Build', 'section Build'], ['gantt:title', 'title Plan']]);
});

test('GANTT-2-SECTION-FONT-SIZE: CSS units retain saved and live section selection', { timeout: 60_000 }, async () => {
  const source = "---\nconfig:\n  gantt:\n    sectionFontSize: '1.5em'\n    leftPadding: 180\n---\ngantt\ndateFormat YYYY-MM-DD\nsection Work 😀\nTask :a, 2026-01-01, 1d\n";
  await verifyNative(source, 'gantt:task:a', 'Task :a, 2026-01-01, 1d', 'Task', [['gantt:section:Work 😀', 'section Work 😀', 'control']]);
});

test('GANTT-2-TICK-INTERVAL-CONFIG: configured ticks retain saved and live task selection', { timeout: 60_000 }, async () => {
  const source = '---\nconfig:\n  gantt:\n    tickInterval: 2day\n    topAxis: true\n---\ngantt\ndateFormat YYYY-MM-DD\naxisFormat %Y-%m-%d\ntodayMarker off\nsection Work\nTask :a, 2026-01-01, 14d\n';
  await verifyNative(source, 'gantt:task:a', 'Task :a, 2026-01-01, 14d', 'Task', [['gantt:section:Work', 'section Work', 'control']]);
});

test('GANTT-2-TICK-INTERVAL-LEXICAL: invalid interval fallback retains saved and live selection', { timeout: 60_000 }, async () => {
  const source = "---\nconfig: { gantt: { useWidth: 600, tickInterval: '01day' } }\n---\ngantt\ndateFormat YYYY-MM-DD\naxisFormat %Y-%m-%d\ntodayMarker off\nsection Work\nTask :a, 2026-01-01, 15d\n";
  await verifyNative(source, 'gantt:task:a', 'Task :a, 2026-01-01, 15d', 'Task', [['gantt:section:Work', 'section Work', 'control']]);
});

test('GANTT-2-ROOT-SIZING: fixed and responsive SVGs retain saved and live selection', { timeout: 120_000 }, async () => {
  for (const useMaxWidth of [false, true]) {
    const source = '---\nconfig:\n  gantt:\n    useWidth: 420\n    useMaxWidth: ' + useMaxWidth + '\n---\ngantt\ndateFormat YYYY-MM-DD\nsection Work\nTask :a, 2026-01-01, 1d\n';
    await verifyNative(source, 'gantt:task:a', 'Task :a, 2026-01-01, 1d', 'Task', [['gantt:section:Work', 'section Work', 'control']]);
  }
});

test('GANTT-2-SUBPIXEL-TEXT: narrow labels retain saved and live source selection', { timeout: 60_000 }, async () => {
  const source = '---\nconfig:\n  gantt:\n    useWidth: 153\n    fontSize: 0.5\n---\ngantt\ndateFormat YYYY-MM-DD\nsection Work\nTask label :a, 2026-01-01, 1d\n';
  await verifyNative(source, 'gantt:task:a', 'Task label :a, 2026-01-01, 1d', 'Task label',
    [], undefined, [], 'gantt:task:a', undefined, false, [], true);
});

test('GANTT-2-NARROW-PLOT-WIDTH: visible label selects its task without a phantom bar', { timeout: 60_000 }, async () => {
  const task = 'Task :a, 2026-01-01, 1d';
  const source = `---\nconfig: { gantt: { useWidth: 149 } }\n---\ngantt\ndateFormat YYYY-MM-DD\nsection Work\n${task}\n`;
  const directory = await mkdtemp(join(tmpdir(), 'trace-gantt-narrow-'));
  const filename = join(directory, 'gantt.md');
  const markdown = `# Narrow\n\n\`\`\`mermaid\n${source}\`\`\`\n`;
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const { svg } = await producer.render('gantt-narrow-saved', source);
    const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
    const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage();
    await page.setContent(svg);
    await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      const events: unknown[] = [];
      Object.assign(window, { events, handle: activateSvg(document.querySelector('svg')!, { onSelect: (event: unknown) => events.push(event) }) });
    }, activation);
    const label = page.locator('[data-mt-key="gantt:task:a"][data-mt-role=node-label]');
    assert.equal(await page.locator('rect.task, [data-mt-key="gantt:task:a"][data-mt-role=node]').count(), 0);
    assert.equal(await label.getAttribute('tabindex'), '0');
    await clickExposedTarget(label);
    const savedSpan = await page.evaluate(() => (window as any).events.at(-1).span);
    assert.equal(source.slice(savedSpan.start, savedSpan.end), 'Task');
    await label.focus(); await label.press('Enter');
    assert.equal(await label.getAttribute('data-mt-selected'), 'true');
    const keyboardSpan = await page.evaluate(() => (window as any).events.at(-1).span);
    assert.equal(source.slice(keyboardSpan.start, keyboardSpan.end), 'Task');
    await page.evaluate(() => (window as any).handle.dispose());
    await writeFile(filename, markdown);
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    const liveLabel = page.locator('[data-mt-key="gantt:task:a"][data-mt-role=node-label]');
    assert.equal(await page.locator('rect.task, [data-mt-key="gantt:task:a"][data-mt-role=node]').count(), 0);
    await clickExposedTarget(liveLabel);
    const original = page.frameLocator('#source-frame').locator('#source');
    assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), 'Task');
    const start = markdown.indexOf(task);
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start, end: start + 4 }));
    await page.locator('h1').click();
    assert.equal(await liveLabel.getAttribute('data-mt-selected'), null);
    await original.evaluate((element, span) => {
      const range = element.ownerDocument.createRange();
      range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
      const selection = element.ownerDocument.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
    }, { start, end: start + 4 });
    await page.waitForFunction(() => document.querySelector('[data-mt-key="gantt:task:a"][data-mt-role=node-label][data-mt-selected=true]'));
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('GANTT-2-CLIPPED-VIEWPORT: zero and off-viewport labels have no keyboard target', { timeout: 60_000 }, async () => {
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  const directory = await mkdtemp(join(tmpdir(), 'trace-gantt-clipped-'));
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
    const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage();
    for (const width of [-1, 0, 1, 149]) {
      const source = `---\nconfig: { gantt: { useWidth: ${width}, useMaxWidth: false } }\n---\ngantt\ndateFormat YYYY-MM-DD\nsection Work\nTask :a, 2026-01-01, 1d\n`;
      const { svg } = await producer.render(`gantt-clipped-${width}`, source);
      await page.setContent(svg);
      await page.evaluate(async activation => {
        const { activateSvg } = await import(activation);
        Object.assign(window, { handle: activateSvg(document.querySelector('svg')!, { onSelect() {} }) });
      }, activation);
      const root = page.locator('svg');
      const task = root.locator('[data-mt-key="gantt:task:a"][data-mt-role=node-label]');
      assert.equal(await root.getAttribute('viewBox'), `0 0 ${Math.max(width, 1)} 124`);
      assert.equal(await root.getAttribute('tabindex'), '0');
      assert.equal(await task.count(), width <= 0 ? 0 : 1, `width ${width}`);
      if (width > 0) assert.equal(await task.getAttribute('tabindex'), width === 149 ? '0' : null, `width ${width}`);
      assert.equal(await root.locator('[data-mt-role][tabindex="0"]').count(), width === 149 ? 2 : 0, `width ${width}`);
      if (width <= 1) {
        const start = source.indexOf('Task :a');
        await page.evaluate(span => (window as any).handle.highlight([span]), { start, end: start + 4 });
        assert.equal(await root.locator('[data-mt-role][data-mt-selected="true"]').count(), 0);
      }
      await page.evaluate(() => (window as any).handle.dispose());
      if (width === 1) {
        await root.evaluate(element => { (element as SVGSVGElement).style.overflow = 'visible'; });
        await page.evaluate(async activation => {
          const { activateSvg } = await import(activation);
          Object.assign(window, { handle: activateSvg(document.querySelector('svg')!, { onSelect() {} }) });
        }, activation);
        assert.equal(await task.getAttribute('tabindex'), '0', 'visible overflow exposes the label');
        await page.evaluate(() => (window as any).handle.dispose());
      }
    }
    const filename = join(directory, 'gantt.md');
    for (const width of [-1, 0, 1]) {
      const source = `---\nconfig: { gantt: { useWidth: ${width}, useMaxWidth: false } }\n---\ngantt\ndateFormat YYYY-MM-DD\nsection Work\nTask :a, 2026-01-01, 1d\n`;
      const markdown = `# Narrow\n\n\`\`\`mermaid\n${source}\`\`\`\n`;
      await writeFile(filename, markdown);
      preview = await watchPreview(filename, { port: 0, sourceView: true });
      await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
      const root = page.locator('svg[data-mt-map]');
      assert.equal(await root.locator('[data-mt-role][tabindex="0"]').count(), 0, `live width ${width}`);
      const original = page.frameLocator('#source-frame').locator('#source');
      const start = markdown.indexOf('Task :a');
      await original.evaluate((element, span) => {
        const range = element.ownerDocument.createRange();
        range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
        const selection = element.ownerDocument.getSelection()!;
        selection.removeAllRanges(); selection.addRange(range);
      }, { start, end: start + 4 });
      assert.equal(await root.locator('[data-mt-role][data-mt-selected="true"]').count(), 0);
      await root.click({ force: true });
      assert.equal(await root.getAttribute('data-mt-selected'), 'true');
      const fence = markdown.indexOf('```mermaid');
      const end = markdown.indexOf('```', fence + 10) + 4;
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected),
        formatLocation({ id: filename, source: markdown }, { start: fence, end }));
      await preview.close(); preview = undefined;
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('GANTT-2-LATE-EXPOSURE: target stops follow reveal and overflow changes', { timeout: 60_000 }, async () => {
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  const directory = await mkdtemp(join(tmpdir(), 'trace-gantt-late-'));
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const source = '---\nconfig: { gantt: { useWidth: 1, useMaxWidth: false } }\n---\ngantt\ndateFormat YYYY-MM-DD\nsection Work\nTask :a, 2026-01-01, 1d\n';
    const { svg } = await producer.render('gantt-late-exposure', source);
    const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
    const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage();
    await page.setContent(`<div id="host" style="display:none">${svg}</div>`);
    await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      const events: unknown[] = [];
      Object.assign(window, { events, handle: activateSvg(document.querySelector('svg')!, { onSelect: (event: unknown) => events.push(event) }) });
    }, activation);
    const root = page.locator('svg');
    const task = root.locator('[data-mt-key="gantt:task:a"][data-mt-role=node-label]');
    assert.equal(await task.count(), 1);
    await page.locator('#host').evaluate(element => { (element as HTMLElement).style.display = 'block'; });
    await page.waitForFunction(() => document.querySelector('svg')!.getBoundingClientRect().width > 0);
    await page.waitForFunction(() => !document.querySelector('[data-mt-key="gantt:task:a"][tabindex]'));
    assert.equal(await root.locator('[data-mt-role][tabindex="0"]').count(), 0);
    const start = source.indexOf('Task :a');
    await page.evaluate(span => (window as any).handle.highlight([span]), { start, end: start + 4 });
    assert.equal(await task.getAttribute('data-mt-selected'), null);

    await root.evaluate(element => { (element as SVGSVGElement).style.overflow = 'visible'; });
    await page.waitForFunction(() => document.querySelector('[data-mt-key="gantt:task:a"][data-mt-role=node-label]')?.getAttribute('tabindex') === '0');
    await task.focus();
    await task.press('Enter');
    const selected = await page.evaluate(() => (window as any).events.at(-1).span);
    assert.equal(source.slice(selected.start, selected.end), 'Task');
    assert.equal(await task.getAttribute('data-mt-selected'), 'true');

    await root.evaluate(element => { (element as SVGSVGElement).style.overflow = 'hidden'; });
    await page.waitForFunction(() => !document.querySelector('[data-mt-key="gantt:task:a"][tabindex]'));
    assert.equal(await task.getAttribute('data-mt-selected'), null);
    await page.evaluate(() => (window as any).handle.dispose());
    assert.equal(await task.getAttribute('tabindex'), null);
    assert.equal(await task.getAttribute('role'), null);
    await root.evaluate(element => { (element as SVGSVGElement).style.overflow = 'visible'; });
    assert.equal(await task.getAttribute('tabindex'), null, 'disposed activation stays inert');

    await page.evaluate(async activation => {
      const svg = document.querySelector('svg')!;
      svg.remove();
      const { activateSvg } = await import(activation);
      Object.assign(window, { detached: svg, handle: activateSvg(svg, { onSelect() {} }) });
    }, activation);
    await page.evaluate(() => {
      const svg = (window as any).detached as SVGSVGElement;
      svg.style.overflow = 'hidden';
      document.querySelector('#host')!.append(svg);
    });
    await page.waitForFunction(() => !document.querySelector('[data-mt-key="gantt:task:a"][tabindex]'));
    await root.evaluate(element => { (element as SVGSVGElement).style.overflow = 'visible'; });
    await page.waitForFunction(() => document.querySelector('[data-mt-key="gantt:task:a"][data-mt-role=node-label]')?.getAttribute('tabindex') === '0');
    await root.evaluate(element => { (element as SVGSVGElement).style.overflow = 'hidden'; });
    await page.waitForFunction(() => !document.querySelector('[data-mt-key="gantt:task:a"][tabindex]'));
    await page.evaluate(() => (window as any).handle.dispose());

    const filename = join(directory, 'gantt.md');
    const markdown = `# Narrow\n\n\`\`\`mermaid\n${source}\`\`\`\n`;
    await writeFile(filename, markdown);
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    const liveRoot = page.locator('svg[data-mt-map]');
    const liveTask = liveRoot.locator('[data-mt-key="gantt:task:a"][data-mt-role=node-label]');
    assert.equal(await liveTask.getAttribute('tabindex'), null);
    await liveRoot.evaluate(element => { (element as SVGSVGElement).style.overflow = 'visible'; });
    await page.waitForFunction(() => document.querySelector('[data-mt-key="gantt:task:a"][data-mt-role=node-label]')?.getAttribute('tabindex') === '0');
    await liveTask.focus(); await liveTask.press('Enter');
    const original = page.frameLocator('#source-frame').locator('#source');
    assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), 'Task');
    const markdownStart = markdown.indexOf('Task :a');
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected),
      formatLocation({ id: filename, source: markdown }, { start: markdownStart, end: markdownStart + 4 }));
    await liveRoot.evaluate(element => { (element as SVGSVGElement).style.overflow = 'hidden'; });
    await page.waitForFunction(() => !document.querySelector('[data-mt-key="gantt:task:a"][tabindex]'));
    assert.equal(await liveTask.getAttribute('data-mt-selected'), null);
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('ACT-VISIBILITY-TRANSITIONS: Gantt text label follows font visibility', { timeout: 30_000 }, async () => {
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  const directory = await mkdtemp(join(tmpdir(), 'trace-gantt-font-'));
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const source = '---\nconfig: { gantt: { useWidth: 153, fontSize: 0 } }\n---\ngantt\ndateFormat YYYY-MM-DD\nsection Work\nTask label :a, 2026-01-01, 1d\n';
    const { svg } = await producer.render('gantt-zero-font', source);
    const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
    const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage();
    await page.setContent(svg);
    await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      const events: unknown[] = [];
      Object.assign(window, { events, handle: activateSvg(document.querySelector('svg')!, { onSelect: (event: unknown) => events.push(event) }) });
    }, activation);
    const task = page.locator('[data-mt-key="gantt:task:a"][data-mt-role=node]');
    const label = page.locator('[data-mt-key="gantt:task:a"][data-mt-role=node-label]');
    assert.equal(await label.evaluate(element => getComputedStyle(element).fontSize), '0px');
    assert.equal(await label.getAttribute('tabindex'), null);
    assert.equal(await task.getAttribute('tabindex'), '0');
    const start = source.indexOf('Task label');
    await page.evaluate(span => (window as any).handle.highlight([span]), { start, end: start + 'Task label'.length });
    assert.equal(await task.getAttribute('data-mt-selected'), 'true');
    assert.equal(await label.getAttribute('data-mt-selected'), null);
    await label.evaluate(element => { (element as SVGTextElement).style.fontSize = '11px'; });
    await page.waitForFunction(() => document.querySelector('[data-mt-key="gantt:task:a"][data-mt-role=node-label]')?.getAttribute('tabindex') === '0', undefined, { timeout: 2_000 });
    assert.equal(await label.getAttribute('data-mt-selected'), 'true');
    assert.equal(await task.getAttribute('data-mt-selected'), null);
    await label.focus(); await label.press('Enter');
    const selected = await page.evaluate(() => (window as any).events.at(-1).span);
    assert.equal(source.slice(selected.start, selected.end), 'Task label');
    await label.evaluate(element => { (element as SVGTextElement).style.fontSize = '0px'; });
    await page.waitForFunction(() => !document.querySelector('[data-mt-key="gantt:task:a"][data-mt-role=node-label]')?.hasAttribute('tabindex'), undefined, { timeout: 2_000 });
    assert.equal(await label.getAttribute('data-mt-selected'), null);
    await page.evaluate(span => (window as any).handle.highlight([span]), { start, end: start + 'Task label'.length });
    assert.equal(await task.getAttribute('data-mt-selected'), 'true');
    await page.evaluate(() => (window as any).handle.dispose());

    const filename = join(directory, 'gantt.md');
    const markdown = `# Fonts\n\n\`\`\`mermaid\n${source}\`\`\`\n`;
    await writeFile(filename, markdown);
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    const liveLabel = page.locator('[data-mt-key="gantt:task:a"][data-mt-role=node-label]');
    assert.equal(await liveLabel.getAttribute('tabindex'), null);
    await liveLabel.evaluate(element => { (element as SVGTextElement).style.fontSize = '11px'; });
    await page.waitForFunction(() => document.querySelector('[data-mt-key="gantt:task:a"][data-mt-role=node-label]')?.getAttribute('tabindex') === '0');
    await liveLabel.focus(); await liveLabel.press('Enter');
    const original = page.frameLocator('#source-frame').locator('#source');
    assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), 'Task label');
    const markdownStart = markdown.indexOf('Task label');
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected),
      formatLocation({ id: filename, source: markdown }, { start: markdownStart, end: markdownStart + 'Task label'.length }));
    await liveLabel.evaluate(element => { (element as SVGTextElement).style.fontSize = '0px'; });
    await page.waitForFunction(() => !document.querySelector('[data-mt-key="gantt:task:a"][data-mt-role=node-label]')?.hasAttribute('tabindex'));
    assert.equal(await liveLabel.getAttribute('data-mt-selected'), null);
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('OWN-GANTT-DEPENDENCY: saved and live source references select their task owner', { timeout: 60_000 }, async () => {
  const source = 'gantt\n  dateFormat YYYY-MM-DD\n  Base 😀 :base, 2026-01-01, 1d\n  Peer :peer, 2026-01-02, 1d\n  Window :win, 2026-01-05, 1d\n  Base 😀 :done, b, after base base peer, until win\n';
  const after = source.indexOf('after base base peer');
  for (const [start, length] of [[after + 6, 4], [after + 11, 4], [after + 16, 4], [source.indexOf('until win') + 6, 3]] as const) {
    await verifyNative(source, 'gantt:task:b', 'Base 😀 :done, b, after base base peer, until win', 'Base 😀', [], { start, end: start + length });
  }
});

test('GANTT-2-SECTION-OWNERSHIP: merged titles select their first contributing declaration', { timeout: 60_000 }, async () => {
  const section = 'section Work 😀<br>Area';
  const source = `gantt\n  dateFormat YYYY-MM-DD\n  ${section}\n  section Vertical\n  Marker :vert, v, 2026-01-01, 1d\n  section Other\n  Other task :o, 2026-01-02, 1d\n  ${section}\n  Work task :w, 2026-01-03, 1d\n  section Other\n  Other again :o2, 2026-01-04, 1d\n  ${section}\n  Work again :w2, 2026-01-05, 1d\n  section Empty\n`;
  const effective = source.indexOf(section, source.indexOf(section) + 1);
  const alias = source.indexOf(section, effective + 1);
  await verifyNative(source, 'gantt:task:w', 'Work task :w, 2026-01-03, 1d', 'Work task', [
    ['gantt:section:Work 😀<br>Area', section, 'control', effective],
  ], { start: alias, end: alias + section.length }, [], 'gantt:section:Work 😀<br>Area', undefined, false, [
    { start: source.indexOf(section), end: source.indexOf(section) + section.length },
    { start: source.indexOf('section Vertical'), end: source.indexOf('section Vertical') + 'section Vertical'.length },
    { start: source.indexOf('section Empty'), end: source.indexOf('section Empty') + 'section Empty'.length },
  ]);
});

test('GANTT-2-TITLE-ORIGINS: body replacements and frontmatter fallback keep exact saved/live selection', { timeout: 90_000 }, async () => {
  const head = '---\ntitle: Configured 😀\n---\ngantt\n';
  const task = 'Task :a, 2026-01-01, 1d';
  const tail = `  dateFormat YYYY-MM-DD\n  ${task}\n`;
  const repeated = head + '  title First 😀\n  title Last 😀\n' + tail;
  await verifyNative(repeated, 'gantt:task:a', task, 'Task', [
    ['gantt:title', 'title Last 😀', 'control', repeated.indexOf('title Last')],
  ], 'title First 😀', [], 'gantt:title');
  const fallback = head + tail;
  await verifyNative(fallback, 'gantt:task:a', task, 'Task', [
    ['gantt:title', 'title: Configured 😀', 'control', fallback.indexOf('title:')],
  ], 'Configured 😀', [], 'gantt:title');
  const cleared = head + '  title First 😀\n  title  \n' + tail;
  await verifyNative(cleared, 'gantt:task:a', task, 'Task', [], undefined, [], 'gantt:task:a', undefined, false, [
    { start: cleared.indexOf('title:'), end: cleared.indexOf('title:') + 'title: Configured 😀'.length },
    { start: cleared.indexOf('title First'), end: cleared.indexOf('title First') + 'title First 😀'.length },
    { start: cleared.indexOf('title  '), end: cleared.indexOf('title  ') + 'title  '.length },
  ]);
});

test('GANTT-2-CROSS-LINE-TITLE-SECTION: saved and live labels select two-line constructs', { timeout: 60_000 }, async () => {
  const task = 'Task :a, 2026-01-01, 1d';
  for (const comments of ['', '%% title comment\n']) {
    const sectionComment = comments ? '%% section comment\n' : '';
    const source = `gantt\ndateFormat YYYY-MM-DD\ntitle\n${comments}Plan 😀\nsection\n${sectionComment}Work 😀\n${task}\n`;
    await verifyNative(source, 'gantt:task:a', task, 'Task', [
      ['gantt:title', `title\n${comments}Plan 😀`, 'control', source.indexOf('title')],
      ['gantt:section:Work 😀', `section\n${sectionComment}Work 😀`, 'control', source.indexOf('section')],
    ], 'Plan 😀', [], 'gantt:title');
  }
});

test('GANTT-2-ACCESSIBILITY: source-only title and description evidence survives saved/live SVG', { timeout: 60_000 }, async () => {
  const task = 'Task :a, 2026-01-01, 1d';
  const source = `gantt\naccTitle: First 😀\naccTitle: Last 😀\naccDescr: Old text\naccDescr {\n  New 😀 line\n  second line\n}\ndateFormat YYYY-MM-DD\n${task}\n`;
  const statements = ['accTitle: First 😀', 'accTitle: Last 😀', 'accDescr: Old text', 'accDescr {\n  New 😀 line\n  second line\n}'];
  await verifyNative(source, 'gantt:task:a', task, 'Task', [], undefined, [], 'gantt:task:a', undefined, false,
    statements.map(statement => ({ start: source.indexOf(statement), end: source.indexOf(statement) + statement.length })));
  const directory = await mkdtemp(join(tmpdir(), 'trace-gantt-acc-'));
  const filename = join(directory, 'gantt.md');
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const { svg } = await producer.render('gantt-acc', source);
    const page = await browser.newPage();
    await page.setContent(svg);
    const saved = JSON.parse((await page.locator('[data-mt-native]').getAttribute('data-mt-native'))!);
    assert.equal(saved.filter((piece: any) => piece.classification === 'accessibility').length, 4);
    await writeFile(filename, '```mermaid\n' + source + '```\n');
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    const live = JSON.parse((await page.locator('[data-mt-native]').getAttribute('data-mt-native'))!);
    assert.deepEqual(live, saved, 'Markdown embedding retains every original accessibility occurrence');
    assert.equal(await page.locator('svg title[tabindex], svg desc[tabindex], svg title[data-mt-role], svg desc[data-mt-role]').count(), 0);
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('GANTT-2-DIRECTIVE-ORIGINS: source-only settings survive saved and live SVG', { timeout: 60_000 }, async () => {
  const task = 'Task :a, 2026-01-01, 1d';
  const statements = [
    'dateFormat YYYY-MM-DD', 'inclusiveEndDates', 'topAxis', 'axisFormat %Y-%m-%d ',
    'tickInterval 1day', 'includes weekends', 'excludes weekends', 'todayMarker off',
    'weekday monday', 'weekend friday', 'dateFormat YYYY-MM-DD', 'topAxis',
  ];
  const source = `gantt\n%% 😀 comment\n${statements.map((statement, i) => i === 3 ? `${statement}; note` : statement).join('\n')}\n${task}\n`;
  const spans: { start: number; end: number }[] = [];
  let searchFrom = 0;
  for (const statement of statements) {
    const start = source.indexOf(statement, searchFrom);
    assert.ok(start >= 0);
    spans.push({ start, end: start + statement.length });
    searchFrom = start + statement.length;
  }
  await verifyNative(source, 'gantt:task:a', task, 'Task', [], undefined, [], 'gantt:task:a', undefined, false, spans);
  const directory = await mkdtemp(join(tmpdir(), 'trace-gantt-directives-'));
  const filename = join(directory, 'gantt.md');
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const { svg } = await producer.render('gantt-directives', source);
    const page = await browser.newPage();
    await page.setContent(svg);
    const saved = JSON.parse((await page.locator('[data-mt-native]').getAttribute('data-mt-native'))!);
    const directive = saved.filter((item: any) => item.classification === 'gantt-directive');
    assert.equal(directive.length, statements.length);
    assert.ok(directive.every((item: any) => item.kind === 'nonvisual' && !item.domId));
    await writeFile(filename, '```mermaid\n' + source + '```\n');
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    const live = JSON.parse((await page.locator('[data-mt-native]').getAttribute('data-mt-native'))!);
    assert.deepEqual(live, saved, 'Markdown embedding retains every directive origin');
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('GANTT-2-CROSS-LINE-DIRECTIVES: saved and live Markdown keep settings nonvisual', { timeout: 60_000 }, async () => {
  const task = 'Task :a, 2026-01-01, 1d';
  const settings = [
    ['dateFormat', 'YYYY-MM-DD'], ['axisFormat', '%d/%m'],
    ['tickInterval', '2day'], ['includes', 'weekends'],
    ['excludes', 'weekends'], ['todayMarker', 'off'],
    ['weekday', 'monday'], ['weekend', 'friday'],
  ];
  const statements = settings.map(([keyword, value]) => `${keyword}\n%% note\n${value}`);
  const source = `gantt\n${statements.join('\n')}\n${task}\n`;
  const spans = statements.map(statement => ({ start: source.indexOf(statement), end: source.indexOf(statement) + statement.length }));
  await verifyNative(source, 'gantt:task:a', task, 'Task', [], undefined, [], 'gantt:task:a', undefined, false, spans);
});

test('GANTT-2-ACCESSIBILITY-BLOCK-OPEN: saved and live Markdown keep the block nonvisual', { timeout: 60_000 }, async () => {
  const task = 'Task :a, 2026-01-01, 1d';
  const block = 'accDescr\n%% note\n{Beta}';
  const source = `gantt\ndateFormat YYYY-MM-DD\n${block}\n${task}\n`;
  const start = source.indexOf(block);
  await verifyNative(source, 'gantt:task:a', task, 'Task', [], undefined, [], 'gantt:task:a', undefined, false, [{ start, end: start + block.length }]);
});

test('GANTT-2-SINGLE-PERCENT-COMMENTS: comments stay unselectable around a selectable task', { timeout: 60_000 }, async () => {
  const task = 'Task 😀 :a, 2026-01-01, 1d';
  const source = `gantt % header\ndateFormat YYYY-MM-DD\n%\n  % 😀 note\n%{invalid}\n${task}\n`;
  const comments = ['% header', '%\n', '% 😀 note', '%{invalid}'];
  const spans = comments.map(comment => ({ start: source.indexOf(comment), end: source.indexOf(comment) + comment.length }));
  await verifyNative(source, 'gantt:task:a', task, 'Task 😀', [], undefined, [], 'gantt:task:a', undefined, false, spans);
});

test('GANTT-2-CLICK-LINEBREAKS: saved and live Markdown retain task and action selection', { timeout: 60_000 }, async () => {
  const task = 'Task :a, 2026-01-01, 1d';
  const source = `gantt\ndateFormat YYYY-MM-DD\n${task}\nclick\n%% note\na\nhref\n"https://example.test"\n`;
  await verifyNative(source, 'gantt:task:a', task, 'Task', [], 'https://example.test');
});

test('GANTT-2-CLICK-ORIGINS: task interaction syntax selects its own existing targets', { timeout: 60_000 }, async () => {
  const source = 'gantt\n%% 😀\ndateFormat YYYY-MM-DD\nclick a href "https://early.test"\nFirst :a, 2026-01-01, 1d\nSecond :b, 2026-01-02, 1d\nclick a,b href "https://example.test/😀" call cb("x", 2) "Open 😀"\nclick a href "https://later.test"\nclick ghost href "https://missing.test"\nclick a href "" ""\n';
  const directory = await mkdtemp(join(tmpdir(), 'trace-gantt-click-'));
  const filename = join(directory, 'gantt.md');
  const markdown = '```mermaid\n' + source + '```\n';
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const { svg } = await producer.render('gantt-click', source);
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    await page.setContent(svg + svg.replaceAll('gantt-click', 'gantt-copy'));
    const original = await page.locator('svg').first().evaluate(element => element.outerHTML);
    await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      const events: unknown[] = [];
      const handles = [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect: (selection: unknown) => events.push(selection) }));
      Object.assign(window, { events, handles });
    }, activation);
    const first = page.locator('svg').first();
    const second = page.locator('svg').nth(1);
    const savedNative = await first.locator('[data-mt-native]').getAttribute('data-mt-native');
    const bars = (root: Locator, id: string) => root.locator(`[data-mt-key="gantt:task:${id}"][data-mt-role=node]`);
    const select = async (text: string, expected: readonly string[], from = 0) => {
      const start = source.indexOf(text, from);
      assert.ok(start >= 0);
      await page.evaluate(span => (window as any).handles[0].highlight([span]), { start, end: start + text.length });
      for (const id of ['a', 'b']) assert.equal(await bars(first, id).getAttribute('data-mt-selected'), expected.includes(id) ? 'true' : null, `${text} selects ${id}`);
      assert.equal(await second.locator('[data-mt-selected=true]').count(), 0, 'saved instances remain isolated');
    };
    await select('a', [], source.indexOf('click a href') + 'click '.length); // The earlier click precedes task creation.
    await select('a,b', ['a', 'b']);
    const ids = source.indexOf('click a,b') + 'click '.length;
    await page.evaluate(span => (window as any).handles[0].highlight([span]), { start: ids, end: ids + 1 });
    assert.equal(await bars(first, 'a').getAttribute('data-mt-selected'), 'true');
    assert.equal(await bars(first, 'b').getAttribute('data-mt-selected'), null);
    await page.evaluate(span => (window as any).handles[0].highlight([span]), { start: ids + 2, end: ids + 3 });
    assert.equal(await bars(first, 'a').getAttribute('data-mt-selected'), null);
    assert.equal(await bars(first, 'b').getAttribute('data-mt-selected'), 'true');
    for (const value of ['https://example.test/😀', 'cb', '"x", 2', 'Open 😀']) await select(value, ['a', 'b']);
    await select('https://later.test', ['a']);
    await select('ghost', []);
    await select('https://early.test', []);
    await select('https://missing.test', []);
    await select('""', ['a'], source.indexOf('click a href ""'));
    await select('""', ['a'], source.indexOf('click a href ""') + 'click a href "" '.length);
    await clickExposedTarget(bars(first, 'a'));
    const event = await page.evaluate(() => (window as any).events.at(-1));
    assert.equal(source.slice(event.span.start, event.span.end), 'First :a, 2026-01-01, 1d');
    assert.equal(await bars(first, 'a').getAttribute('tabindex'), '0', 'interaction source adds no keyboard stop');
    await bars(first, 'a').focus(); await bars(first, 'a').press('Enter');
    const keyboard = await page.evaluate(() => (window as any).events.at(-1));
    assert.deepEqual(keyboard.span, event.span, 'keyboard activation keeps task declaration ownership');
    await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
    assert.equal(await first.evaluate(element => element.outerHTML), original, 'disposal restores the saved SVG');

    await writeFile(filename, markdown);
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    assert.equal(await page.locator('svg[data-mt-map] [data-mt-native]').getAttribute('data-mt-native'), savedNative, 'Markdown embedding keeps click occurrence evidence');
    const sourceView = page.frameLocator('#source-frame').locator('#source');
    await page.evaluate(() => navigator.clipboard.writeText('source-selection-does-not-copy'));
    const multi = markdown.indexOf('click a,b') + 'click '.length;
    const selections: { start: number; end: number; targets: string[] }[] = [
      { start: multi, end: multi + 3, targets: ['a', 'b'] },
      { start: multi, end: multi + 1, targets: ['a'] },
      { start: multi + 2, end: multi + 3, targets: ['b'] },
      ...['https://example.test/😀', 'cb', 'Open 😀'].map(text => ({ start: markdown.indexOf(text), end: markdown.indexOf(text) + text.length, targets: ['a', 'b'] })),
      ...['ghost', 'https://early.test', 'https://missing.test'].map(text => ({ start: markdown.indexOf(text), end: markdown.indexOf(text) + text.length, targets: [] })),
      { start: markdown.indexOf('https://later.test'), end: markdown.indexOf('https://later.test') + 'https://later.test'.length, targets: ['a'] },
      ...[markdown.indexOf('click a href ""') + 'click a href '.length, markdown.indexOf('click a href ""') + 'click a href "" '.length].map(start => ({ start, end: start + 2, targets: ['a'] })),
    ];
    for (const { start, end, targets } of selections) {
      await sourceView.evaluate((element, span) => {
        const range = element.ownerDocument.createRange(), selection = element.ownerDocument.getSelection()!;
        range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
        selection.removeAllRanges(); selection.addRange(range);
      }, { start, end });
      await page.waitForFunction(count => document.querySelectorAll('svg[data-mt-map] [data-mt-role=node][data-mt-selected=true]').length === count, targets.length);
      for (const id of ['a', 'b']) assert.equal(await bars(page.locator('svg[data-mt-map]'), id).getAttribute('data-mt-selected'), targets.includes(id) ? 'true' : null);
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'source-selection-does-not-copy');
    }
    await clickExposedTarget(bars(page.locator('svg[data-mt-map]'), 'a'));
    assert.equal(await sourceView.evaluate(element => element.ownerDocument.getSelection()!.toString()), 'First :a, 2026-01-01, 1d');
    const task = source.indexOf('First :a');
    const start = markdown.indexOf(source) + task;
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start, end: start + 'First :a, 2026-01-01, 1d'.length }));
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('GANTT-2-TASK-FIELDS: parsed task properties select their owner without selecting ignored comments', { timeout: 60_000 }, async () => {
  const source = 'gantt\ndateFormat YYYY-MM-DD\nBase 😀 :base, 2026-01-01, 1d\nMain :active, crit, main, after base, 2d ; ignored\n';
  const statement = 'Main :active, crit, main, after base, 2d';
  const markdown = '```mermaid\n' + source + '```\n';
  const directory = await mkdtemp(join(tmpdir(), 'trace-gantt-fields-'));
  const filename = join(directory, 'gantt.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const { svg } = await producer.render('gantt-fields', source);
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    await page.setContent(svg + svg.replaceAll('gantt-fields', 'gantt-copy'));
    await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      const events: unknown[] = [];
      Object.assign(window, { events, handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect: (selection: unknown) => events.push(selection) })) });
    }, activation);
    const first = page.locator('svg').first();
    const main = first.locator('[data-mt-key="gantt:task:main"][data-mt-role=node]');
    const base = first.locator('[data-mt-key="gantt:task:base"][data-mt-role=node]');
    const fields = ['active', 'crit', 'main,', 'after base', '2d'];
    for (const value of fields) {
      const start = source.indexOf(value, source.indexOf('Main :'));
      await page.evaluate(span => (window as any).handles[0].highlight([span]), { start, end: start + value.length });
      assert.equal(await main.getAttribute('data-mt-selected'), 'true', value);
      assert.equal(await base.getAttribute('data-mt-selected'), null, value);
      assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
    }
    const comment = source.indexOf('; ignored');
    await page.evaluate(span => (window as any).handles[0].highlight([span]), { start: comment, end: comment + '; ignored'.length });
    assert.equal(await first.locator('[data-mt-selected=true]').count(), 0, 'ignored suffix is not task source');
    await clickExposedTarget(main);
    const event = await page.evaluate(() => (window as any).events.at(-1));
    assert.equal(source.slice(event.span.start, event.span.end), statement);
    await main.focus(); await main.press('Enter');
    assert.equal(source.slice((await page.evaluate(() => (window as any).events.at(-1))).span.start, (await page.evaluate(() => (window as any).events.at(-1))).span.end), statement);
    await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));

    await writeFile(filename, markdown);
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    const original = page.frameLocator('#source-frame').locator('#source');
    const liveMain = page.locator('svg[data-mt-map] [data-mt-key="gantt:task:main"][data-mt-role=node]');
    const liveBase = page.locator('svg[data-mt-map] [data-mt-key="gantt:task:base"][data-mt-role=node]');
    for (const value of fields) {
      const start = markdown.indexOf(value, markdown.indexOf('Main :'));
      await original.evaluate((element, span) => {
        const range = element.ownerDocument.createRange(), selection = element.ownerDocument.getSelection()!;
        range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
        selection.removeAllRanges(); selection.addRange(range);
      }, { start, end: start + value.length });
      await page.waitForFunction(() => document.querySelector('svg[data-mt-map] [data-mt-key="gantt:task:main"][data-mt-role=node][data-mt-selected=true]'));
      assert.equal(await liveBase.getAttribute('data-mt-selected'), null, value);
    }
    const ignored = markdown.indexOf('; ignored');
    await original.evaluate((element, span) => {
      const range = element.ownerDocument.createRange(), selection = element.ownerDocument.getSelection()!;
      range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
      selection.removeAllRanges(); selection.addRange(range);
    }, { start: ignored, end: ignored + '; ignored'.length });
    await page.waitForFunction(() => !document.querySelector('svg[data-mt-map] [data-mt-selected=true]'));
    await clickExposedTarget(liveMain);
    assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), statement);
    const start = markdown.indexOf(statement);
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start, end: start + statement.length }));
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('GANTT-2-REPEATED-IDS: each duplicate declaration owns its own saved and live visual', { timeout: 60_000 }, async () => {
  const source = 'gantt\ndateFormat YYYY-MM-DD\nSame 😀 :dup, 2026-01-01, 1d\nUnique :other, 2026-01-02, 1d\nSame 😀 :dup, 2026-01-03, 1d\nclick dup href "https://middle.test"\nDifferent :dup, 2026-01-05, 1d\nDependent :dep, after dup, 1d\nclick dup href "https://latest.test"\n';
  const statements = ['Same 😀 :dup, 2026-01-01, 1d', 'Same 😀 :dup, 2026-01-03, 1d', 'Different :dup, 2026-01-05, 1d'];
  const markdown = '```mermaid\n' + source + '```\n';
  const directory = await mkdtemp(join(tmpdir(), 'trace-gantt-duplicate-'));
  const filename = join(directory, 'gantt.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const { svg, mapping } = await producer.render('gantt-duplicate', source);
    const owners = statements.map(statement => mapping.pieces.find(piece => piece.kind === 'node' && piece.semanticId === 'dup' && piece.span.start === source.indexOf(statement) && piece.span.end === source.indexOf(statement) + statement.length)!);
    assert.equal(new Set(owners.map(piece => piece.domId)).size, 3);
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    await page.setContent(svg + svg.replaceAll('gantt-duplicate', 'gantt-copy'));
    await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      const events: unknown[] = [];
      Object.assign(window, { events, handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect: (selection: unknown) => events.push(selection) })) });
    }, activation);
    const first = page.locator('svg').first();
    const bar = (index: number) => first.locator(`[data-mt-key="${owners[index]!.domId}"][data-mt-role=node]`);
    const label = (index: number) => first.locator(`[data-mt-key="${owners[index]!.domId}"][data-mt-role=node-label]`);
    for (const [index, statement] of statements.entries()) {
      await clickExposedTarget(bar(index));
      const event = await page.evaluate(() => (window as any).events.at(-1));
      assert.equal(source.slice(event.span.start, event.span.end), statement);
      await clickExposedTarget(label(index));
      const labelEvent = await page.evaluate(() => (window as any).events.at(-1));
      assert.equal(source.slice(labelEvent.span.start, labelEvent.span.end), index === 2 ? 'Different' : 'Same 😀');
      await bar(index).focus(); await bar(index).press('Enter');
      const keyboard = await page.evaluate(() => (window as any).events.at(-1));
      assert.deepEqual(keyboard.span, event.span);
      const idStart = source.indexOf(':dup', source.indexOf(statement)) + 1;
      await page.evaluate(span => (window as any).handles[0].highlight([span]), { start: idStart, end: idStart + 3 });
      for (let other = 0; other < 3; other++) assert.equal(await bar(other).getAttribute('data-mt-selected'), other === index ? 'true' : null);
      assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
      const labelStart = source.indexOf(index === 2 ? 'Different' : 'Same 😀', source.indexOf(statement));
      await page.evaluate(span => (window as any).handles[0].highlight([span]), { start: labelStart, end: labelStart + (index === 2 ? 'Different' : 'Same 😀').length });
      for (let other = 0; other < 3; other++) assert.equal(await label(other).getAttribute('data-mt-selected'), other === index ? 'true' : null, 'same-text labels retain separate source occurrences');
    }
    for (const [text, owner] of [['https://middle.test', 1], ['https://latest.test', 2]] as const) {
      const start = source.indexOf(text);
      await page.evaluate(span => (window as any).handles[0].highlight([span]), { start, end: start + text.length });
      for (let index = 0; index < 3; index++) assert.equal(await bar(index).getAttribute('data-mt-selected'), index === owner ? 'true' : null);
    }
    await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));

    await writeFile(filename, markdown);
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    const original = page.frameLocator('#source-frame').locator('#source');
    const liveBar = (index: number) => page.locator(`svg[data-mt-map] [data-mt-key="${owners[index]!.domId}"][data-mt-role=node]`);
    const liveLabel = (index: number) => page.locator(`svg[data-mt-map] [data-mt-key="${owners[index]!.domId}"][data-mt-role=node-label]`);
    for (const [index, statement] of statements.entries()) {
      const idStart = markdown.indexOf(':dup', markdown.indexOf(statement)) + 1;
      await original.evaluate((element, span) => {
        const range = element.ownerDocument.createRange(), selection = element.ownerDocument.getSelection()!;
        range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
        selection.removeAllRanges(); selection.addRange(range);
      }, { start: idStart, end: idStart + 3 });
      await page.waitForFunction(key => document.querySelector(`svg[data-mt-map] [data-mt-key="${key}"][data-mt-role=node][data-mt-selected=true]`), owners[index]!.domId);
      for (let other = 0; other < 3; other++) assert.equal(await liveBar(other).getAttribute('data-mt-selected'), other === index ? 'true' : null);
      const label = index === 2 ? 'Different' : 'Same 😀';
      const labelStart = markdown.indexOf(label, markdown.indexOf(statement));
      await original.evaluate((element, span) => {
        const range = element.ownerDocument.createRange(), selection = element.ownerDocument.getSelection()!;
        range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
        selection.removeAllRanges(); selection.addRange(range);
      }, { start: labelStart, end: labelStart + label.length });
      await page.waitForFunction(key => document.querySelector(`svg[data-mt-map] [data-mt-key="${key}"][data-mt-role=node-label][data-mt-selected=true]`), owners[index]!.domId);
      for (let other = 0; other < 3; other++) assert.equal(await liveLabel(other).getAttribute('data-mt-selected'), other === index ? 'true' : null);
      await clickExposedTarget(liveBar(index));
      assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), statement);
      const start = markdown.indexOf(statement);
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start, end: start + statement.length }));
    }
    for (const [text, owner] of [['https://middle.test', 1], ['https://latest.test', 2]] as const) {
      const start = markdown.indexOf(text);
      await original.evaluate((element, span) => {
        const range = element.ownerDocument.createRange(), selection = element.ownerDocument.getSelection()!;
        range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
        selection.removeAllRanges(); selection.addRange(range);
      }, { start, end: start + text.length });
      await page.waitForFunction(key => document.querySelector(`svg[data-mt-map] [data-mt-key="${key}"][data-mt-role=node][data-mt-selected=true]`), owners[owner]!.domId);
      for (let index = 0; index < 3; index++) assert.equal(await liveBar(index).getAttribute('data-mt-selected'), index === owner ? 'true' : null);
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('JOURNEY PLAN-AC2/3: native cards, labels and original Markdown selection', { timeout: 60_000 }, async () => {
  await verifyNative('journey\n  title Trip\n  section Morning\n  Same 😀 : 5 : Alice, Bob\n  Same 😀 : 2 : Alice\n', 'journey:task:0', 'Same 😀 : 5 : Alice, Bob', 'Same 😀', [['journey:score:0', '5'], ['journey:actor:1:0', 'Alice'], ['journey:actor:Alice', 'Alice']]);
});

test('JOURNEY-2-PERCENT-COMMENTS: saved and live selection ignores comments but keeps literal percent labels', { timeout: 60_000 }, async () => {
  for (const comment of ['%', '%%']) {
    const source = `journey ${comment} header; ignored\n${comment} whole line; ignored\ntitle Work % literal\nsection Phase % literal\nTask % literal: 5\n`;
    await verifyNative(source, 'journey:task:0', 'Task % literal: 5', 'Task % literal', [
      ['journey:title', 'title Work % literal', 'control'],
      ['journey:section:0', 'Phase % literal', 'control-label'],
    ]);
  }
});

test('OWN-JOURNEY-ACTOR / JOURNEY-2-ACTOR-UNICODE: saved and live actor slots preserve local ownership and legend grouping', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-journey-owner-'));
  const filename = join(directory, 'journey.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) for (const sectionMode of [0, 1, 2, 3, 4]) {
      const source = `---\r\nconfig:\r\n  look: ${look}\r\n  htmlLabels: ${html}\r\n---\r\njourney\r\n%% 😀\r\n` + (sectionMode === 4
        ? 'First : 5 : \uFEFF😀\uFEFF, \u0085Alpha\u0085, \uE000, 😀, Alpha, \uFEFF\r\nSecond : 3 : Alpha, 😀\r\n'
        : `${sectionMode === 1 || sectionMode === 2 ? 'section Day\r\n' : ''}First : 5 : Alice 😀, Alice 😀, , Bob, Alice 😀\r\n${sectionMode >= 2 ? 'section Day\r\n' : ''}Second : 2 : Alice 😀, Bob, Carol : Ignored\r\nThird : 3 : Carol\r\n`);
      const { svg, mapping } = await producer.render('journey-owner', source);
      const actors = mapping.pieces.filter((piece: any) => piece.relation === 'actor-reference');
      assert.equal(actors.length, sectionMode === 4 ? 7 : 8);
      if (sectionMode === 4) assert.deepEqual(actors.map(piece => source.slice(piece.span.start, piece.span.end)), ['😀', '\u0085Alpha\u0085', '\uE000', '😀', 'Alpha', 'Alpha', '😀']);
      const groupSize = (piece: typeof actors[number]) => mapping.pieces.some((declaration: any) => declaration.relation !== 'actor-reference' && declaration.domId?.startsWith('journey:actor:') && declaration.span.start === piece.span.start && declaration.span.end === piece.span.end) ? 3 : 1;
      await page.setContent(svg + svg.replaceAll('journey-owner', 'journey-copy'));
      const savedMarkup = await page.locator('svg').evaluateAll(elements => elements.map(element => element.outerHTML));
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
      assert.deepEqual(await page.locator('svg').evaluateAll(elements => elements.map(element => element.outerHTML)), savedMarkup, 'disposal restores the exact host SVG');
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
        if (groupSize(piece) === 3) {
          const group = diagrams.first().locator(`[data-mt-start="${await target.getAttribute('data-mt-start')}"][data-mt-end="${await target.getAttribute('data-mt-end')}"]`);
          assert.equal(await group.count(), 3);
          assert.equal(await group.locator(':scope[tabindex="0"]').count(), 1);
          for (const member of await group.all()) {
            await clickExposedTarget(member);
            assert.equal(await diagrams.first().locator('[data-mt-selected=true]').count(), 3);
            assert.equal(await diagrams.nth(1).locator('[data-mt-selected=true]').count(), 0);
          }
        }
        await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, span));
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), source.slice(piece.span.start, piece.span.end));
        await page.evaluate(() => navigator.clipboard.writeText('before-actor-keyboard'));
        await target.focus();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'before-actor-keyboard', 'focus does not copy');
        await target.press(piece.span.start % 2 ? 'Space' : 'Enter');
        await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, span));
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
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: clipboardPermissions });
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

test('JOURNEY-2-PALETTE: theme colors preserve one source selection per visual group', { timeout: 180_000 }, async () => {
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
  const themes = {
    default: ['rgb(236, 236, 255)', 'rgb(51, 51, 51)'],
    dark: ['rgb(31, 32, 32)', 'rgb(204, 204, 204)'],
    forest: ['rgb(205, 228, 152)', 'rgb(0, 0, 0)'],
    neutral: ['rgb(238, 238, 238)', 'rgb(0, 0, 0)'],
    base: ['rgb(255, 244, 221)', 'rgb(51, 51, 51)'],
  } as const;
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(10_000);
    for (const [theme, [defaultFill, defaultText]] of Object.entries(themes)) for (const override of [false, true]) {
      for (const look of ['classic', 'neo', 'handDrawn']) for (const htmlLabels of [false, true]) {
        const config = { theme, look, htmlLabels, ...(override ? { themeVariables: {
          fillType0: '#123456', actor0: '#654321', textColor: '#fedcba', faceColor: '#ffeedd', lineColor: '#abcdef',
        } } : {}), journey: { textPlacement: 'tspan' } };
        const source = '---\nconfig: ' + JSON.stringify(config) + '\n---\njourney\nsection Day\nFirst : 5 : Alice, Bob\nsection Night\nSecond : 3 : Bob\n';
        const { svg, mapping } = await producer.render('journey-palette', source);
        const actor = mapping.pieces.find(piece => piece.domId === 'journey:actor:Alice')!.span;
        await page.setContent(svg + svg.replaceAll('journey-palette', 'journey-copy'));
        const first = page.locator('svg').first();
        const colors = await first.evaluate(element => Object.fromEntries(([
          ['actor', 'circle.actor-0', 'fill'], ['task', 'rect.task', 'fill'],
          ['section', 'rect.journey-section', 'fill'], ['taskText', 'text.task', 'fill'],
          ['legend', 'text.legend', 'fill'], ['face', 'circle.face', 'fill'],
          ['line', 'line.task-line', 'stroke'],
        ] as const).map(([key, selector, property]) => [key, getComputedStyle(element.querySelector(selector)!).getPropertyValue(property)])));
        const fill = override ? 'rgb(18, 52, 86)' : defaultFill;
        const text = override ? 'rgb(254, 220, 186)' : defaultText;
        assert.deepEqual(colors, {
          actor: override ? 'rgb(101, 67, 33)' : 'rgb(143, 188, 143)',
          task: fill, section: fill, taskText: 'rgb(255, 255, 255)', legend: text,
          face: override ? 'rgb(255, 238, 221)' : 'rgb(255, 248, 220)', line: text,
        }, `${theme}/${override}/${look}/${htmlLabels}: pinned Mermaid 11.17.2 computed colors`);
        await page.evaluate(async activation => {
          const { activateSvg } = await import(activation);
          Object.assign(window, { events: [], handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect: (event: unknown) => (window as any).events.push(event) })) });
        }, activation);
        const group = first.locator(`[data-mt-start="${actor.start}"][data-mt-end="${actor.end}"]`);
        assert.equal(await group.count(), 3, 'actor circle and both legend visuals share one source owner');
        assert.equal(await group.locator(':scope[tabindex="0"]').count(), 1);
        for (const member of await group.all()) {
          await clickExposedTarget(member);
          assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), actor);
          assert.equal(await first.locator('[data-mt-selected=true]').count(), 3);
          assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected=true]').count(), 0);
        }
        await page.evaluate(span => (window as any).handles[0].highlight([span]), actor);
        assert.equal(await first.locator('[data-mt-selected=true]').count(), 3);
        await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
        assert.equal(await page.locator('[data-mt-selected], [data-mt-active]').count(), 0);
      }
    }
  } finally { await browser.close(); await producer.close(); }
});

test('JOURNEY-2-ROOT: saved fixed and responsive SVGs retain independent selection', { timeout: 30_000 }, async () => {
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
  try {
    const diagrams = await Promise.all([false, true].map(async useMaxWidth => {
      const source = '---\nconfig: ' + JSON.stringify({ journey: { useMaxWidth, width: 500 } }) + '\n---\njourney\nsection Day\nTask : 5 : Alice\n';
      const { svg, mapping } = await producer.render(useMaxWidth ? 'root-responsive' : 'root-fixed', source);
      return { svg, actor: mapping.pieces.find(piece => piece.domId === 'journey:actor:Alice')!.span, useMaxWidth };
    }));
    await producer.close();
    const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
    await page.setContent(diagrams.map(({ svg }) => `<div style="width:320px;overflow:auto">${svg}</div>`).join(''));
    const before = await page.locator('svg').evaluateAll(elements => elements.map(element => element.outerHTML));
    await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      Object.assign(window, { events: [], handles: [...document.querySelectorAll('svg')].map(svg => activateSvg(svg, { onSelect: (event: unknown) => (window as any).events.push(event) })) });
    }, activation);
    for (const [index, { actor, useMaxWidth }] of diagrams.entries()) {
      const svg = page.locator('svg').nth(index);
      assert.equal(await svg.getAttribute('width') === '100%', useMaxWidth);
      const group = svg.locator(`[data-mt-start="${actor.start}"][data-mt-end="${actor.end}"]`);
      assert.equal(await group.count(), 3);
      assert.equal(await group.locator(':scope[tabindex="0"]').count(), 1);
      await clickExposedTarget(group.first());
      assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), actor);
      assert.equal(await svg.locator('[data-mt-selected=true]').count(), 3);
      assert.equal(await page.locator('svg').nth(1 - index).locator('[data-mt-selected=true]').count(), 0);
      await group.locator(':scope[tabindex="0"]').press('Enter');
      assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), actor);
      await page.evaluate(({ index, actor }) => (window as any).handles[index].highlight([actor]), { index, actor });
      assert.equal(await svg.locator('[data-mt-selected=true]').count(), 3);
      await page.evaluate((index: number) => (window as any).handles[index].highlight([]), index);
    }
    await page.evaluate(() => (window as any).handles.forEach((handle: any) => handle.dispose()));
    assert.deepEqual(await page.locator('svg').evaluateAll(elements => elements.map(element => element.outerHTML)), before);
  } finally { await browser.close(); await producer.close(); }
});

test('JOURNEY-2-IGNORED: source-only Journey options create no visual selection', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-journey-ignored-'));
  const filename = join(directory, 'ignored.md');
  const sources = ['classic', 'neo', 'handDrawn'].flatMap(look => [false, true].map(htmlLabels =>
    '---\nconfig:\n  look: ' + look + '\n  htmlLabels: ' + htmlLabels + '\n  journey:\n    boxMargin: 0\n    noteMargin: 99\n    messageMargin: 99\n    messageAlign: left\n    bottomMarginAdj: 5\n    rightAngles: true\n    activationWidth: 25\n---\n' +
    '%%{init: { journey: { boxMargin: 0, activationWidth: 25 } }}%%\njourney\nsection Day\nTask 😀 : 5 : Alice\n'));
  const markdown = sources.map(source => '```mermaid\n' + source + '```\n').join('\n');
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    await writeFile(filename, markdown);
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
    const diagrams = page.locator('svg[data-mt-map]');
    assert.equal(await diagrams.count(), sources.length);
    const original = page.frameLocator('#source-frame').locator('#source');
    let after = 0;
    for (const [index, source] of sources.entries()) {
      const start = markdown.indexOf(source, after); after = start + source.length;
      const task = source.indexOf('Task 😀 : 5 : Alice');
      const target = diagrams.nth(index).locator('[data-mt-key="journey:task:0"][data-mt-role=node] rect.task');
      await clickExposedTarget(target);
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected),
        formatLocation({ id: filename, source: markdown }, { start: start + task, end: start + task + 'Task 😀 : 5 : Alice'.length }));
      await page.waitForFunction(index => document.querySelectorAll('svg')[index]!.querySelectorAll('[data-mt-role=node][data-mt-selected=true]').length === 1, index);
      for (const token of ['boxMargin: 0', 'activationWidth: 25']) {
        const property = (token.startsWith('activation') ? source.lastIndexOf(token) : source.indexOf(token)) + token.indexOf(': ') + 2;
        await original.evaluate((element, span) => {
          const range = element.ownerDocument.createRange();
          range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
          element.ownerDocument.getSelection()!.removeAllRanges(); element.ownerDocument.getSelection()!.addRange(range);
        }, { start: start + property, end: start + property + token.length - token.indexOf(': ') - 2 });
        await page.waitForFunction(() => document.querySelectorAll('svg [data-mt-selected=true], svg[data-mt-selected=true]').length === 0);
      }
      await diagrams.nth(index).locator('[data-mt-key="journey:task:0"][data-mt-role=node]').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected),
        formatLocation({ id: filename, source: markdown }, { start: start + task, end: start + task + 'Task 😀 : 5 : Alice'.length }));
      assert.equal(await diagrams.filter({ has: page.locator('[data-mt-selected=true]') }).count(), 1, 'keyboard selection stays in its diagram');
    }
  } finally { await preview?.close(); await browser.close(); await rm(directory, { recursive: true, force: true }); }
});

test('KANBAN PLAN-AC2/3: columns, cards, metadata and original Markdown selection', { timeout: 60_000 }, async () => {
  await verifyNative("kanban\n  todo[Todo]\n    a[Same 😀]@{ ticket: 'T-1', assigned: 'Alice', priority: 'High' }\n    b[Same 😀]\n  done[Done]\n    c[Ship]\n", 'kanban:card:1', "a[Same 😀]@{ ticket: 'T-1', assigned: 'Alice', priority: 'High' }", 'Same 😀', [['kanban:column:0', 'todo[Todo]'], ['kanban:field:1:ticket', 'T-1'], ['kanban:field:1:assigned', 'Alice'], ['kanban:field:1:priority', 'High']]);
});

test('KANBAN-2-OCCURRENCES: repeated IDs retain separate saved/live selections', { timeout: 60_000 }, async () => {
  for (const separateColumns of [false, true]) {
    const first = "a[Same 😀]@{ ticket: 'T-1', assigned: 'Alice', priority: 'High' }";
    const second = "a[Same 😀]@{ ticket: 'T-2', assigned: 'Bob', priority: 'Low' }";
    const source = `kanban\n  todo[Todo]\n    ${first}\n${separateColumns ? '  done[Done]\n' : ''}    ${second}\n`;
    for (const [id, statement, ticket, assigned, priority] of [
      [1, first, 'T-1', 'Alice', 'High'],
      [separateColumns ? 3 : 2, second, 'T-2', 'Bob', 'Low'],
    ] as const) {
      const key = `kanban:card:${id}`;
      await verifyNative(source, key, statement, 'Same 😀', [
        [key, 'Same 😀', 'node-label', source.indexOf(statement) + 2],
        [`kanban:field:${id}:ticket`, ticket],
        [`kanban:field:${id}:assigned`, assigned],
        [`kanban:field:${id}:priority`, priority],
      ], { start: source.indexOf(statement), end: source.indexOf(statement) + 1 }, [], key, undefined, true);
    }
  }
});

test('OWN-JOURNEY-SECTION: saved and live section runs keep distinct source owners', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-section-owner-'));
  const filename = join(directory, 'sections.md');
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: clipboardPermissions });
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
        await clickExposedTarget(frame.locator(':scope > rect'));
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
        await clickExposedTarget(frame.locator(':scope > rect'));
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

test('JOURNEY-2-FONTS: invisible labels resolve to their owner while CSS-sized labels remain selectable', { timeout: 180_000 }, async () => {
  const producer = await createMermanProducer();
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3_000);
    for (const [font, computed] of [['0', '0px'], ['0.5', '0.5px'], ['24', '24px'], ["'24'", '24px'], ["'24px'", '24px'], ["'1em'", '16px'], ["'120%'", '19.2px'], ['-1', '16px'], ["'garbage'", '16px']] as const) for (const mode of ['tspan', 'fo', 'old']) {
      const invisible = font === '0' && mode !== 'old';
      const expectedSize = mode === 'old' ? '16px' : computed;
      const source = '---\nconfig:\n  fontFamily: Georgia\n  journey:\n    taskFontSize: ' + font + '\n    taskFontFamily: Courier\n    textPlacement: ' + mode + '\n---\njourney\nsection Day\nTask<br>Line : 5 : Alice\n';
      const { svg, mapping } = await producer.render('journey-font-select', source);
      await page.setContent(svg);
      await page.evaluate(async activation => {
        const { activateSvg } = await import(activation);
        const events: unknown[] = [];
        const root = document.querySelector('svg') as SVGSVGElement;
        Object.assign(window, { events, handle: activateSvg(root, { onSelect: (event: unknown) => events.push(event) }) });
      }, activation);
      const first = page.locator('svg');
      const task = first.locator('[data-mt-key="journey:task:0"][data-mt-role=node]');
      const label = first.locator('[data-mt-key="journey:task:0"][data-mt-role=node-label]');
      const text = mode === 'old' ? label : label.locator('text.task').first();
      assert.equal(await text.evaluate(element => getComputedStyle(element).fontSize), expectedSize);
      assert.match(await text.evaluate(element => getComputedStyle(element).fontFamily), mode === 'old' ? /Georgia/ : /Courier/);
      assert.equal(await label.getAttribute('tabindex'), invisible ? null : '0');
      const labelStart = source.indexOf('Task<br>Line');
      const selected = await page.evaluate(span => (window as any).handle.highlight([span]), { start: labelStart, end: labelStart + 4 });
      assert.ok(selected.length, 'the authored label still resolves to its owning source object');
      assert.equal(await task.getAttribute('data-mt-selected'), invisible ? 'true' : null, font);
      if (!invisible) {
        await label.click();
        const event = await page.evaluate(() => (window as any).events.at(-1));
        assert.equal(source.slice(event.span.start, event.span.end), 'Task<br>Line');
        assert.equal(await label.getAttribute('data-mt-selected'), 'true');
      }
      const section = first.locator('[data-mt-key="journey:section:0"][data-mt-role=control]');
      const sectionLabel = first.locator('[data-mt-key="journey:section:0"][data-mt-role=control-label]');
      assert.equal(await sectionLabel.getAttribute('tabindex'), invisible ? null : '0');
      const sectionStart = source.indexOf('section Day') + 'section '.length;
      await page.evaluate(span => (window as any).handle.highlight([span]), { start: sectionStart, end: sectionStart + 3 });
      assert.equal(await section.getAttribute('data-mt-selected'), invisible ? 'true' : null);
      assert.equal(await sectionLabel.getAttribute('data-mt-selected'), invisible ? null : 'true');
      assert.equal(mapping.source, source);
      await page.evaluate(() => (window as any).handle.dispose());
    }
    const source = '---\nconfig:\n  journey:\n    titleFontSize: 0\n---\njourney\ntitle Invisible title\nTask : 5\n';
    const { svg } = await producer.render('journey-zero-title', source);
    await page.setContent(svg);
    await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      Object.assign(window, { handle: activateSvg(document.querySelector('svg') as SVGSVGElement, { onSelect() {} }) });
    }, activation);
    const title = page.locator('[data-mt-key="journey:title"][data-mt-role=control]');
    assert.equal(await title.count(), 1, 'static SVG retains title provenance');
    assert.equal(await title.getAttribute('tabindex'), null, 'invisible title has no keyboard stop');
    assert.equal(await page.evaluate(source => (window as any).handle.mapping.pieces.some((piece: any) => source.slice(piece.span.start, piece.span.end) === 'title Invisible title'), source), true);
    await page.evaluate(() => (window as any).handle.dispose());
  } finally { await browser.close(); await producer.close(); }
});

test('JOURNEY-2-FONTS-LIVE: source, focus and clipboard follow the visible label or owning task', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-journey-font-'));
  const filename = join(directory, 'fonts.md');
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    for (const look of ['classic', 'neo', 'handDrawn']) for (const html of [false, true]) for (const mode of ['tspan', 'fo', 'old']) for (const [font, invisible] of [['0', true], ["'24px'", false]] as const) {
      const source = '---\nconfig:\n  look: ' + look + '\n  htmlLabels: ' + html + '\n  journey:\n    taskFontSize: ' + font + '\n    textPlacement: ' + mode + '\n---\njourney\nsection Day\nTask<br>Line : 5 : Alice\n';
      const markdown = '# Fonts\n\n~~~mermaid\n' + source + '~~~\n';
      await writeFile(filename, markdown);
      preview = await watchPreview(filename, { port: 0, sourceView: true });
      await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
      const invisibleLabel = invisible && mode !== 'old';
      const task = page.locator('[data-mt-key="journey:task:0"][data-mt-role=node]');
      const label = page.locator('[data-mt-key="journey:task:0"][data-mt-role=node-label]');
      const target = invisibleLabel ? task : label;
      assert.equal(await label.getAttribute('tabindex'), invisibleLabel ? null : '0');
      const original = page.frameLocator('#source-frame').locator('#source');
      const labelStart = markdown.indexOf('Task<br>Line');
      await original.evaluate((element, span) => {
        const range = element.ownerDocument.createRange();
        range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
        const selection = element.ownerDocument.getSelection()!;
        selection.removeAllRanges(); selection.addRange(range);
      }, { start: labelStart, end: labelStart + 4 });
      await page.waitForFunction(({ role, key }) => document.querySelector('[data-mt-key="' + key + '"][data-mt-role=' + role + ']')?.getAttribute('data-mt-selected') === 'true', { role: invisibleLabel ? 'node' : 'node-label', key: 'journey:task:0' });
      await target.focus(); await target.press('Enter');
      const expected = invisibleLabel ? 'Task<br>Line : 5 : Alice' : 'Task<br>Line';
      assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), expected);
      const start = markdown.indexOf(expected);
      await page.waitForFunction(location => navigator.clipboard.readText().then(value => value === location), formatLocation({ id: filename, source: markdown }, { start, end: start + expected.length }));
      await preview.close(); preview = undefined;
    }
  } finally { await preview?.close(); await browser.close(); await rm(directory, { recursive: true, force: true }); }
});

test('JOURNEY-2-GEOMETRY-CONFIG: zero-area tasks and signed spacing retain saved/live selection', { timeout: 300_000 }, async () => {
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

test('FLOW AC5/6: minimum-width nodes preserve saved/live selection across layouts and looks', { timeout: 180_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const look of ['classic', 'neo', 'handDrawn']) for (const htmlLabels of [false, true]) {
    const source = `---\nconfig:\n  htmlLabels: ${htmlLabels}\n  look: ${look}\n  handDrawnSeed: 42\n  flowchart:\n    minNodeWidth: 240\n---\n${header}\nA["Short 😀"] -->|next| B["Other"]\n`;
    await verifyNative(source, 'node:A', 'A["Short 😀"]', 'Short 😀', [
      ['edge:L_A_B_0', '-->|next|', 'edge'],
      ['edge:L_A_B_0', 'next', 'edge-label'],
    ], { start: source.indexOf('A['), end: source.indexOf('A[') + 1 }, ['node:A'], 'node:A', undefined, true);
  }
});

test('FLOW AC5/6: bumpX defaults and edge overrides preserve saved/live connector selection', { timeout: 180_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const look of ['classic', 'neo', 'handDrawn']) for (const htmlLabels of [false, true]) for (const override of [false, true]) {
    const source = `---\nconfig:\n  htmlLabels: ${htmlLabels}\n  look: ${look}\n  handDrawnSeed: 42\n  flowchart:\n    curve: ${override ? 'basis' : 'bumpX'}\n---\n${header}\nA[Start] e@-->|next| B[Finish]\nA --> C[Branch]\nC --> B\n${override ? 'e@{ curve: bumpX }\n' : ''}`;
    await verifyNative(source, 'node:A', 'A[Start]', 'Start', [
      ['edge:e', 'e@-->|next|', 'edge'],
      ['edge:e', 'next', 'edge-label'],
    ], 'e@-->|next|', ['edge:e'], 'edge:e');
  }
});

test('FLOW AC5/6: scoped appearance preserves saved/live source and connector selection', { timeout: 180_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const look of ['classic', 'neo', 'handDrawn']) for (const htmlLabels of [false, true]) for (const directive of [false, true]) {
    const config = { theme: 'forest', look: 'classic', layout: 'dagre', htmlLabels, handDrawnSeed: 42, flowchart: { theme: 'dark', look, layout: 'elk' } };
    const source = `${directive ? `%%{init: ${JSON.stringify(config)}}%%` : `---\nconfig: ${JSON.stringify(config)}\n---`}\n${header}\nA["Short 😀"] e@-->|next| B[Finish]\nA --> C[Branch]\nC --> B\n`;
    await verifyNative(source, 'node:A', 'A["Short 😀"]', 'Short 😀', [
      ['edge:e', 'e@-->|next|', 'edge'],
      ['edge:e', 'next', 'edge-label'],
    ], 'e@-->|next|', ['edge:e'], 'edge:e');
  }
});

test('FLOW AC5/6: hand-drawn seeds preserve saved/live node, group and connector selection', { timeout: 120_000 }, async () => {
  for (const layout of ['dagre', 'elk']) for (const handDrawnSeed of [undefined, 0, 42, 43]) {
    const group = 'subgraph G[Group]\nA[Alpha] e@-->|next| B[Beta]\nend';
    const source = `---\nconfig: ${JSON.stringify({ layout, look: 'handDrawn', handDrawnSeed })}\n---\nflowchart LR\n${group}\n`;
    await verifyNative(source, 'node:A', 'A[Alpha]', 'Alpha', [
      ['edge:e', 'e@-->|next|', 'edge'], ['edge:e', 'next', 'edge-label'],
      ['flowchart:subgraph:G', group], ['flowchart:subgraph:G', 'Group', 'control-label'],
    ], { start: source.indexOf('A['), end: source.indexOf('A[') + 1 }, ['node:A'], 'node:A', undefined, true);
  }
});

test('FLOW AC5/6: ELK ordering options preserve saved/live source ownership', { timeout: 240_000 }, async t => {
  for (const considerModelOrder of ['NONE', 'NODES_AND_EDGES', 'PREFER_EDGES', 'PREFER_NODES']) for (const forceNodeModelOrder of [false, true]) {
    const elk = { preset: 'legacy', considerModelOrder, forceNodeModelOrder };
    const source = `---\nconfig: ${JSON.stringify({ layout: 'elk', elk })}\n---\nflowchart TB\nS[Start]\nA[Alpha]\nB[Beta]\nC[Gamma]\nS sc@-->|route| C\nS --> B\nS --> A`;
    await t.test(`${considerModelOrder}/force=${forceNodeModelOrder}`, () => verifyNative(source, 'node:A', 'A[Alpha]', 'Alpha', [
      ['edge:sc', 'sc@-->|route|', 'edge'], ['edge:sc', 'route', 'edge-label'],
    ]));
  }
  for (const cycleBreakingStrategy of ['GREEDY', 'DEPTH_FIRST', 'INTERACTIVE', 'MODEL_ORDER', 'GREEDY_MODEL_ORDER']) for (const nested of [false, true]) {
    const body = 'A[Alpha]\nB[Beta]\nC[Gamma]\nD[Delta]\nA ab@-->|route| B\nB --> C\nC --> A\nB --> D\nD --> A';
    const group = `subgraph G[Group]\n${body}\nend`;
    const source = `---\nconfig: ${JSON.stringify({ layout: 'elk', elk: { preset: 'legacy', cycleBreakingStrategy } })}\n---\nflowchart LR\n${nested ? group : body}`;
    await t.test(`${cycleBreakingStrategy}/nested=${nested}`, () => verifyNative(source, 'node:A', 'A[Alpha]', 'Alpha', [
      ['edge:ab', 'ab@-->|route|', 'edge'], ['edge:ab', 'route', 'edge-label'],
      ...(nested ? [['flowchart:subgraph:G', group] as const] : []),
    ]));
  }
});

test('FLOW AC5/6: ELK cycle entries preserve saved/live source ownership', { timeout: 240_000 }, async t => {
  for (const direction of ['TB', 'BT', 'LR', 'RL']) for (const nested of [false, true]) for (const keepEntryNodeOnTop of [false, true]) {
    const body = 'B[Beta]\nC[Gamma]\nA[Entry]\nA ab@-->|next| B\nB --> C\nC --> A';
    const group = `subgraph G[Group]\n${body}\nend`;
    const source = `---\nconfig: ${JSON.stringify({ layout: 'elk', elk: { preset: 'legacy', keepEntryNodeOnTop } })}\n---\nflowchart ${direction}\n${nested ? group : body}`;
    await t.test(`${direction}/nested=${nested}/entry=${keepEntryNodeOnTop}`, () => verifyNative(source, 'node:A', 'A[Entry]', 'Entry', [
      ['edge:ab', 'ab@-->|next|', 'edge'], ['edge:ab', 'next', 'edge-label'],
      ...(nested ? [['flowchart:subgraph:G', group] as const] : []),
    ]));
  }
});

test('FLOW AC5/6: ELK merging and placement keep connectors independently selectable', { timeout: 240_000 }, async t => {
  const variants = [
    ...['SIMPLE', 'NETWORK_SIMPLEX', 'LINEAR_SEGMENTS', 'BRANDES_KOEPF'].flatMap(nodePlacementStrategy => [false, true].flatMap(mergeEdges => ['TB', 'LR'].map(direction => ({ direction, elk: { nodePlacementStrategy, mergeEdges } })))),
    ...['NONE', 'LEFTUP', 'LEFTDOWN', 'RIGHTUP', 'RIGHTDOWN', 'BALANCED'].map(nodePlacementAlignment => ({ direction: 'TB', elk: { nodePlacementStrategy: 'BRANDES_KOEPF', nodePlacementAlignment, mergeEdges: true } })),
  ];
  for (const { direction, elk } of variants) {
    const group = 'subgraph G[Group]\nA[Alpha] ab@-->|next| B[Longer beta]\nA ac@--> C[Gamma]\nA ad@--> D[Delta]\nB --> E[End]\nC --> E\nD --> E\nA ae@--> E\nend';
    const source = `---\nconfig: ${JSON.stringify({ layout: 'elk', elk: { preset: 'legacy', ...elk } })}\n---\nflowchart ${direction}\n${group}`;
    await t.test(JSON.stringify({ direction, ...elk }), () => verifyNative(source, 'node:A', 'A[Alpha]', 'Alpha', [
      ['edge:ab', 'ab@-->|next|', 'edge'], ['edge:ab', 'next', 'edge-label'],
      ['edge:ac', 'ac@-->', 'edge'], ['edge:ad', 'ad@-->', 'edge'], ['edge:ae', 'ae@-->', 'edge'],
      ['flowchart:subgraph:G', group],
    ]));
  }
});

test('FLOW AC5/6: ELK terminal straightening preserves saved/live source selection', { timeout: 240_000 }, async () => {
  for (const straightenEdges of [false, true]) for (const lineHops of [false, 'arc', 'gap']) for (const direction of ['TB', 'LR']) {
    const group = 'subgraph G[Routes]\nA[Alpha] --> D\nA --> E\nA --> F\nB --> D\nB --> E\nB --> F\nC e@-->|route| D\nC --> E\nC --> F\nend';
    const source = `---\nconfig: ${JSON.stringify({ layout: 'elk', elk: { straightenEdges, lineHops } })}\n---\nflowchart ${direction}\n${group}`;
    await verifyNative(source, 'node:A', 'A[Alpha]', 'Alpha', [
      ['edge:e', 'e@-->|route|', 'edge'], ['edge:e', 'route', 'edge-label'],
      ['edge:L_B_E_0', '-->', 'edge'], ['flowchart:subgraph:G', group],
    ]);
  }
});

test('FLOW AC5: ELK hop paint fits the static SVG viewport', async () => {
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    for (const lineHops of ['arc', 'gap']) for (const direction of ['TB', 'BT', 'LR', 'RL']) {
      const source = `---\nconfig: ${JSON.stringify({ layout: 'elk', elk: { lineHops } })}\n---\nflowchart ${direction}\nsubgraph G\nA --> D\nA --> E\nA e@--> F\nB --> D\nB --> E\nB --> F\nC --> D\nC --> E\nC --> F\nend`;
      await page.setContent((await producer.render('hop-bounds', source)).svg);
      const paths = await page.locator('path.flowchart-link').evaluateAll(elements => elements.map(element => {
        const path = element as SVGPathElement, root = path.ownerSVGElement!;
        const box = path.getBBox(), matrix = root.getScreenCTM()!.inverse().multiply(path.getScreenCTM()!);
        const corners = [[box.x, box.y], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
        const view = root.viewBox.baseVal;
        return { d: path.getAttribute('d')!, inside: corners.every(p => p.x >= view.x && p.y >= view.y && p.x <= view.x + view.width && p.y <= view.y + view.height) };
      }));
      assert.ok(paths.some(({ d }) => lineHops === 'arc' ? d.includes('A') : d.split('M').length > 2), `${direction}/${lineHops} paints actual hops`);
      assert.ok(paths.every(p => p.inside), `${direction}/${lineHops} fits the static viewport`);
    }
  } finally { await browser.close(); await producer.close(); }
});

test('FLOW AC5/6: ELK crossing hops preserve saved/live connector selection', { timeout: 180_000 }, async () => {
  for (const lineHops of [false, 'arc', 'gap']) for (const direction of ['TB', 'LR']) for (const look of ['classic', 'neo', 'handDrawn']) {
    const group = 'subgraph G[Crossings]\nA[Alpha] --> D\nA --> E\nA e@-->|crossing| F\nB --> D\nB --> E\nB --> F\nC --> D\nC --> E\nC --> F\nend';
    const source = `---\nconfig: ${JSON.stringify({ layout: 'elk', look, elk: { lineHops } })}\n---\nflowchart ${direction}\n${group}\ne@{curve: basis}`;
    await verifyNative(source, 'node:A', 'A[Alpha]', 'Alpha', [
      ['edge:e', 'e@-->|crossing|', 'edge'], ['edge:e', 'crossing', 'edge-label'],
      ['edge:L_C_D_0', '-->', 'edge'], ['flowchart:subgraph:G', group],
    ]);
  }
});

test('FLOW AC5/6: ELK layering preserves saved/live selection across cycles and nested scopes', { timeout: 240_000 }, async () => {
  for (const layeringStrategy of ['NETWORK_SIMPLEX', 'LONGEST_PATH', 'LONGEST_PATH_SOURCE', 'COFFMAN_GRAHAM', 'MIN_WIDTH', 'STRETCH_WIDTH', 'INTERACTIVE']) for (const direction of ['TB', 'BT', 'LR', 'RL']) {
    const group = 'subgraph G[Group]\nA[Alpha] e@-->|next| B[Beta]\nB --> C[Gamma]\nC --> A\nA s@--> A\nend';
    const source = `---\nconfig: ${JSON.stringify({ layout: 'elk', elk: { layeringStrategy, layeringLayerBound: 1 } })}\n---\nflowchart ${direction}\n${group}\nA --> D[Delta]\nB --> D\nD f@-->|last| E[End]\nF[Detached]\n`;
    await verifyNative(source, 'node:A', 'A[Alpha]', 'Alpha', [
      ['edge:e', 'e@-->|next|', 'edge'], ['edge:e', 'next', 'edge-label'],
      ['edge:s', 's@-->', 'edge'], ['edge:f', 'f@-->|last|', 'edge'], ['edge:f', 'last', 'edge-label'],
      ['flowchart:subgraph:G', group], ['flowchart:subgraph:G', 'Group', 'control-label'],
    ], { start: source.indexOf('A['), end: source.indexOf('A[') + 1 }, ['node:A'], 'node:A', undefined, true);
  }
});

test('FLOW AC5/6: ELK presets preserve nested saved/live selection and overrides', { timeout: 120_000 }, async () => {
  for (const preset of ['default', 'legacy', 'modelOrder', 'depthFirst']) for (const override of [false, true]) {
    const group = 'subgraph G[Group]\nA[Alpha] e@-->|next| B[Beta]\nB --> C[Gamma]\nC --> A\nend';
    const elk = { preset, ...(override ? { nodePlacementStrategy: 'SIMPLE', nodePlacementAlignment: 'NONE', cycleBreakingStrategy: 'GREEDY' } : {}) };
    const source = `---\nconfig: ${JSON.stringify({ layout: 'elk', elk })}\n---\nflowchart LR\nsubgraph Outer\n${group}\nend\nA --> D[Delta]\nB --> D\n`;
    await verifyNative(source, 'node:A', 'A[Alpha]', 'Alpha', [
      ['edge:e', 'e@-->|next|', 'edge'], ['edge:e', 'next', 'edge-label'],
      ['flowchart:subgraph:G', group], ['flowchart:subgraph:G', 'Group', 'control-label'],
    ], { start: source.indexOf('A['), end: source.indexOf('A[') + 1 }, ['node:A'], 'node:A', undefined, true);
  }
});

test('FLOW AC5/6: authored ID settings preserve saved/live selection and instance isolation', { timeout: 120_000 }, async () => {
  for (const layout of ['dagre', 'elk']) for (const deterministicIds of [false, true]) for (const deterministicIDSeed of ['', '作者 🐟']) {
    const group = 'subgraph G[Group]\nA[Alpha] e@-->|next| B[Beta]\nend';
    const source = `---\nconfig: ${JSON.stringify({ layout, deterministicIds, deterministicIDSeed })}\n---\nflowchart LR\n${group}\n`;
    await verifyNative(source, 'node:A', 'A[Alpha]', 'Alpha', [
      ['edge:e', 'e@-->|next|', 'edge'], ['edge:e', 'next', 'edge-label'],
      ['flowchart:subgraph:G', group], ['flowchart:subgraph:G', 'Group', 'control-label'],
    ], { start: source.indexOf('A['), end: source.indexOf('A[') + 1 }, ['node:A'], 'node:A', undefined, true);
  }
});

test('FLOW AC5/6: wrapping boundaries preserve saved/live node, group and connector selection', { timeout: 240_000 }, async () => {
  for (const header of ['flowchart TB', 'flowchart-elk TB']) for (const look of ['classic', 'neo', 'handDrawn']) for (const htmlLabels of [false, true]) for (const wrappingWidth of [0, 60]) {
    const group = 'subgraph G[Group]\nA["`Alpha beta 😀`"] e@-->|next| B[Finish]\nend';
    const config = { look, htmlLabels, handDrawnSeed: 42, flowchart: { wrappingWidth, padding: 8, nodeSpacing: 120, rankSpacing: 120 } };
    const source = `---\nconfig: ${JSON.stringify(config)}\n---\n${header}\n${group}\n`;
    await verifyNative(source, 'node:A', 'A["`Alpha beta 😀`"]', 'Alpha beta 😀', [
      ['edge:e', 'e@-->|next|', 'edge'],
      ['edge:e', 'next', 'edge-label'],
      ['flowchart:subgraph:G', group],
      ['flowchart:subgraph:G', 'Group', 'control-label'],
    ], { start: source.indexOf('A['), end: source.indexOf('A[') + 1 }, ['node:A'], 'node:A', undefined, true);
  }
});

test('FLOW AC5/6: title margins and viewport sizing preserve visible saved/live targets', { timeout: 240_000 }, async () => {
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    for (const header of ['flowchart TB', 'flowchart-elk TB']) for (const look of ['classic', 'neo', 'handDrawn']) for (const htmlLabels of [false, true]) for (const useMaxWidth of [false, true]) {
      const group = 'subgraph G[Group]\nA[Alpha] e@-->|next| B[Beta]\nend';
      const empty = 'subgraph E[Empty]\nend';
      const config = { look, htmlLabels, handDrawnSeed: 42, flowchart: { diagramPadding: 30, titleTopMargin: 60, subGraphTitleMargin: { top: 30, bottom: 30 }, useMaxWidth } };
      const source = `---\ntitle: Diagram 😀\nconfig: ${JSON.stringify(config)}\n---\n${header}\nsubgraph Outer\n${group}\nend\n${empty}\nA --> X[Outside]\n`;
      const { svg } = await producer.render('margin-geometry', source);
      await page.setContent(svg!);
      const boxes = await page.evaluate(() => {
        const root = document.querySelector('svg')!;
        const scale = root.getScreenCTM()!.a;
        const bounds = (e: Element) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
        return ['Outer', 'G', 'E'].map(id => {
          const frame = document.querySelector(`[data-mt-key="flowchart:subgraph:${id}"][data-mt-role=control]`)!;
          const shape = frame.querySelector(':scope > rect, :scope > g > path')!;
          const label = document.querySelector(`[data-mt-key="flowchart:subgraph:${id}"][data-mt-role=control-label]`)!;
          const child = id === 'G' ? document.querySelector('[data-mt-key="node:A"][data-mt-role=node]') : null;
          return { id, scale, frame: bounds(shape), label: bounds(label), child: child && bounds(child) };
        });
      });
      for (const box of boxes) {
        // Dagre renders an empty group as a centered proxy node, without title margins.
        assert.ok(box.label.top >= box.frame.top - 3 * box.scale && box.label.bottom <= box.frame.bottom + 3 * box.scale && box.label.left >= box.frame.left - 3 * box.scale && box.label.right <= box.frame.right + 3 * box.scale, `${header}/${look}/${htmlLabels}/${useMaxWidth}/${box.id}: title must fit its frame`);
        if (header.startsWith('flowchart-elk') && box.child) assert.ok(box.child.top >= box.label.bottom + 27 * box.scale, 'ELK must reserve the bottom title margin before its children');
      }
      await verifyNative(source, 'node:A', 'A[Alpha]', 'Alpha', [
        ['edge:e', 'e@-->|next|', 'edge'], ['edge:e', 'next', 'edge-label'],
        ['flowchart:subgraph:G', group], ['flowchart:subgraph:G', 'Group', 'control-label'],
        ['flowchart:subgraph:E', empty], ['flowchart:subgraph:E', 'Empty', 'control-label'],
        ['flowchart:title', 'Diagram 😀', 'control-label'],
      ], { start: source.indexOf('A['), end: source.indexOf('A[') + 1 }, ['node:A'], 'node:A', undefined, true);
    }
  } finally { await browser.close(); await producer.close(); }
});

test('FLOW AC5/6: every curve preserves saved/live self-loop and group-boundary selection', { timeout: 240_000 }, async () => {
  const curves = ['basis', 'bumpX', 'bumpY', 'cardinal', 'catmullRom', 'linear', 'monotoneX', 'monotoneY', 'natural', 'step', 'stepAfter', 'stepBefore', 'rounded'];
  for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const curve of curves) {
    const group = 'subgraph G[Group]\nA["Start 😀"] e@-->|inside| B[Middle]\nA s@--> A\nend';
    const source = `---\nconfig: {flowchart: {curve: ${curve}}}\n---\n${header}\n${group}\nB x@-->|outside| C[Finish]\nG g@-->|group| C\ne@{curve: ${curve}}\n`;
    const start = source.lastIndexOf(curve);
    await verifyNative(source, 'node:A', 'A["Start 😀"]', 'Start 😀', [
      ['edge:e', 'e@-->|inside|', 'edge'], ['edge:e', 'inside', 'edge-label'],
      ['edge:s', 's@-->', 'edge'],
      ['edge:x', 'x@-->|outside|', 'edge'], ['edge:x', 'outside', 'edge-label'],
      ['edge:g', 'g@-->|group|', 'edge'], ['edge:g', 'group', 'edge-label'],
      ['flowchart:subgraph:G', group],
    ], { start, end: start + curve.length }, ['edge:e'], 'edge:e');
  }
});

test('FLOW AC5/6: inherited directions and conflicting HTML options preserve saved/live ownership', { timeout: 240_000 }, async () => {
  for (const header of ['flowchart LR', 'flowchart-elk LR']) for (const external of [false, true]) for (const html of [
    { htmlLabels: true, flowchart: { htmlLabels: false } },
    { htmlLabels: false, flowchart: { htmlLabels: true } },
    { flowchart: { htmlLabels: true } },
    { htmlLabels: null, flowchart: { htmlLabels: true } },
    { htmlLabels: true, flowchart: { htmlLabels: null } },
  ]) {
    const group = 'subgraph G[Group 😀]\ndirection RL\ndirection TB\nA[Alpha] e@-->|next| B[Beta]\nend';
    const inherited = 'subgraph H[Inherited]\nC[Gamma] --> D[Delta]\nend';
    const config = { ...html, flowchart: { ...html.flowchart, inheritDir: true } };
    const source = `---\nconfig: ${JSON.stringify(config)}\n---\n${header}\nsubgraph Outer\ndirection BT\n${group}\n${inherited}\nend\n${external ? 'A --> X[Outside]\n' : ''}`;
    await verifyNative(source, 'node:A', 'A[Alpha]', 'Alpha', [
      ['edge:e', 'e@-->|next|', 'edge'], ['edge:e', 'next', 'edge-label'],
      ['flowchart:subgraph:G', group], ['flowchart:subgraph:G', 'Group 😀', 'control-label'],
      ['flowchart:subgraph:H', inherited], ['flowchart:subgraph:H', 'Inherited', 'control-label'],
    ], 'direction TB', ['flowchart:subgraph:G'], 'flowchart:subgraph:G');
  }
});

test('FLOW AC5/6: portable markers survive HTML base URLs and saved/live selection', { timeout: 240_000 }, async () => {
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    let html = '';
    await page.route('http://trace.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.route('https://elsewhere.invalid/**', route => route.abort());
    for (const layout of ['dagre', 'elk']) for (const look of ['classic', 'neo', 'handDrawn']) {
      for (const absolute of [false, true]) {
        const source = `---
config:
  layout: ${layout}
  look: ${look}
  handDrawnSeed: 42
  arrowMarkerAbsolute: ${absolute}
---
flowchart LR
A[Alpha 😀]
B[Beta]
A e@<-->|Go| B
B o--o C
C x--x D
`;
        const { svg } = await producer.render('marker-portability', source);
        let baseline: Buffer | undefined;
        for (const base of ['', 'http://trace.test/other/', 'https://elsewhere.invalid/']) {
          html = `<!doctype html><head>${base ? `<base href="${base}">` : ''}</head><body>${svg}</body>`;
          await page.goto('http://trace.test/document');
          const refs = await page.locator('[marker-start], [marker-end]').evaluateAll(elements =>
            elements.flatMap(element => ['marker-start', 'marker-end'].flatMap(name => {
              const value = element.getAttribute(name);
              if (!value) return [];
              const id = /^url\(#([^)]*)\)$/.exec(value)?.[1];
              return [{ value, exists: !!id && element.ownerDocument.getElementById(id)?.localName === 'marker' }];
            })));
          assert.equal(refs.length, 6, `${layout}/${look}: all three double-ended marker kinds`);
          assert.ok(refs.every(ref => ref.exists), 'every portable reference resolves inside the saved artifact');
          const screenshot = await page.locator('svg').screenshot();
          if (baseline) assert.deepEqual(screenshot, baseline, `${layout}/${look}/${absolute}/${base}: base must not change marker pixels`);
          else baseline = screenshot;
          for (const kind of ['point', 'circle', 'cross']) {
            const markerPaths = page.locator(`[marker-start*="-${kind}Start"]`);
            assert.equal(await markerPaths.count(), 1);
            const markers = await markerPaths.evaluate(element => {
              const values = [element.getAttribute('marker-start')!, element.getAttribute('marker-end')!];
              element.removeAttribute('marker-start'); element.removeAttribute('marker-end');
              return values;
            });
            assert.notDeepEqual(await page.locator('svg').screenshot(), baseline, `${kind}: comparison must include visible marker geometry`);
            // Only the edge under test has had its markers removed.
            await page.locator('[data-mt-role=edge]:not([marker-start])').evaluate((element, values) => {
              element.setAttribute('marker-start', values[0]!); element.setAttribute('marker-end', values[1]!);
            }, markers);
          }
        }
        if (look === 'classic') await verifyNative(source, 'node:A', 'A[Alpha 😀]', 'Alpha 😀', [
          ['edge:e', 'e@<-->|Go|', 'edge'], ['edge:e', 'Go', 'edge-label'],
        ], 'e@<-->|Go|', [], 'edge:e');
      }
    }
  } finally { await browser.close(); await producer.close(); }
});
