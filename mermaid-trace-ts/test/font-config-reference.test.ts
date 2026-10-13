import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { launchBrowser } from './browser.js';

test('FLOW-CSS-VARIABLES: browser reference for inheritance, cycles, token boundaries and invalid values', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    for (const [parent, child, expected] of [
      ['--Size:32px;--size:8px', 'font-size:var(--Size)', '32px'],
      ['--a:32px;--b:var(--a)', '--a:8px;font-size:var(--b)', '32px'],
      ['font-size:24px', 'font-size:32px;font-size:var(--missing)', '24px'],
      ['font-size:24px', '--a:red;font-size:32px;font-size:var(--a)', '24px'],
      ['', '--a:var(--b,32px);--b:var(--a);font-size:var(--a,12px)', '12px'],
      ['--safe:32px', '--a:var(--safe,var(--a));font-size:var(--a,12px)', '32px'],
      ['', '--a:var(--missing,initial);--b:var(--a,32px);font-size:var(--b)', '32px'],
      ['--a:40px', '--a:var(--missing,inherit);font-size:var(--a)', '40px'],
      ['--a:40px', '--a:var(--missing,unset);font-size:var(--a)', '40px'],
      ['--a:40px', '--a:var(--missing,revert);font-size:var(--a)', '40px'],
      ['', '--a:;font-size:var(--a,32px)', '16px'],
      ['', '--a:32;font-size:var(--a)px', '16px'],
      ['', String.raw`--S\69 ze:32px;font-size:VAR(--Size)`, '32px'],
      ['', '--size:24px !/**/IMPORTANT;font-size:var(--size)', '24px'],
      ['', 'font-size:24px;font-size:var(invalid)', '24px'],
      ['', 'font-size:24px;font-size:var(--missing,!)', '24px'],
    ]) {
      await page.setContent('<div style="font-size:16px"><div id="parent"><span id="child">Label</span></div></div>');
      const actual = await page.evaluate(({ parent, child }) => {
        document.querySelector('#parent')!.setAttribute('style', parent!);
        document.querySelector('#child')!.setAttribute('style', child!);
        return getComputedStyle(document.querySelector('#child')!).fontSize;
      }, { parent, child });
      assert.equal(actual, expected, `${parent} / ${child}`);
    }
  } finally { await browser.close(); }
});

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
