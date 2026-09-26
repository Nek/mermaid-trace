import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const config = {
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'default',
  look: 'classic',
  layout: 'dagre',
  fontFamily: 'TraceBaseline',
  fontSize: 16,
  htmlLabels: false,
  deterministicIds: true,
  deterministicIDSeed: 'mermaid-trace-baseline',
  flowchart: { htmlLabels: false, useMaxWidth: false },
};

const contextOptions = {
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light',
  reducedMotion: 'reduce',
  serviceWorkers: 'block',
} as const;

export type Fixture = { readonly id: string; readonly source: string };

const root = fileURLToPath(new URL('../../../', import.meta.url));
export const forkBundle = process.env.MERMAID_TRACE_BUNDLE ? resolve(process.env.MERMAID_TRACE_BUNDLE) : resolve(root, '../mermaid/packages/mermaid/dist/mermaid.min.js');

export async function renderReferences(fixtures: readonly Fixture[], mapped: boolean | 'viewer' = false, bundle = mapped
  ? forkBundle
  : resolve(root, 'node_modules/mermaid/dist/mermaid.min.js')) {
  const font = await readFile(resolve(root, 'node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2'));
  const versions: Record<string, string> = {};
  for (const name of ['mermaid', 'playwright', '@fontsource/noto-sans']) {
    versions[name] = JSON.parse(await readFile(resolve(root, `node_modules/${name}/package.json`), 'utf8')).version;
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(contextOptions);
    const requests: string[] = [];
    await context.route('**/*', route => {
      requests.push(route.request().url());
      return route.abort();
    });
    const svgs: Record<string, string> = {};
    const diagramOnly: string[] = [];
    for (const { id, source } of fixtures) {
      assert.match(id, /^[a-z][a-z0-9-]*$/, 'Fixture ID must be safe for SVG and filenames');
      assert.ok(!Object.hasOwn(svgs, id), `Duplicate fixture ID: ${id}`);
      const page = await context.newPage();
      try {
        await page.setContent(`<!doctype html><style>
          @font-face { font-family: TraceBaseline; src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2'); font-weight: 400; }
          body { margin: 0; font-family: TraceBaseline; }
        </style><body></body>`);
        await page.addScriptTag({ path: resolve(bundle) });
        if (mapped) {
          for (const [file, exports] of [['flowchart-source', 'renderFlowchart'], ['svg-mapping', 'annotateSvg']] as const) {
            await page.addScriptTag({ type: 'module', content: await readFile(new URL(`../${file}.js`, import.meta.url), 'utf8') + `\nwindow.${exports} = ${exports};` });
          }
        }
        const rendered = await page.evaluate(async ({ id, source, config, mapped }) => {
          const faces = await document.fonts.load('16px TraceBaseline');
          if (faces.length !== 1 || faces[0]?.status !== 'loaded') throw new Error('Baseline font did not load');
          await document.fonts.ready;
          const mermaid = (window as unknown as { mermaid: {
            initialize(config: unknown): void;
            render: import('../flowchart-source.js').MermaidRenderHost['render'];
            detectType(source: string): string;
          } }).mermaid;
          mermaid.initialize(config);
          const api = window as unknown as {
            renderFlowchart: typeof import('../flowchart-source.js').renderFlowchart;
            annotateSvg: typeof import('../svg-mapping.js').annotateSvg;
          };
          if (mapped) {
            Object.defineProperty(mermaid, 'mermaidAPI', { get() { throw new Error('Private Mermaid API must not be accessed'); } });
            if (mapped === 'viewer' && !['flowchart', 'flowchart-v2'].includes(mermaid.detectType(source))) {
              const { svg } = await mermaid.render(`baseline-${id}`, source);
              return { svg: api.annotateSvg(svg, { format: 'mermaid-trace/0', source, pieces: [] }), diagramOnly: true };
            }
            const { svg, mapping } = await api.renderFlowchart(`baseline-${id}`, source, mermaid);
            return { svg: api.annotateSvg(svg, mapping), diagramOnly: false };
          }
          return { svg: (await mermaid.render(`baseline-${id}`, source)).svg, diagramOnly: false };
        }, { id, source, config, mapped });
        svgs[id] = rendered.svg;
        if (rendered.diagramOnly) diagramOnly.push(id);
      } finally {
        await page.close();
      }
    }
    assert.deepEqual(requests, [], 'Reference rendering attempted network access');
    return {
      svgs,
      ...(mapped === 'viewer' ? { diagramOnly } : {}),
      environment: {
        versions, browser: browser.version(), platform: process.platform, arch: process.arch,
        fontSha256: createHash('sha256').update(font).digest('hex'), config, context: contextOptions,
      },
    };
  } finally {
    await browser.close();
  }
}
