import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { SourceMapping } from '../source-mapping.js';

/** One native Rust process owns the Merman engine across preview revisions. */
export async function createMermanProducer() {
  const binary = fileURLToPath(new URL('../../../../mermaid-trace-rs/target/debug/mermaid-trace-rs', import.meta.url));
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let diagnostic = '';
  let stopped = false;
  child.on('exit', () => { stopped = true; });
  child.stdin.on('error', error => { stopped = true; diagnostic = String(error); });
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + String(chunk)).slice(-4000); });
  const exited = once(child, 'exit');
  // A failed spawn also rejects the exit waiter; observe it even before close().
  void exited.catch(() => {});
  try { await once(child, 'spawn'); }
  catch (error) { throw new Error(`Native renderer unavailable; run pnpm native:build. ${String(error)}`); }
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  const request = (input: unknown) => {
    if (closed) return Promise.reject(new Error('Merman producer is closed'));
    const result = queue.then(async () => {
      if (stopped) throw new Error(`Native renderer stopped: ${diagnostic}`);
      child.stdin.write(JSON.stringify(input) + '\n');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const line = await Promise.race([
          lines.next(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { stopped = true; child.kill(); reject(new Error('Native renderer timed out')); }, 10_000); }),
        ]);
        if (line.done) throw new Error(`Native renderer stopped: ${diagnostic}`);
        const reply = JSON.parse(line.value) as { error?: string; result?: unknown };
        if (reply.error) throw new Error(reply.error);
        if (!('result' in reply)) throw new Error('Missing native render result');
        return reply.result;
      } finally { clearTimeout(timer); }
    });
    queue = result.catch(() => {});
    return result;
  };
  const supportedDiagrams = await request({ operation: 'catalog' }) as readonly string[];
  if (!Array.isArray(supportedDiagrams) || !supportedDiagrams.every(value => typeof value === 'string')) {
    child.kill(); throw new Error('Invalid Merman diagram catalog');
  }
  let closing: Promise<void> | undefined;
  return {
    supportedDiagrams,
    async render(id: string, source: string) {
      if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Diagram ID must be safe for SVG');
      if (!source.length || source.length > 50_000) throw new Error('Invalid Mermaid source length');
      return await request({ id, source }) as { readonly source: string; readonly semantic: unknown; readonly svg: string; readonly mapping: SourceMapping };
    },
    close() {
      if (!closing) {
        closed = true;
        closing = queue.then(async () => { child.stdin.end(); await exited; });
      }
      return closing;
    },
  };
}
