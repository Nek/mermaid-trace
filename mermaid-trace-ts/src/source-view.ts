import type { Span } from './source-mapping.js';

// Independent native selection keeps source visible while preview retains focus.
export async function attachSourceView(frame: HTMLIFrameElement, text: string) {
  if (!frame.contentDocument?.querySelector('#source')) {
    await new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
  }
  const sourceDocument = frame.contentDocument!;
  const source = sourceDocument.querySelector<HTMLElement>('#source')!;
  // Build one text node from the exact input; HTML parsing normalizes CRLF.
  const sourceText = sourceDocument.createTextNode(text);
  source.replaceChildren(sourceText);
  const sourceSelection = () => {
    const selection = sourceDocument.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!range.intersectsNode(sourceText)) return;
    return { start: range.startContainer === sourceText ? range.startOffset : 0,
      end: range.endContainer === sourceText ? range.endOffset : sourceText.textContent!.length };
  };
  const selectSource = (span: Span) => {
    const range = sourceDocument.createRange();
    range.setStart(sourceText, span.start);
    range.setEnd(sourceText, span.end);
    const current = sourceSelection();
    if (current?.start !== span.start || current.end !== span.end) {
      const selection = sourceDocument.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (document.activeElement === frame) return;
    const first = range.getClientRects()[0];
    if (!first) return;
    const viewport = source.getBoundingClientRect();
    const padding = parseFloat(frame.contentWindow!.getComputedStyle(source).paddingTop);
    if (first.top < viewport.top + padding || first.bottom > viewport.bottom - padding) source.scrollTop += first.top - viewport.top - padding;
    if (first.left < viewport.left + padding || first.right > viewport.right - padding) source.scrollLeft += first.left - viewport.left - padding;
  };
  return { document: sourceDocument, element: source, selection: sourceSelection, select: selectSource };
}
