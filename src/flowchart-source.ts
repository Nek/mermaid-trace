export type Span = { readonly start: number; readonly end: number };
export type Piece = {
  readonly id: string;
  readonly kind: 'node' | 'edge';
  readonly semanticId: string;
  readonly domId: string;
  readonly span: Span;
  readonly labelSpan?: Span;
  readonly from?: string;
  readonly to?: string;
};
export type SourceMapping = {
  readonly format: 'mermaid-trace/0';
  readonly source: string;
  readonly pieces: readonly Piece[];
};

type Location = { range: [number, number] };
type Reduction = { $: unknown; _$: Location };
type ActionArgs = [string, number, number, FlowDb, number, unknown[], Location[]];
type Parser = {
  Parser: new () => Parser;
  yy: FlowDb;
  lexer: { options: { ranges?: boolean } };
  symbols_: Record<string, number>;
  productions_: [number, number][];
  performAction: (this: Reduction, ...args: ActionArgs) => unknown;
  parse(source: string): unknown;
};
type FlowDb = {
  constructor: new () => FlowDb;
  addSingleLink(...args: unknown[]): unknown;
  getEdges(): { id: string; start: string; end: string }[];
  getData(): { nodes: { id: string; domId?: string }[]; edges: { id: string }[] };
};
export type MermaidParserHost = {
  mermaidAPI: { getDiagramFromText(source: string): Promise<unknown> };
};

const unsupported = (reason: string): never => { throw new Error(`Unsupported mapping: ${reason}`); };

