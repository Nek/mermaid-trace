import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareMarkdown } from '../src/markdown-it.js';
import { renderMarkdownView } from '../src/markdown-view.js';
import type { MarkdownDocument } from '../src/markdown-source.js';
import type { Span } from '../src/source-mapping.js';

type LayerArtifact = { name: string; svg: string; source: string; expected: string; label: string; role: string; runs?: string[][] };

export const cssVariableCases = ['dagre', 'elk'].flatMap(layout => ['classic', 'neo', 'handDrawn'].map(look => {
  const parent = '--Font:monospace;--Size:32px;--size:8px;--weight:700;--paint:rebeccapurple';
  const child = 'font-family:var(--Font);font-size:var(--Size);font-weight:var(--weight);color:var(--paint);line-height:var(--leading,1.5)';
  const [label, edge, title] = ['Alpha WWWiii', 'Next WWWiii', 'Group WWWiii'].map(text => `<span style='${parent}'><span style='${child}'>${text}</span></span>`);
  const node = `A["${label}"]`, connector = `e@-->|"${edge}"|`;
  const group = `subgraph G["${title}"]\n${node} ${connector} B[Beta]\nend`;
  const config = { layout, look, handDrawnSeed: 42, htmlLabels: true };
  return { source: `---\nconfig: ${JSON.stringify(config)}\n---\n%% FLOW-CSS-VARIABLES ${layout}/${look}\nflowchart LR\n%% 😀\n${group}\n`, label: label!, edge: edge!, title: title!, node, connector, group };
}));

export function inspectVariableTypography(root: SVGSVGElement) {
  return ['node:A', 'edge:e', 'flowchart:subgraph:G'].map(key => {
    const label = root.querySelector(`[data-mt-key="${key}"][data-mt-role$="-label"]`)!;
    const runs = [...label.querySelectorAll('text,tspan')].filter(element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent!.trim()))
      .map(element => { const style = getComputedStyle(element); return [style.fontSize, style.fontWeight, style.fill]; });
    return [...new Map(runs.map(run => [run.join('|'), run])).values()];
  });
}

export const variableTypography = [['32px', '700', 'rgb(102, 51, 153)']];

export const altFontCases = ['dagre', 'elk'].flatMap(layout => [false, true].flatMap(htmlLabels =>
  ['', 'Courier New'].map(altFontFamily => {
    const group = 'subgraph G[Group WWWiii]\nA[Alpha WWWiii] e@-->|Next WWWiii| B[Beta]\nend';
    const config = { layout, htmlLabels, fontFamily: 'Arial', altFontFamily };
    return { source: `---\nconfig: ${JSON.stringify(config)}\n---\n%% FLOW-ALT-FONT ${layout}/${htmlLabels}/${altFontFamily}\nflowchart LR\n%% 😀\n${group}\n`, group };
  })));

export function styledCharacters(runs: readonly string[][]): string[][] {
  return runs.flatMap(([text, ...style]) => Array.from(text!, character => [character, ...style]));
}

export async function withCssLayerPreview(run: (host: {
  url: string; artifacts: LayerArtifact[];
  show(artifact: LayerArtifact, live: boolean): { sourceDocument: MarkdownDocument; span: Span };
}) => Promise<void>) {
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
  try {
    // The CLI cannot accept untrusted site configuration. Exercise the Rust host API.
    execFileSync('cargo', ['test', '--locked', '--offline', '--manifest-path', '../mermaid-trace-rs/Cargo.toml', '--test', 'font_metrics', 'trusted_layered_css_preserves_exported_font_and_source'], {
      env: { ...process.env, TRACE_CSS_LAYER_ARTIFACTS: directory }, stdio: 'pipe',
    });
    execFileSync('cargo', ['test', '--locked', '--offline', '--manifest-path', '../mermaid-trace-rs/Cargo.toml', '--test', 'font_metrics', 'trusted_css_rich_label_runs_reach_layout_and_export'], {
      env: { ...process.env, TRACE_CSS_LAYER_ARTIFACTS: directory }, stdio: 'pipe',
    });
    execFileSync('cargo', ['test', '--locked', '--offline', '--manifest-path', '../mermaid-trace-rs/Cargo.toml', '--test', 'font_metrics', 'rich_html_emphasis_matches_explicit_styles_through_wrapping_and_export'], {
      env: { ...process.env, TRACE_CSS_LAYER_ARTIFACTS: directory }, stdio: 'pipe',
    });
    execFileSync('cargo', ['test', '--locked', '--offline', '--manifest-path', '../mermaid-trace-rs/Cargo.toml', '--test', 'css_variable_export'], {
      env: { ...process.env, TRACE_CSS_LAYER_ARTIFACTS: directory }, stdio: 'pipe',
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    const artifacts: LayerArtifact[] = [];
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.json'))) {
      const { svg, mapping, fixture } = JSON.parse(await readFile(join(directory, name), 'utf8'));
      artifacts.push({ name, svg, source: mapping.source, expected: name.includes('rollback') ? '24px' : '32px',
        role: fixture?.role ?? 'node-label',
        label: fixture?.label ?? (name.startsWith('rich-') ? "<span class='large'>Wide</span> small" : 'Alpha WWWiii'),
        runs: fixture?.runs ?? (name.startsWith('rich-') ? [['Wide', '32px', '400', 'normal'], [' small', '16px', '400', 'normal']] : undefined),
      });
    }
    assert.equal(artifacts.length, 66);
    await run({ url, artifacts, show({ svg, source, label }, live) {
      const sourceDocument = { revision: 'fixture', id: '/example/layers.md', source: live ? '# Layers\n\n```mermaid\n' + source + '```\n' : source };
      const span = { start: sourceDocument.source.indexOf(label), end: sourceDocument.source.indexOf(label) + label.length };
      if (live) {
        const { blocks } = prepareMarkdown(sourceDocument, 'layers');
        assert.equal(blocks[0]!.source, source);
        const view = renderMarkdownView(sourceDocument, blocks, new Map([[blocks[0]!.id, svg]]));
        html = `<article>${view.html}</article><iframe id="source-frame" srcdoc="<pre id='source'></pre>"></iframe><script id="trace-data" type="application/json">${JSON.stringify({ document: sourceDocument, blocks, targets: view.targets, texts: view.texts }).replaceAll('<', '\\u003c')}</script><script type="module" src="/viewer.js"></script>`;
      } else {
        html = svg + svg.replaceAll('layers', 'layers-copy') + `<script type="module">import {activateSvg} from '/svg-activation.js';import {formatLocation} from '/markdown-source.js';window.handle=activateSvg(document.querySelector('svg'),{onSelect(event){window.selected=event.span;if(event.trigger==='activation')navigator.clipboard.writeText(formatLocation(${JSON.stringify(sourceDocument)},event.span));}});document.body.dataset.ready='true';</script>`;
      }
      return { sourceDocument, span };
    } });
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}
