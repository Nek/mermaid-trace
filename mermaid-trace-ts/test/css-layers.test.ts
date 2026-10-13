import assert from 'node:assert/strict';
import test from 'node:test';
import { launchBrowser, clipboardPermissions } from './browser.js';
import { withCssLayerPreview, styledCharacters } from './css-layer-fixtures.js';
import { formatLocation } from '../src/markdown-source.js';

test('FLOW CSS layers: trusted host styles retain saved/live label selection', { timeout: 240_000 }, async () => {
  const browser = await launchBrowser();
  try { await withCssLayerPreview(async ({ url, artifacts, show }) => {
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    for (const artifact of artifacts) {
      for (const live of [false, true]) {
        const { sourceDocument, span } = show(artifact, live);
        await page.goto(url); await page.waitForSelector('body[data-ready=true]');
        await page.evaluate(() => document.fonts.ready);
        const label = page.locator(`[data-mt-role="${artifact.role}"]`).first();
        if (artifact.runs) {
          const runs = await label.locator('tspan').evaluateAll(elements => elements.map(element => {
            const style = getComputedStyle(element);
            return [element.textContent!, style.fontSize, style.fontWeight, style.fontStyle];
          }));
          assert.deepEqual(styledCharacters(runs), styledCharacters(artifact.runs), artifact.name);
        } else assert.equal(await label.evaluate(element => getComputedStyle(element.matches('text,tspan') ? element : element.querySelector('text')!).fontSize), artifact.expected, artifact.name);
        if (artifact.role === 'node-label') assert.ok(await label.evaluate(element => {
          const owner = element.closest('svg')!.querySelector('[data-mt-key="node:A"][data-mt-role=node]')!;
          const shape = owner.querySelector(':scope > rect, :scope > g.basic.label-container, :scope > g > path')!.getBoundingClientRect();
          return [...element.querySelectorAll('text')].every(row => {
            const text = row.getBoundingClientRect();
            return text.left >= shape.left - 3 && text.right <= shape.right + 3
              && text.top >= shape.top - 3 && text.bottom <= shape.bottom + 3;
          });
        }), `${artifact.name}: CSS-sized text must fit its allocated node`);
        if (artifact.name.startsWith('variables-')) {
          const sizes = await label.evaluate(element => {
            const text = (element.matches('text,tspan') ? element : element.querySelector('text')!) as SVGElement;
            const previousStyle = text.style.cssText;
            const before = text.getBoundingClientRect().width;
            text.style.setProperty('font-size', '48px', 'important');
            const after = text.getBoundingClientRect().width;
            text.style.cssText = previousStyle;
            return { before, after };
          });
          assert.ok(sizes.after > sizes.before * 1.4, 'embedded fonts preserve deliberate CSS size edits');
        }
        for (const gesture of ['pointer', 'Enter', 'Space']) {
          await page.evaluate(() => navigator.clipboard.writeText('cleared'));
          if (gesture === 'pointer') await label.click();
          else { await label.focus(); await label.press(gesture); }
          await page.waitForFunction(location => navigator.clipboard.readText().then(value => value === location), formatLocation(sourceDocument, span));
          if (live) assert.equal(await page.frameLocator('#source-frame').locator('#source').evaluate(element => element.ownerDocument.getSelection()!.toString()), artifact.label);
          else assert.deepEqual(await page.evaluate(() => (window as any).selected), span);
        }
        if (live) {
          await page.locator('h1').click();
          assert.equal(await label.getAttribute('data-mt-selected'), null);
          await page.frameLocator('#source-frame').locator('#source').evaluate((element, span) => {
            const range = element.ownerDocument.createRange(); range.setStart(element.firstChild!, span.start); range.setEnd(element.firstChild!, span.end);
            const selection = element.ownerDocument.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
          }, { start: span.start, end: span.start + 1 });
          await page.waitForFunction(role => document.querySelector(`[data-mt-role="${role}"]`)?.getAttribute('data-mt-selected') === 'true', artifact.role);
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
