/**
 * Minimal edits of a JSON file (editor.md §3.6): the text of a changed file is its
 * original text with only the changed places rewritten. Everything else — indents, the
 * order of keys, the way numbers are written (`20.0`), one-line arrays, comments, the
 * BOM, the line ends — stays byte for byte.
 *
 * How: the old value and the new one are compared member by member and element by
 * element (arrays by their common head and tail, so one element inserted or removed is
 * one edit), and each difference becomes one edit of the text at the place jsonc-parser's
 * syntax tree gives:
 *
 * - a changed scalar, or a value whose type changed, is replaced where it stands; a
 *   whole number put where the file wrote a float (`20.0`) keeps the float's form (`21.0`);
 * - a member removed takes its line with it (and the comma before it, when it was the
 *   last); on a one-line object only its own text and one comma go;
 * - a member added goes after the last one, on a line of its own in the file's indent,
 *   or inline (`, "key": value`) in a one-line object;
 * - array elements likewise, at their place;
 * - an empty object or array, or one that becomes empty, is replaced whole;
 * - of duplicate keys the last is the one edited (it is the one that counts), and a
 *   removed key goes with all its duplicates.
 *
 * New values are written as dump writes them (./dump.ts) in the file's indent unit and
 * line end. jsonc-parser's own `modify` is not used for the text: it reformats every line
 * an edit touches with its formatter, which puts each element of `[1.0, 2.0]` on a line
 * of its own and rewrites numbers through `JSON.stringify`.
 *
 * The result is read back and compared with the new value; if the two differ (a text
 * that does not hold the old value, a layout too odd for the rules above) or the text is
 * not JSON, the file is written whole in its own indent instead, and the result says so.
 */

import type { Node } from 'jsonc-parser';
import { type TextStyle, encodeInline, encodeValue } from './dump';
import { isFloatLexeme, pythonFloat } from './numbers';
import { JsonSyntaxError, memberNode, nodeAt, parseBody, parseJson, splitBom } from './parse';
import { deepEqual, isJsonObject } from './value';

/** What {@link editJson} made. */
export interface EditResult {
  text: string;
  /** True when the minimal edits did not give the value and the text was written whole. */
  rewritten: boolean;
}

interface TextEdit {
  offset: number;
  length: number;
  content: string;
}

/** How the text after a value goes on, up to the end of its line. */
interface Trailing {
  /** Offset of a comma right after the value, or −1. */
  comma: number;
  /** Where the comma, blanks and comments that follow on the same line end. */
  end: number;
  /** True when nothing but those follows up to the line end (or the end of the text). */
  atEol: boolean;
  /** Offset just past that line end. */
  next: number;
}

function isBlank(c: string | undefined): boolean {
  return c === ' ' || c === '\t';
}

/** The text's indent unit and line end, from the first container whose members sit on lines of their own. */
export function detectStyle(body: string, root: Node | undefined): TextStyle {
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const queue: Node[] = root === undefined ? [] : [root];
  for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
    const children = node.children ?? []; // members as property nodes: their line is the key's
    const first = children[0];
    if ((node.type === 'object' || node.type === 'array') && first !== undefined && ownLine(body, first.offset)) {
      const outer = lineIndent(body, node.offset);
      const inner = lineIndent(body, first.offset);
      if (inner.length > outer.length && inner.startsWith(outer)) return { unit: inner.slice(outer.length), eol };
    }
    for (const child of children) {
      const value = child.type === 'property' ? child.children?.[1] : child;
      if (value !== undefined) queue.push(value);
    }
  }
  // no tree (not JSON) or nothing on lines of its own: the first indented line, if any
  const indented = root === undefined ? /^([ \t]+)\S/m.exec(body) : null;
  return { unit: indented?.[1] ?? '  ', eol };
}

function lineStart(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && text[i - 1] !== '\n' && text[i - 1] !== '\r') i--;
  return i;
}

function lineIndent(text: string, offset: number): string {
  const start = lineStart(text, offset);
  let end = start;
  while (isBlank(text[end])) end++;
  return text.slice(start, end);
}

/** True when only blanks stand before the offset on its line. */
function ownLine(text: string, offset: number): boolean {
  for (let i = lineStart(text, offset); i < offset; i++) if (!isBlank(text[i])) return false;
  return true;
}

