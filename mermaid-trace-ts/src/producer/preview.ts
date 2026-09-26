import { createMermanProducer } from './merman.js';
import { renderReferences } from './mermaid-browser.js';
import type { SourceMapping } from '../source-mapping.js';

/** Transitional routing: retain exact legacy flowchart selection until native mapped parity. */
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
      const flowcharts: { readonly id: string; readonly source: string }[] = [];
      for (const input of inputs) {
        const result = await native.render(`baseline-${input.id}`, input.source);
        const semantic = result.semantic;
        if (!semantic || typeof semantic !== 'object' || !('type' in semantic)) throw new Error('Missing Merman diagram type');
        if (semantic.type === 'flowchart-v2' || semantic.type === 'flowchart') {
          flowcharts.push(input);
          continue;
        }
        const mapping: SourceMapping = { format: 'mermaid-trace/0', source: result.source, pieces: [] };
        // Native resvg-safe output is already validated SVG. Add inert root metadata only;
        // activation validates the saved artifact independently in the host DOM.
        if (!result.svg.startsWith('<svg ')) throw new Error('Unexpected Merman SVG root');
        svgs[input.id] = result.svg.replace('<svg ', `<svg data-mt-map="${encodeURIComponent(JSON.stringify(mapping))}" `);
        diagramOnly.push(input.id);
      }
      if (flowcharts.length) Object.assign(svgs, (await renderReferences(flowcharts, true)).svgs);
      return { svgs, diagramOnly };
    },
    close: native.close,
  };
}
