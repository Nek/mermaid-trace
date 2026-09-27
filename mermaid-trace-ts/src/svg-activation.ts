import type { Piece, SourceMapping, Span } from './source-mapping.js';
import { readSvgMapping } from './svg-mapping.js';

export type Selection = { readonly role: string; readonly pieces: readonly Piece[]; readonly span: Span; readonly trigger: 'focus' | 'activation' };
export type Activation = {
  readonly mapping: SourceMapping;
  highlight(ranges: readonly Span[]): readonly Piece[];
  select(pieceId: string): void;
  dispose(): void;
};

const active = new WeakSet<SVGSVGElement>();

export function activateSvg(svg: SVGSVGElement, options: {
  readonly source?: string;
  readonly onSelect: (selection: Selection) => void;
}): Activation {
  if (active.has(svg)) throw new Error('SVG is already activated');
  const mapping = readSvgMapping(new XMLSerializer().serializeToString(svg), options.source);
  const byId = new Map(mapping.pieces.map(piece => [piece.id, piece]));
  const elements = [...svg.querySelectorAll('[data-mt-refs]')];
  const hitTargets = new Map<Element, Element>();
  const refs = (element: Element) => element.getAttribute('data-mt-refs')!.split(' ');
  const changes = new Map<Element, Map<string, { before: string | null; after: string | null }>>();
  const set = (element: Element, name: string, value: string | null) => {
    const attributes = changes.get(element) ?? new Map();
    const change = attributes.get(name) ?? { before: element.getAttribute(name), after: null };
    change.after = value;
    attributes.set(name, change);
    changes.set(element, attributes);
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  };
  let disposed = false;
  const checkActive = () => { if (disposed) throw new Error('SVG activation is disposed'); };
  const highlight = (ranges: readonly Span[], selectedIds?: ReadonlySet<string>) => {
    checkActive();
    for (const range of ranges) {
      if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0
        || range.end < range.start || range.end > mapping.source.length) throw new Error('Invalid selection range');
    }
    const overlaps = (span: Span, range: Span) => range.start === range.end
      ? span.start <= range.start && range.start < span.end
      : span.start < range.end && span.end > range.start;
    const matching = mapping.pieces.filter(piece => (!selectedIds || selectedIds.has(piece.id)) && ranges.some(range => overlaps(piece.span, range)));
    // ponytail: quadratic containment check for bounded diagrams; use an interval index if large maps make it slow.
    const pieces = matching.filter(piece => !ranges.filter(range => overlaps(piece.span, range)).every(range => matching.some(child =>
      child.span.start >= piece.span.start && child.span.end <= piece.span.end
      && (child.span.start > piece.span.start || child.span.end < piece.span.end)
      && range.start >= child.span.start && range.start < child.span.end && range.end <= child.span.end)))
      .sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);
    const whole = ranges.some(range => range.start === 0 && range.end === mapping.source.length);
    set(svg, 'data-mt-selected', whole ? 'true' : null);
    const selected = new Set(whole ? [] : pieces.map(piece => piece.id));
    const labelOnly = new Set(pieces.filter(piece => piece.labelSpan && ranges.filter(range => overlaps(piece.span, range))
      .every(range => range.start >= piece.labelSpan!.start && range.start < piece.labelSpan!.end && range.end <= piece.labelSpan!.end))
      .map(piece => piece.id));
    for (const element of elements) {
      const label = element.getAttribute('data-mt-role')!.endsWith('-label');
      const match = refs(element).some(id => selected.has(id) && (label || !labelOnly.has(id)));
      set(element, 'data-mt-selected', match ? 'true' : null);
      set(element, 'aria-pressed', String(match));
    }
    return pieces;
  };
  const emit = (selection: Selection) => {
    highlight([selection.span], new Set(selection.pieces.map(piece => piece.id)));
    options.onSelect(selection);
  };
  const targetFor = (event: Event) => {
    const element = event.target instanceof Element
      ? hitTargets.get(event.target) ?? event.target.closest('[data-mt-refs]') ?? svg : null;
    return element && element.closest('svg') === svg && (element === svg || elements.includes(element)) ? element as SVGElement : null;
  };
  const pointerFocus = (event: MouseEvent) => {
    const element = targetFor(event);
    if (!element || event.button !== 0) return;
    event.preventDefault();
    element.focus({ preventScroll: true });
  };
  const gesture = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
    const element = targetFor(event);
    if (!element) return;
    if (event.type !== 'focusin') {
      event.preventDefault();
      element.focus({ preventScroll: true });
    }
    if (element === svg) {
      emit({ trigger: event.type === 'focusin' ? 'focus' : 'activation', role: 'diagram', pieces: mapping.pieces, span: { start: 0, end: mapping.source.length } });
      return;
    }
    emit({ trigger: event.type === 'focusin' ? 'focus' : 'activation', role: element.getAttribute('data-mt-role')!, pieces: refs(element).map(id => byId.get(id)!),
      span: { start: Number(element.getAttribute('data-mt-start')), end: Number(element.getAttribute('data-mt-end')) } });
  };
  set(svg, 'role', 'group');
  set(svg, 'tabindex', '0');
  set(svg, 'aria-label', 'Select whole diagram');
  for (const element of elements) {
    const piece = byId.get(refs(element)[0]!)!;
    set(element, 'tabindex', '0');
    set(element, 'role', 'button');
    set(element, 'aria-label', `Select ${element.getAttribute('data-mt-role')} ${piece.semanticId}`);
    set(element, 'aria-pressed', 'false');
    const geometry = element.getAttribute('data-mt-role') === 'edge' && ['path', 'line'].includes(element.localName) ? [element]
      : element.getAttribute('data-mt-role') === 'control' ? [...element.querySelectorAll('line.loopLine')] : [];
    for (const shape of geometry) {
      const target = shape.cloneNode(false) as SVGElement;
      for (const name of [...target.attributes].map(attribute => attribute.name)) {
        if (!['d', 'x1', 'y1', 'x2', 'y2', 'transform'].includes(name)) target.removeAttribute(name);
      }
      target.setAttribute('aria-hidden', 'true');
      target.setAttribute('focusable', 'false');
      target.style.cssText = 'fill:none;stroke:transparent;stroke-width:12px;stroke-linecap:round;pointer-events:stroke;vector-effect:non-scaling-stroke;cursor:pointer';
      shape.before(target);
      hitTargets.set(target, element);
    }
  }
  svg.addEventListener('click', gesture);
  svg.addEventListener('keydown', gesture);
  svg.addEventListener('focusin', gesture);
  svg.addEventListener('mousedown', pointerFocus);
  const preventTextSelection = (event: Event) => { event.preventDefault(); };
  svg.addEventListener('selectstart', preventTextSelection);
  active.add(svg);
  return {
    mapping,
    highlight,
    select(pieceId) {
      checkActive();
      const piece = byId.get(pieceId);
      if (!piece) throw new Error(`Unknown piece: ${pieceId}`);
      const element = elements.find(element => element.getAttribute('data-mt-role') === piece.kind && refs(element).includes(piece.id))
        ?? elements.find(element => refs(element).includes(piece.id))!;
      (element as SVGElement).focus({ preventScroll: true });
      emit({ trigger: 'activation', role: piece.kind, pieces: [piece], span: piece.span });
    },
    dispose() {
      if (disposed) return;
      svg.removeEventListener('click', gesture);
      svg.removeEventListener('keydown', gesture);
      svg.removeEventListener('focusin', gesture);
      svg.removeEventListener('mousedown', pointerFocus);
      svg.removeEventListener('selectstart', preventTextSelection);
      for (const target of hitTargets.keys()) target.remove();
      for (const [element, attributes] of changes) for (const [name, { before, after }] of attributes) {
        if (element.getAttribute(name) !== after) continue;
        if (before === null) element.removeAttribute(name);
        else element.setAttribute(name, before);
      }
      active.delete(svg);
      disposed = true;
    },
  };
}
