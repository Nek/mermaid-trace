import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderReferences } from '../src/producer/mermaid-browser.js';
import type { Fixture } from '../src/producer/mermaid-browser.js';
export { renderReferences, forkBundle } from '../src/producer/mermaid-browser.js';

export async function readFixtures(): Promise<readonly Fixture[]> {
  const directory = 'test/fixtures/flowchart';
  const names = (await readdir(directory)).filter(name => name.endsWith('.mmd')).sort();
  assert.ok(names.length, 'No Mermaid fixtures found');
  return Promise.all(names.map(async name => ({
    id: name.slice(0, -4), source: await readFile(`${directory}/${name}`, 'utf8'),
  })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.deepEqual(process.argv.slice(2), ['--update'], 'Usage: pnpm snapshots:update');
  const fixtures = await readFixtures();
  const reference = await renderReferences(fixtures);
  for (const inputs of [[...fixtures].reverse(), fixtures]) {
    const repeated = await renderReferences(inputs);
    assert.deepEqual(repeated, reference, 'Renderer is not repeatable; baselines were not written');
  }
  await mkdir('test/baselines', { recursive: true });
  for (const { id } of fixtures) {
    await writeFile(`test/baselines/${id}.svg`, reference.svgs[id]!);
  }
  await writeFile('test/baselines/environment.json', JSON.stringify(reference.environment, null, 2) + '\n');
  console.log(`Updated ${fixtures.length} upstream SVG baselines after three identical browser passes. Review the diff before committing.`);
}
