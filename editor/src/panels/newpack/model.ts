/**
 * The wizard of a new pack and of a new wagon (docs/proposals/editor.md §2.1, steps 1–2),
 * as data: what the user typed → the files of a new pack, or the command that adds a type
 * and its model. Pure: no DOM, no signals; the dialogs are ./NewPackPanel.tsx.
 *
 * - **A new pack** is `pack.mcmeta` alone: Minecraft's `pack` section as the converter
 *   writes it (`pack_format` 34, `supported_formats` [34, 48]) and the `rwat` block of
 *   format 1 with what the user said of the pack. It is written by `dump`, as the tools
 *   write new files, and opened from memory; saving it downloads a zip under its name.
 * - **A new wagon** is one command of the journal (undo takes it back whole): the model's
 *   files under `assets/<ns>/<folder>/`, the type `data/<ns>/wagon_types/<id>.json` with
 *   its required fields, the model `assets/<ns>/wagon_models/<id>.json` naming the OBJ,
 *   and its names if given. A file name Minecraft would not load (capitals, spaces) is
 *   refused with the list of such files, as is anything that is there already.
 * - **Files added** to a folder of the pack — textures shared by several models
 *   (`assets/<ns>/stock/common/`), a livery's folder beside an OBJ, the pack's `README.md`,
 *   `LICENSE.txt` and `pack.png` at its root — are one command too, refused the same way.
 */

import { isBadResourcePath } from '../../checks/loader';
import type { Command, FileEntry, Op, PackSource } from '../../core/contracts';
import { dumpBytes } from '../../core/json';
import { MCMETA, SUPPORTED_FORMAT, modelPath, putJson, typePath, wagonNameKey, type Pack } from '../../core/pack';
import { packPathProblem } from '../../core/paths';
import type { Schema } from '../../core/schema';
import { parseNumber } from '../../forms/values';
import { nameOps } from '../names/model';

/** Minecraft's pack format of 1.21.1 resource packs, and the formats a pack that is also a data pack works with (as `ir2rwat` writes). */
export const PACK_FORMAT = 34;
export const SUPPORTED_FORMATS: readonly number[] = [34, 48];

/** A reason the wizard refuses, as an i18n key and its params. */
export interface WizardError {
  key: string;
  params?: Record<string, string | number>;
}

/** A pattern of `common.schema.json#/$defs/<name>` (the schema is where the format says it). */
export function commonPattern(schema: Schema, name: string): RegExp {
  const node = schema.store.resolve(schema.store.uriOf('common'), `#/$defs/${name}`).schema;
  if (typeof node.pattern !== 'string') throw new Error(`common.schema.json#/$defs/${name} has no pattern`);
  return new RegExp(node.pattern, 'u');
}

export interface NewPackInput {
  /** The pack's folder or zip name. */
  name: string;
  namespace: string;
  /** `rwat.name`: the pack's display name. */
  title: string;
  version: string;
  /** Comma-separated. */
  authors: string;
  license: string;
  description: string;
}

/** What is wrong with the input of a new pack; empty when it makes one. */
export function checkNewPack(input: NewPackInput, schema: Schema): WizardError[] {
  const errors: WizardError[] = [];
  if (input.name.trim() === '') errors.push({ key: 'newpack.error.name' });
  if (!commonPattern(schema, 'namespace').test(input.namespace.trim())) errors.push({ key: 'newpack.error.namespace', params: { namespace: input.namespace.trim() } });
  return errors;
}

/** The `pack.mcmeta` of a new pack: the `pack` section, then the `rwat` block with the fields the user filled in. */
export function newPackMeta(input: NewPackInput): Record<string, unknown> {
  const title = input.title.trim() || input.name.trim();
  const description = input.description.trim();
  const authors = input.authors
    .split(',')
    .map((author) => author.trim())
    .filter((author) => author !== '');
  const rwat: Record<string, unknown> = { format: SUPPORTED_FORMAT, name: title };
  if (input.version.trim() !== '') rwat.version = input.version.trim();
  if (authors.length > 0) rwat.authors = authors;
  if (input.license.trim() !== '') rwat.license = input.license.trim();
  if (description !== '') rwat.description = description;
  return {
    pack: { pack_format: PACK_FORMAT, supported_formats: [...SUPPORTED_FORMATS], description: description || title },
    rwat,
  };
}

/**
 * A pack the editor made, held in memory: what it opens from. It is not a folder the
 * editor can write back to (`writable` false), so saving downloads a zip under its name.
 */
export class NewPackSource implements PackSource {
  readonly kind = 'memory';
  readonly writable = false;

  constructor(
    readonly name: string,
    private readonly files: ReadonlyMap<string, Uint8Array>,
  ) {}

  list(): Promise<FileEntry[]> {
    return Promise.resolve([...this.files].map(([path, bytes]) => ({ path, size: bytes.length })));
  }

  read(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    return bytes === undefined ? Promise.reject(new Error(`no file ${path}`)) : Promise.resolve(bytes.slice());
  }
}

/** The source of a new pack: its `pack.mcmeta`, written as the tools write new files. */
export function newPackSource(input: NewPackInput): NewPackSource {
  return new NewPackSource(input.name.trim(), new Map([[MCMETA, dumpBytes(newPackMeta(input))]]));
}

/** A file the user picked for the model. */
export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

