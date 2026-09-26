import { activateSvg } from './svg-activation.js';
import type { Activation, Selection } from './svg-activation.js';
import { fromMarkdown, toMarkdown, formatLocation } from './markdown-source.js';
import type { MarkdownBlock, MarkdownDocument } from './markdown-source.js';
import { renderedTextSelection } from './document-selection.js';
import type { DocumentTarget, DocumentText } from './markdown-view.js';
import type { Span } from './flowchart-source.js';

const data = JSON.parse(document.querySelector('#demo-data')!.textContent!) as {
  document: MarkdownDocument; blocks: readonly MarkdownBlock[];
  targets: readonly DocumentTarget[]; texts: readonly DocumentText[];
};
const source = document.querySelector<HTMLTextAreaElement>('#source')!;
const sourceHighlight = document.querySelector<HTMLElement>('#source-highlight')!;
const syncSourceHighlight = () => {
  sourceHighlight.style.width = `${source.clientWidth}px`;
  sourceHighlight.style.height = `${source.clientHeight}px`;
  sourceHighlight.scrollTop = source.scrollTop;
  sourceHighlight.scrollLeft = source.scrollLeft;
};
source.addEventListener('scroll', syncSourceHighlight);
new ResizeObserver(syncSourceHighlight).observe(source);
const highlightSource = (span: Span) => {
  const mark = document.createElement('mark');
  mark.textContent = source.value.slice(span.start, span.end);
  sourceHighlight.replaceChildren(source.value.slice(0, span.start), mark, source.value.slice(span.end));
  syncSourceHighlight();
  if (document.activeElement === source) return;
  const selected = mark.getClientRects()[0];
  if (!selected) return;
  const viewport = source.getBoundingClientRect();
  const padding = parseFloat(getComputedStyle(source).paddingTop) + source.clientTop;
  if (selected.top < viewport.top + padding || selected.bottom > viewport.top + source.clientHeight - padding) {
    source.scrollTop += selected.top - viewport.top - padding;
  }
  if (selected.left < viewport.left + padding || selected.right > viewport.left + source.clientWidth - padding) {
    source.scrollLeft += selected.left - viewport.left - padding;
  }
  syncSourceHighlight();
};

const status = document.querySelector<HTMLElement>('#selection-status')!;
const occurrences = document.querySelector<HTMLElement>('#occurrences')!;
const location = document.querySelector<HTMLInputElement>('#selection-location')!;
const copyStatus = document.querySelector<HTMLElement>('#copy-status')!;
const showLocation = (span: Span) => {
  const value = formatLocation(data.document, span);
  if (location.value !== value) copyStatus.textContent = '';
  location.value = value;
};
const copyLocation = async () => {
  const value = location.value;
  copyStatus.textContent = '';
  try {
    await navigator.clipboard.writeText(value);
    if (location.value === value) copyStatus.textContent = 'Location copied.';
  } catch {
    if (location.value === value) copyStatus.textContent = 'Could not copy. Select the location and copy it manually.';
  }
};
const instances: { block: MarkdownBlock; activation: Activation }[] = [];
const reportError = (error: unknown) => { status.textContent = `Mapping unavailable: ${error instanceof Error ? error.message : String(error)}`; };
const article = document.querySelector('article')!;
let selectedRange: Span | undefined;
const selectDocument = (span: Span, copy: boolean, targetId?: string) => {
  const native = document.getSelection();
  if (targetId !== '' && native?.anchorNode && article.contains(native.anchorNode)) native.removeAllRanges();
  selectedRange = span;
  source.setSelectionRange(span.start, span.end);
  highlightSource(span);
  showLocation(span);
  occurrences.replaceChildren();
  for (const { block, activation } of instances) activation.highlight(fromMarkdown(block, span, data.document));
  const inDiagram = data.blocks.some(block => block.span.start <= span.start && block.span.end >= span.end);
  const target = targetId ?? (inDiagram ? undefined : data.targets.filter(target => target.span.start <= span.start && target.span.end >= span.end)
    .sort((a, b) => (a.span.end - a.span.start) - (b.span.end - b.span.start))[0]?.id);
  for (const element of article.querySelectorAll('[data-md-target]')) {
    element.toggleAttribute('data-md-selected', element.getAttribute('data-md-target') === target);
  }
  if (copy) void copyLocation();
};

