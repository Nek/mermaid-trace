import { createNodeEngine } from '@mermanjs/node';

/** Native rendering only; exact occurrence bindings need an upstream provenance export. */
export async function createMermanProducer() {
  const engine = await createNodeEngine({ bindingOptions: { version: 2, runtime_policy: 'deterministic' } });
  const catalog: unknown = JSON.parse(engine.metadataJson('supported-diagrams'));
  if (!Array.isArray(catalog) || !catalog.every(value => typeof value === 'string')) {
    await engine.dispose();
    throw new Error('Invalid Merman supported-diagram catalog');
  }
  return {
    supportedDiagrams: catalog as readonly string[],
    async render(id: string, source: string) {
      if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Diagram ID must be safe for SVG');
      if (!source.length || source.length > 50_000) throw new Error('Diagram source must contain 1–50000 UTF-16 units');
      const optionsJson = JSON.stringify({
        svg: { pipeline: 'resvg-safe', diagram_id: id },
        site_config: { htmlLabels: false, deterministicIds: true, deterministicIDSeed: 'mermaid-trace', layout: 'dagre' },
      });
      const result = await engine.executeOperation({ operationId: 'semantic-json', source, optionsJson }, { timeoutMs: 10_000 });
      const semantic: unknown = JSON.parse(result.data);
      const svg = await engine.renderSvg(source, { optionsJson, timeoutMs: 10_000 });
      return {
        source, semantic, svg,
        mapping: { status: 'unavailable' as const, reason: 'Merman native binding does not expose source-to-visual provenance' },
      };
    },
    close: () => engine.dispose(),
  };
}
