import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { writeDemo } from '../scripts/demo.js';

test('ACT-AC5: real Markdown page maps in both directions and displays offline without scripts', async () => {
  await writeDemo();
  const server = await createServer({ root: 'dist', server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const address = server.httpServer!.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      requests.push(route.request().url());
      return route.request().url().startsWith(url + '/') ? route.continue() : route.abort();
    });
    await page.goto(url);
    await page.locator('body[data-ready="true"]').waitFor();
    assert.equal(await page.locator('#selection-location').inputValue(), '');
    assert.equal(await page.locator('#source-frame').count(), 1, 'Original Markdown has an independent native text selection');
    const source = page.frameLocator('#source-frame').locator('#source');
    const selectedSource = () => source.evaluate(element => element.ownerDocument.getSelection()!.toString());
    assert.equal(await page.locator('#source-highlight, textarea').count(), 0, 'no source overlay or textarea');
    assert.equal(await source.evaluate(element => element.childNodes.length === 1 && element.firstChild!.nodeType === Node.TEXT_NODE), true, 'source is one exact text node');
    assert.equal(await page.frameLocator('#source-frame').locator('script, mark').count(), 0);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    assert.equal(await page.locator('svg').count(), 2);
    await page.locator('svg').nth(1).locator('[data-mt-role="node-label"] text').first().click();
    const selection = await source.evaluate(element => {
      const selection = element.ownerDocument.getSelection()!;
      return { text: selection.toString(), start: selection.getRangeAt(0).startOffset, expected: element.textContent!.lastIndexOf('Draft') };
    });
    assert.equal(selection.text, 'Draft');

    assert.equal(await page.locator('[data-md-selected]').count(), 0, 'a diagram child does not also select its enclosing Markdown container');
    assert.equal(selection.start, selection.expected);
    assert.equal(await page.locator('svg').nth(1).locator('[data-mt-role="node-label"]').first().evaluate(element => element === document.activeElement), true, 'selection keeps focus in the diagram');
    assert.equal(await page.locator('#selection-location').inputValue(), 'interactive.md:18:10-18:15');
    await page.getByText('Location copied.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'interactive.md:18:10-18:15');
    assert.match(await page.locator('#selection-status').innerText(), /node-label/);
    assert.equal(await page.locator('#occurrences button').count(), 2);
    await page.locator('#occurrences button').last().click();
    assert.equal(await selectedSource(), 'A');
    assert.equal(await page.locator('#selection-location').inputValue(), 'interactive.md:20:7-20:8');
    await page.getByText('Location copied.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'interactive.md:20:7-20:8');
    await page.locator('svg').first().locator('[data-mt-role="edge-label"] text').first().click();
    await page.getByText('Location copied.', { exact: true }).waitFor();
    assert.equal(await selectedSource(), 'review');
    assert.equal(await page.locator('svg').first().locator('[data-mt-role="edge"][data-mt-selected]').count(), 0);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'interactive.md:7:18-7:24');
    for (const [index, text, location] of [[0, '-->|review|', 'interactive.md:7:14-7:25'], [1, '-->', 'interactive.md:8:5-8:8']] as const) {
      const previousClipboard = await page.evaluate(() => navigator.clipboard.readText());
      await page.locator('svg').first().locator('[data-mt-role="edge"]').nth(index).focus();
      assert.equal(await page.locator('#selection-location').inputValue(), location, 'focus updates the displayed selection');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), previousClipboard, 'focus alone does not copy');
      await page.keyboard.press('Enter');
      await page.getByText('Location copied.', { exact: true }).waitFor();
      assert.equal(await selectedSource(), text);
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), location);
    }
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#selection-location').inputValue(), 'interactive.md:9:5-9:8');
    assert.equal(await page.locator('svg').first().locator('[data-mt-role="edge"]').nth(2).evaluate(element => element === document.activeElement && element.hasAttribute('data-mt-selected')), true);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'interactive.md:8:5-8:8');
    await source.evaluate(element => {
      const start = element.textContent!.indexOf('Review');
      element.focus(); element.ownerDocument.getSelection()!.setBaseAndExtent(element.firstChild!, start, element.firstChild!, start + 6);
      element.dispatchEvent(new Event('pointerup'));
    });
    assert.ok(await page.locator('svg').nth(0).locator('[data-mt-selected]').count() > 0);
    assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected]').count(), 0);
    assert.equal(await page.locator('#selection-location').inputValue(), 'interactive.md:7:29-7:35');
    assert.equal(await selectedSource(), 'Review', 'source uses its real native selection');

    assert.equal(await page.locator('#copy-status').innerText(), '');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'interactive.md:8:5-8:8');
    // Focusing the SVG background selects the entire fenced Markdown block.
    await page.locator('svg').first().focus();
    assert.equal(await page.locator('#selection-location').inputValue(), 'interactive.md:5:1-11:1');
    await page.keyboard.press('Enter');
    await page.getByText('Location copied.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'interactive.md:5:1-11:1');
    const svgBox = await page.locator('svg').nth(1).boundingBox();
    assert.ok(svgBox);
    await page.mouse.click(svgBox.x + 2, svgBox.y + 2);
    assert.equal(await page.locator('#selection-location').inputValue(), 'interactive.md:16:1-22:1');
    assert.equal(await page.locator('svg').nth(1).evaluate(element => element === document.activeElement && element.hasAttribute('data-mt-selected')), true);
    await page.getByText('Location copied.', { exact: true }).waitFor();
    for (const [selector, expected, location] of [
      ['article h1', '# A small publishing workflow', 'interactive.md:1:1-1:30'],
      ['article h2', '## Inside a list and a quote', 'interactive.md:12:1-12:29'],
    ] as const) {
      const heading = page.locator(selector).first();
      await heading.click();
      assert.equal(await selectedSource(), expected);
      assert.equal(await heading.evaluate(element => element === document.activeElement && element.hasAttribute('data-md-selected')), true);
      assert.equal(await page.locator('[data-mt-selected]').count(), 0, 'heading selection must clear diagram highlights');
      assert.equal(await page.locator('[data-md-selected]').count(), 1);
      await page.getByText('Location copied.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), location);
    }
    await page.locator('article p').first().focus();
    assert.equal(await selectedSource(), 'The same diagram appears twice. Each one points to its own fence in this document.');
    // A real drag across a rendered word maps only those characters, not its paragraph.
    const bold = page.locator('article strong');
    await bold.scrollIntoViewIfNeeded();
    const word = await bold.evaluate(element => {
      const node = element.querySelector('[data-md-text]')!.firstChild!;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 4);
      const box = range.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    await page.mouse.move(word.x + .5, word.y + word.height / 2);
    await page.mouse.down();
    await page.mouse.move(word.x + word.width - .5, word.y + word.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.equal(await selectedSource(), 'bold');
    assert.equal(await page.evaluate(() => document.getSelection()!.toString()), 'bold', 'rendered text keeps its independent native range');
    await page.getByText('Location copied.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.locator('#selection-location').inputValue());
    assert.equal(await page.locator('[data-md-selected]').count(), 0, 'a text drag retains its native highlight without selecting the whole paragraph');
    await page.locator('article h2').last().focus();
    await page.keyboard.up('Tab');
    assert.equal(await page.evaluate(() => document.getSelection()!.isCollapsed), true, 'structural focus clears a previous native text selection');
    assert.equal(await selectedSource(), '## Inline text selection');
    assert.equal(await source.evaluate(element => {
      const range = element.ownerDocument.getSelection()!.getRangeAt(0);
      const box = range.getClientRects()[0]!;
      const viewport = element.getBoundingClientRect();
      return box.top >= viewport.top && box.bottom <= viewport.bottom;
    }), true, 'native source range is revealed without transferring focus');
    await source.evaluate(element => { element.scrollTop = 60; element.scrollLeft = 40; });
    assert.equal(await selectedSource(), '## Inline text selection', 'scrolling preserves the native selection');
    await page.locator('.source-editor').evaluate((element: HTMLElement) => { element.style.height = '300px'; });
    assert.equal(await selectedSource(), '## Inline text selection', 'resizing preserves the native selection');

    // Drag real source text: native selection drives reverse mapping without copying a location.
    const clipboardBeforeSourceDrag = await page.evaluate(() => navigator.clipboard.readText());
    await source.evaluate(element => { element.ownerDocument.getSelection()!.removeAllRanges(); element.focus({ preventScroll: true }); element.scrollTop = 0; element.scrollLeft = 0; });
    const frameBox = await page.locator('#source-frame').boundingBox();
    assert.ok(frameBox);
    const sourceWord = await source.evaluate(element => {
      const range = element.ownerDocument.createRange();
      range.setStart(element.firstChild!, 4); range.setEnd(element.firstChild!, 9);
      const box = range.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    await page.mouse.move(frameBox.x + sourceWord.x + .5, frameBox.y + sourceWord.y + sourceWord.height / 2);
    await page.mouse.down();
    await page.mouse.move(frameBox.x + sourceWord.x + sourceWord.width - .5, frameBox.y + sourceWord.y + sourceWord.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.equal(await selectedSource(), 'small');
    assert.equal(await page.locator('#selection-location').inputValue(), 'interactive.md:1:5-1:10');
    assert.equal(await page.locator('article [data-md-selected]').textContent(), 'A small publishing workflow');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), clipboardBeforeSourceDrag);
    await page.keyboard.press('ControlOrMeta+c');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'small', 'normal Copy uses the actual source text selection');

    // A native range spanning formatting maps the original delimiters and entity spelling.
    await page.locator('article strong').evaluate(element => {
      const first = element.querySelector('[data-md-text]')!.firstChild!;
      const paragraph = element.closest('p')!;
      const last = [...paragraph.querySelectorAll('[data-md-text]')].find(span => span.textContent!.includes('entity: &'))!.firstChild!;
      const range = document.createRange(); range.setStart(first, 2); range.setEnd(last, last.textContent!.indexOf('&') + 1);
      const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      paragraph.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    assert.equal(await selectedSource(), 'ld text**, *emphasis*, `inline code`, an escaped \\*star\\*, or an entity: &amp;');
    // Multiple blocks enclose the entire intervening diagram, including its fences.
    await page.locator('article').evaluate(article => {
      const first = article.querySelector('p [data-md-text]')!.firstChild!;
      const last = article.querySelector('h2 [data-md-text]')!.firstChild!;
      const range = document.createRange(); range.setStart(first, 4); range.setEnd(last, 6);
      const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      article.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    const across = await selectedSource();
    assert.ok(across.startsWith('same diagram'));
    assert.ok(across.includes('```mermaid'));
    assert.ok(across.endsWith('## Inside'));
    assert.equal(await page.locator('svg').first().getAttribute('data-mt-selected'), 'true');
    // Reverse selection in plain source also chooses its rendered Markdown block.
    await source.evaluate(element => {
      const start = element.textContent!.indexOf('Ordinary code');
      element.focus(); element.ownerDocument.getSelection()!.setBaseAndExtent(element.firstChild!, start, element.firstChild!, start + 8);
      element.dispatchEvent(new Event('pointerup'));
    });
    assert.equal(await page.locator('article [data-md-selected]').innerText(), 'Ordinary code remains ordinary code:');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Denied'); } } });
    });
    await page.locator('svg').nth(1).locator('[data-mt-role="node-label"] text').first().click();
    await page.getByText('Could not copy. Select the location and copy it manually.', { exact: true }).waitFor();
    assert.equal(await page.locator('#selection-location').inputValue(), 'interactive.md:18:10-18:15');
    // A page retained by browser history must keep its live diagram handlers.
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.locator('svg').nth(1).locator('[data-mt-role="node-label"] text').first().click();
    assert.equal(await selectedSource(), 'Draft');
    assert.equal(await page.evaluate(() => 'mermaid' in window), false);
    assert.ok(!requests.some(request => /mermaid\.min|markdown-it|mdast|hast|flowchart-source/.test(request)));
    assert.ok(requests.every(request => request.startsWith(url + '/')));
    assert.deepEqual(errors, []);

    const staticContext = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await staticContext.newPage();
    await staticPage.goto(url);
    assert.equal(await staticPage.locator('svg').count(), 2);
    assert.equal(await staticPage.locator('svg script, svg [onload], svg animate').count(), 0);
    assert.ok((await staticPage.frameLocator('#source-frame').locator('#source').textContent())!.includes('```mermaid'));
    for (const svg of await staticPage.locator('svg').all()) {
      const box = await svg.boundingBox();
      assert.ok(box && box.width > 100 && box.height > 30);
    }
    await staticContext.close();
  } finally {
    await browser.close();
    await server.close();
  }
});
