import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { watchPreview } from '../src/watch.js';
import { formatLocation } from '../src/markdown-source.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const sequence = 'sequenceDiagram\nparticipant Alice\nparticipant Bob\nAlice->>Bob: Hello\nBob-->>Alice: Hi\n';
const markdown = '# Title\n\nSelect **these words**.\n\n![asset](asset.svg)\n\n```mermaid\nsequenceDiagram\nparticipant A as Draft\nparticipant B as Publish\nA->>B: review\nB-->>A: \n```\n\n```mermaid\n' + sequence + '```\n';

test('WATCH-AC1: CLI help and argument diagnostics work outside the checkout', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: tmpdir(), encoding: 'utf8' });
  const help = run('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /watch.*file.*--port/i);
  assert.match(help.stdout, /--source/);
  for (const args of [[], ['watch'], ['watch', 'no.txt'], ['watch', 'no.md'], ['watch', 'no.md', '--port', '-1'], ['watch', 'no.md', '--unknown']]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /usage|file|port|unknown/i);
  }
});

test('WATCH-AC2/3/4/5: live minimal Markdown preview, native sequence mapping, clipboard, assets, saves and recovery', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mermaid-trace-watch-'));
  const filename = join(directory, 'document.md');
  const errors: string[] = [];
  let preview: { url: string; close(): Promise<void> } | undefined;
  const browser = await chromium.launch();
  try {
    await writeFile(filename, markdown);
    await writeFile(join(directory, 'asset.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    preview = await watchPreview(filename, { port: 0, onError: (error: unknown) => errors.push(String(error)) });
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto(preview!.url);
    await page.waitForSelector('body[data-ready=true]');
    assert.equal(await page.locator('svg').count(), 2);
    assert.equal(await page.locator('textarea,iframe,button,input,header,footer,[role=status],vite-error-overlay').count(), 0);
    assert.ok(await page.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 10));
    assert.match(await page.locator('svg').nth(1).textContent() ?? '', /Hello/);
    assert.ok(requests.every(url => url.startsWith(preview!.url)));
    assert.ok(!requests.some(url => /mermaid\.min|markdown-it|mdast/.test(url)));
    await page.evaluate(() => navigator.clipboard.writeText('unchanged'));
    await page.locator('h1').focus();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'unchanged');
    await page.locator('h1').click();
    await page.waitForFunction(() => navigator.clipboard.readText().then(text => text.endsWith(':1:1-1:8')));
    assert.equal(await page.locator('[data-md-selected]').count(), 1);
    assert.equal(await page.locator('svg[data-mt-selected=true]').count(), 0);
    const word = await page.locator('strong').evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const box = range.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    await page.mouse.move(word.x + .5, word.y + word.height / 2);
    await page.mouse.down();
    await page.mouse.move(word.x + word.width - .5, word.y + word.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => document.getSelection()!.toString()), 'these words');
    const textStart = markdown.indexOf('these words');
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected),
      formatLocation({ id: filename, source: markdown }, { start: textStart, end: textStart + 11 }));
    assert.equal(await page.locator('[data-md-selected]').count(), 0);
    await page.keyboard.press('ControlOrMeta+c');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'these words', 'normal Copy must keep native text behavior');
    const edge = page.locator('[data-mt-role="edge"]').nth(1);
    const point = await edge.evaluate((element: SVGGeometryElement) => {
      const position = element.getPointAtLength(element.getTotalLength() / 2);
      const screen = new DOMPoint(position.x, position.y).matrixTransform(element.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    });
    await page.mouse.click(point.x, point.y + 3);
    const connectorStart = markdown.indexOf('B-->>A: ');
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected),
      formatLocation({ id: filename, source: markdown }, { start: connectorStart, end: connectorStart + 8 }));
    assert.equal(await edge.getAttribute('data-mt-selected'), 'true');
    const label = page.locator('[data-mt-role="edge-label"]').first();
    await label.click();
    const start = markdown.indexOf('review');
    const location = formatLocation({ id: filename, source: markdown }, { start, end: start + 6 });
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), location);
    await page.locator('svg').nth(1).focus();
    await page.keyboard.press('Enter');
    const fence = markdown.indexOf('```mermaid', markdown.indexOf('```mermaid') + 1);
    const end = markdown.indexOf('```', fence + 10) + 4;
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: filename, source: markdown }, { start: fence, end }));
    assert.equal(await page.locator('svg[data-mt-selected=true]').count(), 1);
    await writeFile(filename, markdown.replace('# Title', '# Updated').replace('Draft', 'Saved'));
    await page.getByRole('heading', { name: 'Updated', exact: true }).waitFor();
    await page.waitForSelector('body[data-ready=true]');
    assert.match(await page.locator('svg').first().textContent() ?? '', /Saved/);
    await writeFile(filename, '# Broken\n\n```mermaid\nflowchart LR\nA -->\n```');
    await assertEventually(() => errors.some(error => /parse|syntax/i.test(error)));
    assert.equal(await page.locator('h1').textContent(), 'Updated');
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    const replacement = join(directory, 'replacement.md');
    await writeFile(replacement, markdown.replace('# Title', '# Recovered'));
    await rename(replacement, filename);
    await page.getByRole('heading', { name: 'Recovered', exact: true }).waitFor();
    await writeFile(filename, markdown.replace('# Title', '# Intermediate'));
    await new Promise(resolve => setTimeout(resolve, 180));
    await writeFile(filename, markdown.replace('# Title', '# Latest').replace('Draft', 'Newest'));
    await page.getByRole('heading', { name: 'Latest', exact: true }).waitFor();
    await page.waitForSelector('body[data-ready=true]');
    assert.match(await page.locator('svg').first().textContent() ?? '', /Newest/);
    const staticContext = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await staticContext.newPage();
    await staticPage.goto(preview!.url);
    assert.equal(await staticPage.locator('svg').count(), 2);
    await preview!.close();
    await assert.rejects(fetch(preview!.url));
    preview = undefined;
    const mmd = join(directory, 'sequence.mmd');
    await writeFile(mmd, sequence);
    preview = await watchPreview(mmd, { port: 0 });
    await page.goto(preview!.url);
    await page.waitForSelector('body[data-ready=true]');
    await page.locator('svg').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), formatLocation({ id: mmd, source: sequence }, { start: 0, end: sequence.length }));
  } finally {
    await preview?.close();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('WATCH-SOURCE-AC1/2/3: optional native source selection, scrolling, reverse mapping and saves', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mermaid-trace-source-'));
  const filename = join(directory, 'source.md');
  const source = '# Source 🐟\r\n\r\n' + '\r\n'.repeat(100) + '```mermaid\r\n' + sequence.replaceAll('\n', '\r\n') + '```\r\n\r\n`<script>never()</script>`\r\n';
  const browser = await chromium.launch();
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  try {
    await writeFile(filename, source);
    preview = await watchPreview(filename, { port: 0, sourceView: true });
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(preview.url);
    await page.waitForSelector('body[data-ready=true]');
    assert.ok((await page.locator('h1').boundingBox())!.y < 100, 'rendered document starts at the top beside the source pane');
    const frame = page.frameLocator('#source-frame');
    const original = frame.locator('#source');
    assert.equal(await original.textContent(), source, 'preserve CRLF and Unicode offsets');
    assert.equal(await frame.locator('script, mark, textarea').count(), 0);
    await page.locator('[data-mt-role=edge-label]').first().click();
    await original.evaluate(element => {
      if (element.ownerDocument.getSelection()?.toString() !== 'Hello') throw new Error('Expected selected source label');
    });
    assert.ok(await original.evaluate(element => element.scrollTop > 0), 'scroll selected source into view');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-mt-role')), 'edge-label');
    const start = source.indexOf('Hello');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), formatLocation({ id: filename, source }, { start, end: start + 5 }));
    await original.focus();
    await page.keyboard.press('ControlOrMeta+c');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Hello');
    await original.evaluate(element => {
      const doc = element.ownerDocument;
      const text = element.firstChild!;
      const start = text.textContent!.indexOf('Hi');
      const range = doc.createRange(); range.setStart(text, start); range.setEnd(text, start + 2);
      doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
    });
    await page.locator('[data-mt-role=edge-label][data-mt-selected=true]').filter({ hasText: 'Hi' }).waitFor();
    assert.equal(await page.locator('[data-mt-role=edge-label][data-mt-selected=true]').count(), 1);
    await original.evaluate(element => {
      const doc = element.ownerDocument;
      const text = element.firstChild!;
      const start = text.textContent!.indexOf('# Source');
      const range = doc.createRange(); range.setStart(text, start); range.setEnd(text, start + 11);
      doc.getSelection()!.removeAllRanges(); doc.getSelection()!.addRange(range);
    });
    await page.waitForSelector('h1[data-md-selected]');
    assert.equal(await page.locator('svg [data-mt-selected=true]').count(), 0);
    await page.locator('h1').click();
    assert.equal(await original.evaluate(element => element.ownerDocument.getSelection()!.toString()), '# Source 🐟');
    await writeFile(filename, source.replace('Hello', 'Updated'));
    await page.locator('[data-mt-role=edge-label]').filter({ hasText: 'Updated' }).waitFor();
    await page.waitForSelector('body[data-ready=true]');
    assert.equal(await original.textContent(), source.replace('Hello', 'Updated'));
    await preview.close(); preview = undefined;
    const mmd = join(directory, 'diagram.mmd');
    await writeFile(mmd, sequence);
    preview = await watchPreview(mmd, { port: 0, sourceView: true });
    await page.goto(preview.url);
    await page.waitForSelector('body[data-ready=true]');
    await page.locator('svg').focus(); await page.keyboard.press('Enter');
    assert.deepEqual(await original.evaluate(element => {
      const range = element.ownerDocument.getSelection()!.getRangeAt(0);
      return { start: range.startOffset, end: range.endOffset, text: range.cloneContents().textContent };
    }), { start: 0, end: sequence.length, text: sequence });
  } finally {
    await browser.close(); await preview?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('WATCH-AC1/2: actual CLI renders from another cwd and closes on SIGTERM', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mermaid-trace-cli-'));
  const filename = join(directory, 'input.md');
  await writeFile(filename, '# CLI preview');
  const child = spawn(process.execPath, [cli, 'watch', filename, '--port', '0', '--source'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let diagnostic = '';
  child.stdout.on('data', data => { output += String(data); });
  child.stderr.on('data', data => { diagnostic += String(data); });
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
  try {
    await assertEventually(() => /http:\/\/127\.0\.0\.1:\d+/.test(output) || child.exitCode !== null);
    assert.equal(child.exitCode, null, diagnostic);
    const url = output.match(/http:\/\/127\.0\.0\.1:\d+\//)![0];
    const html = await (await fetch(url)).text();
    assert.match(html, /CLI preview/);
    assert.match(html, /source-frame/);
    assert.doesNotMatch(html, /selection-status|textarea/);
    await writeFile(filename, '# Plain Markdown save');
    for (let i = 0; i < 100; i++) {
      if ((await (await fetch(url)).text()).includes('Plain Markdown save')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(await (await fetch(url)).text(), /Plain Markdown save/);
    child.kill('SIGTERM');
    assert.equal(await exited, 0, diagnostic);
    await assert.rejects(fetch(url));
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});

async function assertEventually(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(predicate(), 'Expected watcher diagnostic');
}


test('WATCH-AC2: shutdown closes incomplete HTTP connections', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mermaid-trace-close-'));
  const filename = join(directory, 'close.md'); await writeFile(filename, '# Close');
  const preview = await watchPreview(filename, { port: 0 });
  const socket = createConnection({ host: '127.0.0.1', port: Number(new URL(preview.url).port) });
  socket.on('error', error => assert.equal((error as NodeJS.ErrnoException).code, 'ECONNRESET', 'server shutdown may reset the unfinished request'));
  let closing: Promise<void> | undefined;
  try {
    await once(socket, 'connect');
    socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
    let timer: ReturnType<typeof setTimeout> | undefined;
    closing = preview.close();
    const closed = await Promise.race([closing.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 1000); })]);
    clearTimeout(timer);
    assert.equal(closed, true, 'shutdown must not wait for a browser connection to finish');
  } finally {
    socket.destroy(); await (closing ?? preview.close());
    await rm(directory, { recursive: true, force: true });
  }
});
