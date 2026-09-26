import type { Span } from './source-mapping.js';

export type MarkdownDocument = { readonly id: string; readonly revision: string; readonly source: string };
export function formatLocation(document: Pick<MarkdownDocument, 'id' | 'source'>, span: Span): string {
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0
    || span.end < span.start || span.end > document.source.length) throw new Error('Invalid selection range');
  const position = (offset: number) => {
    const lines = document.source.slice(0, offset).split(/\r\n|\r|\n/);
    return `${lines.length}:${lines.at(-1)!.length + 1}`;
  };
  return `${document.id}:${position(span.start)}${span.start === span.end ? '' : `-${position(span.end)}`}`;
}
export type Origin = { readonly logical: Span; readonly original: Span };
export type MarkdownBlock = {
  readonly id: string;
  readonly source: string;
  readonly span: Span;
  readonly document: MarkdownDocument;
  readonly origins: readonly Origin[];
};

function translate(block: MarkdownBlock, span: Span, document: MarkdownDocument, reverse: boolean): Span[] {
  if (document.id !== block.document.id || document.revision !== block.document.revision || document.source !== block.document.source) {
    throw new Error('Stale Markdown document');
  }
  const length = reverse ? document.source.length : block.source.length;
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end < span.start || span.end > length) {
    throw new Error('Invalid selection range');
  }
  const result: Span[] = [];
  for (const origin of block.origins) {
    const from = reverse ? origin.original : origin.logical;
    const to = reverse ? origin.logical : origin.original;
    const start = Math.max(span.start, from.start);
    const end = Math.min(span.end, from.end);
    const caret = span.start === span.end;
    if (caret ? start !== end || start < from.start || start >= from.end : start >= end) continue;
    const sameLength = from.end - from.start === to.end - to.start;
    const mapped = {
      start: sameLength ? to.start + start - from.start : to.start,
      end: caret ? (sameLength ? to.start + start - from.start : to.start)
        : sameLength ? to.start + end - from.start : to.end,
    };
    const previous = result.at(-1);
    if (previous?.end === mapped.start) result[result.length - 1] = { start: previous.start, end: mapped.end };
    else result.push(mapped);
  }
  return result;
}

export function toMarkdown(block: MarkdownBlock, span: Span, document: MarkdownDocument): { segments: readonly Span[]; envelope: Span } {
  const segments = translate(block, span, document, false);
  if (!segments.length) throw new Error('Selection has no original Markdown range');
  return { segments, envelope: { start: segments[0]!.start, end: segments.at(-1)!.end } };
}

export function fromMarkdown(block: MarkdownBlock, span: Span, document: MarkdownDocument): readonly Span[] {
  return translate(block, span, document, true);
}