function trailing(text: string, offset: number): Trailing {
  let i = offset;
  const skipBlanks = (): void => {
    while (isBlank(text[i])) i++;
  };
  skipBlanks();
  let comma = -1;
  if (text[i] === ',') {
    comma = i++;
    skipBlanks();
  }
  for (;;) {
    if (text.startsWith('//', i)) {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
    } else if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      if (close < 0 || /[\r\n]/.test(text.slice(i, close))) break;
      i = close + 2;
      skipBlanks();
      continue;
    }
    break;
  }
  const end = i;
  const atEol = i >= text.length || text[i] === '\n' || text[i] === '\r';
  const next = text.startsWith('\r\n', i) ? i + 2 : atEol && i < text.length ? i + 1 : i;
  return { comma, end, atEol, next };
}

/** Offset of the comma that follows a value (blanks, line ends and comments between), or −1. */
function commaAfter(text: string, offset: number): number {
  let i = offset;
  for (;;) {
    while (/\s/.test(text[i] ?? '')) i++;
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      return text[i] === ',' ? i : -1;
    }
  }
}

function isEmptyContainer(value: unknown): boolean {
  return Array.isArray(value) ? value.length === 0 : isJsonObject(value) && Object.keys(value).length === 0;
}

/** The working text and the edits on it; every step reads the tree of the text as it stands. */
class Editor {
  private tree: Node | undefined;

  constructor(
    public text: string,
    private readonly style: TextStyle,
  ) {}

  private root(): Node {
    this.tree ??= parseBody(this.text);
    return this.tree;
  }

  private node(segments: readonly string[]): Node {
    const node = nodeAt(this.root(), segments);
    if (node === undefined) throw new Error(`no node at /${segments.join('/')}`);
    return node;
  }

  /** Applies non-overlapping edits given in text order; two inserts at one offset land in the order given. */
  private apply(edits: TextEdit[]): void {
    const order = edits.map((edit, index) => ({ edit, index }));
    order.sort((a, b) => b.edit.offset - a.edit.offset || b.index - a.index);
    for (const { edit } of order) {
      this.text = this.text.slice(0, edit.offset) + edit.content + this.text.slice(edit.offset + edit.length);
    }
    this.tree = undefined;
  }

  /** The value written in place of `node`: on its lines in the file's indent, or inline when more follows on its line. */
  private encodeAt(node: Node, value: unknown): string {
    const after = trailing(this.text, node.offset + node.length);
    return after.atEol ? encodeValue(value, lineIndent(this.text, node.offset), this.style) : encodeInline(value);
  }

  diff(segments: string[], from: unknown, to: unknown): void {
    if (deepEqual(from, to)) return;
    if (isEmptyContainer(from) || isEmptyContainer(to)) {
      this.replace(segments, to);
    } else if (isJsonObject(from) && isJsonObject(to)) {
      for (const key of Object.keys(from)) if (!Object.hasOwn(to, key)) this.removeMember(segments, key);
      for (const key of Object.keys(from)) if (Object.hasOwn(to, key)) this.diff([...segments, key], from[key], to[key]);
      for (const key of Object.keys(to)) if (!Object.hasOwn(from, key)) this.addMember(segments, key, to[key]);
    } else if (Array.isArray(from) && Array.isArray(to)) {
      let head = 0;
      while (head < from.length && head < to.length && deepEqual(from[head], to[head])) head++;
      let tail = 0;
      while (tail < from.length - head && tail < to.length - head && deepEqual(from[from.length - 1 - tail], to[to.length - 1 - tail])) tail++;
      const fromMiddle = from.length - head - tail;
      const toMiddle = to.length - head - tail;
      const paired = Math.min(fromMiddle, toMiddle);
      for (let i = 0; i < paired; i++) this.diff([...segments, String(head + i)], from[head + i], to[head + i]);
      for (let i = fromMiddle - 1; i >= paired; i--) this.removeChild(this.node(segments), head + i);
      for (let i = paired; i < toMiddle; i++) this.insertElement(segments, head + i, to[head + i]);
    } else {
      this.replace(segments, to);
    }
  }

  private replace(segments: readonly string[], value: unknown): void {
    const node = this.node(segments);
    const lexeme = this.text.slice(node.offset, node.offset + node.length);
    const content =
      node.type === 'number' && typeof value === 'number' && Number.isInteger(value) && isFloatLexeme(lexeme)
        ? pythonFloat(value)
        : this.encodeAt(node, value);
    this.apply([{ offset: node.offset, length: node.length, content }]);
  }

