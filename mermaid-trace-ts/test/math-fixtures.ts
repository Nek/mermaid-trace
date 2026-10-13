export const styledMathCases = ['dagre', 'elk'].flatMap(layout => ['classic', 'neo', 'handDrawn'].map(look => {
  const label = "<strong>bold</strong> <span style='font-size:32px;color:red'><em>large</em> $$x^2$$</span> tail<br/><span style='font-size:12px'>small wrapped words alpha beta gamma</span>";
  const edge = "from <span style='font-size:24px'>$$y^2$$</span> to";
  const title = "<strong>Group</strong> <span style='font-size:20px'>$$g^2$$</span>";
  const group = `subgraph G["${title}"]\nA["${label}"] e@-->|"${edge}"| B[Beta]\nend`;
  const source = `---\nconfig: ${JSON.stringify({ layout, look, handDrawnSeed: 42, htmlLabels: true, flowchart: { wrappingWidth: 90 } })}\n---\n%% FLOW-STYLED-MATH ${layout}/${look}\nflowchart LR\n%% 😀\n${group}\n`;
  return { source, label, edge, title, group };
}));

export const styledMathRuns = [
  ['bold', '16px', '700', 'normal'], [' ', '16px', '400', 'normal'],
  ['large', '32px', '400', 'italic'], [' ', '32px', '400', 'normal'],
  [' tail', '16px', '400', 'normal'], ['small wrapped words alpha beta gamma', '12px', '400', 'normal'],
];

export function inspectStyledMath(root: Element) {
  const labels = [...root.querySelectorAll('[data-mt-role$="-label"]')].filter(e => e.querySelector('svg'));
  const byKey = (key: string) => labels.find(e => e.getAttribute('data-mt-key') === key)!;
  const node = byKey('node:A');
  const shape = root.querySelector('[data-mt-key="node:A"][data-mt-role=node]')!.querySelector(':scope > rect, :scope > g.basic.label-container, :scope > g > path')!.getBoundingClientRect();
  return {
    formulas: ['node:A', 'edge:e', 'flowchart:subgraph:G'].map(key => getComputedStyle(byKey(key).querySelector('svg')!).fontSize),
    color: getComputedStyle([...node.querySelectorAll('tspan')].find(e => e.textContent === 'large')!).fill,
    runs: [...node.querySelectorAll('tspan')].map(e => { const s = getComputedStyle(e); return [e.textContent, s.fontSize, s.fontWeight, s.fontStyle]; }),
    contained: [...node.querySelectorAll('text,svg')].every(e => { const b = e.getBoundingClientRect(); return b.left >= shape.left - 1 && b.right <= shape.right + 1 && b.top >= shape.top - 1 && b.bottom <= shape.bottom + 1; }),
  };
}
