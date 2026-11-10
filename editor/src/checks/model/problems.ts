/**
 * The model check's findings as the checks show them (docs/proposals/editor.md §3.10, item
 * 4): each finding of ports/modelCheck (`ModelCheck`) a {@link Problem} of source `model`
 * with the code `model.<code>` (translated in ./i18n.ts), its params and the engine's
 * line, pointing where it is fixed:
 *
 * - the OBJ's path in the declaration (`/obj`) when it is no resource location or no file;
 * - the OBJ for what is wrong in it (a face, no faces, nothing drawn, an `mtllib` that
 *   names nothing) — and the objects that carry a control group too long;
 * - the material library for a library that doesn't read and for a texture its material names;
 * - the declaration's `/animations/<door>` and `/liveries/<id>` entries.
 *
 * One system of codes for everything said of a model: the model worker's findings of a
 * model it can't read (model/build: the declaration doesn't read, the OBJ is no resource
 * location, missing, unreadable) are these, and `model.bad-declaration` and
 * `model.failed` (the worker failed) besides. Pure: it runs in the model worker.
 */

import type { Link, Problem } from '../../core/contracts';
import { childPointer, isJsonObject } from '../../core/json';
import { resourceFile } from '../../model/resources';
import type { ModelFinding } from '../../ports/modelCheck';

/** The model a finding is of: its id (`ns:name`), its declaration's pack path and JSON value. */
export interface CheckedModel {
  id: string;
  file: string;
  declaration: unknown;
}

function field(file: string, at: string): Link {
  return { kind: 'field', file, at };
}

/** The pack file of a location, or the declaration when Minecraft takes no such location. */
function fileOf(location: unknown, model: CheckedModel): Link {
  const file = typeof location === 'string' ? resourceFile(location) : null;
  return file === null ? { kind: 'file', file: model.file } : { kind: 'file', file };
}

/** The pointer of a key of `section` (`animations`, `liveries`) as the declaration writes it; the engine's animation keys are lower case. */
function entry(model: CheckedModel, section: string, key: unknown): string {
  const map = isJsonObject(model.declaration) ? model.declaration[section] : undefined;
  const pointer = `/${section}`;
  if (!isJsonObject(map) || typeof key !== 'string') return pointer;
  const written = Object.keys(map).find((name) => name === key) ?? Object.keys(map).find((name) => name.toLowerCase() === key);
  return written === undefined ? pointer : childPointer(pointer, written);
}

/** Where a finding is fixed: its links, the most telling first. */
function linksOf(finding: ModelFinding, model: CheckedModel): Link[] {
  const { params } = finding;
  switch (finding.code) {
    case 'bad-path':
    case 'missing':
      return [field(model.file, '/obj')];
    case 'unreadable-library':
      return [fileOf(params.library, model)];
    case 'bad-texture-path':
    case 'missing-texture':
      return [fileOf(finding.library, model)];
    case 'group-too-long':
      return [fileOf(params.path, model), ...(finding.objects ?? []).map((name): Link => ({ kind: 'object', model: model.id, name }))];
    case 'bad-animation-path':
    case 'missing-animation':
    case 'unreadable-animation':
      return [field(model.file, entry(model, 'animations', params.door))];
    case 'livery-replaces-nothing':
      return [field(model.file, entry(model, 'liveries', params.livery))];
    default:
      return [fileOf(params.path, model)];
  }
}

/** A finding of the model check as a finding of the checks. */
export function modelProblem(finding: ModelFinding, model: CheckedModel): Problem {
  return {
    severity: finding.severity,
    source: 'model',
    code: `model.${finding.code}`,
    params: { ...finding.params },
    text: finding.text,
    at: linksOf(finding, model),
  };
}

/** The finding of a declaration the engine refuses (ports/modelParts `modelDeclaration`): the model is not read. */
export function badDeclaration(model: CheckedModel, error: string): Problem {
  return {
    severity: 'error',
    source: 'model',
    code: 'model.bad-declaration',
    params: { error },
    text: `${model.file}: ${error}`,
    at: [{ kind: 'file', file: model.file }],
  };
}

/** The finding of a model the worker failed to read: not the model's fault, the worker's. The one finding of it, of the open model (app/openModel) and in "Check all models" (./all.ts). */
export function failedModel(model: Pick<CheckedModel, 'id' | 'file'>, error: unknown): Problem {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    severity: 'error',
    source: 'model',
    code: 'model.failed',
    params: { model: model.id, error: detail },
    text: `model ${model.id} could not be read: ${detail}`,
    at: [{ kind: 'file', file: model.file }],
  };
}
