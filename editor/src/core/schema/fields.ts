/**
 * Field descriptors: what a form needs to know about a property, read from the schema
 * (editor.md §3.7) — type, unit, default, status, texts in both languages, limits, enum,
 * and the descriptors of what is inside. `$ref`s are followed; what the property says
 * itself (its own description, unit, …) wins over what the schema it refers to says.
 * A property that is `anyOf [X, null]` (the override files) is X, nullable.
 *
 * Texts are `{ en, ru }` pairs, which is what i18n's `pairText` reads.
 */

import { isNode, type NodeLocation, type SchemaKind, type SchemaNode, type SchemaStore, type Texts } from './store';

export type FieldShape = 'number' | 'integer' | 'string' | 'boolean' | 'null' | 'array' | 'object' | 'oneOf' | 'anyOf' | 'const' | 'any';

export interface FieldLimits {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
}

export interface FieldStatus {
  /** `reserved` or `pending-engine`. */
  id: string;
  /** The short label of pack-layout.json (`label-ru`; the id stands for the English one). */
  label: Texts;
  /** `x-status-note`: what exactly the engine does. */
  note: Texts;
  /** What the status means, from pack-layout.json. */
  meaning: Texts;
}

export interface FieldDescriptor {
  /** The property's name; undefined for the root, an array item or a dictionary value. */
  key: string | undefined;
  /** Where the property's own node lives. */
  at: NodeLocation;
  shape: FieldShape;
  /** JSON types the schema allows (without null). */
  types: string[];
  nullable: boolean;
  required: boolean;
  description: Texts;
  unit?: { id: string; label: Texts };
  hasDefault: boolean;
  default?: unknown;
  /** `x-engine-default`: the engine's value when the key is absent, figured from other fields. */
  engineDefault?: Texts;
  /** `x-frame`: the coordinate frame of a point or box (an id of pack-layout.json frames). */
  frame?: string;
  status?: FieldStatus;
  deprecated: boolean;
  enum?: unknown[];
  const?: unknown;
  limits: FieldLimits;
  items?: FieldDescriptor;
  /** Properties of an object, in the schema's order. */
  properties?: FieldDescriptor[];
  /** A dictionary's value (`additionalProperties` that is a schema) and the pattern its keys follow. */
  values?: FieldDescriptor;
  keyPattern?: string;
  /** The forms of `oneOf`/`anyOf`, null left out. */
  variants?: FieldDescriptor[];
  /** The object also allows `_comment` keys (recipe and override files). */
  comments: boolean;
}

const LIMIT_KEYS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
] as const;

function textsOf(chain: SchemaNode[], english: string, russian: string): Texts {
  const pick = (key: string): string | undefined => {
    for (const node of chain) if (typeof node[key] === 'string') return node[key];
    return undefined;
  };
  const out: Texts = {};
  const en = pick(english);
  const ru = pick(russian);
  if (en !== undefined) out.en = en;
  if (ru !== undefined) out.ru = ru;
  return out;
}

function isNullSchema(node: unknown): boolean {
  return isNode(node) && node.type === 'null' && Object.keys(node).every((k) => k === 'type');
}

export class FieldDescriber {
  private readonly cache = new Map<string, FieldDescriptor>();

  constructor(private readonly store: SchemaStore) {}

  /** The root descriptor of a pack file's schema. */
  root(kind: SchemaKind): FieldDescriptor {
    const { uri, schema } = this.store.root(kind);
    return this.describe(schema, uri, undefined, false, new Set());
  }

  /** Descriptor of the node a `$ref`-style address names (`wagon_type.schema.json#/$defs/door`). */
  at(ref: string, base?: string): FieldDescriptor {
    const target = this.store.resolve(base ?? [...this.store.documents.keys()][0] ?? '', ref);
    return this.describe(target.schema, target.uri, undefined, false, new Set());
  }

  private chainOf(node: SchemaNode, uri: string): { chain: SchemaNode[]; uri: string } {
    const chain: SchemaNode[] = [node];
    let current = node;
    let at = uri;
    while (typeof current.$ref === 'string' && chain.length < 12) {
      const target = this.store.resolve(at, current.$ref);
      chain.push(target.schema);
      current = target.schema;
      at = target.uri;
    }
    return { chain, uri: at };
  }

