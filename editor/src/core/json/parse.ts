/**
 * Reading the pack's JSON text. Pack files are strict JSON as the tools write them, but
 * hand-edited files may carry a BOM, comments and trailing commas (tools/ir2rwat.py
 * `lenient_json` takes them too); jsonc-parser reads those and gives the offsets that
 * minimal edits (./edit.ts) need.
 *
 * Objects are built with own data properties only: a member named `__proto__` is a
 * member, as `JSON.parse` makes it, not a prototype. Of duplicate members the last one
 * counts, as with `JSON.parse` and Gson; {@link nodeAt} finds that one too.
 */

import { type Node, type ParseError, parseTree, printParseErrorCode } from 'jsonc-parser';

const BOM = '﻿';

const LENIENT = { allowTrailingComma: true, disallowComments: false, allowEmptyContent: false } as const;

/** Text that is not JSON (even with comments and trailing commas allowed). */
export class JsonSyntaxError extends Error {
  constructor(
    /** What jsonc-parser found: `CommaExpected`, `ValueExpected`, … */
    readonly code: string,
    /** Offset in the text, the BOM counted. */
    readonly offset: number,
  ) {
    super(`not valid JSON: ${code} at offset ${offset}`);
    this.name = 'JsonSyntaxError';
  }
}

/** The text split into its BOM (`''` or U+FEFF) and the rest: offsets into the body are offsets into the text minus the BOM's length. */
export function splitBom(text: string): { bom: string; body: string } {
  return text.startsWith(BOM) ? { bom: BOM, body: text.slice(1) } : { bom: '', body: text };
}

/** Defines an own enumerable member, also for `__proto__`. */
export function putMember(object: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
}

/** The syntax tree of a text without BOM; throws {@link JsonSyntaxError} when it is not JSON. */
export function parseBody(body: string, bomLength = 0): Node {
  const errors: ParseError[] = [];
  const root = parseTree(body, errors, LENIENT);
  const first = errors[0];
  if (first !== undefined) throw new JsonSyntaxError(printParseErrorCode(first.error), first.offset + bomLength);
  if (root === undefined) throw new JsonSyntaxError('ValueExpected', bomLength);
  return root;
}

/** The value of a syntax tree node; `number` turns a number node into the value wanted. */
function valueOf(node: Node, body: string, number: (lexeme: string, value: number) => unknown): unknown {
  switch (node.type) {
    case 'object': {
      const object: Record<string, unknown> = {};
      for (const property of node.children ?? []) {
        const [key, value] = property.children ?? [];
        if (key !== undefined && value !== undefined) putMember(object, key.value as string, valueOf(value, body, number));
      }
      return object;
    }
    case 'array':
      return (node.children ?? []).map((child) => valueOf(child, body, number));
    case 'number':
      return number(body.slice(node.offset, node.offset + node.length), node.value as number);
    default:
      return node.value as unknown;
  }
}

/**
 * The value of a JSON text: objects, arrays and JavaScript numbers. Throws
 * {@link JsonSyntaxError}. Strict JSON goes through `JSON.parse`, the rest (comments,
 * trailing commas) through the tree; both give the same value.
 */
export function parseJson(text: string): unknown {
  const { bom, body } = splitBom(text);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return valueOf(parseBody(body, bom.length), body, (_lexeme, value) => value);
  }
}

/**
 * A number of a JSON text as it was written: what {@link parseLossless} gives instead of
 * a JavaScript number, so that `100.0` stays apart from `100` and an integer past 2^53
 * keeps its digits. `dump` writes it as Python would.
 */
export class JsonNumber {
  constructor(readonly lexeme: string) {}

  valueOf(): number {
    return Number(this.lexeme);
  }
}

/**
 * The value of a JSON text with nothing lost: objects as `Map`s (every key in its
 * place, numeric-looking ones too, which a JavaScript object would move to the front),
 * numbers as {@link JsonNumber}s. For writing a read file again exactly as Python would
 * (golden `json_dump`), not for editing.
 */
export function parseLossless(text: string): unknown {
  const { bom, body } = splitBom(text);
  return losslessOf(parseBody(body, bom.length), body);
}

function losslessOf(node: Node, body: string): unknown {
  switch (node.type) {
    case 'object': {
      const map = new Map<string, unknown>();
      for (const property of node.children ?? []) {
        const [key, value] = property.children ?? [];
        if (key !== undefined && value !== undefined) map.set(key.value as string, losslessOf(value, body));
      }
      return map;
    }
    case 'array':
      return (node.children ?? []).map((child) => losslessOf(child, body));
    case 'number':
      return new JsonNumber(body.slice(node.offset, node.offset + node.length));
    default:
      return node.value as unknown;
  }
}

/** The property node (key and value) of the member `key` of an object node: the last one of duplicates. */
export function memberNode(object: Node, key: string): Node | undefined {
  let found: Node | undefined;
  for (const property of object.children ?? []) {
    if (property.children?.[0]?.value === key && property.children[1] !== undefined) found = property;
  }
  return found;
}

/** The value node at these pointer segments, or undefined. */
export function nodeAt(root: Node, segments: readonly string[]): Node | undefined {
  let node: Node | undefined = root;
  for (const segment of segments) {
    if (node === undefined) return undefined;
    if (node.type === 'object') {
      node = memberNode(node, segment)?.children?.[1];
    } else if (node.type === 'array' && /^(?:0|[1-9][0-9]*)$/.test(segment)) {
      node = node.children?.[Number(segment)];
    } else {
      return undefined;
    }
  }
  return node;
}
