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
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    assert.equal(await page.locator('svg').count(), 2);
    await page.locator('svg').nth(1).locator('[data-mt-role="node-label"] text').first().click();
    const selection = await page.locator('textarea').evaluate((input: HTMLTextAreaElement) => ({
      text: input.value.slice(input.selectionStart, input.selectionEnd), start: input.selectionStart,
      expected: input.value.lastIndexOf('Draft'),
    }));
    assert.equal(selection.text, 'Draft');
    assert.equal(selection.start, selection.expected);
    assert.equal(await page.locator('svg').nth(1).locator('[data-mt-role="node-label"]').first().evaluate(element => element === document.activeElement), true, 'selection keeps focus in the diagram');
    assert.equal(await page.locator('#selection-location').inputValue(), 'interactive.md:18:10-18:15');
    await page.getByText('Location copied.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'interactive.md:18:10-18:15');
    assert.match(await page.locator('#selection-status').innerText(), /node-label/);
    assert.equal(await page.locator('#occurrences button').count(), 2);
    await page.locator('#occurrences button').last().click();
    assert.equal(await page.locator('textarea').evaluate((input: HTMLTextAreaElement) => input.value.slice(input.selectionStart, input.selectionEnd)), 'A');
    assert.equal(await page.locator('#selection-location').inputValue(), 'interactive.md:20:7-20:8');
    await page.getByText('Location copied.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'interactive.md:20:7-20:8');
    await page.locator('svg').first().locator('[data-mt-role="edge-label"] text').first().click();
    await page.getByText('Location copied.', { exact: true }).waitFor();
    assert.equal(await page.locator('textarea').evaluate((input: HTMLTextAreaElement) => input.value.slice(input.selectionStart, input.selectionEnd)), 'review');
    assert.equal(await page.locator('svg').first().locator('[data-mt-role="edge"][data-mt-selected]').count(), 0);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'interactive.md:7:18-7:24');
    for (const [index, text, location] of [[0, '-->|review|', 'interactive.md:7:14-7:25'], [1, '-->', 'interactive.md:8:5-8:8']] as const) {
      const previousClipboard = await page.evaluate(() => navigator.clipboard.readText());
      await page.locator('svg').first().locator('[data-mt-role="edge"]').nth(index).focus();
      assert.equal(await page.locator('#selection-location').inputValue(), location, 'focus updates the displayed selection');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), previousClipboard, 'focus alone does not copy');
      await page.keyboard.press('Enter');
      await page.getByText('Location copied.', { exact: true }).waitFor();
      assert.equal(await page.locator('textarea').evaluate((input: HTMLTextAreaElement) => input.value.slice(input.selectionStart, input.selectionEnd)), text);
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), location);
    }
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#selection-location').inputValue(), 'interactive.md:9:5-9:8');
    assert.equal(await page.locator('svg').first().locator('[data-mt-role="edge"]').nth(2).evaluate(element => element === document.activeElement && element.hasAttribute('data-mt-selected')), true);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'interactive.md:8:5-8:8');
    await page.locator('textarea').evaluate((input: HTMLTextAreaElement) => {
      const start = input.value.indexOf('Review');
      input.focus(); input.setSelectionRange(start, start + 6);
      input.dispatchEvent(new Event('select'));
    });
    assert.ok(await page.locator('svg').nth(0).locator('[data-mt-selected]').count() > 0);
    assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected]').count(), 0);
    assert.equal(await page.locator('#selection-location').inputValue(), 'interactive.md:7:29-7:35');
    assert.equal(await page.locator('#copy-status').innerText(), '');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'interactive.md:8:5-8:8');
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
    assert.equal(await page.locator('textarea').evaluate((input: HTMLTextAreaElement) => input.value.slice(input.selectionStart, input.selectionEnd)), 'Draft');
    assert.equal(await page.evaluate(() => 'mermaid' in window), false);
    assert.ok(!requests.some(request => /mermaid\.min|markdown-it|flowchart-source/.test(request)));
    assert.ok(requests.every(request => request.startsWith(url + '/')));
    assert.deepEqual(errors, []);

    const staticContext = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await staticContext.newPage();
    await staticPage.goto(url);
    assert.equal(await staticPage.locator('svg').count(), 2);
    assert.equal(await staticPage.locator('svg script, svg [onload], svg animate').count(), 0);
    assert.ok((await staticPage.locator('textarea').inputValue()).includes('```mermaid'));
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
