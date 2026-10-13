import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

test('FLOW-PALETTE: pinned reference assigns container colors in declaration order', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ path: 'node_modules/mermaid/dist/mermaid.min.js' });
    for (const look of ['classic', 'neo', 'handDrawn']) for (const theme of ['redux-color', 'redux-dark-color', 'redux']) {
      const result = await page.evaluate(async ({ look, theme }) => {
        const mermaid = (window as any).mermaid;
        mermaid.initialize({ startOnLoad: false, look, theme, handDrawnSeed: 42, themeVariables: {
          THEME_COLOR_LIMIT: 1, borderColorArray: ['#a1b2c3', '#d4e5f6', '#123456'], bkgColorArray: ['#123abc', '#456def'],
        } });
        const source = 'flowchart TB\nsubgraph O[Outer]\nsubgraph I[Inner]\nA[Alpha]\nend\nend\nsubgraph S[Sibling]\nB[Beta]\nend\nsubgraph C[Collapsed]\nD[Delta]\nend\nC@{view:collapsed}\nO --> S --> C';
        const { svg } = await mermaid.render('palette', source);
        const host = document.createElement('div'); host.innerHTML = svg; document.body.append(host);
        const result = [...host.querySelectorAll('[data-color-id]')].map(element => ({
          id: element.id, slot: element.getAttribute('data-color-id'),
          paint: [...element.querySelectorAll('rect,path,.collapsed-group')].filter(shape =>
            shape.closest('[data-color-id],.node,.rough-node,.cluster') === element && !shape.closest('.label,.cluster-label')).map(shape => ({
            fill: getComputedStyle(shape).fill, stroke: getComputedStyle(shape).stroke,
          })),
        }));
        host.remove(); return result;
      }, { look, theme });
      if (theme === 'redux') { assert.deepEqual(result, []); continue; }
      for (const [id, slot] of [['O', 0], ['I', 1], ['S', 2], ['C', 0]] as const) {
        const item = result.find(item => item.id === id || item.id.endsWith(`-${id}`) || item.id.includes(`-${id}-`));
        assert.ok(item, JSON.stringify(result));
        assert.equal(item.slot, `color-${slot}`, `${theme}/${look}/${id}`);
        assert.ok(item.paint.length, JSON.stringify(item));
        assert.ok(item.paint.some(paint => paint.fill === ['rgb(18, 58, 188)', 'rgb(69, 109, 239)'][slot % 2]), JSON.stringify(item));
        assert.ok(item.paint.some(paint => paint.stroke === ['rgb(161, 178, 195)', 'rgb(212, 229, 246)', 'rgb(18, 52, 86)'][slot]), JSON.stringify(item));
      }
      assert.equal(result.length, 4, 'ordinary nodes do not take container slots');
    }
    for (const layer of ['directive', 'frontmatter']) {
      const paint = await page.evaluate(async layer => {
        const mermaid = (window as any).mermaid;
        mermaid.initialize({ startOnLoad: false });
        const config = { theme: 'redux-color', themeVariables: { borderColorArray: ['#a1b2c3'], bkgColorArray: ['#123abc'] } };
        const prefix = layer === 'directive' ? `%%{init: ${JSON.stringify(config)}}%%` : `---\nconfig: ${JSON.stringify(config)}\n---`;
        const { svg } = await mermaid.render('palette-layer', `${prefix}\nflowchart TB\nsubgraph O[Outer]\nA\nend`);
        document.body.innerHTML = svg;
        const shape = document.querySelector('[data-color-id] rect')!;
        return { fill: getComputedStyle(shape).fill, stroke: getComputedStyle(shape).stroke };
      }, layer);
      assert.deepEqual(paint, { fill: 'rgb(253, 244, 255)', stroke: 'rgb(232, 121, 249)' }, `${layer} filters custom palette arrays in the reference`);
    }
  } finally { await browser.close(); }
});
