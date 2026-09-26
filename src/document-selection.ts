import type { Span } from './source-mapping.js';
import type { MarkdownBlock } from './markdown-source.js';
import type { DocumentText } from './markdown-view.js';

export function renderedTextSelection(root: HTMLElement, texts: readonly DocumentText[], blocks: readonly MarkdownBlock[]): { span: Span; exact: boolean } | undefined {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
  const spans: Span[] = [];
  let exact = true;
  for (const element of root.querySelectorAll('[data-md-text]')) {
    const node = element.firstChild;
    if (!node || !range.intersectsNode(node)) continue;
    const text = texts.find(text => text.id === element.getAttribute('data-md-text'));
    if (!text || element.textContent !== text.value) throw new Error('Stale rendered Markdown text');
    const start = range.startContainer === node ? range.startOffset : 0;
    const end = range.endContainer === node ? range.endOffset : text.value.length;
    if (start === end || range.comparePoint(node, end) < 0 || range.comparePoint(node, start) > 0) continue;
    spans.push(...text.origins.slice(start, end));
    exact &&= text.exact;
  }
  for (const element of root.querySelectorAll('[data-mt-block]')) {
    if (!range.intersectsNode(element)) continue;
    const block = blocks.find(block => block.id === element.getAttribute('data-mt-block'));
    if (block) spans.push(block.span);
  }
  if (!spans.length) return;
  return { span: { start: Math.min(...spans.map(span => span.start)), end: Math.max(...spans.map(span => span.end)) }, exact };
}
