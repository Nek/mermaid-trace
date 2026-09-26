import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';

test('ACT-AC1/2/3/4: saved SVG gestures, isolation, reverse lookup, validation and lifecycle without renderer', async () => {
  const svg = await readFile('docs/examples/repeated-labels.svg', 'utf8');
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8'))
    .replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>${svg}${svg}</main>`);
    await page.evaluate(async ({ activation }) => {
      const { activateSvg } = await import(activation);
      const roots = [...document.querySelectorAll('svg')] as SVGSVGElement[];
      // Host state must survive activation; markup and original SVG remain intact.
      roots[0]!.querySelector('[data-mt-role="node"]')!.setAttribute('tabindex', '7');
      const originals = roots.map(root => root.outerHTML);
      const events: unknown[][] = [[], []];
      const handles = roots.map((root, i) => activateSvg(root, { onSelect: (event: unknown) => events[i]!.push(event) }));
      Object.assign(window, { roots, originals, events, handles, activateSvg });
    }, { activation });
    const first = page.locator('svg').nth(0);
    await first.locator('[data-mt-role="node-label"] text').first().click();
    const result = await page.evaluate(() => {
      const w = window as any;
      const e = w.events[0][0];
      const mapping = JSON.parse(decodeURIComponent(w.roots[0].getAttribute('data-mt-map')));
      const matched = w.handles[0].highlight([e.span]);
      return { role: e.role, text: mapping.source.slice(e.span.start, e.span.end), count: matched.length,
        otherEvents: w.events[1].length, otherSelected: w.roots[1].querySelectorAll('[data-mt-selected]').length,
        hasMermaid: 'mermaid' in window };
    });
    assert.equal(result.role, 'node-label');
    assert.equal(result.text, 'Café');
    assert.ok(result.count >= 1);
    assert.equal(result.otherEvents, 0);
    assert.equal(result.otherSelected, 0);
    assert.equal(result.hasMermaid, false);
    await first.locator('[data-mt-role="edge-label"]').first().focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    const outcomes = await page.evaluate(() => {
      const w = window as any;
      const [root] = w.roots;
      const [handle] = w.handles;
      const failures: boolean[] = [];
      const fails = (f: () => unknown) => { try { f(); failures.push(false); } catch { failures.push(true); } };
      fails(() => w.activateSvg(root, { onSelect() {} }));
      fails(() => handle.highlight([{ start: -1, end: 1 }]));
      fails(() => handle.select('unknown'));
      const mapping = JSON.parse(decodeURIComponent(root.getAttribute('data-mt-map')));
      const repeated = mapping.pieces.find((p: any, i: number) => p.kind === 'node' && mapping.pieces.some((q: any, j: number) => j < i && q.semanticId === p.semanticId && q.kind === p.kind));
      handle.select(repeated.id);
      const selected = w.events[0].at(-1);
      const keyboardRoles = w.events[0].slice(1, 3).map((e: any) => e.role);
      const link = document.createElementNS('http://www.w3.org/2000/svg', 'a');
      link.setAttribute('href', '#unwanted-navigation');
      const edge = root.querySelector('[data-mt-role="edge"]');
      edge.replaceWith(link); link.append(edge);
      const canceledNavigation = !edge.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      link.replaceWith(edge);
      const edgeSelection = w.events[0].at(-1);
      const caretMatches = handle.highlight([{ start: repeated.span.start, end: repeated.span.start }]);
      const endMatches = handle.highlight([{ start: mapping.source.length, end: mapping.source.length }]);
      handle.dispose(); handle.dispose();
      const restored = root.outerHTML === w.originals[0];
      fails(() => handle.select(repeated.id));
      fails(() => handle.highlight([]));
      const before = w.events[0].length;
      root.querySelector('[data-mt-role="node"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const after = w.events[0].length;
      const next = w.activateSvg(root, { onSelect: (e: unknown) => w.events[0].push(e) });
      root.querySelector('[data-mt-role="node"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      root.setAttribute('role', 'presentation'); // A later host edit is not ours to undo.
      next.dispose();
      const retainedHostRole = root.getAttribute('role');
      root.outerHTML = w.originals[0];
      const clean = document.querySelector('svg')!;
      const original = clean.outerHTML;
      fails(() => w.activateSvg(clean, { source: 'stale', onSelect() {} }));
      const staleUnchanged = clean.outerHTML === original;
      clean.removeAttribute('data-mt-map');
      const bad = clean.outerHTML;
      fails(() => w.activateSvg(clean, { onSelect() {} }));
      return { failures, keyboardRoles, selected, repeated, restored, before, after, canceledNavigation,
        edgeRole: edgeSelection.role, caretIds: caretMatches.map((p: any) => p.id), endMatches,
        countAfterReattach: w.events[0].length, retainedHostRole, staleUnchanged, badUnchanged: bad === clean.outerHTML };
    });
    assert.deepEqual(outcomes.keyboardRoles, ['edge-label', 'edge-label']);
    assert.deepEqual(outcomes.selected.span, outcomes.repeated.span);
    assert.equal(outcomes.selected.pieces[0].id, outcomes.repeated.id);
    assert.equal(outcomes.canceledNavigation, true);
    assert.equal(outcomes.edgeRole, 'edge');
    assert.ok(outcomes.caretIds.includes(outcomes.repeated.id));
    assert.deepEqual(outcomes.endMatches, []);
    assert.ok(outcomes.failures.every(Boolean));
    assert.equal(outcomes.restored, true);
    assert.equal(outcomes.before, outcomes.after);
    assert.equal(outcomes.countAfterReattach, outcomes.after + 1);
    assert.equal(outcomes.retainedHostRole, 'presentation');
    assert.ok(outcomes.staleUnchanged && outcomes.badUnchanged);
  } finally { await browser.close(); }
});
