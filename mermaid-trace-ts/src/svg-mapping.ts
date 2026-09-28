import type { SourceMapping, Span } from './source-mapping.js';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid SVG mapping: ${message}`);
}

function parse(svg: string): SVGSVGElement {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  check(!document.querySelector('parsererror') && document.documentElement.localName === 'svg'
    && document.documentElement.namespaceURI === 'http://www.w3.org/2000/svg', 'malformed SVG');
  return document.documentElement as unknown as SVGSVGElement;
}

function validate(mapping: SourceMapping) {
  check(mapping && (mapping.format === 'mermaid-trace/0' || mapping.format === 'mermaid-trace/1'), 'unsupported format');
  check(typeof mapping.source === 'string' && mapping.source.length <= 50_000, 'source');
  check(Array.isArray(mapping.pieces) && mapping.pieces.length <= 10_000, 'pieces');
  const ids = new Set<string>();
  const span = (value: Span) => check(value && Number.isInteger(value.start) && Number.isInteger(value.end)
    && value.start >= 0 && value.end > value.start && value.end <= mapping.source.length, 'source span bounds');
  for (const piece of mapping.pieces) {
    check(piece && typeof piece.id === 'string' && /^p\d+$/.test(piece.id) && !ids.has(piece.id), 'piece ID');
    ids.add(piece.id);
    check((mapping.format === 'mermaid-trace/0' ? ['node', 'edge'] : ['node', 'edge', 'note', 'activation', 'control']).includes(piece.kind), 'piece kind');
    check(typeof piece.semanticId === 'string' && typeof piece.domId === 'string' && piece.domId.length, 'semantic/visual identity');
    span(piece.span);
    if (piece.effective !== undefined) check(typeof piece.effective === 'boolean', 'effective occurrence');
    if (piece.labelSpan !== undefined) {
      span(piece.labelSpan);
      check(piece.labelSpan.start >= piece.span.start && piece.labelSpan.end <= piece.span.end, 'label outside piece');
    }
    if (piece.kind === 'edge') check(typeof piece.from === 'string' && typeof piece.to === 'string', 'edge endpoints');
  }
}

export function readSvgMapping(svg: string, source?: string): SourceMapping {
  const root = parse(svg);
  const payload = root.getAttribute('data-mt-map');
  check(payload && payload.length <= 2_000_000, 'missing or oversized payload');
  const mapping = JSON.parse(decodeURIComponent(payload)) as SourceMapping;
  validate(mapping);
  if (source !== undefined) check(source === mapping.source, 'stale source');
  const pieces = new Map(mapping.pieces.map(piece => [piece.id, piece]));
  const referenced = new Set<string>();
  for (const element of root.querySelectorAll('[data-mt-refs], [data-mt-start], [data-mt-end], [data-mt-role]')) {
    const refs = element.getAttribute('data-mt-refs')?.split(' ');
    check(refs?.length && refs.every(ref => pieces.has(ref)), 'unknown piece reference');
    const primary = pieces.get(refs[0]!)!;
    const role = element.getAttribute('data-mt-role');
    check(role === primary.kind || role === `${primary.kind}-label`, 'element role');
    check(refs.every(ref => pieces.get(ref)!.kind === primary.kind && pieces.get(ref)!.semanticId === primary.semanticId
      && pieces.get(ref)!.domId === primary.domId), 'mixed element identities');
    if (mapping.format === 'mermaid-trace/1') {
      check(element.closest('[data-mt-key]')?.getAttribute('data-mt-key') === primary.domId, 'native element identity');
    } else if (primary.kind === 'node') {
      const node = role === 'node' ? element : element.closest('.node');
      check(node?.id === `${root.id}-${primary.domId}`, 'node element identity');
    } else {
      check(element.getAttribute('data-id') === primary.domId, 'edge element identity');
    }
    const span = role.endsWith('-label') ? primary.labelSpan ?? primary.span : primary.span;
    check(element.getAttribute('data-mt-start') === String(span.start) && element.getAttribute('data-mt-end') === String(span.end), 'element range disagrees with piece');
    refs.forEach(ref => referenced.add(ref));
  }
  check(mapping.pieces.every(piece => referenced.has(piece.id)), 'unreferenced piece');
  return mapping;
}
