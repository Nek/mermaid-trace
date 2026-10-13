import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser, clipboardPermissions } from './browser.js';
import { prepareMarkdown } from '../src/markdown-it.js';
import { renderMarkdownView } from '../src/markdown-view.js';
import { formatLocation } from '../src/markdown-source.js';

test('FLOW CSS layers: trusted host styles retain saved/live label selection', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-css-layers-'));
  let html = '';
  const server = createServer(async (request, response) => {
    try {
      const name = request.url?.slice(1);
      if (name && /^[a-z-]+\.js$/.test(name)) {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(await readFile(new URL(`../src/${name}`, import.meta.url)));
      } else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); }
    } catch { response.statusCode = 404; response.end(); }
  });
  const browser = await launchBrowser();
  try {
    // The CLI cannot accept untrusted site configuration. Exercise the Rust host API.
    execFileSync('cargo', ['test', '--locked', '--offline', '--manifest-path', '../mermaid-trace-rs/Cargo.toml', '--test', 'font_metrics', 'trusted_layered_css_preserves_exported_font_and_source'], {
      env: { ...process.env, TRACE_CSS_LAYER_ARTIFACTS: directory }, stdio: 'pipe',
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    const context = await browser.newContext({ permissions: clipboardPermissions });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    const artifacts = (await readdir(directory)).filter(name => name.endsWith('.json'));
    assert.equal(artifacts.length, 18);
    for (const file of artifacts) {
      const { svg, mapping } = JSON.parse(await readFile(join(directory, file), 'utf8'));
      const source: string = mapping.source;
      const expected = file.includes('rollback') ? '24px' : '32px';
      for (const live of [false, true]) {
        const sourceDocument = { revision: 'fixture', id: '/example/layers.md', source: live ? '# Layers\n\n```mermaid\n' + source + '```\n' : source };
        const span = { start: sourceDocument.source.indexOf('Alpha WWWiii'), end: sourceDocument.source.indexOf('Alpha WWWiii') + 'Alpha WWWiii'.length };
        if (live) {
          const { blocks } = prepareMarkdown(sourceDocument, 'layers');
          assert.equal(blocks[0]!.source, source);
          const view = renderMarkdownView(sourceDocument, blocks, new Map([[blocks[0]!.id, svg]]));
          html = `<article>${view.html}</article><iframe id="source-frame" srcdoc="<pre id='source'></pre>"></iframe><script id="trace-data" type="application/json">${JSON.stringify({ document: sourceDocument, blocks, targets: view.targets, texts: view.texts }).replaceAll('<', '\\u003c')}</script><script type="module" src="/viewer.js"></script>`;
        } else {
          html = svg + svg.replaceAll('layers', 'layers-copy') + `<script type="module">import {activateSvg} from '/svg-activation.js';import {formatLocation} from '/markdown-source.js';window.handle=activateSvg(document.querySelector('svg'),{onSelect(event){window.selected=event.span;if(event.trigger==='activation')navigator.clipboard.writeText(formatLocation(${JSON.stringify(sourceDocument)},event.span));}});document.body.dataset.ready='true';</script>`;
        }
        await page.goto(url); await page.waitForSelector('body[data-ready=true]');
        await page.evaluate(() => document.fonts.ready);
        const label = page.locator('[data-mt-role=node-label]').first();
        assert.equal(await label.locator('text').evaluate(element => getComputedStyle(element).fontSize), expected, file);
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
  } finally {
    await browser.close();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
