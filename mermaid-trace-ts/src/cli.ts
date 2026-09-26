#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { watchPreview } from './watch.js';

const usage = 'Usage: mermaid-trace watch <file.md|file.mmd> [--port N]\nWatch Markdown (.md/.markdown) or Mermaid (.mmd/.mermaid); serves a localhost preview.\nPort 0 chooses an available port. Open the printed URL in your browser.';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, port: { type: 'string' } } });
  if (values.help) console.log(usage);
  else {
    if (positionals.length !== 2 || positionals[0] !== 'watch') throw new Error(usage);
    if (values.port !== undefined && !/^\d+$/.test(values.port)) throw new Error('Port must be an integer from 0 to 65535');
    const preview = await watchPreview(positionals[1]!, { port: values.port === undefined ? 5173 : Number(values.port) });
    console.log(`Watching ${positionals[1]}\n${preview.url}`);
    const stop = () => { void preview.close().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
