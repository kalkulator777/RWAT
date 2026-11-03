/**
 * The schema files of the pack format, indexed: documents by `$id`, `$ref` resolution
 * across them (a port of tools/validate_pack.py `SchemaStore`), the layout tables
 * (units, frames, statuses) and the place of every schema node, which is how a finding
 * from Ajv is traced back to the schema it came from.
 */

import { CONVENTIONS_FILE, LAYOUT_FILE, type SchemaFiles } from './files';

/** A schema object (boolean schemas are not used by the pack format). */
export type SchemaNode = { readonly [key: string]: unknown };

/** The schema files that describe a file of a pack or of a conversion recipe. */
export const SCHEMA_KINDS = [
  'wagon_type',
  'wagon_model',
  'rail_model',
  'pack_mcmeta_rwat',
  'recipe',
  'recipe_override',
] as const;
export type SchemaKind = (typeof SCHEMA_KINDS)[number];

/** `{ en, ru }` — the shape of the texts of pack-layout.json, and of the field descriptors. */
export interface Texts {
  en?: string;
  ru?: string;
}

/** Where a schema node lives: its document and the JSON pointer inside it. */
export interface NodeLocation {
  uri: string;
  pointer: string;
}

export function isNode(value: unknown): value is SchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unescapePointerPart(part: string): string {
  return decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Every `*.schema.json` by `$id`, with `$ref` resolution, and the layout tables. */
export class SchemaStore {
  readonly documents = new Map<string, SchemaNode>();
  private readonly uriByName = new Map<string, string>();
  private readonly locations = new WeakMap<object, NodeLocation>();
  readonly layout: SchemaNode;
  readonly conventions: SchemaNode;

  constructor(files: SchemaFiles) {
    for (const [name, document] of Object.entries(files)) {
      if (!name.endsWith('.schema.json')) continue;
      if (!isNode(document) || typeof document.$id !== 'string') {
        throw new Error(`${name}: a schema file without $id`);
      }
      this.documents.set(document.$id, document);
      this.uriByName.set(name, document.$id);
      this.index(document, document.$id, '');
    }
    const layout = files[LAYOUT_FILE];
    const conventions = files[CONVENTIONS_FILE];
    this.layout = isNode(layout) ? layout : {};
    this.conventions = isNode(conventions) ? conventions : {};
  }

  private index(node: unknown, uri: string, pointer: string): void {
    if (typeof node !== 'object' || node === null) return;
    this.locations.set(node, { uri, pointer });
    const entries: [string, unknown][] = Array.isArray(node)
      ? node.map((v, i) => [String(i), v])
      : Object.entries(node);
    for (const [key, value] of entries) {
      this.index(value, uri, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    }
  }

  /** The place of a node of a loaded document (by identity), if it is one. */
  locationOf(node: object): NodeLocation | undefined {
    return this.locations.get(node);
  }

  /** The `$id` of a schema file by its name (`wagon_type` or `wagon_type.schema.json`). */
  uriOf(name: string): string {
    const full = name.endsWith('.schema.json') ? name : `${name}.schema.json`;
    const uri = this.uriByName.get(full);
    if (uri === undefined) throw new Error(`no schema file ${full}`);
    return uri;
  }

  /** The root of a schema file. */
  root(name: string): { uri: string; schema: SchemaNode } {
    const uri = this.uriOf(name);
    return { uri, schema: this.documents.get(uri) as SchemaNode };
  }

  /** The node a `$ref` names, seen from document `base` (JSON pointer fragments only). */
  resolve(base: string, ref: string): { uri: string; schema: SchemaNode } {
    const url = new URL(ref, base);
    const fragment = url.hash;
    url.hash = '';
    const uri = url.href;
    const document = this.documents.get(uri);
    if (document === undefined) throw new Error(`$ref ${ref} from ${base}: no schema ${uri}`);
    let node: unknown = document;
    if (fragment !== '' && fragment !== '#') {
      if (!fragment.startsWith('#/')) throw new Error(`$ref ${ref}: only JSON pointer fragments are supported`);
      for (const raw of fragment.slice(2).split('/')) {
        const part = unescapePointerPart(raw);
        if (Array.isArray(node)) node = node[Number(part)];
        else if (isNode(node) && part in node) node = node[part];
        else node = undefined;
        if (node === undefined) throw new Error(`$ref ${ref} from ${base}: ${fragment} not found`);
      }
    }
    if (!isNode(node)) throw new Error(`$ref ${ref} from ${base}: not a schema`);
    return { uri, schema: node };
  }

  /** The layout's list `key` (`units`, `frames`, `statuses`) as nodes. */
  layoutList(key: string): SchemaNode[] {
    const list = this.layout[key];
    return Array.isArray(list) ? list.filter(isNode) : [];
  }
}