// Preserve original UTF-16 positions through Mermaid's CR normalization and
// MIT-licensed comment cleanup rule (attribution in the MAP-1 spec).
function prepare(source: string) {
  const chars: { text: string; start: number; end: number }[] = [];
  for (let i = 0; i < source.length; i++) {
    const start = i;
    const text = source[i] === '\r' ? '\n' : source[i]!;
    if (source[i] === '\r' && source[i + 1] === '\n') i++;
    chars.push({ text, start, end: i + 1 });
  }
  const normalized = chars.map(c => c.text).join('');
  const kept: typeof chars = [];
  let position = 0;
  for (const match of normalized.matchAll(/^\s*%%(?!{)[^\n]+\n?/gm)) {
    kept.push(...chars.slice(position, match.index));
    position = match.index + match[0].length;
  }
  kept.push(...chars.slice(position));
  const text = kept.map(c => c.text).join('');
  const offset = text.length - text.trimStart().length;
  const locations = kept.slice(offset);
  return {
    text: text.trimStart(),
    span(location: Location): Span {
      const [start, end] = location.range;
      if (!locations[start] || !locations[end - 1] || end <= start) return unsupported('invalid parser range');
      return { start: locations[start]!.start, end: locations[end - 1]!.end };
    },
  };
}

export async function traceFlowchart(source: string, mermaid: MermaidParserHost): Promise<SourceMapping> {
  if (source.length > 50_000) return unsupported('source exceeds 50000 UTF-16 units');
  const prepared = prepare(source);
  if (!/^(?:flowchart|graph)\s+(?:LR|RL|TB|BT|TD)\b/.test(prepared.text)) return unsupported('flowchart header required');
  if (/[<&`]|%%\{|#\w+;/.test(prepared.text)) return unsupported('HTML, entities, Markdown labels or directives');
  const diagram = await mermaid.mermaidAPI.getDiagramFromText('flowchart LR\n') as { parser: { parser: Parser }; db: FlowDb };
  if (!diagram.parser?.parser?.Parser || !diagram.db?.constructor) return unsupported('Mermaid 12 parser interface required');
  const parser = new diagram.parser.parser.Parser();
  const db = new diagram.db.constructor();
  parser.yy = db;
  parser.lexer = Object.create(parser.lexer) as Parser['lexer'];
  parser.lexer.options = { ...parser.lexer.options, ranges: true };
  const pending: Omit<Piece, 'domId'>[] = [];
  const texts = new WeakMap<object, Span>();
  const links = new WeakMap<object, { span: Span; labelSpan?: Span }>();
  const declarations = new Set<string>();
  const originalAction = parser.performAction;
  const label = (value: unknown): Span | undefined => {
    const span = typeof value === 'object' && value !== null ? texts.get(value) : undefined;
    if (span && /[\r\n]/.test(source.slice(span.start, span.end))) return unsupported('multiline labels');
    return span;
  };
  parser.performAction = function (...args) {
    const [, , , , state, values] = args;
    const production = parser.productions_[state];
    if (!production) return unsupported('unknown grammar production');
    const [symbol] = production;
    const result = originalAction.apply(this, args);
    if (['styleStatement', 'linkStyleStatement', 'classDefStatement', 'classStatement', 'clickStatement', 'shapeData'].some(name => symbol === parser.symbols_[name])) {
      return unsupported('styles, clicks or shape metadata');
    }
    if (symbol === parser.symbols_.node && production[1] !== 1) return unsupported('compound node lists');
    if (symbol === parser.symbols_.text && typeof this.$ === 'object' && this.$ !== null) {
      texts.set(this.$, prepared.span(this._$));
    }
    if (symbol === parser.symbols_.vertex) {
      const rhs = values.slice(-production[1]);
      const bare = rhs.length === 1;
      const delimiters: Record<string, string> = { '[': ']', '(': ')', '{': '}' };
      if (!bare && !(rhs.length === 4 && typeof rhs[1] === 'string'
        && Object.hasOwn(delimiters, rhs[1]) && delimiters[rhs[1]] === rhs[3])) return unsupported('node shape');
      if (typeof this.$ !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(this.$)) return unsupported('node ID');
      const labelSpan = bare ? undefined : label(rhs[2]);
      if (!bare && !labelSpan) return unsupported('missing label provenance');
      if (labelSpan && declarations.has(this.$)) return unsupported('multiple label declarations for one node');
      if (labelSpan) declarations.add(this.$);
      pending.push({ id: `p${pending.length}`, kind: 'node', semanticId: this.$, span: prepared.span(this._$), ...(labelSpan ? { labelSpan } : {}) });
    }
    if (symbol === parser.symbols_.link) {
      if (typeof this.$ !== 'object' || this.$ === null) return unsupported('edge syntax');
      const link = this.$ as { type: string; stroke: string; length: number; text?: unknown };
      if (link.type !== 'arrow_point' || link.stroke !== 'normal' || link.length !== 1) return unsupported('edge type');
      const raw = prepared.span(this._$);
      const value = source.slice(raw.start, raw.end);
      const syntax = value.trim();
      if (!syntax.startsWith('-->') || (syntax.slice(3).trim() !== ''
        && !(syntax.slice(3).trim().startsWith('|') && syntax.endsWith('|')))) return unsupported('edge syntax');
      const span = { start: raw.start + value.length - value.trimStart().length, end: raw.end - value.length + value.trimEnd().length };
      const labelSpan = label(link.text);
      if (link.text && !labelSpan) return unsupported('missing edge label provenance');
      links.set(link, { span, ...(labelSpan ? { labelSpan } : {}) });
    }
    return result;
  };
  const addSingleLink = db.addSingleLink;
  db.addSingleLink = (...args) => {
    const provenance = typeof args[2] === 'object' && args[2] !== null ? links.get(args[2]) : undefined;
    if (!provenance) return unsupported('missing edge provenance');
    const result = addSingleLink.apply(db, args);
    const edge = db.getEdges().at(-1)!;
    pending.push({ id: `p${pending.length}`, kind: 'edge', semanticId: edge.id, from: edge.start, to: edge.end, ...provenance });
    return result;
  };
  parser.parse(prepared.text + '\n');
  const data = db.getData();
  const pieces = pending.map(piece => {
    const domId = piece.kind === 'node'
      ? data.nodes.find(node => node.id === piece.semanticId)?.domId
      : data.edges.find(edge => edge.id === piece.semanticId)?.id;
    if (!domId) return unsupported(`missing visual identity for ${piece.semanticId}`);
    return { ...piece, domId };
  });
  return { format: 'mermaid-trace/0', source, pieces };
}
