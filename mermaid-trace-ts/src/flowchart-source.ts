import type { Piece, SourceMapping } from './source-mapping.js';

export type MermaidRenderHost = {
  render(id: string, source: string, container?: Element, options?: { sourceMap: boolean }): Promise<{
    svg: string;
    sourceMap?: { source: string; pieces: readonly Omit<Piece, 'id'>[] };
  }>;
};

export async function renderFlowchart(id: string, source: string, mermaid: MermaidRenderHost) {
  const { svg, sourceMap } = await mermaid.render(id, source, undefined, { sourceMap: true });
  if (!sourceMap || sourceMap.source !== source) {
    throw new Error('Mermaid source-map API required; build the documented Mermaid fork');
  }
  const declarations = new Set<string>();
  const pieces = sourceMap.pieces.map((piece, index) => {
    if (piece.kind === 'node' && piece.labelSpan) {
      if (declarations.has(piece.semanticId)) {
        throw new Error('Unsupported mapping: multiple label declarations for one node');
      }
      declarations.add(piece.semanticId);
    }
    return { ...piece, id: `p${index}` };
  });
  const mapping: SourceMapping = { format: 'mermaid-trace/0', source, pieces };
  return { svg, mapping };
}
