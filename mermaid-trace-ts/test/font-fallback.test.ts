import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser, clipboardPermissions } from './browser.js';
import { createMermanProducer } from '../src/producer/merman.js';
import { watchPreview } from '../src/watch.js';
import { formatLocation } from '../src/markdown-source.js';

test('FONT-PORTABLE/MISSING: replacement labels retain saved/live ownership and Chromium verifies font independence', { timeout: 120_000 }, async () => {
  const label = 'Before e\u0301 😀 漢 العربية \u{10ffff} and \u{10fffe} after';
  const sources = [
    `flowchart LR\nA["${label}"]`, `flowchart-elk LR\nA["${label}"]`,
    `sequenceDiagram\nA->>B: ${label}`,
    `gantt\ndateFormat YYYY-MM-DD\n${label} :a, 2026-10-01, 2d`,
    `journey\nsection Work\n${label}: 5: Alice`,
    `kanban\n  todo[Todo]\n    task[${label}]`,
    `stateDiagram-v2\nstate "${label}" as A`,
  ];
  if (process.platform === 'darwin') sources.push(...sources.map(source => `---\nconfig: {fontFamily: Apple Color Emoji}\n---\n${source}`));
  const directory = await mkdtemp(join(tmpdir(), 'trace-font-selection-'));
  const filename = join(directory, 'missing.md');
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const location = 'data:text/javascript;base64,' + (await readFile('dist/src/markdown-source.js')).toString('base64');
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    // Only Chromium exposes local-font disabling and actual painted-font inspection.
    const cdp = browser.browserType().name() === 'chromium' ? await context.newCDPSession(page) : undefined;
    await cdp?.send('DOM.enable'); await cdp?.send('CSS.enable');
    const requests: string[] = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.route('http://localhost/saved', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
    for (const source of sources) {
      const { svg, diagnostics } = await producer.render('missing', source);
      assert.equal(diagnostics?.some(d => d.code === 'font-fallback'), source.includes('Apple Color Emoji'));
      // The parser's editable label excludes Gantt's trailing metadata separator space.
      const authored = label;
      const span = { start: source.indexOf(label), end: source.indexOf(label) + authored.length };
      await page.goto('http://localhost/saved');
      requests.length = 0;
      await cdp?.send('CSS.setLocalFontsEnabled', { enabled: true });
      await page.setContent(svg); await page.evaluate(() => document.fonts.ready);
      if (cdp) {
        const before = await page.locator('svg').screenshot();
        await cdp.send('CSS.setLocalFontsEnabled', { enabled: false });
        await page.setContent(svg); await page.evaluate(() => document.fonts.ready);
        const { root } = await cdp.send('DOM.getDocument');
        const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'svg text, svg tspan' });
        let painted = 0;
        for (const nodeId of nodeIds) {
          const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
          for (const font of fonts) {
            if (!font.glyphCount) continue;
            painted += font.glyphCount;
            assert.ok(font.isCustomFont, `viewer font leaked into ${source}: ${font.familyName}`);
          }
        }
        assert.ok(painted > 0, 'portability must not pass with absent labels');
        assert.deepEqual(await page.locator('svg').screenshot(), before, 'disabling local fonts must preserve saved SVG pixels');
      }
      assert.deepEqual(requests, [], 'saved SVG must load without external resources');
      await page.evaluate(async ({ activation, location, source, filename }) => {
        const { activateSvg } = await import(activation);
        const { formatLocation } = await import(location);
        const handle = activateSvg(document.querySelector('svg')!, { onSelect(event: any) {
          Object.assign(window, { selected: event.span });
          if (event.trigger !== 'focus') void navigator.clipboard.writeText(formatLocation({ id: filename, source }, event.span));
        } });
        Object.assign(window, { handle });
      }, { activation, location, source, filename });
      const selector = `[data-mt-start="${span.start}"][data-mt-end="${span.end}"]`;
      const target = page.locator(selector).last();
      assert.equal((await target.textContent())!.match(/\ufffd/g)?.length, 2);
      assert.doesNotMatch((await target.textContent())!, /[\u{10ffff}\u{10fffe}]/u);
      await target.click();
      assert.deepEqual(await page.evaluate(() => (window as any).selected), span);
      for (const key of ['Enter', 'Space']) {
        await target.focus(); await target.press(key);
        await page.waitForFunction(expected => navigator.clipboard.readText().then(value => value === expected), formatLocation({ id: filename, source }, span));
      }
      await page.evaluate(start => (window as any).handle.highlight([{ start, end: start + 2 }]), source.indexOf('\u{10ffff}'));
      assert.equal(await target.getAttribute('data-mt-selected'), 'true');
      assert.equal(await page.locator('svg').getAttribute('data-mt-selected'), null);
      await page.evaluate(() => (window as any).handle.dispose());
      assert.equal(await page.locator('[data-mt-selected]').count(), 0);
      const markdown = '# Missing glyphs\n\n```mermaid\n' + source + '\n```\n';
      await writeFile(filename, markdown);
      preview = await watchPreview(filename, { port: 0, sourceView: true });
      await page.goto(preview.url); await page.waitForSelector('body[data-ready=true]');
      const live = page.locator(selector).last();
      assert.equal((await live.textContent())!.match(/\ufffd/g)?.length, 2);
      assert.doesNotMatch((await live.textContent())!, /[\u{10ffff}\u{10fffe}]/u);
      const original = page.frameLocator('#source-frame').locator('#source');
      const offset = markdown.indexOf(source);
      for (const gesture of ['click', 'Enter', 'Space']) {
        if (gesture === 'click') await live.click();
        else { await live.focus(); await live.press(gesture); }
        assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), authored);
        await page.waitForFunction(expected => navigator.clipboard.readText().then(value => value === expected), formatLocation({ id: filename, source: markdown }, { start: offset + span.start, end: offset + span.end }));
      }
      await original.evaluate((element, start) => {
        const range = element.ownerDocument.createRange();
        range.setStart(element.firstChild!, start); range.setEnd(element.firstChild!, start + 2);
        const selection = element.ownerDocument.getSelection()!;
        selection.removeAllRanges(); selection.addRange(range);
      }, markdown.indexOf('\u{10ffff}'));
      await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('data-mt-selected') === 'true', selector);
      assert.equal(await page.locator('svg').getAttribute('data-mt-selected'), null);
      await preview.close(); preview = undefined;
    }
  } finally { await preview?.close(); await browser.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
});

