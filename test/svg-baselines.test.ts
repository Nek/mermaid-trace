import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readFixtures, renderReferences } from '../scripts/svg-baselines.js';

test('BASE-AC1/2: raw SVG matches baselines across fresh browsers and fixture order', async () => {
  const fixtures = await readFixtures();
  assert.ok(fixtures.length >= 4, 'Expected the initial fixture corpus');
  const expected = new Map(await Promise.all(fixtures.map(async ({ id }) => [
    id, await readFile(`test/baselines/${id}.svg`, 'utf8'),
  ] as const)));
  const manifest = JSON.parse(await readFile('test/baselines/environment.json', 'utf8'));

  for (const inputs of [fixtures, [...fixtures].reverse(), fixtures]) {
    const result = await renderReferences(inputs);
    assert.deepEqual(result.environment, manifest, 'Rendering environment changed; review before updating baselines');
    for (const { id } of inputs) {
      const svg = result.svgs[id];
      assert.ok(typeof svg === 'string' && svg.startsWith('<svg'), `${id}: no SVG`);
      assert.match(svg, /class="node /, `${id}: no rendered node`);
      assert.match(svg, /class="[^"]*flowchart-link/, `${id}: no rendered edge`);
      assert.equal(svg, expected.get(id), `${id}: SVG differs from upstream baseline`);
    }
  }
});

test('BASE-AC4: invalid Mermaid rejects instead of becoming a baseline', async () => {
  await assert.rejects(
    renderReferences([{ id: 'invalid', source: 'flowchart LR\nA[unterminated' }]),
    /Parse error/,
  );
});
