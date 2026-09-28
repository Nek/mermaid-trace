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
let nextScope = 0;

export function activateSvg(svg: SVGSVGElement, options: {
  readonly source?: string;
  readonly onSelect: (selection: Selection) => void;
}): Activation {
  if (active.has(svg)) throw new Error('SVG is already activated');
  const mapping = readSvgMapping(new XMLSerializer().serializeToString(svg), options.source);
  const byId = new Map(mapping.pieces.map(piece => [piece.id, piece]));
  const viewport = svg.getBoundingClientRect();
  const clipped = svg.isConnected && viewport.width > 0 && viewport.height > 0
    && svg.ownerDocument.defaultView?.getComputedStyle(svg).overflow !== 'visible';
  const elements = [...svg.querySelectorAll('[data-mt-refs]')].filter(element => {
    if (clipped) {
      const bounds = element.getBoundingClientRect();
      if (bounds.right < viewport.left || bounds.left > viewport.right
        || bounds.bottom < viewport.top || bounds.top > viewport.bottom) return false;
    }
    if (!element.querySelector('rect,path,line,polygon,circle,ellipse,foreignObject,image,use')) {
      const text = element.localName === 'text' ? [element] : [...element.querySelectorAll('text')];
      if (text.length && text.every(line => svg.ownerDocument.defaultView?.getComputedStyle(line).fontSize === '0px')) return false;
    }
    if (element.getAttribute('data-mt-role') !== 'edge' || !['path', 'line'].includes(element.localName)) return true;
    const style = svg.ownerDocument.defaultView?.getComputedStyle(element);
    if (!style || !style.stroke) return true;
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
    return (style.stroke !== 'none' && parseFloat(style.strokeWidth) > 0 && Number(style.strokeOpacity) > 0)
      || (element.localName === 'path' && style.fill !== 'none' && Number(style.fillOpacity) > 0)
      || [style.markerStart, style.markerMid, style.markerEnd].some(marker => marker !== 'none');
  });
  const hitTargets = new Map<Element, Element>();
  const refs = (element: Element) => element.getAttribute('data-mt-refs')!.split(' ');
  const spanKey = (element: Element) => `${element.getAttribute('data-mt-start')}:${element.getAttribute('data-mt-end')}`;
  const groups = new Map<string, Element[]>();
  for (const element of elements) {
    const key = spanKey(element);
    const members = groups.get(key) ?? [];
    members.push(element);
    groups.set(key, members);
  }
  const primary = (element: Element) => {
    const members = groups.get(spanKey(element))!;
    return members.find(member => ['node', 'control'].includes(member.getAttribute('data-mt-role')!)) ?? members[0]!;
  };
  const labelIds = new Set(elements.filter(element => element.getAttribute('data-mt-role')!.endsWith('-label')).flatMap(refs));
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
    const matchingLabels = matching.filter(piece => piece.labelSpan && labelIds.has(piece.id) && ranges.filter(range => overlaps(piece.span, range))
      .every(range => range.start >= piece.labelSpan!.start && range.start < piece.labelSpan!.end && range.end <= piece.labelSpan!.end));
    const labelPieces = new Set(matchingLabels);
    // ponytail: quadratic containment check for bounded diagrams; use an interval index if large maps make it slow.
    const pieces = matching.filter(piece => labelPieces.has(piece) || !ranges.filter(range => overlaps(piece.span, range)).every(range => matching.some(child => {
      const span = labelPieces.has(child) ? child.labelSpan! : child.span;
      return span.start >= piece.span.start && span.end <= piece.span.end
        && (span.start > piece.span.start || span.end < piece.span.end)
        && range.start >= span.start && range.start < span.end && range.end <= span.end;
    })))
      .sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);
    const whole = ranges.some(range => range.start === 0 && range.end === mapping.source.length);
    set(svg, 'data-mt-selected', whole ? 'true' : null);
    const selected = new Set(whole ? [] : pieces.map(piece => piece.id));
    const labelOnly = new Set(pieces.filter(piece => ranges.filter(range => overlaps(piece.span, range)).every(range => matchingLabels.some(label =>
      label.kind === piece.kind && label.semanticId === piece.semanticId
      && range.start >= label.labelSpan!.start && range.start < label.labelSpan!.end && range.end <= label.labelSpan!.end)))
      .map(piece => piece.id));
    for (const members of groups.values()) {
      const match = members.some(element => {
        const label = element.getAttribute('data-mt-role')!.endsWith('-label');
        return refs(element).some(id => selected.has(id) && (label || !labelOnly.has(id)));
      });
      for (const element of members) {
        set(element, 'data-mt-selected', match ? 'true' : null);
        set(element, 'aria-pressed', String(match));
      }
    }
    return pieces;
  };
  const emit = (selection: Selection) => {
    const members = groups.get(`${selection.span.start}:${selection.span.end}`);
    if (selection.role !== 'diagram' && members) {
      const ids = new Set([...selection.pieces.map(piece => piece.id), ...members.flatMap(refs)]);
      selection = { ...selection, pieces: [...ids].map(id => byId.get(id)!) };
    }
    highlight([selection.span], new Set(selection.pieces.map(piece => piece.id)));
    options.onSelect(selection);
  };
  const targetFor = (event: Event) => {
    const element = event.target instanceof Element
      ? hitTargets.get(event.target) ?? event.target.closest('[data-mt-refs]') ?? svg : null;
    return element && element.closest('svg') === svg && (element === svg || elements.includes(element)) ? element as SVGElement : null;
  };
  let pointerTarget: SVGElement | null = null;
  const pointerFocus = (event: MouseEvent) => {
    const element = targetFor(event);
    if (!element || event.button !== 0) return;
    pointerTarget = element;
    event.preventDefault();
    (element === svg ? svg : primary(element) as SVGElement).focus({ preventScroll: true });
  };
  const gesture = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
    const target = event instanceof MouseEvent && event.type === 'click' && event.detail > 0
      && pointerTarget && event.target instanceof Node && event.target.contains(pointerTarget)
      ? pointerTarget : targetFor(event);
    if (event.type === 'click') pointerTarget = null;
    if (!target) return;
    const element = (target === svg ? svg : primary(target)) as SVGElement;
    if (event.type === 'focusin' && element !== target) {
      element.focus({ preventScroll: true });
      return;
    }
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
  let scope: string;
  do { scope = `mt-${++nextScope}`; } while (svg.ownerDocument.querySelector(`svg[data-mt-active="${scope}"]`));
  const selector = `svg[data-mt-active="${scope}"]`;
  const selectionStyle = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'style');
  selectionStyle.textContent = `
${selector}{cursor:pointer}
${selector}[data-mt-selected=true]{outline:2px solid #007c8a;outline-offset:4px;filter:none}
${selector} [data-mt-selected=true]{filter:drop-shadow(0 0 3px #007c8a)}
${selector} [data-mt-selected=true] [data-mt-selected=true]{filter:none}
${selector} [data-mt-selected=true]:focus{outline:none}
${selector} [data-mt-role=node][data-mt-selected=true] rect{stroke:#007c8a!important;stroke-width:3px!important}
${selector} [data-mt-role=edge][data-mt-selected=true]{stroke:#007c8a!important;stroke-width:3px!important}`;
  set(svg, 'data-mt-active', scope);
  svg.append(selectionStyle);
  set(svg, 'role', 'group');
  set(svg, 'tabindex', '0');
  set(svg, 'aria-label', 'Select whole diagram');
  for (const helper of svg.querySelectorAll('[data-mt-generated="bounds"]')) set(helper, 'pointer-events', 'none');
  for (const element of elements) {
    const piece = byId.get(refs(element)[0]!)!;
    set(element, 'tabindex', primary(element) === element ? '0' : '-1');
    set(element, 'role', 'button');
    set(element, 'aria-label', `Select ${element.getAttribute('data-mt-role')} ${piece.semanticId}`);
    set(element, 'aria-pressed', 'false');
    if (element.localName === 'g' && element.getAttribute('data-mt-role')!.endsWith('-label')) {
      const bounds = (element as SVGGElement).getBBox();
      if (bounds.width > 0 && bounds.height > 0) {
        const target = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const width = Math.max(bounds.width, 12);
        const height = Math.max(bounds.height, 12);
        for (const [name, value] of Object.entries({
          x: bounds.x - (width - bounds.width) / 2,
          y: bounds.y - (height - bounds.height) / 2,
          width, height,
        })) target.setAttribute(name, String(value));
        target.setAttribute('aria-hidden', 'true');
        target.setAttribute('focusable', 'false');
        target.style.cssText = 'fill:transparent;stroke:none;pointer-events:all;cursor:pointer';
        element.prepend(target);
        hitTargets.set(target, element);
      }
    }
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
      (element as SVGElement | undefined)?.focus({ preventScroll: true });
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
      selectionStyle.remove();
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