  private removeMember(segments: readonly string[], key: string): void {
    const duplicates = (this.node(segments).children ?? []).length;
    for (let round = 0; round <= duplicates; round++) {
      const object = this.node(segments);
      const property = memberNode(object, key);
      if (property === undefined) return; // duplicates: every one goes
      this.removeChild(object, (object.children ?? []).indexOf(property));
    }
    throw new Error(`member ${key} not removed`);
  }

  /** Removes a member (its property node) or an element of a container node. */
  private removeChild(container: Node, index: number): void {
    const children = container.children ?? [];
    const child = children[index] as Node;
    if (children.length === 1) {
      const empty = container.type === 'object' ? '{}' : '[]';
      this.apply([{ offset: container.offset, length: container.length, content: empty }]);
      return;
    }
    const start = child.offset;
    const end = child.offset + child.length;
    const after = trailing(this.text, end);
    const previous = children[index - 1];
    if (ownLine(this.text, start) && after.atEol) {
      const from = lineStart(this.text, start);
      const edits: TextEdit[] = [{ offset: from, length: after.next - from, content: '' }];
      if (index === children.length - 1 && after.comma < 0 && previous !== undefined) {
        const comma = commaAfter(this.text, previous.offset + previous.length);
        if (comma >= 0) edits.push({ offset: comma, length: 1, content: '' });
      }
      this.apply(edits);
    } else if (index < children.length - 1) {
      this.apply([{ offset: start, length: (children[index + 1] as Node).offset - start, content: '' }]);
    } else {
      const from = (previous as Node).offset + (previous as Node).length;
      this.apply([{ offset: from, length: end - from, content: '' }]);
    }
  }

  private addMember(segments: readonly string[], key: string, value: unknown): void {
    const object = this.node(segments);
    this.append(object, (indent) => `${JSON.stringify(key)}: ${encodeValue(value, indent, this.style)}`, `${JSON.stringify(key)}: ${encodeInline(value)}`);
  }

  private insertElement(segments: readonly string[], index: number, value: unknown): void {
    const array = this.node(segments);
    const children = array.children ?? [];
    const before = children[index];
    if (before === undefined) {
      this.append(array, (indent) => encodeValue(value, indent, this.style), encodeInline(value));
    } else if (ownLine(this.text, before.offset)) {
      const indent = lineIndent(this.text, before.offset);
      this.apply([{ offset: before.offset, length: 0, content: `${encodeValue(value, indent, this.style)},${this.style.eol}${indent}` }]);
    } else {
      this.apply([{ offset: before.offset, length: 0, content: `${encodeInline(value)}, ` }]);
    }
  }

  /** Adds a child after the last one of a non-empty container: on a line of its own when the last one has one, else inline. */
  private append(container: Node, onItsLine: (indent: string) => string, inline: string): void {
    const last = (container.children ?? [])[(container.children ?? []).length - 1] as Node;
    const end = last.offset + last.length;
    const after = trailing(this.text, end);
    const edits: TextEdit[] = [];
    if (ownLine(this.text, last.offset)) {
      const indent = lineIndent(this.text, last.offset);
      if (after.comma < 0) edits.push({ offset: end, length: 0, content: ',' });
      const at = after.atEol ? after.end : after.comma >= 0 ? after.comma + 1 : end;
      edits.push({ offset: at, length: 0, content: this.style.eol + indent + onItsLine(indent) });
    } else if (after.comma >= 0) {
      edits.push({ offset: after.comma + 1, length: 0, content: ` ${inline}` });
    } else {
      edits.push({ offset: end, length: 0, content: `, ${inline}` });
    }
    this.apply(edits);
  }
}

/**
 * The text of a JSON file whose value went from `from` (what `text` holds) to `to`,
 * changed only where the values differ. Text that is not JSON, or edits that do not give
 * `to`, end in the whole value written in the text's indent and line end (`rewritten`).
 */
export function editJson(text: string, from: unknown, to: unknown): EditResult {
  if (deepEqual(from, to)) return { text, rewritten: false };
  const { bom, body } = splitBom(text);
  let root: Node | undefined;
  try {
    root = parseBody(body);
  } catch (error) {
    if (!(error instanceof JsonSyntaxError)) throw error;
  }
  const style = detectStyle(body, root);
  if (root !== undefined) {
    const editor = new Editor(body, style);
    try {
      editor.diff([], from, to);
      if (deepEqual(parseJson(editor.text), to)) return { text: bom + editor.text, rewritten: false };
    } catch {
      // too odd for minimal edits: written whole below
    }
  }
  const finalEol = /\r?\n$/.test(body) ? style.eol : '';
  return { text: bom + encodeValue(to, '', style) + finalEol, rewritten: true };
}
