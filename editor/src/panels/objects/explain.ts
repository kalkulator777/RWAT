/**
 * Why an object has its role: which rule of schema/obj-conventions.json took it, which
 * part of its name that rule matched, what the rule makes the engine do, and which
 * modifiers and flags of the name are read besides (control group, label, offset, range,
 * hinge, slide, toggle, light group, …). The texts are the schema's, in the interface
 * language (`effect` / `x-description-ru`, `name` / `x-name-ru`), so the editor says
 * what the format's reference says. Pure, no DOM.
 *
 * The role itself is not decided here: it comes from `ObjectInfo.role`. This only finds
 * the words of the name that fit the rule of that role.
 */

import type { Lang } from '../../i18n/define';
import { pairText } from '../../i18n/schemaText';
import { CONVENTIONS, roleEntry, roleRegex } from './roles';

/** A modifier, flag or light mark of the name, with the schema's words for it. */
export interface Mark {
  /** The schema's id: `CG`, `TOGGLE`, `LCG`, … */
  id: string;
  group: 'modifier' | 'flag' | 'light';
  /** The schema's name of it (`_CG_<group>`). */
  label: string;
  /** The words of the name that matched (`CG_IL`), underscores at the ends dropped. */
  matched: string;
  /** What the engine does with it, in the language. */
  effect: string;
}

/** How the rule found the object. */
export type MatchKind = 'prefix' | 'substring' | 'regex' | 'skip' | 'anim' | 'control' | 'material' | 'fallback' | 'unknown';

export interface Explanation {
  /** The role id as given. */
  role: string;
  /** The schema's name of the rule (`BOGEY_FRONT*`), or null for a role the schema does not know. */
  rule: string | null;
  /** What the rule makes the engine do, in the language; empty for an unknown role. */
  effect: string;
  how: MatchKind;
  /** The part of the name the rule matched; null when it matches by something else than the name. */
  matched: string | null;
  /** Which form of the name the rule reads: as written, or without Blender's `.001`; null when it reads neither. */
  input: 'raw' | 'normalized' | null;
  /** The control kind (`THROTTLE_<n>`) with its words, for a control or a door leaf. */
  kind: { id: string; label: string; effect: string; matched: string } | null;
  /** `active`, or `dropped` for an object the engine throws away. */
  engine: string | null;
  marks: Mark[];
  /** Where the engine does it, for the curious: `file#symbol`. */
  code: string[];
}

export interface ExplainContext {
  /** The model declaration's `skip` prefixes. */
  skip: readonly string[];
  lang: Lang;
}

/** A node of the schema as these functions read it. */
interface Node {
  name?: string;
  effect?: string;
  regex?: string;
  input?: string;
  [key: string]: unknown;
}

const COPY_SUFFIX = new RegExp(CONVENTIONS.naming.copy_suffix.regex, 'u');

/** The roles whose objects are cab controls or door leaves: the control modifiers and flags apply to them. */
const CONTROLLED = new Set(['control', 'door_leaf']);

function words(node: Node, lang: Lang): string {
  return pairText({ en: node.effect, ru: node['x-description-ru'] }, lang) ?? '';
}

function label(node: Node, lang: Lang): string {
  return pairText({ en: node.name, ru: node['x-name-ru'] ?? node.name }, lang) ?? '';
}

/** The words a regular expression found, with the underscores that only part them from their neighbours dropped. */
function found(regex: string, name: string): string | null {
  const match = new RegExp(regex, 'u').exec(name);
  return match === null ? null : match[0].replace(/^_+|_+$/gu, '');
}

/** The entries of a schema list whose expression is found in the name, as marks. */
function marksOf(list: readonly Node[], group: Mark['group'], idKey: string, raw: string, normalized: string, lang: Lang): Mark[] {
  const marks: Mark[] = [];
  for (const node of list) {
    if (node.regex === undefined) continue;
    const matched = found(node.regex, node.input === 'raw' ? raw : normalized);
    if (matched === null) continue;
    const id = String(node[idKey]);
    marks.push({ id, group, label: label(node, lang) || id, matched, effect: words(node, lang) });
  }
  return marks;
}

/**
 * Why `name` has the role `role`.
 *
 * Marks are listed for what the engine reads from the name under that role: a control's
 * modifiers and flags only for controls and door leaves, a coupler head's `HIDE` and
 * `INVERT`, light marks for any object.
 */
export function explainObject(name: string, role: string, context: ExplainContext): Explanation {
  const { lang } = context;
  const normalized = name.replace(COPY_SUFFIX, '');
  const entry = roleEntry(role);
  const match = entry?.match;
  const input = match?.input === 'normalized' ? 'normalized' : match?.input === 'raw' ? 'raw' : null;

  let how: MatchKind = 'unknown';
  let matched: string | null = null;
  let kind: Explanation['kind'] = null;

  if (entry !== undefined && match !== undefined) {
    switch (match.type) {
      case 'prefix':
      case 'substring':
      case 'regex':
        how = match.type;
        matched = roleRegex(role)?.exec(input === 'normalized' ? normalized : name)?.[0] ?? null;
        break;
      case 'anim':
        how = 'anim';
        matched = name;
        break;
      case 'control_kind':
        how = 'control';
        break;
      case 'material':
        how = 'material';
        break;
      default:
        how = 'fallback';
    }
    if (role === 'skip' && matched === null) {
      // not CARGO_FILL: one of the prefixes the model declaration lists
      const prefix = context.skip.find((candidate) => name.startsWith(candidate));
      if (prefix !== undefined) {
        how = 'skip';
        matched = prefix;
      }
    }
  }

  if (role === 'control' || role === 'door_leaf') {
    for (const node of CONVENTIONS.control_kinds as (Node & { kind: string })[]) {
      if ((node.kind === 'DOOR') !== (role === 'door_leaf')) continue;
      const hit = found(node.regex ?? '', normalized);
      if (hit === null) continue;
      kind = { id: node.kind, label: label(node, lang), effect: words(node, lang), matched: hit };
      matched = hit;
      break;
    }
  }

  const marks: Mark[] = [];
  if (CONTROLLED.has(role)) {
    marks.push(...marksOf(CONVENTIONS.control_modifiers, 'modifier', 'id', name, normalized, lang));
    marks.push(...marksOf(CONVENTIONS.control_flags, 'flag', 'flag', name, normalized, lang));
  } else if (role === 'coupler_head') {
    const flags = marksOf(CONVENTIONS.control_flags, 'flag', 'flag', name, normalized, lang);
    marks.push(...flags.filter((mark) => mark.id === 'HIDE' || mark.id === 'INVERT'));
  }
  marks.push(...marksOf(CONVENTIONS.lights, 'light', 'id', name, normalized, lang));

  return {
    role,
    rule: entry === undefined ? null : label(entry, lang),
    effect: entry === undefined ? '' : words(entry, lang),
    how,
    matched,
    input,
    kind,
    engine: entry?.engine ?? null,
    marks,
    code: entry?.code ?? [],
  };
}
