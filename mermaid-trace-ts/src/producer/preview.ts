import { createMermanProducer, type RenderDiagnostic } from './merman.js';

export async function createPreviewProducer() {
  const native = await createMermanProducer();
  return {
    async render(inputs: readonly { readonly id: string; readonly source: string }[]) {
      const ids = new Set<string>();
      for (const { id } of inputs) {
        if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Diagram ID must be safe for SVG');
        if (ids.has(id)) throw new Error(`Duplicate diagram ID: ${id}`);
        ids.add(id);
      }
      const svgs: Record<string, string> = {};
      const diagramOnly: string[] = [];
      const diagnostics: (RenderDiagnostic & { readonly id: string })[] = [];
      for (const input of inputs) {
        const result = await native.render(`baseline-${input.id}`, input.source);
        svgs[input.id] = result.svg;
        diagnostics.push(...(result.diagnostics ?? []).map(diagnostic => ({ ...diagnostic, id: input.id })));
        if (!result.mapping.pieces.length) diagramOnly.push(input.id);
      }
      return { svgs, diagramOnly, diagnostics };
    },
    close: native.close,
  };
}
