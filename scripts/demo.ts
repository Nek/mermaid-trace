import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import MarkdownIt from 'markdown-it';
import { prepareMarkdown } from '../src/markdown-it.js';
import { renderReferences } from './svg-baselines.js';

export async function writeDemo(): Promise<void> {
  const document = { id: 'interactive.md', revision: 'demo-1', source: await readFile('docs/examples/interactive.md', 'utf8') };
  const prepared = prepareMarkdown(document, 'demo');
  const { svgs } = await renderReferences(prepared.blocks, true);
  const html = prepared.render(new Map(Object.entries(svgs)));
  const payload = JSON.stringify({ document, blocks: prepared.blocks }).replace(/</g, '\\u003c');
  const font = (await readFile('node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2')).toString('base64');
  const source = new MarkdownIt().utils.escapeHtml(document.source);
  await mkdir('dist', { recursive: true });
  await writeFile('dist/index.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mermaid Trace · Markdown demo</title>
<style>
@font-face{font-family:TraceBaseline;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:400}
*{box-sizing:border-box}body{margin:0;background:#f5f7f9;color:#172c3e;font:15px/1.6 system-ui,sans-serif}
header{padding:24px 32px;background:#172c3e;color:white}header h1{font-size:26px;margin:0}header p{margin:4px 0 0;color:#d9e5ee}
main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;padding:24px 32px}
article,.source{background:white;border:1px solid #d9e2e9;border-radius:12px;padding:24px;min-width:0}
article h1{font-size:24px;margin-top:0}article h2{font-size:19px;margin-top:28px}blockquote{border-left:3px solid #b8cbd8;margin:0;padding-left:16px}
pre{overflow:auto;background:#f5f7f9;padding:12px;border-radius:6px}svg{display:block;max-width:100%;height:auto;margin:20px auto}
.source{position:sticky;top:24px;align-self:start}.source label{display:block;font-weight:650;margin-bottom:10px}
textarea{display:block;width:100%;height:58vh;resize:vertical;border:1px solid #c9d6e0;border-radius:6px;padding:14px;font:13px/1.65 ui-monospace,monospace;white-space:pre;color:#172c3e;background:#fbfcfd}
#selection-status{min-height:3em;font-size:13px;margin-top:14px}#occurrences{display:flex;flex-wrap:wrap;gap:8px}button{font:inherit;font-size:13px;border:1px solid #b8cbd8;border-radius:6px;padding:5px 10px;background:white;color:#172c3e;cursor:pointer}
[data-mt-refs]{cursor:pointer}[data-mt-selected=true]{filter:drop-shadow(0 0 3px #007c8a)}
[data-mt-role=node][data-mt-selected=true] rect{stroke:#007c8a!important;stroke-width:3px!important}
[data-mt-role=edge][data-mt-selected=true]{stroke:#007c8a!important;stroke-width:3px!important}
:focus-visible{outline:3px solid #2d65d3;outline-offset:3px}footer{padding:0 32px 24px;font-size:13px;color:#516776}
@media(max-width:850px){main{grid-template-columns:1fr;padding:16px}.source{position:static}header{padding:20px}textarea{height:45vh}[data-mt-block]{overflow-x:auto}svg{min-width:520px}}
</style></head><body>
<header><h1>Mermaid Trace</h1><p>Click a diagram element to select its Markdown. Select source text to highlight the diagram.</p></header>
<main><article aria-label="Rendered Markdown">${html}</article>
<section class="source" aria-label="Source selection"><label for="source">Original Markdown · interactive.md</label>
<textarea id="source" readonly spellcheck="false">${source}</textarea>
<div id="selection-status" role="status">Select an element, or use Tab and Enter / Space. Source is read-only.</div>
<div id="occurrences" aria-label="Source occurrences"></div></section></main>
<footer>Static SVG + optional interaction · Experimental flowchart format · <noscript>JavaScript is disabled; diagrams remain readable.</noscript></footer>
<script id="demo-data" type="application/json">${payload}</script><script type="module" src="/src/demo.js"></script>
</body></html>`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await writeDemo();
}
