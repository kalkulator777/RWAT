/**
 * The loader's rules that the schema cannot say (editor.md §3.10, item 2): what the mod
 * refuses or warns about once it reads the pack as a whole — a type without its model, a
 * geometry that makes no wagon, an old and a new form of the same thing side by side,
 * keys that name no door, files that are not there, paths Minecraft will not load, a
 * pack format newer than the mod reads.
 *
 * Each finding is a {@link Problem} with source `loader`: a stable code the interface
 * translates (checks/messages.ts), the values its text is built from, and the English
 * text as the engine words it where the engine has a line for it
 * (`stock/WagonTypeParser`, `pack/PackReport`, `pack/RwatPackMeta`).
 *
 * Not here yet: rules that need the model's OBJ parsed (organs named by `handbrake` and
 * `sounds.controls`, the limits of light and control groups) — they come with the model
 * pipeline (M3–M4); the floor's are `FloorCheck`'s (ports/floorCheck).
 *
 * The geometry rule is the engine's, from its port (ports/wagonType `geometryFaults`): the
 * engine stops at the first fault, the checks show every one.
 */

import type { Link, Problem } from '../core/contracts';
import { isJsonObject } from '../core/json';
import { classify, MCMETA, modelPath, SUPPORTED_FORMAT, typePath, type Pack } from '../core/pack';
import { geometryFaults, type GeometryFault } from '../ports/wagonType';

/** A path Minecraft takes as a resource location: `assets|data/<namespace>/<path>`, lower case (`ResourceLocation`). */
const RESOURCE_PATH = /^(?:assets|data)\/[a-z0-9_.-]+\/[a-z0-9_./-]+$/;

/** True for a file under `assets/` or `data/` whose path Minecraft refuses as a resource location. */
export function isBadResourcePath(path: string): boolean {
  return /^(?:assets|data)\//.test(path) && !RESOURCE_PATH.test(path);
}

/** `ns:path` or `path` (the declaring namespace's) → the pack file it names under `assets/`. */
export function resourceFile(ref: string, namespace: string): string {
  const colon = ref.indexOf(':');
  return colon < 0 ? `assets/${namespace}/${ref}` : `assets/${ref.slice(0, colon)}/${ref.slice(colon + 1)}`;
}

function field(file: string, at: string): Link[] {
  return [{ kind: 'field', file, at }];
}

function numbers(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((n): n is number => typeof n === 'number') ? value : null;
}

