import assert from 'node:assert/strict';
import test from 'node:test';
import { launchBrowser, clipboardPermissions } from './browser.js';
import { withCssLayerPreview } from './css-layer-fixtures.js';
import { formatLocation } from '../src/markdown-source.js';

test('FLOW CSS layers: trusted host styles retain saved/live label selection', { timeout: 120_000 }, async () => {
  const browser = await launchBrowser();
  try { await withCssLayerPreview(async ({ url, artifacts, show }) => {
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    for (const artifact of artifacts) {
      for (const live of [false, true]) {
        const { sourceDocument, span } = show(artifact, live);
        await page.goto(url); await page.waitForSelector('body[data-ready=true]');
        await page.evaluate(() => document.fonts.ready);
        const label = page.locator('[data-mt-role=node-label]').first();
        assert.equal(await label.locator('text').evaluate(element => getComputedStyle(element).fontSize), artifact.expected, artifact.name);
        for (const gesture of ['pointer', 'Enter', 'Space']) {
          await page.evaluate(() => navigator.clipboard.writeText('cleared'));
          if (gesture === 'pointer') await label.click();
          else { await label.focus(); await label.press(gesture); }
          await page.waitForFunction(location => navigator.clipboard.readText().then(value => value === location), formatLocation(sourceDocument, span));
          if (live) assert.equal(await page.frameLocator('#source-frame').locator('#source').evaluate(element => element.ownerDocument.getSelection()!.toString()), 'Alpha WWWiii');
          else assert.deepEqual(await page.evaluate(() => (window as any).selected), span);
        }
        if (live) {
          await page.locator('h1').click();
          assert.equal(await label.getAttribute('data-mt-selected'), null);
          await page.frameLocator('#source-frame').locator('#source').evaluate((element, span) => {
            const range = element.ownerDocument.createRange(); range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
            const selection = element.ownerDocument.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
          }, { start: span.start, end: span.start + 1 });
          await page.waitForFunction(() => document.querySelector('[data-mt-role=node-label]')?.getAttribute('data-mt-selected') === 'true');
        } else {
          await page.evaluate(() => (window as any).handle.highlight([]));
          assert.equal(await label.getAttribute('data-mt-selected'), null);
          await page.evaluate(span => (window as any).handle.highlight([span]), span);
          assert.equal(await label.getAttribute('data-mt-selected'), 'true');
          assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected]').count(), 0);
          await page.evaluate(() => (window as any).handle.dispose());
          assert.equal(await page.locator('[tabindex], [data-mt-selected]').count(), 0);
        }
      }
    }
  }); } finally { await browser.close(); }
});