test('FONT-PORTABLE/SHAPING: combining clusters and joined emoji fit measured node geometry', { timeout: 120_000 }, async t => {
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    for (const [label, fontFamily] of [['A\u20dd A 😀', 'Arial'], ['🧑\u200d💻 123 ABC', 'Arial'], ['🧑\u200d💻 123 ABC', 'Apple Color Emoji']]) {
      for (const layout of ['dagre', 'elk']) {
        await t.test(`${layout}/${fontFamily}/${label}`, async () => {
          const text = Array(12).fill(label).join(' ');
          const source = `---\nconfig: ${JSON.stringify({ layout, htmlLabels: false, markdownAutoWrap: false, fontFamily })}\n---\nflowchart LR\nA["\`${text}\`"]`;
          const { svg } = await producer.render('shaping', source);
          await page.setContent(svg);
          await page.evaluate(() => document.fonts.ready);
          const geometry = await page.evaluate(() => {
            const bounds = (element: Element) => {
              const rect = element.getBoundingClientRect();
              return { left: rect.left, right: rect.right };
            };
            const owner = document.querySelector('[data-mt-key="node:A"][data-mt-role="node"]')!;
            const shape = owner.querySelector(':scope > rect')!;
            const label = document.querySelector('[data-mt-key="node:A"][data-mt-role="node-label"]')!;
            return { shape: bounds(shape), label: bounds(label), scale: document.querySelector('svg')!.getScreenCTM()!.a, text: label.textContent };
          });
          assert.equal(geometry.text, text, 'retain all source characters');
          assert.ok(geometry.label.left >= geometry.shape.left - 3 * geometry.scale && geometry.label.right <= geometry.shape.right + 3 * geometry.scale,
            `portable shaped text must fit the native measured node: ${JSON.stringify(geometry)}`);
        });
      }
    }
  } finally { await browser.close(); await producer.close(); }
});

test('FONT-PORTABLE/CSS: mixed-font labels preserve structural selectors and size edits', async () => {
  const producer = await createMermanProducer();
  const browser = await launchBrowser();
  try {
    const source = '---\nconfig:\n  fontFamily: Arial\n---\nstateDiagram-v2\nstate "Alpha 😀 中文" as A';
    const { svg } = await producer.render('font-css', source);
    const page = await browser.newPage();
    await page.setContent(svg); await page.evaluate(() => document.fonts.ready);
    const label = page.locator('.text-inner-tspan').filter({ hasText: 'Alpha 😀 中文' });
    const before = await label.evaluate(el => ({ fill: getComputedStyle(el).fill, text: el.textContent }));
    assert.equal(await label.locator(':scope > *').count(), 0, 'font transport must preserve the original text-only owner');
    await page.addStyleTag({ content: '.text-inner-tspan:has(> tspan){fill:red!important}.text-inner-tspan{font-size:22px!important}' });
    assert.deepEqual(await label.evaluate(el => ({ fill: getComputedStyle(el).fill, text: el.textContent })), before);
    assert.equal(await label.evaluate(el => getComputedStyle(el).fontSize), '22px');
    const width = await label.evaluate(el => (el as SVGTextContentElement).getComputedTextLength());
    await page.addStyleTag({ content: '.text-inner-tspan{font-size:11px!important}' });
    assert.ok(Math.abs(width / 2 - await label.evaluate(el => (el as SVGTextContentElement).getComputedTextLength())) < 0.1,
      'mixed-font text must still scale with authored CSS size');
  } finally { await browser.close(); await producer.close(); }
});
