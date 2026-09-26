import { createMermanProducer } from './merman.js';

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
      for (const input of inputs) {
        const result = await native.render(`baseline-${input.id}`, input.source);
        svgs[input.id] = result.svg;
        if (!result.mapping.pieces.length) diagramOnly.push(input.id);
      }
      return { svgs, diagramOnly };
    },
    close: native.close,
  };
}
