export type Span = { readonly start: number; readonly end: number };
export type Piece = {
  readonly id: string;
  readonly kind: 'node' | 'edge' | 'note' | 'activation' | 'control';
  readonly semanticId: string;
  readonly domId: string;
  readonly span: Span;
  readonly labelSpan?: Span;
  readonly effective?: boolean;
  readonly from?: string;
  readonly to?: string;
};
export type SourceMapping = {
  readonly format: 'mermaid-trace/0' | 'mermaid-trace/1';
  readonly source: string;
  readonly pieces: readonly Piece[];
};
