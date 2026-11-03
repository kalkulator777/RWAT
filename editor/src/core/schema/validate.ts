/**
 * Findings of a pack file against its schema (editor.md §3.10, item 1).
 *
 * Ajv decides what is wrong. This module says it the way tools/validate_pack.py does
 * (golden: fixtures/golden/validate/) — same places, same severities, the same words for
 * the usual keywords, and the same hint to an unknown key:
 *
 * - A failed `anyOf`/`oneOf` is explained as validate_pack explains it: the one branch of
 *   the value's JSON type says what is wrong, else "matches none of the allowed forms"
 *   and the errors of the branch with the fewest. Ajv's own list for a composite is
 *   every branch's errors at once, and an error from a `$ref`'d schema does not say which
 *   branch it belongs to; so a composite is re-validated branch by branch (a branch is
 *   found from the identity of the schema nodes Ajv reports, see SchemaStore.locationOf).
 * - Where a node's `type` is wrong nothing else is said about that node, as in Python.
 * - `deprecated` and `x-status: reserved` are warnings on the nodes that apply to the
 *   value: a walk beside the value that follows the same branch rule.
 * - An unknown key is an error at the key, with the nearest known one as a hint.
 */

import type { ErrorObject } from 'ajv';
import type { Link, Problem, ProblemParam } from '../contracts';
import { createAjv, type SchemaValidator } from './ajv';
import { jsonType, pyNumber, pyRepr, show } from './pyformat';
import { isNode, type SchemaKind, type SchemaNode, type SchemaStore } from './store';
import { nearestKey, suggestion } from './suggest';

export interface Finding {
  level: 'error' | 'warning';
  /** RFC 6901 pointer into the checked value; `''` is the whole value. */
  pointer: string;
  /** The words of validate_pack.py. */
  message: string;
  /** Stable id: `schema.type`, `schema.unknown-key`, … */
  code: string;
  params: Record<string, ProblemParam>;
}

interface Item extends Finding {
  /** The schema node that raised it (to drop what a wrong `type` makes moot). */
  node: object | undefined;
}

const KEYWORD_CODES: Record<string, string> = {
  type: 'schema.type',
  enum: 'schema.enum',
  const: 'schema.const',
  minimum: 'schema.minimum',
  maximum: 'schema.maximum',
  exclusiveMinimum: 'schema.exclusive-minimum',
  exclusiveMaximum: 'schema.exclusive-maximum',
  minLength: 'schema.min-length',
  maxLength: 'schema.max-length',
  pattern: 'schema.pattern',
  minItems: 'schema.min-items',
  maxItems: 'schema.max-items',
  required: 'schema.required',
  dependentRequired: 'schema.dependent-required',
  additionalProperties: 'schema.unknown-key',
  not: 'schema.not',
};

