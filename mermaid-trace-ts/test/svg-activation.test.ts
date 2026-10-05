import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { launchBrowser, clipboardPermissions } from './browser.js';

test('ACT-AC1/2/3/4: saved SVG gestures, isolation, reverse lookup, validation and lifecycle without renderer', async () => {
  const svg = await readFile('../docs/examples/repeated-labels.svg', 'utf8');
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8'))
    .replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
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
      const handles = roots.map((root, i) => activateSvg(root, { onSelect: (event: { trigger?: string }) => {
        if (event.trigger !== 'focus') events[i]!.push(event);
      } }));
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
        selectedRoles: [...w.roots[0].querySelectorAll('[data-mt-selected]')].map((e: any) => e.getAttribute('data-mt-role')),
        otherEvents: w.events[1].length, otherSelected: w.roots[1].querySelectorAll('[data-mt-selected]').length,
        hasMermaid: 'mermaid' in window };
    });
    assert.equal(result.role, 'node-label');
    assert.equal(result.text, 'Café');
    assert.ok(result.count >= 1);
    assert.equal(result.otherEvents, 0);
    assert.equal(result.otherSelected, 0);
    assert.equal(result.hasMermaid, false);
    assert.deepEqual(result.selectedRoles, ['node-label']);
    const selectedLabel = first.locator('[data-mt-role="node-label"][data-mt-selected=true]');
    assert.match(await selectedLabel.evaluate(element => getComputedStyle(element).filter), /drop-shadow/, 'saved SVG activation supplies its own visible selection cue');
    assert.equal(await selectedLabel.evaluate(element => getComputedStyle(element).outlineStyle), 'none', 'focus uses the selection cue');
    assert.equal(await page.locator('svg').nth(1).locator('[data-mt-role="node-label"]').first().evaluate(element => getComputedStyle(element).filter), 'none', 'default selection style stays within its SVG');
    await first.locator('[data-mt-role="edge-label"]').first().focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    assert.equal(await first.locator('[data-mt-role="edge"][data-mt-selected]').count(), 0);
    assert.equal(await first.locator('[data-mt-role="edge-label"][data-mt-selected]').count(), 1);
    for (const labeled of [false, true]) {
      const point = await first.evaluate((root, labeled) => {
        const mapping = JSON.parse(decodeURIComponent(root.getAttribute('data-mt-map')!));
        const piece = mapping.pieces.find((p: any) => p.kind === 'edge' && Boolean(p.labelSpan) === labeled);
        const path = [...root.querySelectorAll<SVGPathElement>('[data-mt-role="edge"]')].find(p => p.getAttribute('data-mt-refs') === piece.id)!;
        const length = path.getTotalLength();
        const p = path.getPointAtLength(length * .2);
        const q = path.getPointAtLength(length * .2 + 1);
        const screen = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!);
        const next = new DOMPoint(q.x, q.y).matrixTransform(path.getScreenCTM()!);
        const dx = next.x - screen.x, dy = next.y - screen.y;
        return { x: screen.x - 4 * dy / Math.hypot(dx, dy), y: screen.y + 4 * dx / Math.hypot(dx, dy),
          span: piece.span, text: mapping.source.slice(piece.span.start, piece.span.end) };
      }, labeled);
      const count = await page.evaluate(() => (window as any).events[0].length);
      await page.mouse.click(point.x, point.y);
      const event = await page.evaluate(() => (window as any).events[0].at(-1));
      assert.equal(await page.evaluate(() => (window as any).events[0].length), count + 1, 'wide connector target receives real mouse click');
      assert.equal(event.role, 'edge');
      assert.deepEqual(event.span, point.span);
      assert.equal(point.text, labeled ? '-->|same|' : '-->');
      assert.equal(await first.locator('[data-mt-role="edge"][data-mt-selected]').count(), 1);
    }
    // Focus is selection; dragging SVG text must not create another selection.
    const labelBox = await first.locator('[data-mt-role="node-label"] text').first().boundingBox();
    assert.ok(labelBox);
    await first.locator('[data-mt-role="edge"]').first().focus();
    await page.mouse.move(labelBox.x + 2, labelBox.y + labelBox.height / 2);
    await page.mouse.down();
    assert.equal(await first.evaluate(root => root.contains(document.activeElement) && document.activeElement!.hasAttribute('data-mt-selected')), true, 'focused diagram target is selected');
    await page.mouse.move(labelBox.x + labelBox.width - 2, labelBox.y + labelBox.height / 2, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.getSelection()!.toString()), '', 'diagram text must not become a second native selection');
    await first.locator('[data-mt-role="edge"]').first().focus();
    const beforeTab = await page.evaluate(() => (window as any).events[0].length);
    await page.keyboard.press('Tab');
    assert.equal(await first.locator('[data-mt-role="edge"]').nth(1).evaluate(element => element === document.activeElement && element.matches(':focus-visible') && element.hasAttribute('data-mt-selected')), true, 'Tab focus is the actual selection');
    assert.equal(await page.evaluate(() => (window as any).events[0].length), beforeTab, 'focus is distinct from clipboard activation');
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
      const next = w.activateSvg(root, { onSelect: (e: { trigger?: string }) => { if (e.trigger !== 'focus') w.events[0].push(e); } });
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

