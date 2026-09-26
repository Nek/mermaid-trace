import assert from 'node:assert/strict';
import test from 'node:test';
import { createMermanProducer } from '../src/producer/merman.js';

const sequence = 'sequenceDiagram\r\n%% 😀 repeated labels\r\nparticipant Alice\r\nparticipant Bob\r\nAlice->>Bob: same\r\nBob-->>Alice: same\r\n';

test('MERMAN-AC1/2: native SVG preserves input and identities, repeats deterministically and reports missing provenance', async () => {
  const producer = await createMermanProducer();
  try {
    assert.ok(producer.supportedDiagrams.includes('sequence'));
    assert.equal(typeof globalThis.document, 'undefined');
    const first = await producer.render('sequence-one', sequence);
    assert.equal(first.source, sequence);
    assert.match(first.svg, /^<svg id="sequence-one"/);
    assert.doesNotMatch(first.svg, /<script\b|<foreignObject\b|\son\w+=|https?:\/\/[^" ]+\.(?:js|css)/i);
    assert.deepEqual((first.semantic as { messages: { message: string }[] }).messages.map(message => message.message), ['same', 'same']);
    assert.deepEqual(first.mapping, { status: 'unavailable', reason: 'Merman native binding does not expose source-to-visual provenance' });
    const other = await producer.render('flowchart-two', 'flowchart LR\nA[Draft] -->|review| B[Publish]');
    assert.match(other.svg, /^<svg id="flowchart-two"/);
    assert.equal((other.semantic as { type: string }).type, 'flowchart-v2');
    assert.deepEqual(await producer.render('sequence-one', sequence), first);
    const instance = await producer.render('sequence-other', sequence);
    assert.match(instance.svg, /^<svg id="sequence-other"/);
    assert.doesNotMatch(instance.svg, /sequence-one/);
    for (const [id, source] of [['unsafe"', sequence], ['limit', 'x'.repeat(50_001)], ['empty', '']]) {
      await assert.rejects(producer.render(id!, source!), /ID|source/i);
    }
    await assert.rejects(producer.render('invalid', 'flowchart LR\nA -->'), /parse|syntax/i);
    await assert.rejects(producer.render('unsupported', 'agentflow\nA --> B'), /unsupported|diagram|parse/i);
    assert.deepEqual(await producer.render('sequence-one', sequence), first, 'errors do not poison the engine');
  } finally { await producer.close(); }
  await producer.close();
  await assert.rejects(producer.render('closed', sequence), /disposed|closed/i);
});

test('MERMAN-AC2/3: preview uses native sequence SVG and preserves mapped flowcharts during migration', async () => {
  const { createPreviewProducer } = await import('../src/producer/preview.js');
  const preview = await createPreviewProducer();
  const native = await createMermanProducer();
  try {
    const result = await preview.render([
      { id: 'sequence', source: sequence },
      { id: 'flowchart', source: 'flowchart LR\nA -->|review| B' },
    ]);
    const svg = result.svgs.sequence!;
    assert.equal(svg.replace(/ data-mt-map="[^"]*"/, ''), (await native.render('baseline-sequence', sequence)).svg);
    const mapping = JSON.parse(decodeURIComponent(svg.match(/ data-mt-map="([^"]*)"/)![1]!));
    assert.equal(mapping.source, sequence);
    assert.deepEqual(mapping.pieces, []);
    assert.deepEqual(result.diagramOnly, ['sequence']);
    assert.match(result.svgs.flowchart!, /data-mt-role="edge-label"/);
    assert.deepEqual(await preview.render([]), { svgs: {}, diagramOnly: [] });
    await assert.rejects(preview.render([{ id: 'same', source: sequence }, { id: 'same', source: sequence }]), /duplicate/i);
    await assert.rejects(preview.render([{ id: 'unsafe"', source: sequence }]), /ID/i);
  } finally { await preview.close(); await native.close(); }
});