export function escapePointerPart(part: string): string {
  return part.replace(/~/g, '~0').replace(/\//g, '~1');
}

function within(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (isNode(a) && isNode(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && jsonEqual(a[k], b[k]));
  }
  return a === b;
}

function isType(value: unknown, name: string): boolean {
  const actual = jsonType(value);
  if (name === 'number') return actual === 'integer' || actual === 'number';
  return actual === name;
}

function typeNames(node: SchemaNode): string[] | undefined {
  const type = node.type;
  if (typeof type === 'string') return [type];
  return Array.isArray(type) ? type.filter((t): t is string => typeof t === 'string') : undefined;
}

function firstLine(text: unknown): string {
  return typeof text === 'string' && text !== '' ? (text.split('. ')[0] ?? '').replace(/\.+$/, '') : 'see the schema';
}

function describeNot(schema: unknown): string {
  if (!isNode(schema)) return show(schema);
  if (Array.isArray(schema.required)) return `all of ${schema.required.map((k) => pyRepr(String(k))).join(', ')} together`;
  if (Array.isArray(schema.enum)) return schema.enum.map(show).join(' or ');
  if (typeof schema.pattern === 'string') return `a match of ${schema.pattern}`;
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map(describeNot).join(' or ');
  return show(schema);
}

/** Checks values against the schemas of a {@link SchemaStore} with Ajv. */
export class SchemaChecker {
  readonly ajv;
  private readonly validators = new Map<object, SchemaValidator | undefined>();
  private readonly reaches = new WeakMap<object, Set<object>>();
  private readonly patterns = new Map<string, RegExp>();

  constructor(readonly store: SchemaStore) {
    this.ajv = createAjv(store);
  }

  /** The findings for `value` as the file of schema `kind`, in the order of the document. */
  check(kind: SchemaKind, value: unknown): Finding[] {
    const { uri, schema } = this.store.root(kind);
    const validator = this.ajv.getSchema(uri);
    if (validator === undefined) throw new Error(`schema ${kind} does not compile`);
    void validator(value);
    const items: Finding[] = this.explain(validator.errors ?? [], '', false);
    this.annotate(schema, value, '', uri, items);
    return sortFindings(items);
  }

  /** The same as {@link Problem}s of file `file` (a pack path). */
  problems(kind: SchemaKind, file: string, value: unknown): Problem[] {
    return this.check(kind, value).map((f) => toProblem(f, file));
  }

  // ------------------------------------------------------------ errors

  private validatorOf(node: object): SchemaValidator | undefined {
    if (this.validators.has(node)) return this.validators.get(node);
    const place = this.store.locationOf(node);
    const found = place === undefined ? undefined : this.ajv.getSchema(place.pointer === '' ? place.uri : `${place.uri}#${place.pointer}`);
    this.validators.set(node, found);
    return found;
  }

  /** Every schema node a composite's branches contain or refer to. */
  private reach(branches: object): Set<object> {
    const cached = this.reaches.get(branches);
    if (cached) return cached;
    const seen = new Set<object>();
    const visit = (node: unknown, uri: string | undefined): void => {
      if (typeof node !== 'object' || node === null || seen.has(node)) return;
      seen.add(node);
      const here = this.store.locationOf(node)?.uri ?? uri;
      if (isNode(node) && typeof node.$ref === 'string' && here !== undefined) {
        visit(this.store.resolve(here, node.$ref).schema, here);
      }
      for (const child of Object.values(node)) visit(child, here);
    };
    visit(branches, undefined);
    this.reaches.set(branches, seen);
    return seen;
  }

  private underWrapper(error: ErrorObject, wrapper: ErrorObject): boolean {
    if (error === wrapper || !within(error.instancePath, wrapper.instancePath)) return false;
    if (wrapper.propertyName !== undefined && error.propertyName !== wrapper.propertyName) return false;
    return typeof wrapper.schema === 'object' && wrapper.schema !== null && this.reach(wrapper.schema).has(error.parentSchema as object);
  }

  /** Ajv's errors, said as validate_pack says them; `prefix` is the pointer of the value they were found in. */
  private explain(errors: readonly ErrorObject[], prefix: string, keyMode: boolean): Item[] {
    const wrappers = errors.filter((e) => e.keyword === 'anyOf' || e.keyword === 'oneOf');
    const top = wrappers.filter((w) => !wrappers.some((other) => other !== w && this.underWrapper(w, other)));
    const items: Item[] = [];
    for (const error of errors) {
      if (error.keyword === 'propertyNames') continue;
      if (wrappers.some((w) => this.underWrapper(error, w))) continue;
      if (top.includes(error)) items.push(...this.composite(error, prefix, keyMode));
      else items.push(this.leaf(error, prefix, keyMode));
    }
    // Python says nothing more about a node whose type is wrong.
    const wrongType = new Set(items.filter((i) => i.code === 'schema.type').map((i) => this.key(i)));
    return items.filter((i) => i.code === 'schema.type' || !wrongType.has(this.key(i)));
  }

  private nodeIds = new WeakMap<object, number>();
  private nodeCount = 0;
  private key(item: Item): string {
    if (item.node === undefined) return `?|${item.pointer}`;
    let id = this.nodeIds.get(item.node);
    if (id === undefined) {
      id = this.nodeCount++;
      this.nodeIds.set(item.node, id);
    }
    return `${id}|${item.pointer}`;
  }

  private pointerOf(error: ErrorObject, prefix: string): string {
    const key = error.propertyName === undefined ? '' : `/${escapePointerPart(error.propertyName)}`;
    return prefix + error.instancePath + key;
  }

  private leaf(error: ErrorObject, prefix: string, keyMode: boolean): Item {
    let pointer = this.pointerOf(error, prefix);
    const params: Record<string, ProblemParam> = {};
    const node = error.parentSchema;
    const data: unknown = error.data;
    let message: string;
    const p = error.params as Record<string, unknown>;
    switch (error.keyword) {
      case 'type': {
        const names = (node && typeNames(node)) ?? [String(p.type)];
        const got = data === null ? 'null' : `${jsonType(data)} ${show(data)}`;
        message = `expected ${names.join(' or ')}, got ${got}`;
        params.expected = names.join(' or ');
        params.got = got;
        break;
      }
      case 'enum':
        message = `${show(data)} is not one of ${show(error.schema)}`;
        params.value = show(data);
        params.allowed = show(error.schema);
        break;
      case 'const':
        message = `${show(data)} must be ${show(error.schema)}`;
        params.value = show(data);
        params.expected = show(error.schema);
        break;
      case 'minimum':
        message = `${pyNumber(data as number)} is below the minimum ${pyNumber(p.limit as number)}`;
        params.value = data as number;
        params.limit = p.limit as number;
        break;
      case 'maximum':
        message = `${pyNumber(data as number)} is above the maximum ${pyNumber(p.limit as number)}`;
        params.value = data as number;
        params.limit = p.limit as number;
        break;
      case 'exclusiveMinimum':
        message = `${pyNumber(data as number)} must be greater than ${pyNumber(p.limit as number)}`;
        params.value = data as number;
        params.limit = p.limit as number;
        break;
      case 'exclusiveMaximum':
        message = `${pyNumber(data as number)} must be less than ${pyNumber(p.limit as number)}`;
        params.value = data as number;
        params.limit = p.limit as number;
        break;
      case 'minLength':
        message = `${show(data)} is shorter than ${String(p.limit)}`;
        params.value = show(data);
        params.limit = p.limit as number;
        break;
      case 'maxLength':
        message = `${show(data)} is longer than ${String(p.limit)}`;
        params.value = show(data);
        params.limit = p.limit as number;
        break;
      case 'pattern':
        message = `${show(data)} doesn't match ${String(p.pattern)}`;
        params.value = show(data);
        params.pattern = String(p.pattern);
        break;
      case 'minItems':
        message = `${(data as unknown[]).length} item(s), at least ${String(p.limit)} needed`;
        params.count = (data as unknown[]).length;
        params.limit = p.limit as number;
        break;
      case 'maxItems':
        message = `${(data as unknown[]).length} item(s), at most ${String(p.limit)} allowed`;
        params.count = (data as unknown[]).length;
        params.limit = p.limit as number;
        break;
      case 'required':
        message = `missing required key ${pyRepr(String(p.missingProperty))}`;
        params.key = String(p.missingProperty);
        break;
      case 'dependentRequired':
        message = `${pyRepr(String(p.property))} needs ${pyRepr(String(p.missingProperty))}`;
        params.key = String(p.property);
        params.needs = String(p.missingProperty);
        break;
      case 'additionalProperties': {
        const key = String(p.additionalProperty);
        const known = Object.keys(isNode(node?.properties) ? node.properties : {});
        const hint = suggestion(key, known);
        message = `unknown key ${pyRepr(key)}${hint}`;
        pointer = `${pointer}/${escapePointerPart(key)}`;
        params.key = key;
        params.nearest = nearestKey(key, known) ?? '';
        break;
      }
      case 'not':
        message = `matches a form that is not allowed: ${describeNot(error.schema)}`;
        params.form = describeNot(error.schema);
        break;
      case 'false schema':
        message = 'no value is allowed here';
        break;
      default:
        message = error.message ?? error.keyword;
    }
    return {
      level: 'error',
      pointer,
      message: keyMode || error.propertyName !== undefined ? `key ${message}` : message,
      code: KEYWORD_CODES[error.keyword] ?? 'schema.invalid',
      params,
      node: error.parentSchema,
    };
  }

  /** validate_pack's `alternatives` for a composite Ajv found failing. */
  private composite(wrapper: ErrorObject, prefix: string, keyMode: boolean): Item[] {
    const branches = wrapper.schema as unknown[];
    const pointer = this.pointerOf(wrapper, prefix);
    const asKey = keyMode || wrapper.propertyName !== undefined;
    const data: unknown = wrapper.data;
    const results = branches.map((branch) => ({ branch, items: this.errorsOf(branch, data, pointer, asKey) }));
    const hasError = (r: { items: Item[] }): number => r.items.length;
    const passing = results.filter((r) => hasError(r) === 0);
    const wrap = (message: string, code: string, params: Record<string, ProblemParam>): Item => ({
      level: 'error',
      pointer,
      message: asKey ? `key ${message}` : message,
      code,
      params,
      node: wrapper.parentSchema,
    });
    if (wrapper.keyword === 'oneOf' && passing.length > 1) {
      return [wrap(`matches ${passing.length} of the oneOf forms, exactly one is allowed`, 'schema.one-of-many', { count: passing.length })];
    }
    if (passing.length > 0) return [];
    const typed = results.filter((r) => this.typeFits(r.branch, data));
    if (typed.length === 1 && typed[0]) return typed[0].items;
    const pool = typed.length > 0 ? typed : results;
    const best = pool.reduce((a, b) => (b.items.length < a.items.length ? b : a));
    const names = branches.map((b) => this.formName(b)).join(', ');
    return [wrap(`matches none of the allowed forms (${names})`, 'schema.no-form', { forms: names }), ...best.items];
  }

  private errorsOf(branch: unknown, data: unknown, pointer: string, keyMode: boolean): Item[] {
    if (typeof branch !== 'object' || branch === null) return [];
    const validator = this.validatorOf(branch);
    if (validator === undefined) throw new Error('a composite branch is not a schema of a loaded file');
    void validator(data);
    return this.explain(validator.errors ?? [], pointer, keyMode);
  }

  // ------------------------------------------------------------ types

  private followRef(node: SchemaNode, stop: (n: SchemaNode) => boolean): SchemaNode {
    let current = node;
    let uri = this.store.locationOf(node)?.uri;
    while (typeof current.$ref === 'string' && uri !== undefined && !stop(current)) {
      const target = this.store.resolve(uri, current.$ref);
      uri = target.uri;
      current = target.schema;
    }
    return current;
  }

  private typeFits(branch: unknown, data: unknown): boolean {
    if (!isNode(branch)) return true;
    const node = this.followRef(branch, (n) => 'type' in n);
    if ('const' in node) return jsonEqual(data, node.const) || jsonType(data) === jsonType(node.const);
    const names = typeNames(node);
    return names === undefined || names.some((n) => isType(data, n));
  }

  private formName(branch: unknown): string {
    if (!isNode(branch)) return 'a composite form';
    const node = this.followRef(branch, (n) => 'type' in n || 'oneOf' in n || 'anyOf' in n);
    if ('const' in node) return JSON.stringify(node.const);
    const names = typeNames(node);
    if (names && Array.isArray(node.type)) return names.join(' or ');
    if (names === undefined && typeof node.pattern === 'string') return `a match of ${node.pattern}`;
    return names?.[0] ?? 'a composite form';
  }

  // ------------------------------------------------------------ warnings

  private regex(pattern: string): RegExp {
    let found = this.patterns.get(pattern);
    if (!found) {
      found = new RegExp(pattern, 'u');
      this.patterns.set(pattern, found);
    }
    return found;
  }

  /** The deprecated and reserved nodes that apply to `data`, as validate_pack's walk meets them. */
  private annotate(node: SchemaNode, data: unknown, pointer: string, uri: string, out: Finding[]): void {
    if (typeof node.$ref === 'string') {
      const target = this.store.resolve(uri, node.$ref);
      this.annotate(target.schema, data, pointer, target.uri, out);
    }
    if (node.deprecated === true) {
      const message = `deprecated form: ${firstLine(node.description)}`;
      out.push({ level: 'warning', pointer, message, code: 'schema.deprecated', params: { note: firstLine(node.description) } });
    }
    if (node['x-status'] === 'reserved') {
      const note = typeof node['x-status-note'] === 'string' ? node['x-status-note'] : 'parsed, not modelled';
      out.push({ level: 'warning', pointer, message: `reserved: ${note}`, code: 'schema.reserved', params: { note } });
    }
    const names = typeNames(node);
    if (names && !names.some((n) => isType(data, n))) return;

    if (Array.isArray(data)) {
      if (isNode(node.items)) data.forEach((item, i) => this.annotate(node.items as SchemaNode, item, `${pointer}/${i}`, uri, out));
    } else if (isNode(data)) {
      const properties = isNode(node.properties) ? node.properties : {};
      const patterns = isNode(node.patternProperties) ? Object.entries(node.patternProperties) : [];
      for (const [key, item] of Object.entries(data)) {
        const where = `${pointer}/${escapePointerPart(key)}`;
        const matched = patterns.filter(([pattern]) => this.regex(pattern).test(key));
        for (const [, sub] of matched) if (isNode(sub)) this.annotate(sub, item, where, uri, out);
        const own = properties[key];
        if (isNode(own)) this.annotate(own, item, where, uri, out);
        else if (matched.length === 0 && isNode(node.additionalProperties)) this.annotate(node.additionalProperties, item, where, uri, out);
      }
    }
    if (Array.isArray(node.allOf)) for (const sub of node.allOf) if (isNode(sub)) this.annotate(sub, data, pointer, uri, out);
    for (const keyword of ['anyOf', 'oneOf'] as const) {
      const branches = node[keyword];
      if (Array.isArray(branches)) this.annotateAlternatives(branches, data, pointer, uri, keyword === 'oneOf', out);
    }
  }

  /** The warnings of the branch that matches; of the one branch of the value's type when none does. */
  private annotateAlternatives(branches: unknown[], data: unknown, pointer: string, uri: string, exactlyOne: boolean, out: Finding[]): void {
    const nodes = branches.filter(isNode);
    const valid = nodes.filter((b) => {
      const validator = this.validatorOf(b);
      return validator === undefined ? true : validator(data);
    });
    if (exactlyOne && valid.length > 1) return;
    let chosen: SchemaNode | undefined = valid[0];
    if (chosen === undefined) {
      const typed = nodes.filter((b) => this.typeFits(b, data));
      if (typed.length === 1) chosen = typed[0];
    }
    if (chosen) this.annotate(chosen, data, pointer, this.store.locationOf(chosen)?.uri ?? uri, out);
  }
}

function pointerOrder(a: string, b: string): number {
  const x = a.split('/');
  const y = b.split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i] as string;
    const q = y[i] as string;
    if (p === q) continue;
    const bothIndexes = /^\d+$/.test(p) && /^\d+$/.test(q);
    return bothIndexes ? Number(p) - Number(q) : p < q ? -1 : 1;
  }
  return x.length - y.length;
}

/** By place in the document, errors before warnings at one place; equal ones keep their order. */
function sortFindings<T extends Finding>(items: T[]): Finding[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => pointerOrder(a.item.pointer, b.item.pointer) || (a.item.level === b.item.level ? 0 : a.item.level === 'error' ? -1 : 1) || a.index - b.index)
    .map(({ item }) => ({ level: item.level, pointer: item.pointer, message: item.message, code: item.code, params: item.params }));
}

export function toProblem(finding: Finding, file: string): Problem {
  const at: Link[] = [{ kind: 'field', file, at: finding.pointer }];
  return { severity: finding.level, source: 'schema', code: finding.code, params: finding.params, text: finding.message, at };
}

/** A file that is not JSON at all. */
export function invalidJsonProblem(file: string, reason: string): Problem {
  return {
    severity: 'error',
    source: 'schema',
    code: 'schema.invalid-json',
    params: { reason },
    text: `not valid JSON: ${reason}`,
    at: [{ kind: 'file', file }],
  };
}
