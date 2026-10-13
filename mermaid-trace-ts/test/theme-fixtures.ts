export const paletteCases = ['dagre', 'elk'].flatMap(layout => ['classic', 'neo', 'handDrawn'].flatMap(look => [false, true].map(htmlLabels => {
  const inner = 'subgraph I[Inner]\nA[Alpha]\nend';
  const outer = `subgraph O[Outer]\n${inner}\nend`;
  const collapsed = 'subgraph C[Collapsed]\nD[Delta]\nend';
  const empty = 'subgraph E[Empty]\nend';
  const config = { layout, look, htmlLabels, handDrawnSeed: 42, theme: htmlLabels ? 'redux-dark-color' : 'redux-color', themeVariables: {
    THEME_COLOR_LIMIT: 1, borderColorArray: ['#a1b2c3', '#d4e5f6', '#123456'], bkgColorArray: ['#123abc', '#456def'],
  } };
  return { source: `---\nconfig: ${JSON.stringify(config)}\n---\n%% FLOW-PALETTE ${layout}/${look}/${htmlLabels}\n%% 😀\nflowchart TB\n${outer}\nsubgraph S[Sibling]\nB[Beta]\nend\n${collapsed}\nC@{view:collapsed}\n${empty}\nO e@-->|next| S --> C --> E\nstyle S fill:#ffddcc,stroke:#ccddff`, outer, inner, collapsed, empty };
})));

export function inspectContainerPaint(root: SVGSVGElement) {
  return [...root.querySelectorAll('[data-color-id]')].map(element => ({
    key: element.getAttribute('data-mt-key'), slot: element.getAttribute('data-color-id'),
    paint: [...element.querySelectorAll('rect,path')].filter(shape =>
      shape.closest('[data-color-id],.node,.rough-node,.cluster') === element && !shape.closest('.label,.cluster-label')).map(shape => ({
        fill: getComputedStyle(shape).fill, stroke: getComputedStyle(shape).stroke,
      })),
  }));
}

export const palettePaint = [
  ['O', 0, 'rgb(18, 58, 188)', 'rgb(161, 178, 195)'],
  ['I', 1, 'rgb(69, 109, 239)', 'rgb(212, 229, 246)'],
  ['S', 2, 'rgb(255, 221, 204)', 'rgb(204, 221, 255)'],
  ['C', 0, 'rgb(18, 58, 188)', 'rgb(161, 178, 195)'],
  ['E', 1, 'rgb(69, 109, 239)', 'rgb(212, 229, 246)'],
] as const;
