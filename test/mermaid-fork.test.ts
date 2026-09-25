import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import type { SourceMapping } from '../src/flowchart-source.js';
import { forkBundle } from '../scripts/svg-baselines.js';

test('FORK-AC2/3: public render returns opt-in mappings without state leaks or SVG changes', async () => {
  const browser = await chromium.launch();
  const source = 'flowchart LR\r\n%% 😀 comment\r\nA["same"] -->|same| B["same"]';
  try {
    const outputs = [];
    for (const mapped of [false, true]) {
      const page = await browser.newPage();
      await page.addScriptTag({ path: forkBundle });
      outputs.push(await page.evaluate(async ({ mapped, source }) => {
        const mermaid = (window as unknown as { mermaid: {
          initialize(config: unknown): void;
          render(id: string, source: string, container?: Element, options?: { sourceMap: boolean }): Promise<{ svg: string; sourceMap?: Omit<SourceMapping, 'format'> }>;
        } }).mermaid;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, deterministicIds: true, deterministicIDSeed: 'fork-test' });
        const result = await mermaid.render('diagram', source, undefined, { sourceMap: mapped });
        const next = await mermaid.render('next', 'flowchart LR\nC --> D');
        let rejected = false;
        try { await mermaid.render('unsupported', 'sequenceDiagram\nA->>B: Hi', undefined, { sourceMap: true }); }
        catch { rejected = true; }
        return { svg: result.svg, map: result.sourceMap, leaked: 'sourceMap' in next, rejected };
      }, { mapped, source }));
      await page.close();
    }
    assert.equal(outputs[0]!.map, undefined);
    assert.equal(outputs[1]!.map?.source, source);
    assert.equal(outputs[1]!.map?.pieces.length, 3);
    assert.equal(outputs[0]!.svg, outputs[1]!.svg);
    assert.ok(outputs.every(output => !output.leaked && output.rejected));
  } finally {
    await browser.close();
  }
});
