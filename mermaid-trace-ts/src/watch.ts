import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { dirname, extname, resolve, basename } from 'node:path';
import { createServer } from 'vite';
import MarkdownIt from 'markdown-it';
import { prepareMarkdown } from './markdown-it.js';
import { renderMarkdownView } from './markdown-view.js';
import { createPreviewProducer } from './producer/preview.js';
import type { MarkdownBlock } from './markdown-source.js';

const escape = new MarkdownIt().utils.escapeHtml;
const runtimeFiles = new Set(['viewer.js', 'svg-activation.js', 'svg-mapping.js', 'markdown-source.js', 'document-selection.js']);

async function renderFile(filename: string, producer: Awaited<ReturnType<typeof createPreviewProducer>>) {
  const source = await readFile(filename, 'utf8');
  const document = { id: filename, revision: createHash('sha256').update(source).digest('hex'), source };
  const standalone = ['.mmd', '.mermaid'].includes(extname(filename).toLowerCase());
  const span = { start: 0, end: source.length };
  const blocks: readonly MarkdownBlock[] = standalone
    ? [{ id: 'preview-0', source, span, document, origins: [{ logical: span, original: span }] }]
    : prepareMarkdown(document, 'preview').blocks;
  const { svgs, diagramOnly = [] } = blocks.length ? await producer.render(blocks) : { svgs: {} as Record<string, string> };
  const view = standalone ? { html: `<div data-mt-block="preview-0">${svgs['preview-0']}</div>`, targets: [], texts: [] }
    : renderMarkdownView(document, blocks, new Map(Object.entries(svgs)));
  for (const id of diagramOnly) {
    console.warn(`${filename}: ${id} supports whole-diagram selection only (no element source map).`);
  }
  const payload = JSON.stringify({ document, blocks, targets: view.targets, texts: view.texts }).replace(/</g, '\\u003c');
  const font = await readFile(new URL('../../node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2', import.meta.url));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(basename(filename))}</title><style>
@font-face{font-family:TraceBaseline;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');font-weight:400}
*{box-sizing:border-box}body{margin:0;color:#172c3e;background:white;font:16px/1.6 system-ui,sans-serif}article{max-width:960px;margin:auto;padding:28px}img{max-width:100%}svg{display:block;max-width:100%;height:auto;margin:24px auto}pre{overflow:auto;background:#f5f7f9;padding:12px}blockquote{border-left:3px solid #b8cbd8;margin-left:0;padding-left:16px}
[data-md-target],svg,[data-mt-refs]{cursor:pointer}[data-md-selected]{background:#e4f4f5;box-shadow:0 0 0 2px #007c8a}svg[data-mt-selected=true]{outline:2px solid #007c8a;outline-offset:4px;filter:none}[data-mt-selected=true]{filter:drop-shadow(0 0 3px #007c8a)}
[data-mt-role=node][data-mt-selected=true] rect{stroke:#007c8a!important;stroke-width:3px!important}[data-mt-role=edge][data-mt-selected=true]{stroke:#007c8a!important;stroke-width:3px!important}
:focus-visible{outline:3px solid #2d65d3;outline-offset:3px}::selection{background:#a9e0e5;color:#172c3e}
</style></head><body><article aria-label="Rendered Markdown">${view.html}</article><script id="trace-data" type="application/json">${payload}</script><script type="module" src="/@mermaid-trace/viewer.js"></script></body></html>`;
}

export async function watchPreview(input: string, options: { port?: number; onError?: (error: unknown) => void } = {}) {
  const filename = resolve(input);
  if (!['.md', '.markdown', '.mmd', '.mermaid'].includes(extname(filename).toLowerCase())) throw new Error('Expected a .md, .markdown, .mmd or .mermaid file');
  const port = options.port ?? 5173;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535');
  const watchedFile = resolve(await realpath(dirname(filename)), basename(filename));
  const http = createHttpServer();
  let html = '';
  let dirty = false;
  let closed = false;
  let pending: Promise<void> | undefined;
  let producer: Awaited<ReturnType<typeof createPreviewProducer>> | undefined;
  const report = options.onError ?? console.error;
  const server = await createServer({
    configFile: false, root: dirname(watchedFile), appType: 'custom', logLevel: 'warn',
    server: { middlewareMode: true, preTransformRequests: false, hmr: { server: http, overlay: false }, watch: { awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 } } },
    plugins: [{ name: 'mermaid-trace-preview', configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (closed) { response.statusCode = 503; response.end(); return; }
        const path = new URL(request.url ?? '/', 'http://localhost').pathname;
        try {
          if (path.startsWith('/@mermaid-trace/')) {
            const name = path.slice('/@mermaid-trace/'.length);
            if (!runtimeFiles.has(name)) { response.statusCode = 404; response.end(); return; }
            response.setHeader('Content-Type', 'text/javascript');
            response.end(await readFile(new URL(`./${name}`, import.meta.url), 'utf8'));
          } else if (path === '/' || path === '/index.html') {
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(await server.transformIndexHtml('/', html));
          } else next();
        } catch (error) {
          if (closed) response.end();
          else next(error as Error);
        }
      });
    }, handleHotUpdate(context) {
      // Publish only after the producer succeeds; do not reload invalid intermediate edits.
      if (context.file === watchedFile) return [];
    } }],
  });
  const rebuild = async () => {
    while (dirty && !closed) {
      dirty = false;
      try {
        const next = await renderFile(filename, producer!);
        if (!dirty && !closed) {
          const initial = !html;
          html = next;
          if (!initial) server.ws.send({ type: 'full-reload', path: '*' });
        }
      } catch (error) {
        if (!html) throw error;
        report(error);
      }
    }
  };
  http.on('request', server.middlewares);
  server.watcher.on('all', (event, path) => {
    if (resolve(path) !== watchedFile || !['add', 'change', 'unlink'].includes(event) || closed) return;
    dirty = true;
    if (!pending) pending = rebuild().finally(() => { pending = undefined; });
  });
  const close = async () => {
    closed = true;
    await server.close();
    if (http.listening) await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    try { await pending; } finally { await producer?.close(); }
  };
  try {
    producer = await createPreviewProducer();
    // Watch before the first render too: a save during Chromium startup must not be lost.
    dirty = true;
    pending = rebuild();
    await pending;
    pending = undefined;
    http.listen(port, '127.0.0.1');
    await once(http, 'listening');
  } catch (error) { pending = undefined; await close(); throw error; }
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Preview server has no TCP address');
  return { url: `http://127.0.0.1:${address.port}/`, close };
}
