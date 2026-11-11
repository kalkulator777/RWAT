/**
 * The little markup the help is written in (./topics.ts), read into blocks a component
 * draws without any HTML of the text's own: nothing in a topic is markup the page would run.
 *
 * - Blocks are separated by a blank line: `## A heading` (the lines right under it are a
 *   block of their own), a list whose every line starts with `- ` (or `1. ` for a numbered
 *   one), or else a paragraph (its lines joined).
 * - Inline: `` `code` ``; `{{Ctrl+Z}}` a key; `**words**` stressed; `[[newpack.addFiles]]`
 *   the interface's own label of that i18n key, so the help names a button as the button
 *   says it, in either language; `[words](#topic)` a link to another topic of the help;
 *   `[words](https://…)` a link out.
 *
 * Pure: no DOM.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'key'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'label'; key: string }
  | { kind: 'link'; text: string; topic: string }
  | { kind: 'external'; text: string; href: string };

export type Block =
  | { kind: 'heading'; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] };

const INLINE = /`([^`]+)`|\{\{([^}]+)\}\}|\*\*([^*]+)\*\*|\[\[([a-zA-Z0-9_.-]+)\]\]|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** The inline parts of a line of text. */
export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index;
    if (at > last) parts.push({ kind: 'text', text: text.slice(last, at) });
    const [, code, key, strong, label, words, target] = match;
    if (code !== undefined) parts.push({ kind: 'code', text: code });
    else if (key !== undefined) parts.push({ kind: 'key', text: key });
    else if (strong !== undefined) parts.push({ kind: 'strong', text: strong });
    else if (label !== undefined) parts.push({ kind: 'label', key: label });
    else if (target?.startsWith('#') === true) parts.push({ kind: 'link', text: words ?? '', topic: target.slice(1) });
    else parts.push({ kind: 'external', text: words ?? '', href: target ?? '' });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

const BULLET = /^- /;
const NUMBER = /^\d+\. /;

/** The blocks of a topic's text. */
export function parseHelp(text: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.trim().split(/\n\s*\n/)) {
    let lines = chunk
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    // a heading is a block of its own, the lines under it another
    const first = lines[0];
    if (first?.startsWith('## ') === true) {
      blocks.push({ kind: 'heading', inline: parseInline(first.slice(3)) });
      lines = lines.slice(1);
    }
    if (lines.length === 0) continue;
    if (lines.every((line) => BULLET.test(line))) blocks.push({ kind: 'list', ordered: false, items: lines.map((line) => parseInline(line.replace(BULLET, ''))) });
    else if (lines.every((line) => NUMBER.test(line))) blocks.push({ kind: 'list', ordered: true, items: lines.map((line) => parseInline(line.replace(NUMBER, ''))) });
    else blocks.push({ kind: 'paragraph', inline: parseInline(lines.join(' ')) });
  }
  return blocks;
}

/** Every inline part of the blocks, in order. */
export function inlines(blocks: readonly Block[]): Inline[] {
  return blocks.flatMap((block) => (block.kind === 'list' ? block.items.flat() : block.inline));
}
