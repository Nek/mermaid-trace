import { activateSvg } from './svg-activation.js';
import type { Activation } from './svg-activation.js';
import { fromMarkdown, toMarkdown, formatLocation } from './markdown-source.js';
import type { MarkdownBlock, MarkdownDocument } from './markdown-source.js';
import { renderedTextSelection } from './document-selection.js';
import type { DocumentTarget, DocumentText } from './markdown-view.js';
import type { Span } from './source-mapping.js';

const data = JSON.parse(document.querySelector('#trace-data')!.textContent!) as {
  document: MarkdownDocument; blocks: readonly MarkdownBlock[];
  targets: readonly DocumentTarget[]; texts: readonly DocumentText[];
};
const article = document.querySelector('article')!;
const instances: { block: MarkdownBlock; activation: Activation }[] = [];
const select = (span: Span, copy: boolean, target = '') => {
  if (target !== 'text') document.getSelection()?.removeAllRanges();
  for (const { block, activation } of instances) activation.highlight(fromMarkdown(block, span, data.document));
  for (const element of article.querySelectorAll('[data-md-target]')) {
    element.toggleAttribute('data-md-selected', element.getAttribute('data-md-target') === target);
  }
  if (copy) void navigator.clipboard.writeText(formatLocation(data.document, span)).catch(console.error);
};
for (const block of data.blocks) {
  const svg = article.querySelector<SVGSVGElement>(`[data-mt-block="${block.id}"] svg`)!;
  const activation = activateSvg(svg, { source: block.source, onSelect(selection) {
    select(selection.role === 'diagram' ? block.span : toMarkdown(block, selection.span, data.document).envelope,
      selection.trigger === 'activation');
  } });
  instances.push({ block, activation });
}
const blockGesture = (event: Event) => {
  if (!(event.target instanceof Element) || event.target.closest('svg, a, button, input')) return;
  if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
  if (event.type === 'click' && !document.getSelection()?.isCollapsed) return;
  const element = event.target.closest<HTMLElement>('[data-md-target]');
  const target = data.targets.find(target => target.id === element?.getAttribute('data-md-target'));
  if (!element || !target) return;
  if (event.type !== 'focusin') {
    event.preventDefault();
    element.focus({ preventScroll: true });
  }
  select(target.span, event.type !== 'focusin', target.id);
};
article.addEventListener('focusin', blockGesture);
article.addEventListener('click', blockGesture);
article.addEventListener('keydown', blockGesture);
const textGesture = (event: Event) => {
  if (event.target instanceof Element && event.target.closest('svg')) return;
  const selection = renderedTextSelection(article, data.texts, data.blocks);
  if (selection) select(selection.span, event.type === 'pointerup', 'text');
};
article.addEventListener('pointerup', textGesture);
article.addEventListener('keyup', textGesture);
document.body.dataset.ready = 'true';
