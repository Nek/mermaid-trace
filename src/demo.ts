import { activateSvg } from './svg-activation.js';
import type { Activation, Selection } from './svg-activation.js';
import { fromMarkdown, toMarkdown, formatLocation } from './markdown-source.js';
import type { MarkdownBlock, MarkdownDocument } from './markdown-source.js';
import type { Span } from './flowchart-source.js';

const data = JSON.parse(document.querySelector('#demo-data')!.textContent!) as {
  document: MarkdownDocument; blocks: readonly MarkdownBlock[];
};
const source = document.querySelector<HTMLTextAreaElement>('#source')!;
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
let diagramRange: Span | undefined;

try {
  for (const block of data.blocks) {
    const svg = document.querySelector<SVGSVGElement>(`[data-mt-block="${block.id}"] svg`)!;
    const onSelect = (selection: Selection) => {
      try {
        const { segments, envelope } = toMarkdown(block, selection.span, data.document);
        diagramRange = envelope;
        source.setSelectionRange(envelope.start, envelope.end);
        showLocation(envelope);
        if (selection.trigger === 'activation') void copyLocation();
        status.textContent = `${selection.role} · ${selection.pieces[0]!.semanticId} · ${block.id} · exact Markdown segments ${segments.map(s => `[${s.start}, ${s.end})`).join(', ')}${segments.length > 1 ? ' · editor selection includes intervening Markdown prefixes' : ''}`;
        for (const instance of instances) instance.activation.highlight(instance.block.id === block.id ? [selection.span] : []);
        occurrences.replaceChildren();
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
  const reverse = () => {
    // Ignore the queued textarea event caused by our own diagram selection.
    if (diagramRange?.start === source.selectionStart && diagramRange.end === source.selectionEnd) return;
    diagramRange = undefined;
    try {
      showLocation({ start: source.selectionStart, end: source.selectionEnd });
      let count = 0;
      for (const { block, activation } of instances) {
        count += activation.highlight(fromMarkdown(block, { start: source.selectionStart, end: source.selectionEnd }, data.document)).length;
      }
      occurrences.replaceChildren();
      status.textContent = `${count} source occurrence${count === 1 ? '' : 's'} highlighted.`;
    } catch (error) { reportError(error); }
  };
  source.addEventListener('select', reverse);
  source.addEventListener('keyup', reverse);
  source.addEventListener('pointerup', reverse);
  document.body.dataset.ready = 'true';
} catch (error) { reportError(error); }
