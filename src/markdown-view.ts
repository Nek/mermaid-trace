import type { Span } from './source-mapping.js';
import type { MarkdownBlock, MarkdownDocument } from './markdown-source.js';
import MarkdownIt from 'markdown-it';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toHast } from 'mdast-util-to-hast';
import { sanitize } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';
import type { Nodes as MarkdownNode } from 'mdast';
import type { Root, RootContent, Element } from 'hast';

export type DocumentTarget = { readonly id: string; readonly kind: string; readonly span: Span };
export type DocumentText = { readonly id: string; readonly value: string; readonly origins: readonly Span[]; readonly exact: boolean };
export type DocumentView = { readonly html: string; readonly targets: readonly DocumentTarget[]; readonly texts: readonly DocumentText[] };

const normalize = (value: string) => value.replace(/\r\n|\r/g, '\n');
const decode = new MarkdownIt().utils.unescapeAll;

function units(raw: string, start: number, literal: boolean) {
  const result: { value: string; span: Span }[] = [];
  for (let i = 0; i < raw.length;) {
    let token = raw[i]!;
    if (token === '\r') token = raw[i + 1] === '\n' ? '\r\n' : '\r';
    else if (!literal && token === '\\' && i + 1 < raw.length && decode(raw.slice(i, i + 2)) !== raw.slice(i, i + 2)) token = raw.slice(i, i + 2);
    else if (!literal && token === '&') token = raw.slice(i).match(/^&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]+);/)?.[0] ?? token;
    const value = normalize(literal ? token : decode(token)).replace(/\0/g, '\uFFFD');
    for (const char of value.split('')) result.push({ value: char, span: { start: start + i, end: start + i + token.length } });
    i += token.length;
  }
  return result;
}

export function renderMarkdownView(document: MarkdownDocument, blocks: readonly MarkdownBlock[], svgs: ReadonlyMap<string, string>): DocumentView {
  const tree = fromMarkdown(document.source);
  const targets: DocumentTarget[] = [];
  const texts: DocumentText[] = [];
  const nodes = new Map<string, MarkdownNode>();
  const textMaps = new Map<string, Omit<DocumentText, 'id'>>();
  const lines = [...document.source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)];
  const key = (node: { position?: MarkdownNode['position'] }) => `${node.position?.start.offset}:${node.position?.end.offset}`;
  const spanOf = (node: { position?: MarkdownNode['position'] }): Span => ({ start: node.position!.start.offset!, end: node.position!.end.offset! });
  const visitMarkdown = (node: MarkdownNode) => {
    if (node.position) nodes.set(key(node), node);
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
      const span = spanOf(node);
      const raw = document.source.slice(span.start, span.end);
      const value = (node.type === 'inlineCode' ? normalize(node.value).replace(/\n/g, ' ') : normalize(node.value)) + (node.type === 'code' ? '\n' : '');
      let mapped: { value: string; span: Span }[] = [];
      if (node.type === 'inlineCode') {
        const width = raw.match(/^`+/)![0].length;
        mapped = units(raw.slice(width, -width), span.start + width, true).map(unit => ({ ...unit, value: unit.value === '\n' ? ' ' : unit.value }));
        if (mapped[0]?.value === ' ' && mapped.at(-1)?.value === ' ' && mapped.some(unit => unit.value !== ' ')) mapped = mapped.slice(1, -1);
      } else {
        const fenced = node.type === 'code' && /^(?:`{3,}|~{3,})/.test(raw);
        const startRow = node.position!.start.line - 1 + Number(fenced);
        const contentLines = [...value.matchAll(/[^\n]*(?:\n|$)/g)].filter(line => line[0].length);
        for (const [row, logical] of contentLines.entries()) {
          const original = lines[startRow + row];
          if (!original) break;
          const body = original[0].replace(/(?:\r\n|\r|\n)$/, '');
          const start = node.type === 'text' && row === 0 ? span.start : original.index;
          const end = node.type === 'text' ? Math.min(original.index + body.length, span.end) : original.index + body.length;
          const decoded = units(document.source.slice(start, end), start, node.type === 'code');
          const expected = logical[0].replace(/\n$/, '');
          if (!decoded.map(unit => unit.value).join('').endsWith(expected)) break;
          mapped.push(...decoded.slice(decoded.length - expected.length));
          if (logical[0].endsWith('\n')) mapped.push({ value: '\n', span: { start: end, end: Math.min(document.source.length, original.index + original[0].length) } });
        }
      }
      const exact = mapped.map(unit => unit.value).join('') === value;
      textMaps.set(key(node), { value, exact, origins: exact ? mapped.map(unit => unit.span) : value.split('').map(() => span) });
    }
    if ('children' in node) node.children.forEach(visitMarkdown);
  };
  visitMarkdown(tree);
  const safe = sanitize(toHast(tree)) as Root;
  const visitHtml = (node: Root | RootContent, parent?: Element): Root | RootContent => {
    if (node.type === 'text') {
      node.value = normalize(node.value);
      const mapping = textMaps.get(key(node)) ?? (parent?.tagName === 'code' ? textMaps.get(key(parent)) : undefined);
      if (!mapping || mapping.value !== node.value) return node;
      const text = { ...mapping, id: `text-${texts.length}` };
      texts.push(text);
      return { type: 'element', tagName: 'span', properties: { 'data-md-text': text.id }, children: [node] };
    }
    if (node.type !== 'element' && node.type !== 'root') return node;
    if (node.type === 'element' && node.position) {
      const original = nodes.get(key(node));
      if (node.tagName === 'pre' && original?.type === 'code' && original.lang === 'mermaid') {
        const block = blocks.find(block => original.position!.start.offset! >= block.span.start && original.position!.start.offset! < block.span.end);
        if (!block || normalize(original.value) !== block.source.replace(/\n$/, '')) throw new Error('Markdown parser fence provenance disagrees');
        const svg = svgs.get(block.id);
        if (svg === undefined) throw new Error(`Missing SVG artifact: ${block.id}`);
        return { type: 'element', tagName: 'div', properties: { 'data-mt-block': block.id }, children: [{ type: 'raw', value: svg }] };
      }
      if (/^(p|h[1-6]|blockquote|ul|ol|li|pre|hr)$/.test(node.tagName)) {
        const target = { id: `block-${targets.length}`, kind: node.tagName, span: spanOf(node) };
        targets.push(target);
        node.properties['data-md-target'] = target.id;
        node.properties.tabIndex = 0;
      }
    }
    node.children = node.children.map(child => visitHtml(child, node.type === 'element' ? node : undefined) as RootContent) as typeof node.children;
    return node;
  };
  visitHtml(safe);
  return { html: toHtml(safe, { allowDangerousHtml: true }), targets, texts };
}