  describe(node: SchemaNode, uri: string, key: string | undefined, required: boolean, stack: Set<object>): FieldDescriptor {
    const place = this.store.locationOf(node) ?? { uri, pointer: '' };
    const memo = `${place.uri}#${place.pointer}|${key ?? ''}|${required}`;
    const cached = this.cache.get(memo);
    if (cached) return cached;
    if (stack.has(node)) return this.blank(place, key, required);
    stack.add(node);

    const { chain, uri: baseUri } = this.chainOf(node, uri);
    const first = <T>(read: (n: SchemaNode) => T | undefined): T | undefined => {
      for (const n of chain) {
        const v = read(n);
        if (v !== undefined) return v;
      }
      return undefined;
    };

    const d = this.blank(place, key, required);
    const typeOf = first((n) => (n.type === undefined ? undefined : n.type));
    const typeList = typeof typeOf === 'string' ? [typeOf] : Array.isArray(typeOf) ? typeOf.filter((t): t is string => typeof t === 'string') : [];
    d.nullable = typeList.includes('null');
    d.types = typeList.filter((t) => t !== 'null');
    d.description = textsOf(chain, 'description', 'x-description-ru');
    d.deprecated = chain.some((n) => n.deprecated === true);
    const unit = first((n) => (typeof n['x-unit'] === 'string' ? n['x-unit'] : undefined));
    if (unit !== undefined) {
      const entry = this.store.layoutList('units').find((u) => u.unit === unit);
      d.unit = { id: unit, label: { en: textOr(entry?.en, unit), ru: textOr(entry?.ru, unit) } };
    }
    const owner = chain.find((n) => 'default' in n);
    if (owner) {
      d.hasDefault = true;
      d.default = owner.default;
    }
    const formula = textsOf(chain, 'x-engine-default', 'x-engine-default-ru');
    if (formula.en !== undefined || formula.ru !== undefined) d.engineDefault = formula;
    d.frame = first((n) => (typeof n['x-frame'] === 'string' ? n['x-frame'] : undefined));
    const status = first((n) => (typeof n['x-status'] === 'string' ? n['x-status'] : undefined));
    if (status !== undefined) {
      const entry = this.store.layoutList('statuses').find((s) => s.status === status);
      const note = textsOf(chain, 'x-status-note', 'x-status-note-ru');
      d.status = {
        id: status,
        label: { en: status, ru: textOr(entry?.['label-ru'], status) },
        note,
        meaning: { en: textOr(entry?.en, ''), ru: textOr(entry?.ru, '') },
      };
    }
    const enumValues = first((n) => (Array.isArray(n.enum) ? n.enum : undefined));
    if (enumValues) d.enum = enumValues;
    const owner2 = chain.find((n) => 'const' in n);
    if (owner2) d.const = owner2.const;
    for (const limit of LIMIT_KEYS) {
      const v = first((n) => (typeof n[limit] === 'number' ? n[limit] : undefined));
      if (v !== undefined) d.limits[limit] = v;
    }
    d.limits.pattern = first((n) => (typeof n.pattern === 'string' ? n.pattern : undefined));
    if (d.limits.pattern === undefined) delete d.limits.pattern;

    const requiredKeys = new Set(first((n) => (Array.isArray(n.required) ? (n.required as unknown[]) : undefined)) as string[] | undefined);
    const properties = first((n) => (isNode(n.properties) ? n.properties : undefined));
    if (properties) {
      d.properties = Object.entries(properties)
        .filter((e): e is [string, SchemaNode] => isNode(e[1]))
        .map(([name, sub]) => this.describe(sub, baseUri, name, requiredKeys.has(name), stack));
    }
    d.comments = chain.some((n) => isNode(n.patternProperties) && '^_' in n.patternProperties);
    const extra = first((n) => (isNode(n.additionalProperties) ? n.additionalProperties : undefined));
    if (extra) d.values = this.describe(extra, baseUri, undefined, false, stack);
    const names = first((n) => (isNode(n.propertyNames) ? n.propertyNames : undefined));
    const namePattern = names && this.chainOf(names, baseUri).chain.find((n) => typeof n.pattern === 'string')?.pattern;
    if (typeof namePattern === 'string') d.keyPattern = namePattern;
    const items = first((n) => (isNode(n.items) ? n.items : undefined));
    if (items) d.items = this.describe(items, baseUri, undefined, false, stack);

    const keyword = chain.find((n) => Array.isArray(n.oneOf) || Array.isArray(n.anyOf));
    if (keyword) {
      const oneOf = Array.isArray(keyword.oneOf);
      const branches = (oneOf ? keyword.oneOf : keyword.anyOf) as unknown[];
      const live = branches.filter((b): b is SchemaNode => isNode(b) && !isNullSchema(b));
      if (live.length < branches.length) d.nullable = true;
      const described = live.map((b) => this.describe(b, baseUri, undefined, false, stack));
      if (described.length === 1 && described[0]) {
        d.nullable ||= described[0].nullable;
        const only = described[0];
        const merged: FieldDescriptor = { ...only, key, required, nullable: d.nullable, at: place };
        merged.description = { ...only.description, ...d.description };
        if (d.unit) merged.unit = d.unit;
        if (d.hasDefault) {
          merged.hasDefault = true;
          merged.default = d.default;
        }
        merged.deprecated ||= d.deprecated;
        stack.delete(node);
        this.cache.set(memo, merged);
        return merged;
      }
      d.variants = described;
      d.shape = oneOf ? 'oneOf' : 'anyOf';
      if (d.description.en === undefined && d.description.ru === undefined) d.description = described[0]?.description ?? {};
    } else if ('const' in d) {
      d.shape = 'const';
    } else if (d.types.length === 1) {
      d.shape = d.types[0] as FieldShape;
    } else if (d.types.length === 0 && d.nullable) {
      d.shape = 'null';
    }
    stack.delete(node);
    this.cache.set(memo, d);
    return d;
  }

  private blank(at: NodeLocation, key: string | undefined, required: boolean): FieldDescriptor {
    return {
      key,
      at,
      shape: 'any',
      types: [],
      nullable: false,
      required,
      description: {},
      hasDefault: false,
      deprecated: false,
      limits: {},
      comments: false,
    };
  }
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Every descriptor of the tree, the root first. */
export function* walkFields(root: FieldDescriptor, seen = new Set<FieldDescriptor>()): Generator<FieldDescriptor> {
  if (seen.has(root)) return;
  seen.add(root);
  yield root;
  for (const child of [...(root.properties ?? []), ...(root.variants ?? []), ...(root.items ? [root.items] : []), ...(root.values ? [root.values] : [])]) {
    yield* walkFields(child, seen);
  }
}