test('ACT-VISIBILITY-TRANSITIONS: a hidden saved connector becomes selectable when painted', async () => {
  const svg = await readFile('../docs/examples/repeated-labels.svg', 'utf8');
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8'))
    .replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>.hidden-edge{display:none}</style>${svg}`);
    await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      const root = document.querySelector('svg')!;
      const edge = root.querySelector<SVGPathElement>('[data-mt-role="edge"]')!;
      edge.classList.add('hidden-edge');
      const original = root.outerHTML;
      const events: unknown[] = [];
      Object.assign(window, { original, events, handle: activateSvg(root, { onSelect: (event: unknown) => events.push(event) }) });
    }, activation);
    const edge = page.locator('[data-mt-role="edge"]').first();
    assert.equal(await edge.getAttribute('tabindex'), null);
    await edge.evaluate(element => element.classList.remove('hidden-edge'));
    await page.waitForFunction(() => document.querySelector('[data-mt-role="edge"]')?.getAttribute('tabindex') === '0', undefined, { timeout: 2_000 });
    const point = await edge.evaluate(element => {
      const path = element as SVGPathElement;
      const at = path.getTotalLength() * .2;
      const a = path.getPointAtLength(at).matrixTransform(path.getScreenCTM()!);
      const b = path.getPointAtLength(at + 1).matrixTransform(path.getScreenCTM()!);
      const dx = b.x - a.x, dy = b.y - a.y;
      return { x: a.x - 4 * dy / Math.hypot(dx, dy), y: a.y + 4 * dx / Math.hypot(dx, dy) };
    });
    assert.equal(await edge.evaluate(element => element.previousElementSibling?.getAttribute('aria-hidden')), 'true');
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.evaluate(() => (window as any).events.at(-1).role), 'edge');
    await edge.focus(); await edge.press('Enter');
    assert.equal(await edge.getAttribute('data-mt-selected'), 'true');
    const selection = await page.evaluate(() => (window as any).events.at(-1));
    const source = await page.evaluate(() => (window as any).handle.mapping.source);
    assert.equal(source.slice(selection.span.start, selection.span.end), '-->|same|');
    await edge.evaluate(element => element.classList.add('hidden-edge'));
    await page.waitForFunction(() => !document.querySelector('[data-mt-role="edge"]')?.hasAttribute('tabindex'), undefined, { timeout: 2_000 });
    assert.equal(await edge.getAttribute('data-mt-selected'), null);
    assert.notEqual(await edge.evaluate(element => element.previousElementSibling?.getAttribute('aria-hidden')), 'true', 'wide hit target is removed when the edge is hidden');
    await page.evaluate(() => (window as any).handle.dispose());
    assert.equal(await page.locator('svg').evaluate(element => element.outerHTML === (window as any).original), true);
  } finally { await browser.close(); }
});

for (const references of [false, true]) test(`FONT-PORTABLE: saved ${references ? 'referenced' : 'inline'} glyph labels preserve paint, gestures and source ownership without fonts`, async () => {
  const svg = await readFile('test/fixtures/glyph-label.svg', 'utf8');
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8'))
    .replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const location = 'data:text/javascript;base64,' + (await readFile('dist/src/markdown-source.js')).toString('base64');
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage();
    await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: svg + svg }));
    await page.goto('http://127.0.0.1/glyph');
    await page.evaluate(async ({ activation, location, references }) => {
      const { activateSvg } = await import(activation);
      const { formatLocation } = await import(location);
      const root = document.querySelector('svg')!;
      if (references) {
        const label = root.querySelector('[data-mt-role=node-label]')!;
        const glyphs = document.createElementNS(root.namespaceURI, 'g');
        glyphs.id = 'portable-label-glyphs';
        glyphs.append(...label.childNodes);
        const defs = document.createElementNS(root.namespaceURI, 'defs');
        defs.append(glyphs); root.append(defs);
        const use = document.createElementNS(root.namespaceURI, 'use');
        use.setAttribute('href', '#portable-label-glyphs'); label.append(use);
      }
      const original = root.outerHTML;
      const events: any[] = [];
      const handle = activateSvg(root, { onSelect: (event: any) => {
        events.push(event);
        if (event.trigger === 'activation') {
          const mapping = JSON.parse(decodeURIComponent(root.getAttribute('data-mt-map')!));
          (window as any).copied = navigator.clipboard.writeText(formatLocation({ id: 'glyph.md', source: mapping.source }, event.span));
        }
      } });
      Object.assign(window, { handle, events, original });
    }, { activation, location, references });
    const root = page.locator('svg').first();
    const label = root.locator('[data-mt-role=node-label]');
    assert.equal(await label.locator('text').count(), 0, 'fixture must exercise portable glyph geometry');
    const paths = references ? root.locator('#portable-label-glyphs path') : label.locator('path');
    assert.equal(await paths.first().evaluate(element => getComputedStyle(element).fill), 'rgb(51, 51, 51)', 'node shape CSS must not recolor glyphs');
    assert.equal(await paths.first().evaluate(element => getComputedStyle(element).stroke), 'none');
    await label.click();
    for (const key of ['Enter', 'Space']) await label.press(key);
    const result = await page.evaluate(async () => {
      const w = window as any; await w.copied;
      const events = w.events.filter((event: any) => event.trigger === 'activation');
      const span = events[0].span; w.handle.highlight([span]);
      const root = document.querySelector('svg')!;
      const mapping = JSON.parse(decodeURIComponent(root.getAttribute('data-mt-map')!));
      return { roles: events.map((event: any) => event.role), spans: events.map((event: any) => event.span),
        text: mapping.source.slice(span.start, span.end), clipboard: await navigator.clipboard.readText(),
        label: root.querySelector('[data-mt-role=node-label]')!.getAttribute('data-mt-selected'),
        node: root.querySelector('[data-mt-role=node]')!.getAttribute('data-mt-selected') };
    });
    assert.deepEqual(result.roles, ['node-label', 'node-label', 'node-label']);
    assert.ok(result.spans.every((span: unknown) => JSON.stringify(span) === JSON.stringify(result.spans[0])));
    assert.equal(result.text, 'Alpha **bold** beta gamma delta epsilon 😀');
    assert.equal(result.clipboard, 'glyph.md:5:5-5:47');
    assert.equal(result.label, 'true'); assert.equal(result.node, null);
    assert.equal(await page.locator('svg').nth(1).locator('[data-mt-selected]').count(), 0);
    const before = await label.screenshot();
    const previousStyle = await label.getAttribute('style');
    await label.evaluate(element => { (element as SVGElement).style.fontFamily = 'MissingFont, monospace'; });
    assert.deepEqual(await label.screenshot(), before, 'font availability must not change saved glyph pixels');
    await label.evaluate((element, value) => value === null ? element.removeAttribute('style') : element.setAttribute('style', value), previousStyle);
    assert.equal(await page.evaluate(() => {
      const w = window as any; w.handle.dispose();
      return document.querySelector('svg')!.outerHTML === w.original;
    }), true, 'disposal restores the saved artifact');
  } finally { await browser.close(); }
});

test('FONT-INVISIBLE: an empty glyph wrapper retains source ownership without a keyboard stop', async () => {
  const svg = await readFile('test/fixtures/glyph-label.svg', 'utf8');
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(svg);
    const result = await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      const root = document.querySelector('svg') as SVGSVGElement;
      const label = root.querySelector('[data-mt-role=node-label]')!;
      const node = root.querySelector('[data-mt-role=node]') as SVGElement;
      const title = document.createElementNS(root.namespaceURI, 'title');
      title.textContent = 'Nonpainting label';
      label.replaceChildren(title);
      const before = root.outerHTML;
      const events: { role: string }[] = [];
      const handle = activateSvg(root, { onSelect: (event: { role: string }) => events.push(event) });
      const start = Number(label.getAttribute('data-mt-start'));
      const pieces = handle.highlight([{ start, end: start + 1 }]);
      const result = { labelStop: label.getAttribute('tabindex'), nodeStop: node.getAttribute('tabindex'),
        labelSelected: label.getAttribute('data-mt-selected'), nodeSelected: node.getAttribute('data-mt-selected'),
        pieces: pieces.length, hasHitTarget: !!label.querySelector('rect'), disposed: false, roles: [] as string[] };
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      result.roles = events.filter(event => event.role === 'node').map(event => event.role);
      handle.dispose(); result.disposed = root.outerHTML === before;
      return result;
    }, activation);
    assert.equal(result.labelStop, null); assert.equal(result.nodeStop, '0');
    assert.equal(result.labelSelected, null); assert.equal(result.nodeSelected, 'true');
    assert.ok(result.pieces > 0); assert.equal(result.hasHitTarget, false);
    assert.ok(result.roles.length >= 2); assert.equal(result.disposed, true);
  } finally { await browser.close(); }
});

for (const nested of [false, true]) test(`FONT-CONTROL: ${nested ? 'nested' : 'direct'} glyph controls retain clickable whitespace and exact disposal`, async () => {
  const svg = await readFile('test/fixtures/glyph-label.svg', 'utf8');
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(svg);
    const setup = await page.evaluate(async ({ activation, nested }) => {
      const { activateSvg } = await import(activation);
      const root = document.querySelector('svg') as SVGSVGElement;
      const label = root.querySelector('[data-mt-role=node-label]') as SVGGElement;
      const node = root.querySelector('[data-mt-role=node]')!;
      const span = { start: Number(label.getAttribute('data-mt-start')), end: Number(label.getAttribute('data-mt-end')) };
      const mapping = JSON.parse(decodeURIComponent(root.getAttribute('data-mt-map')!));
      mapping.format = 'mermaid-trace/1';
      const piece = mapping.pieces.find((piece: any) => piece.id === label.getAttribute('data-mt-refs'));
      piece.kind = 'control'; piece.span = span;
      mapping.pieces = [piece];
      for (const attribute of [...node.attributes]) if (attribute.name.startsWith('data-mt-')) node.removeAttribute(attribute.name);
      label.setAttribute('data-mt-role', 'control');
      label.setAttribute('data-mt-key', piece.domId);
      root.setAttribute('data-mt-map', encodeURIComponent(JSON.stringify(mapping)));
      label.id = 'glyph-control';
      const glyphs = document.createElementNS(root.namespaceURI, 'g');
      glyphs.id = 'control-glyphs'; glyphs.append(...label.childNodes);
      const defs = document.createElementNS(root.namespaceURI, 'defs');
      defs.append(glyphs); root.append(defs);
      const use = document.createElementNS(root.namespaceURI, 'use');
      use.setAttribute('href', '#control-glyphs');
      const group = document.createElementNS(root.namespaceURI, 'g');
      group.append(use); label.append(nested ? group : use);
      const box = label.getBoundingClientRect();
      let point: { x: number; y: number } | undefined;
      for (let x = box.left + 1; x < box.right - 1 && !point; x += 2) {
        const y = box.top + box.height / 2;
        if (!label.contains(document.elementFromPoint(x, y))) point = { x, y };
      }
      if (!point) throw new Error('fixture needs whitespace between painted glyphs');
      const original = root.outerHTML;
      const events: any[] = [];
      const handle = activateSvg(root, { onSelect: (event: any) => events.push(event) });
      Object.assign(window, { handle, events, original });
      return { point, span };
    }, { activation, nested });
    const control = page.locator('#glyph-control');
    await page.mouse.click(setup.point.x, setup.point.y);
    assert.equal(await control.getAttribute('data-mt-selected'), 'true');
    assert.equal(await page.evaluate(() => (window as any).events.at(-1).role), 'control');
    assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), setup.span);
    await page.evaluate(span => (window as any).handle.highlight([span]), setup.span);
    assert.equal(await control.getAttribute('data-mt-selected'), 'true');
    assert.equal(await page.locator('[data-mt-refs][tabindex="0"]').count(), 1, 'the glyph control retains one keyboard stop');
    await page.locator('[data-mt-refs][tabindex="0"]').focus(); await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), setup.span);
    assert.equal(await page.evaluate(() => { (window as any).handle.dispose(); return document.querySelector('svg')!.outerHTML === (window as any).original; }), true);
  } finally { await browser.close(); }
});

test('ACT-NESTED-VIEWPORT: nested SVG labels remain selectable and follow clipping', async () => {
  const svg = await readFile('test/fixtures/glyph-label.svg', 'utf8');
  const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
  const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(svg);
    const span = await page.evaluate(async activation => {
      const { activateSvg } = await import(activation);
      const root = document.querySelector('svg')!;
      const label = root.querySelector('[data-mt-role=node-label]')!;
      root.append(label); label.removeAttribute('transform');
      label.innerHTML = '<svg x="38" y="28" width="16" height="16" viewBox="0 0 1 1"><path d="M0 0H1V1H0Z"/></svg>';
      const original = root.outerHTML;
      const events: unknown[] = [];
      Object.assign(window, { original, events, handle: activateSvg(root, { onSelect: (event: unknown) => events.push(event) }) });
      return { start: Number(label.getAttribute('data-mt-start')), end: Number(label.getAttribute('data-mt-end')) };
    }, activation);
    const label = page.locator('[data-mt-role=node-label]');
    assert.equal(await label.getAttribute('tabindex'), '0', 'a painted nested viewport must remain selectable');
    await label.locator('path').click();
    for (const key of ['Enter', 'Space']) {
      assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), span);
      await label.press(key);
    }
    assert.deepEqual(await page.evaluate(() => (window as any).events.at(-1).span), span);
    assert.equal(await page.evaluate(() => (window as any).events.filter((event: any) => event.trigger === 'activation').length), 3);
    await label.evaluate(element => { (element as SVGElement).style.transform = 'translateX(1000px)'; });
    await page.waitForFunction(() => !document.querySelector('[data-mt-role=node-label]')!.hasAttribute('tabindex'));
    assert.equal(await label.getAttribute('data-mt-selected'), null);
    await label.evaluate(element => element.removeAttribute('style'));
    await page.waitForFunction(() => document.querySelector('[data-mt-role=node-label]')!.getAttribute('tabindex') === '0');
    await page.evaluate(span => (window as any).handle.highlight([span]), span);
    assert.equal(await label.getAttribute('data-mt-selected'), 'true');
    assert.equal(await page.evaluate(() => { (window as any).handle.dispose(); return document.querySelector('svg')!.outerHTML === (window as any).original; }), true);
  } finally { await browser.close(); }
});