try {
  for (const block of data.blocks) {
    const svg = document.querySelector<SVGSVGElement>(`[data-mt-block="${block.id}"] svg`)!;
    const onSelect = (selection: Selection) => {
      try {
        if (selection.role === 'diagram') {
          selectDocument(block.span, selection.trigger === 'activation');
          status.textContent = `Whole diagram · ${block.id} · including Markdown fences`;
          return;
        }
        const { segments, envelope } = toMarkdown(block, selection.span, data.document);
        selectDocument(envelope, selection.trigger === 'activation');
        status.textContent = `${selection.role} · ${selection.pieces[0]!.semanticId} · ${block.id} · exact Markdown segments ${segments.map(s => `[${s.start}, ${s.end})`).join(', ')}${segments.length > 1 ? ' · editor selection includes intervening Markdown prefixes' : ''}`;
        const primary = selection.pieces[0]!;
        const alternatives = activation.mapping.pieces.filter(piece => piece.kind === primary.kind && piece.domId === primary.domId);
        for (const [index, piece] of alternatives.entries()) {
          const button = document.createElement('button');
          button.textContent = `Occurrence ${index + 1}: ${block.source.slice(piece.span.start, piece.span.end)}`;
          button.addEventListener('click', () => activation.select(piece.id));
          occurrences.append(button);
        }
      } catch (error) { reportError(error); }
    };
    const activation = activateSvg(svg, { source: block.source, onSelect });
    instances.push({ block, activation });
  }
  const targetFor = (event: Event) => {
    if (!(event.target instanceof Element) || event.target.closest('svg, a, button, input')) return;
    const element = event.target.closest<HTMLElement>('[data-md-target]');
    const target = data.targets.find(target => target.id === element?.getAttribute('data-md-target'));
    return element && target ? { element, target } : undefined;
  };
  const blockGesture = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
    // Let the browser complete text drags before interpreting a click as a block selection.
    if (event.type === 'click' && !document.getSelection()?.isCollapsed) return;
    const result = targetFor(event);
    if (!result) return;
    if (event.type !== 'focusin') {
      event.preventDefault();
      result.element.focus({ preventScroll: true });
    }
    selectDocument(result.target.span, event.type !== 'focusin', result.target.id);
    status.textContent = `${result.target.kind} · original Markdown`;
  };
  article.addEventListener('focusin', blockGesture);
  article.addEventListener('click', blockGesture);
  article.addEventListener('keydown', blockGesture);
  const textGesture = (event: Event) => {
    if (event.target instanceof Element && event.target.closest('svg')) return;
    try {
      const selection = renderedTextSelection(article, data.texts, data.blocks);
      if (!selection) return;
      selectDocument(selection.span, event.type === 'pointerup', '');
      status.textContent = selection.exact ? 'Text selection · original Markdown' : 'Text selection · enclosing Markdown construct (transformed text)';
    } catch (error) { reportError(error); }
  };
  article.addEventListener('pointerup', textGesture);
  article.addEventListener('keyup', textGesture);
  const reverse = () => {
    // Ignore the queued textarea event caused by our own preview selection.
    if (selectedRange?.start === source.selectionStart && selectedRange.end === source.selectionEnd) return;
    try {
      selectDocument({ start: source.selectionStart, end: source.selectionEnd }, false);
      status.textContent = 'Source selection · matching Markdown and diagram elements highlighted.';
    } catch (error) { reportError(error); }
  };
  source.addEventListener('select', reverse);
  source.addEventListener('keyup', reverse);
  source.addEventListener('pointerup', reverse);
  document.body.dataset.ready = 'true';
} catch (error) { reportError(error); }
