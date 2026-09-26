import MarkdownIt from 'markdown-it';
import type { MarkdownBlock, MarkdownDocument, Origin } from './markdown-source.js';

export function prepareMarkdown(document: MarkdownDocument, namespace: string): {
  blocks: readonly MarkdownBlock[];
  render(artifacts: ReadonlyMap<string, string>): string;
} {
  if (!/^[a-z][a-z0-9-]*$/.test(namespace)) throw new Error('Invalid Markdown namespace');
  const md = new MarkdownIt({ html: false });
  const env = {};
  const tokens = md.parse(document.source, env);
  const lines = [...document.source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)].filter(line => line[0].length);
  const blocks: MarkdownBlock[] = [];
  const byToken = new Map<number, MarkdownBlock>();
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'fence' || token.info.trim().split(/\s+/)[0] !== 'mermaid') continue;
    if (!token.map) throw new Error('Missing Markdown fence line range');
    const origins: Origin[] = [];
    const contentLines = [...token.content.matchAll(/[^\n]*(?:\n|$)/g)].filter(line => line[0].length);
    for (const [row, content] of contentLines.entries()) {
      const original = lines[token.map[0] + 1 + row];
      const logicalText = content[0].replace(/\n$/, '');
      const originalText = original?.[0].replace(/(?:\r\n|\r|\n)$/, '');
      if (!original || originalText === undefined || !originalText.replace(/\0/g, '\uFFFD').endsWith(logicalText)) {
        throw new Error(`Unsupported Markdown provenance in ${namespace}-${blocks.length}: indentation expands or changes content`);
      }
      const originalEnd = original.index + originalText.length;
      if (logicalText.length) origins.push({
        logical: { start: content.index, end: content.index + logicalText.length },
        original: { start: originalEnd - logicalText.length, end: originalEnd },
      });
      if (content[0].endsWith('\n')) {
        if (originalText.length === original[0].length) throw new Error('Unsupported Markdown provenance: synthetic newline');
        origins.push({ logical: { start: content.index + logicalText.length, end: content.index + content[0].length },
          original: { start: originalEnd, end: original.index + original[0].length } });
      }
    }
    const block = { id: `${namespace}-${blocks.length}`, source: token.content, document: { ...document }, origins,
      span: { start: lines[token.map[0]]!.index, end: lines[token.map[1]]?.index ?? document.source.length } };
    blocks.push(block);
    byToken.set(index, block);
  }
  const fence = md.renderer.rules.fence!;
  return {
    blocks,
    render(artifacts) {
      md.renderer.rules.fence = (items, index, options, environment, renderer) => {
        const block = byToken.get(index);
        if (!block) return fence(items, index, options, environment, renderer);
        const svg = artifacts.get(block.id);
        if (svg === undefined) throw new Error(`Missing SVG artifact: ${block.id}`);
        return `<div data-mt-block="${block.id}">${svg}</div>\n`;
      };
      return md.renderer.render(tokens, md.options, env);
    },
  };
}
