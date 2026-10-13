const styledMathRuns = [
  ['bold', '16px', '700', 'normal'], [' ', '16px', '400', 'normal'],
  ['large', '32px', '400', 'italic'], [' ', '32px', '400', 'normal'],
  [' tail', '16px', '400', 'normal'], ['small wrapped words alpha beta gamma', '12px', '400', 'normal'],
];

export const styledMathCases = ['dagre', 'elk'].flatMap(layout => ['classic', 'neo', 'handDrawn'].map(look => {
  const label = "<strong>bold</strong> <span style='font-size:32px;color:red'><em>large</em> $$x^2$$</span> tail<br/><span style='font-size:12px'>small wrapped words alpha beta gamma</span>";
  const edge = "from <span style='font-size:24px'>$$y^2$$</span> to";
  const title = "<strong>Group</strong> <span style='font-size:20px'>$$g^2$$</span>";
  const group = `subgraph G["${title}"]\nA["${label}"] e@-->|"${edge}"| B[Beta]\nend`;
  const source = `---\nconfig: ${JSON.stringify({ layout, look, handDrawnSeed: 42, htmlLabels: true, flowchart: { wrappingWidth: 90 } })}\n---\n%% FLOW-STYLED-MATH ${layout}/${look}\nflowchart LR\n%% 😀\n${group}\n`;
  return { source, label, edge, title, group, formulas: [['32px'], ['24px'], ['20px']], runs: styledMathRuns, color: 'rgb(255, 0, 0)' };
}));

export const crossRowMathCases = ['dagre', 'elk'].flatMap(layout => ['classic', 'neo', 'handDrawn'].map(look => {
  const label = "<span style='font-size:32px'><strong>before $$x^2$$<br/><em>after $$y^2$$</em></strong><br/>plain wrapped words alpha beta gamma</span><br/>reset $$z^2$$";
  const edge = "<span style='font-size:24px'>from $$a^2$$<br/>to $$b^2$$</span>";
  const title = "<span style='font-size:20px'>Group $$g^2$$<br/>next $$h^2$$</span>";
  const group = `subgraph G["${title}"]\nA["${label}"] e@-->|"${edge}"| B[Beta]\nend`;
  const source = `---\nconfig: ${JSON.stringify({ layout, look, handDrawnSeed: 42, htmlLabels: true, flowchart: { wrappingWidth: 90 } })}\n---\n%% FLOW-CROSS-ROW-MATH ${layout}/${look}\nflowchart LR\n%% 😀\n${group}\n`;
  return { source, label, edge, title, group, formulas: [['32px', '32px', '16px'], ['24px', '24px'], ['20px', '20px']], color: null, runs: [
    ['before ', '32px', '700', 'normal'], ['after ', '32px', '700', 'italic'],
    ['plain wrapped words alpha beta gamma', '32px', '400', 'normal'], ['reset ', '16px', '400', 'normal'],
  ] };
}));

export const paintMathCases = ['dagre', 'elk'].flatMap(layout => ['classic', 'neo', 'handDrawn'].map(look => {
  const formula = String.raw`$$x+\textcolor{black}{y}+\textcolor{blue}{z}+\frac{a}{b}+\sqrt{c}$$`;
  const label = `<span style='color:red'>${formula}</span>`;
  const edge = `<span style='color:green'>${formula}</span>`;
  const title = `<span style='color:purple'>${formula}</span>`;
  const group = `subgraph G["${title}"]\nA["${label}"] e@-->|"${edge}"| B[Beta]\nend`;
  const source = `---\nconfig: ${JSON.stringify({ layout, look, handDrawnSeed: 42, htmlLabels: true })}\n---\n%% FLOW-PAINT-MATH ${layout}/${look}\nflowchart LR\n%% 😀\n${group}\n`;
  return { source, label, edge, title, group };
}));

export const modeMathCases = ['dagre', 'elk'].flatMap(layout => [false, true].flatMap(html =>
  [false, true].flatMap(markdown => [false, true].map(wrap => {
    const label = 'Node **bold** $$x^2$$ after<br/>literal $$';
    const edge = label.replace('Node', 'Edge'), title = label.replace('Node', 'Group');
    const quote = (value: string) => markdown ? `"\`${value}\`"` : `"${value}"`;
    const node = `A[${quote(label)}]`, connector = `e@-->|${quote(edge)}|`;
    const group = `subgraph G[${quote(title)}]\n${node} ${connector} B[Beta]\nend`;
    const config = { layout, htmlLabels: html, markdownAutoWrap: wrap, flowchart: { wrappingWidth: 80 } };
    const source = `---\nconfig: ${JSON.stringify(config)}\n---\n%% FLOW-MODE-MATH ${layout}/${html}/${markdown}/${wrap}\nflowchart LR\n%% 😀\n${group}\n`;
    const bold = markdown && !html ? 'bold' : '**bold**', formula = html ? '' : '$$x^2$$';
    const expected = ['Node', 'Edge', 'Group'].map(prefix => ({ formulas: html ? 1 : 0, text: `${prefix}${bold}${formula}afterliteral$$` }));
    return { source, label, edge, title, node, connector, group, expected };
  }))));

export function inspectFormulaModes(root: Element) {
  return ['node:A', 'edge:e', 'flowchart:subgraph:G'].map(key => {
    const label = root.querySelector(`[data-mt-key="${key}"][data-mt-role$="-label"]`)!;
    return { formulas: label.querySelectorAll('svg').length, text: label.textContent!.replace(/\s/g, '') };
  });
}

export function inspectFormulaPaint(root: Element) {
  return ['node:A', 'edge:e', 'flowchart:subgraph:G'].map(key => {
    const formula = root.querySelector(`[data-mt-key="${key}"][data-mt-role$="-label"] svg`)!;
    return ['currentColor', 'rgba(0,0,0,1)', 'rgba(0,0,255,1)'].map(paint =>
      [...new Set([...formula.querySelectorAll(`[fill="${paint}"]`)].map(e => getComputedStyle(e).fill))]);
  });
}

export const expectedFormulaPaint = ['rgb(255, 0, 0)', 'rgb(0, 128, 0)', 'rgb(128, 0, 128)']
  .map(color => [[color], ['rgb(0, 0, 0)'], ['rgb(0, 0, 255)']]);

export function inspectStyledMath(root: Element) {
  const labels = [...root.querySelectorAll('[data-mt-role$="-label"]')].filter(e => e.querySelector('svg'));
  const byKey = (key: string) => labels.find(e => e.getAttribute('data-mt-key') === key)!;
  const node = byKey('node:A');
  const shape = root.querySelector('[data-mt-key="node:A"][data-mt-role=node]')!.querySelector(':scope > rect, :scope > g.basic.label-container, :scope > g > path')!.getBoundingClientRect();
  const colored = [...node.querySelectorAll('tspan')].find(e => e.textContent === 'large');
  return {
    formulas: ['node:A', 'edge:e', 'flowchart:subgraph:G'].map(key => [...byKey(key).querySelectorAll('svg')].map(e => getComputedStyle(e).fontSize)),
    color: colored ? getComputedStyle(colored).fill : null,
    runs: [...node.querySelectorAll('tspan')].map(e => { const s = getComputedStyle(e); return [e.textContent, s.fontSize, s.fontWeight, s.fontStyle]; }),
    contained: [...node.querySelectorAll('text,svg')].every(e => { const b = e.getBoundingClientRect(); return b.left >= shape.left - 1 && b.right <= shape.right + 1 && b.top >= shape.top - 1 && b.bottom <= shape.bottom + 1; }),
  };
}
