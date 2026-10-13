import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

test('FLOW-ALT-FONT: pinned Mermaid alternate font variable does not reach inline or standalone labels', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const artifact = await browser.newPage();
    await page.addScriptTag({ path: 'node_modules/mermaid/dist/mermaid.min.js' });
    for (const html of [false, true]) for (const override of [false, true]) {
      let baseline: unknown;
      for (const altFontFamily of [undefined, '', 'Courier New', 'Arial']) {
        const { svg, result } = await page.evaluate(async ({ html, override, altFontFamily }) => {
          const mermaid = (window as any).mermaid;
          mermaid.initialize({ startOnLoad: false, look: 'classic', htmlLabels: html, fontFamily: 'Arial', altFontFamily,
            themeCSS: `.nodeLabel,.label text{${override ? '--mermaid-alt-font-family:serif;' : ''}font-family:var(--mermaid-alt-font-family,monospace)}` });
          const { svg } = await mermaid.render('alt-font', 'flowchart LR\nA[WWWWiiii]');
          const host = document.createElement('div'); host.innerHTML = svg; document.body.append(host);
          await document.fonts.ready;
          const label = host.querySelector(html ? '.nodeLabel' : '.label text')!;
          const style = getComputedStyle(label);
          const result = { variable: style.getPropertyValue('--mermaid-alt-font-family').trim(), font: style.fontFamily, width: label.getBoundingClientRect().width };
          if (altFontFamily) {
            const rule = [...(host.querySelector('style')!.sheet?.cssRules ?? [])].find(rule => rule.cssText.includes('--mermaid-alt-font-family') && rule.cssText.includes(':root')) as CSSStyleRule;
            if (!rule || host.querySelector(rule.selectorText)) throw new Error('Reference root-variable selector changed');
          }
          host.remove(); return { svg, result };
        }, { html, override, altFontFamily });
        assert.equal(result.variable, override ? 'serif' : '');
        assert.equal(result.font, override ? 'serif' : 'monospace');
        if (baseline) assert.deepEqual(result, baseline); else baseline = result;
        await artifact.goto('data:image/svg+xml,' + encodeURIComponent(svg));
        const standalone = await artifact.evaluate(async html => {
          await document.fonts.ready;
          const label = document.querySelector(html ? '.nodeLabel' : '.label text')!;
          const style = getComputedStyle(label);
          return { variable: style.getPropertyValue('--mermaid-alt-font-family').trim(), font: style.fontFamily, width: label.getBoundingClientRect().width };
        }, html);
        assert.deepEqual(standalone, result);
      }
    }
  } finally { await browser.close(); }
});