export interface AddWagonInput {
  namespace: string;
  /** The id's path: `coach`, `sub/coach`. */
  id: string;
  /** The model's folder under `assets/<ns>/`; empty: `stock/<id>`. */
  folder: string;
  /** The OBJ and, beside it, its MTL, textures and `.anim`s. */
  files: readonly PickedFile[];
  length: string;
  massT: string;
  bogieFront: string;
  bogieRear: string;
  /** Names by Minecraft language code; empty ones are left out. */
  names: Readonly<Record<string, string>>;
}

/** The model folder the input names, without slashes at its ends. */
export function modelFolder(input: Pick<AddWagonInput, 'folder' | 'id'>): string {
  const folder = input.folder.trim().replace(/^\/+|\/+$/g, '');
  return folder === '' ? `stock/${input.id.trim()}` : folder;
}

/** The namespaces of a pack: the folders under `assets/` and `data/`, sorted. */
export function packNamespaces(pack: Pack): string[] {
  const found = new Set<string>();
  for (const path of pack.paths()) {
    const match = /^(?:assets|data)\/([^/]+)\//.exec(path);
    if (match !== null) found.add(match[1] as string);
  }
  return [...found].sort();
}

/**
 * The pack paths of files put into `base` (a folder of the pack, '' for its root) by their
 * names; what is wrong with them goes into `errors`: names Minecraft would not load under
 * `assets/` and `data/` (capitals, spaces), files the pack has already.
 */
function placedPaths(pack: Pack, base: string, files: readonly PickedFile[], errors: WizardError[]): string[] {
  const paths = files.map((file) => (base === '' ? file.name : `${base}/${file.name}`));
  const badNames = paths.filter(isBadResourcePath);
  if (badNames.length > 0) errors.push({ key: 'newpack.error.fileNames', params: { files: badNames.join(', ') } });
  const taken = paths.filter((path) => pack.has(path));
  if (taken.length > 0) errors.push({ key: 'newpack.error.filesTaken', params: { files: taken.join(', ') } });
  return paths;
}

/** The command that adds the wagon, or why it cannot be added. */
export function addWagonCommand(pack: Pack, input: AddWagonInput, schema: Schema): { command: Command } | { errors: WizardError[] } {
  const errors: WizardError[] = [];
  const namespace = input.namespace.trim();
  const name = input.id.trim();
  const id = `${namespace}:${name}`;
  if (!commonPattern(schema, 'type_id').test(id)) errors.push({ key: 'newpack.error.id', params: { id } });
  else if (pack.has(typePath(id)) || pack.has(modelPath(id))) errors.push({ key: 'newpack.error.idTaken', params: { id } });

  const folder = modelFolder(input);
  if (folder.split('/').some((part) => part === '' || part === '.' || part === '..')) errors.push({ key: 'newpack.error.folder', params: { folder } });
  const objs = input.files.filter((file) => file.name.toLowerCase().endsWith('.obj'));
  if (objs.length !== 1) errors.push({ key: 'newpack.error.obj', params: { count: objs.length } });
  const paths = placedPaths(pack, `assets/${namespace}/${folder}`, input.files, errors);

  const number = (text: string, field: string, check: (n: number) => boolean): number => {
    const parsed = parseNumber(text);
    if ('error' in parsed || !check(parsed.value)) {
      errors.push({ key: 'newpack.error.number', params: { field } });
      return Number.NaN;
    }
    return parsed.value;
  };
  const length = number(input.length, 'length', (n) => n > 0);
  const massT = number(input.massT, 'mass_t', (n) => n > 0);
  const front = number(input.bogieFront, 'bogies[0]', () => true);
  const rear = number(input.bogieRear, 'bogies[1]', () => true);
  if (errors.length > 0) return { errors };

  const ops: Op[] = input.files.map((file, i) => ({ op: 'putFile', file: paths[i] as string, bytes: file.bytes }));
  ops.push(putJson(typePath(id), { length, bogies: [front, rear], mass_t: massT }));
  ops.push(putJson(modelPath(id), { obj: `${folder}/${(objs[0] as PickedFile).name}` }));
  const key = wagonNameKey(id);
  for (const [lang, text] of Object.entries(input.names)) {
    if (text.trim() !== '') ops.push(...nameOps(pack, key, namespace, lang, text.trim()));
  }
  return { command: { label: 'newpack.command.addWagon', labelParams: { id }, ops } };
}

export interface AddFilesInput {
  /** The folder of the pack the files go into, from its root: `assets/<ns>/stock/common`; empty for the root itself. */
  folder: string;
  files: readonly PickedFile[];
}

/** The folder the input names, without slashes at its ends ('' for the pack's root). */
export function filesFolder(input: Pick<AddFilesInput, 'folder'>): string {
  return input.folder.trim().replace(/^\/+|\/+$/g, '');
}

/** The command that puts the files into the folder, or why they cannot be added. */
export function addFilesCommand(pack: Pack, input: AddFilesInput): { command: Command } | { errors: WizardError[] } {
  const errors: WizardError[] = [];
  const folder = filesFolder(input);
  if (folder !== '' && packPathProblem(folder) !== null) errors.push({ key: 'newpack.error.folder', params: { folder } });
  if (input.files.length === 0) errors.push({ key: 'newpack.error.noFiles' });
  const paths = placedPaths(pack, folder, input.files, errors);
  if (errors.length > 0) return { errors };
  const ops: Op[] = input.files.map((file, i) => ({ op: 'putFile', file: paths[i] as string, bytes: file.bytes }));
  return { command: { label: 'newpack.command.addFiles', labelParams: { count: ops.length, folder: folder === '' ? '/' : folder }, ops } };
}