function escape(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Where a geometry fault points in the type's file. */
const GEOMETRY_POINTER: Record<GeometryFault['code'], (params: GeometryFault['params']) => string> = {
  'length-not-positive': () => '/length',
  'bogie-outside': (params) => `/bogies/${params.index}`,
  'bogie-order': (params) => `/bogies/${params.index}`,
  'coupler-outside': (params) => `/couplers/${params.end}`,
};

/**
 * The geometry must make a wagon: every fault `WagonTypeParser.checkGeometry` would stop
 * at (ports/wagonType `geometryFaults`), each at its field. Values of the wrong type are
 * the schema's to say: a length that is no positive number checks nothing, bogies that are
 * not all numbers and a coupler offset that is no number are left out.
 */
function geometry(file: string, type: Record<string, unknown>, out: Problem[]): void {
  const length = type.length;
  if (typeof length !== 'number' || !(length > 0)) return; // the schema says it
  const couplers = isJsonObject(type.couplers) ? type.couplers : {};
  const offset = (value: unknown): number => (typeof value === 'number' ? value : 0.0);
  const faults = geometryFaults(length, numbers(type.bogies) ?? [], { front: offset(couplers.front), rear: offset(couplers.rear) });
  for (const fault of faults) {
    out.push({
      severity: 'error',
      source: 'loader',
      code: `loader.${fault.code}`,
      params: { ...fault.params },
      text: fault.text,
      at: field(file, GEOMETRY_POINTER[fault.code](fault.params)),
    });
  }
}

/** The door ids of a type, lower-cased (the model's keys are matched without case); null when the type gives none to match. */
function doorIds(type: unknown): string[] | null {
  if (!isJsonObject(type)) return null;
  const doors = type.doors;
  if (doors === undefined) return [];
  if (!Array.isArray(doors)) return null;
  return doors.flatMap((door) => (isJsonObject(door) && typeof door.id === 'string' ? [door.id] : []));
}

/** Keys of `animations` and `sounds.doors` are door ids of the type, case aside: any other key does nothing. */
function doorKeys(file: string, model: Record<string, unknown>, typeId: string, doors: string[], out: Problem[]): void {
  const known = new Set(doors.map((id) => id.toLowerCase()));
  const sounds = isJsonObject(model.sounds) ? model.sounds : {};
  const sections: [string, string, unknown][] = [
    ['animations', '/animations', model.animations],
    ['sounds.doors', '/sounds/doors', sounds.doors],
  ];
  for (const [section, pointer, map] of sections) {
    if (!isJsonObject(map)) continue;
    for (const key of Object.keys(map)) {
      if (known.has(key.toLowerCase())) continue;
      const list = doors.length > 0 ? doors.join(', ') : '—';
      out.push({
        severity: 'warning',
        source: 'loader',
        code: 'loader.door-key',
        params: { key, section, id: typeId, doors: list },
        text: `${section} key '${key}' is no door of wagon type ${typeId}: it does nothing (doors: ${list})`,
        at: field(file, `${pointer}/${escape(key)}`),
      });
    }
  }
}

/** The files a model names, by pointer: its OBJ, its `.anim`s, its `.ogg` sounds (other sounds are sound events). */
function modelRefs(model: Record<string, unknown>): [string, string][] {
  const refs: [string, string][] = [];
  if (typeof model.obj === 'string') refs.push(['/obj', model.obj]);
  if (isJsonObject(model.animations)) {
    for (const [key, ref] of Object.entries(model.animations)) if (typeof ref === 'string') refs.push([`/animations/${escape(key)}`, ref]);
  }
  const sounds = isJsonObject(model.sounds) ? model.sounds : {};
  const sound = (pointer: string, ref: unknown): void => {
    if (typeof ref === 'string' && ref.endsWith('.ogg')) refs.push([pointer, ref]);
  };
  for (const loop of ['idle', 'wheels', 'horn', 'bell']) {
    const value = sounds[loop];
    if (isJsonObject(value)) for (const part of ['start', 'main', 'stop']) sound(`/sounds/${loop}/${part}`, value[part]);
    else sound(`/sounds/${loop}`, value);
  }
  sound('/sounds/clack', sounds.clack);
  if (isJsonObject(sounds.doors)) for (const [key, ref] of Object.entries(sounds.doors)) sound(`/sounds/doors/${escape(key)}`, ref);
  if (isJsonObject(sounds.controls)) {
    for (const [key, pair] of Object.entries(sounds.controls)) {
      if (isJsonObject(pair)) for (const part of ['move', 'engage']) sound(`/sounds/controls/${escape(key)}/${part}`, pair[part]);
    }
  }
  return refs;
}

/** A file a declaration names that the pack lacks, where the pack has that namespace (another namespace may be another pack's). */
function missingFiles(pack: Pack, file: string, namespace: string, refs: [string, string][], namespaces: Set<string>, out: Problem[]): void {
  for (const [pointer, ref] of refs) {
    const target = resourceFile(ref, namespace);
    const targetNamespace = target.split('/')[1] ?? '';
    if (!namespaces.has(targetNamespace) || pack.has(target)) continue;
    out.push({
      severity: 'warning',
      source: 'loader',
      code: 'loader.missing-file',
      params: { ref, file: target },
      text: `${ref}: no file ${target} in the pack`,
      at: field(file, pointer),
    });
  }
}

/** Every loader finding of the pack beyond the schema's, in a stable order: paths, pack.mcmeta, then wagons and rail styles by id. */
export function loaderProblems(pack: Pack): Problem[] {
  const out: Problem[] = [];
  const paths = pack.paths();
  const namespaces = new Set(paths.flatMap((path) => (path.startsWith('assets/') ? [path.split('/')[1] ?? ''] : [])));

  for (const path of paths) {
    if (!isBadResourcePath(path)) continue;
    out.push({
      severity: 'warning',
      source: 'loader',
      code: 'loader.resource-path',
      params: { file: path },
      text: `${path}: Minecraft takes only lower-case letters, digits and _ . - / in a resource path; this file is not loaded`,
      at: [{ kind: 'file', file: path }],
    });
  }

  const meta = pack.meta();
  if (meta.format !== null && !meta.supported) {
    out.push({
      severity: 'error',
      source: 'loader',
      code: 'loader.format-too-new',
      params: { format: meta.format, supported: SUPPORTED_FORMAT },
      text: `pack format ${meta.format} is newer than this version of RWAT reads (up to ${SUPPORTED_FORMAT}): update the mod`,
      at: field(MCMETA, '/rwat/format'),
    });
  }

  for (const entry of pack.stock()) {
    const [namespace = ''] = entry.id.split(':');
    if (entry.type !== null && entry.model === null) {
      const model = modelPath(entry.id);
      out.push({
        severity: 'warning',
        source: 'loader',
        code: 'loader.type-without-model',
        params: { id: entry.id, model },
        text: `wagon type '${entry.id}' has no model: it is drawn as a box (declare it in ${model})`,
        at: [{ kind: 'file', file: entry.type }],
      });
    }
    if (entry.model !== null && entry.type === null) {
      out.push({
        severity: 'warning',
        source: 'loader',
        code: 'loader.model-without-type',
        params: { id: entry.id, type: typePath(entry.id) },
        text: `no wagon type '${entry.id}': this model is never drawn (a model and its type share the id)`,
        at: [{ kind: 'file', file: entry.model }],
      });
    }
    const type = entry.type === null ? undefined : pack.json(entry.type);
    if (entry.type !== null && isJsonObject(type)) {
      geometry(entry.type, type, out);
      const cab = type.cab;
      if (isJsonObject(cab) && Object.hasOwn(cab, 'seat') && Object.hasOwn(cab, 'seats')) {
        out.push({
          severity: 'error',
          source: 'loader',
          code: 'loader.cab-seat-and-seats',
          params: {},
          text: "'cab' has both 'seat' and 'seats': list every chair in 'seats'",
          at: field(entry.type, '/cab/seat'),
        });
      }
    }
    const model = entry.model === null ? undefined : pack.json(entry.model);
    if (entry.model !== null && isJsonObject(model)) {
      const doors = entry.type === null ? null : doorIds(type);
      if (doors !== null) doorKeys(entry.model, model, entry.id, doors, out);
      missingFiles(pack, entry.model, namespace, modelRefs(model), namespaces, out);
    }
  }

  for (const style of pack.railStyles()) {
    const rail = pack.json(style.file);
    const namespace = classify(style.file)?.namespace ?? '';
    if (isJsonObject(rail) && typeof rail.obj === 'string') missingFiles(pack, style.file, namespace, [['/obj', rail.obj]], namespaces, out);
  }
  return out;
}
