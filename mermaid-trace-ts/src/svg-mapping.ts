import type { Piece, SourceMapping, Span } from './source-mapping.js';

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

export function annotateSvg(svg: string, mapping: SourceMapping): string {
  validate(mapping);
  check(mapping.format === 'mermaid-trace/0', 'native producers annotate format 1');
  const root = parse(svg);
  check(!root.querySelector('[data-mt-refs]') && !root.hasAttribute('data-mt-map'), 'already annotated');
  const attributes = new Map<Element, string>();
  attributes.set(root, ` data-mt-map="${encodeURIComponent(JSON.stringify(mapping))}"`);
  const bind = (element: Element | undefined | null, pieces: readonly Piece[], label: boolean) => {
    check(element, 'missing SVG element');
    check(!attributes.has(element), 'duplicate SVG binding');
    const first = pieces[0]!;
    const span = label ? first.labelSpan ?? first.span : first.span;
    attributes.set(element, ` data-mt-refs="${pieces.map(piece => piece.id).join(' ')}" data-mt-role="${first.kind}${label ? '-label' : ''}" data-mt-start="${span.start}" data-mt-end="${span.end}"`);
  };
  const groups = new Map<string, Piece[]>();
  for (const piece of mapping.pieces) {
    const key = `${piece.kind}:${piece.domId}`;
    const group = groups.get(key) ?? [];
    group.push(piece);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const pieces = [...group].sort((a, b) => Number(Boolean(b.labelSpan)) - Number(Boolean(a.labelSpan)));
    const first = pieces[0]!;
    if (first.kind === 'node') {
      const nodes = [...root.querySelectorAll('.node')].filter(node => node.id === `${root.id}-${first.domId}`);
      check(nodes.length === 1, 'node visual identity mismatch');
      bind(nodes[0], pieces, false);
      bind(nodes[0]!.querySelector('.label'), [first], true);
    } else {
      const elements = [...root.querySelectorAll('[data-id]')].filter(element => element.getAttribute('data-id') === first.domId);
      const paths = elements.filter(element => element.classList.contains('flowchart-link'));
      check(paths.length === 1, 'edge visual identity mismatch');
      bind(paths[0], pieces, false);
      if (first.labelSpan) {
        const labels = elements.filter(element => element.classList.contains('label'));
        check(labels.length === 1, 'edge label identity mismatch');
        bind(labels[0], [first], true);
      }
    }
  }

  // DOM is used for identity lookup; insert into original start tags so the
  // serializer cannot change baseline bytes. This accepts upstream's simple SVG
  // serialization only, rejecting XML constructs that need a richer tokenizer.
  check(!/<[!?]/.test(svg), 'unsupported XML construct');
  const tags = [...svg.matchAll(/<[A-Za-z][\w:.-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/g)];
  const elements = [root, ...root.querySelectorAll('*')];
  check(tags.length === elements.length, 'SVG tag correspondence');
  let output = svg;
  for (let i = tags.length - 1; i >= 0; i--) {
    const tag = tags[i]!;
    const element = elements[i]!;
    check(tag[0].match(/^<([\w:.-]+)/)?.[1] === element.tagName, 'SVG tag order');
    const extra = attributes.get(element);
    if (extra) {
      const offset = tag.index + tag[0].length - (tag[0].endsWith('/>') ? 2 : 1);
      output = output.slice(0, offset) + extra + output.slice(offset);
    }
  }
  readSvgMapping(output);
  return output;
}
