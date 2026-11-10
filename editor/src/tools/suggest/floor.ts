/**
 * «Предложить пол» (docs/proposals/editor.md §2.3, §3.9, M6): the floor generator of the
 * converter (`tools/floorgen.py`, run in Pyodide as it is) asked for the zones of a wagon of
 * the author's own pack. A pack of one's own has no IR passenger area to find the floor
 * level by, so the author names it — a click on the model's floor or a number — or leaves
 * it to the generator, which then takes the largest level surface in the lower part of
 * the model.
 *
 * The suggestion is a **draft**: its zones are drawn dashed over the zones the type has,
 * the floor check says what it finds of the type with them (the same port the checks run),
 * and only «Принять» writes it — one command of the journal replacing `interior`.
 * «Отклонить» changes nothing.
 *
 * The parts are apart so that another place can ask for a floor and write it somewhere
 * else (the override of an IR recipe, M6 A6.3): {@link requestFloorDraft} asks the
 * bridge and knows nothing of the type; {@link draftProblems} judges a draft against a type;
 * {@link acceptFloor} is the command that writes it; {@link startFloorSuggest} is the
 * state of the zones tool's section (./SuggestFloor.tsx).
 */

import { computed, effect, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { typeFloorProblems } from '../../checks/floor/problems';
import type { Command, LoadedModel, OverlayShape, PickHit, Problem } from '../../core/contracts';
import { isJsonObject } from '../../core/json';
import { t } from '../../i18n';
import type { BridgeError, FloorSuggestion, ObjBox } from '../../ir/bridge';
import type { ToolContext, ToolSubject } from '../registry';
import { vertexYNear } from '../floor/height';
import { suggestBridge, type SuggestBridge } from './bridge';
import { explain, type Said } from './failure';
import { runWithProgress, type Running } from './run';
import { objSource } from './subject';

/** The overlay layer of the draft's zones. */
export const DRAFT_LAYER = 'suggest.floor';
/** The overlay layer of the floor levels asked for: a plane over the model at each. */
export const LEVEL_LAYER = 'suggest.level';

/** What the author asks of the generator. */
export interface FloorRequest {
  /** The floor heights, OBJ y (a click or a number each); none: the generator picks one. */
  readonly levels: readonly number[];
  /** How far a body may lean into a wall (`clearance`); null: the generator's 0.1. */
  readonly clearance: number | null;
  /** How far below the level a surface is floor too (`step_down`); null: the generator's 0.15. */
  readonly stepDown: number | null;
}

/** The generator's defaults, as `tools/floorgen.py` has them: what an empty option field means. */
export const FLOOR_DEFAULTS = { clearance: 0.1, stepDown: 0.15 };

/** The request as the per-type `floor` object of the generator (`FloorConfig`): only what differs from its defaults. */
export function generatorOptions(request: FloorRequest): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (request.levels.length === 1) options.level = request.levels[0];
  else if (request.levels.length > 1) options.level = [...request.levels];
  if (request.clearance !== null) options.clearance = request.clearance;
  if (request.stepDown !== null) options.step_down = request.stepDown;
  return options;
}

/** What the generator gave, for the author to take or leave. */
export interface FloorDraft {
  /** The zones, as the type's `interior` is written. */
  readonly zones: readonly ObjBox[];
  /** The floor heights used (OBJ y). */
  readonly levels: readonly number[];
  /** What the generator says of its work. */
  readonly notes: readonly string[];
  /** Where a rider's centre fits, m². */
  readonly regionArea: number;
  /** Of it, dropped as unreachable from a door, m². */
  readonly droppedArea: number;
  /** What it was made for ({@link basisOf}): a change of either makes it stale. */
  readonly basis: string;
}

/** The generator found nothing to stand on. */
export class EmptyFloor extends Error {
  constructor() {
    super('the generator gave no zones');
    this.name = 'EmptyFloor';
  }
}

/** The doors of a type's JSON the generator can use: the ones with a box of two corners. */
export function generatorDoors(typeJson: unknown): unknown[] {
  if (!isJsonObject(typeJson) || !Array.isArray(typeJson.doors)) return [];
  const corner = (value: unknown): boolean => Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
  return typeJson.doors.filter((door) => isJsonObject(door) && corner(door.min) && corner(door.max));
}

/** What a draft is made from: the model's OBJ and the doors the generator saw. */
export function basisOf(subject: ToolSubject): string {
  return JSON.stringify([subject.model?.obj ?? null, generatorDoors(subject.typeJson)]);
}

/**
 * Asks the bridge for the floor of `obj` (the OBJ's bytes) with the request's options and the
 * type's doors. Fails as the bridge does (a `BridgeError`: the generator refuses the options,
 * finds no floor at the level, the call is cancelled) or with {@link EmptyFloor}.
 */
export async function requestFloorDraft(
  bridge: Pick<SuggestBridge, 'suggestFloor'>,
  input: { obj: Uint8Array; request: FloorRequest; doors: readonly unknown[] },
  signal?: AbortSignal,
): Promise<Omit<FloorDraft, 'basis'>> {
  const answer: FloorSuggestion = await bridge.suggestFloor(input.obj, generatorOptions(input.request), input.doors, signal === undefined ? {} : { signal });
  if (answer.interior.length === 0) throw new EmptyFloor();
  return { zones: answer.interior, levels: answer.levels, notes: answer.notes, regionArea: answer.regionArea, droppedArea: answer.droppedArea };
}

/** The floor check's findings of the type with the draft's zones for its `interior`, as the checks word them. */
export function draftProblems(wagon: string, typeFile: string, typeJson: unknown, zones: readonly ObjBox[]): Problem[] {
  if (!isJsonObject(typeJson)) return [];
  return typeFloorProblems(wagon, typeFile, { ...typeJson, interior: zones });
}

/** The command that takes the draft: the type's `interior` replaced by its zones (whatever it was, or was not), one entry of the journal. */
export function acceptFloor(typeFile: string, zones: readonly ObjBox[]): Command {
  return { label: 'tools.suggest.cmd.floor', labelParams: { count: zones.length }, ops: [{ op: 'set', file: typeFile, at: '/interior', value: zones.map((zone) => ({ min: [...zone.min], max: [...zone.max] })) }] };
}

/** The draft's zones as the view draws them: dashed rectangles on their floors, selecting nothing. */
export function draftShapes(zones: readonly ObjBox[]): OverlayShape[] {
  return zones.map((zone) => ({ shape: 'rect', min: [...zone.min], max: [...zone.max], style: 'draft' }));
}

/** The plan of the whole model in the OBJ frame (x along the car, z across), or null for a model with nothing in it. */
export function modelPlan(model: LoadedModel): { minX: number; minZ: number; maxX: number; maxZ: number } | null {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const { bbox } of model.objects) {
    const [lo, hi] = bbox;
    if (![lo[0], lo[2], hi[0], hi[2]].every((n) => Number.isFinite(n))) continue;
    minX = Math.min(minX, lo[0]);
    minZ = Math.min(minZ, lo[2]);
    maxX = Math.max(maxX, hi[0]);
    maxZ = Math.max(maxZ, hi[2]);
  }
  return Number.isFinite(minX) ? { minX, minZ, maxX, maxZ } : null;
}

/** A plane over the model at each floor level asked for. */
export function levelShapes(model: LoadedModel, levels: readonly number[]): OverlayShape[] {
  const plan = modelPlan(model);
  if (plan === null) return [];
  return levels.map((y) => ({ shape: 'rect', min: [plan.minX, y, plan.minZ], max: [plan.maxX, y, plan.maxZ], style: 'reach' }));
}

/** The sentence for a failure of the generator the author can do something about. */
export function floorFailure(error: BridgeError, request: FloorRequest): string | null {
  const message = error.message;
  if (error.type === 'FloorConfigError') return t('tools.suggest.err.floor.config');
  if (message.includes('no up-facing surface near level') || message.includes('no floor surface at the level')) {
    return t('tools.suggest.err.floor.level', { levels: request.levels.join(', ') });
  }
  if (message.includes('no floor level found')) return t('tools.suggest.err.floor.auto');
  if (message.includes('no visible triangles')) return t('tools.suggest.err.floor.empty');
  if (message.includes('a player fits nowhere')) return t('tools.suggest.err.floor.narrow');
  return null;
}

/** Where the zones tool's section stands. */
export type FloorSuggestOutcome =
  | { readonly phase: 'idle' }
  | { readonly phase: 'draft'; readonly draft: FloorDraft }
  | { readonly phase: 'failed'; readonly said: Said };

/** What the zones tool's section holds and does for the floor suggestion. */
export interface FloorSuggest {
  /** The floor heights asked for (OBJ y); none: the generator picks. */
  readonly levels: ReadonlySignal<readonly number[]>;
  /** `clearance` of the generator; null: its default ({@link FLOOR_DEFAULTS}). */
  readonly clearance: Signal<number | null>;
  /** `step_down` of the generator; null: its default. */
  readonly stepDown: Signal<number | null>;
  /** True while the next click on the model sets a level. */
  readonly picking: Signal<boolean>;
  readonly outcome: ReadonlySignal<FloorSuggestOutcome>;
  /** The call under way (progress, cancel), or null. */
  readonly running: ReadonlySignal<Running | null>;
  /** True when the doors or the model changed since the draft was made: it is not taken as it is. */
  readonly stale: ReadonlySignal<boolean>;
  /** What the floor check says of the type with the draft's zones; empty without a draft. */
  readonly problems: ReadonlySignal<readonly Problem[]>;
  /** Adds a level (a number the author typed, or a click's); false for one that is there already. */
  addLevel(y: number): boolean;
  removeLevel(index: number): void;
  /** Asks the generator. Does nothing while a call is under way. */
  request(): Promise<void>;
  /** Stops the call under way. */
  cancel(): void;
  /** Takes the draft: one command replacing `interior`. False when there is no draft, it is stale, or the pack refused. */
  accept(): boolean;
  /** Drops the draft (or the failure shown): nothing changes in the type. */
  reject(): void;
  /** Takes everything back: layers emptied, picks given up, a call under way stopped. */
  dispose(): void;
}

/** Two levels this close are one (blocks). */
const SAME_LEVEL = 1e-6;

/**
 * The state of the floor suggestion for the wagon of a tool's context. It draws its two
 * layers (the draft, the level planes) and listens for the click that picks a level; it
 * asks the bridge only when {@link FloorSuggest.request} is called.
 *
 * @param bridge the Python bridge ({@link suggestBridge} when left out)
 */
export function startFloorSuggest(context: ToolContext, bridge: () => SuggestBridge = suggestBridge): FloorSuggest {
  const subject = (): ToolSubject => context.subject.peek() as ToolSubject;
  const levels = signal<readonly number[]>([]);
  const clearance = signal<number | null>(null);
  const stepDown = signal<number | null>(null);
  const picking = signal(false);
  const outcome = signal<FloorSuggestOutcome>({ phase: 'idle' });
  const running = signal<Running | null>(null);
  let disposed = false;

  const stale = computed(() => {
    const now = outcome.value;
    const open = context.subject.value;
    return now.phase === 'draft' && open !== null && basisOf(open) !== now.draft.basis;
  });
  const problems = computed<readonly Problem[]>(() => {
    const now = outcome.value;
    const open = context.subject.value;
    return now.phase === 'draft' && open !== null ? draftProblems(open.wagon, open.typeFile, open.typeJson, now.draft.zones) : [];
  });

  const suggest: FloorSuggest = {
    levels,
    clearance,
    stepDown,
    picking,
    outcome,
    running,
    stale,
    problems,
    addLevel(y) {
      if (!Number.isFinite(y) || levels.peek().some((level) => Math.abs(level - y) < SAME_LEVEL)) return false;
      levels.value = [...levels.peek(), y];
      return true;
    },
    removeLevel(index) {
      levels.value = levels.peek().filter((_, i) => i !== index);
    },
    async request() {
      if (running.peek() !== null) return;
      const now = subject();
      const source = objSource(now);
      if (source === null) {
        outcome.value = { phase: 'failed', said: { text: t('tools.suggest.err.noModel'), detail: null } };
        return;
      }
      picking.value = false;
      outcome.value = { phase: 'idle' };
      const request: FloorRequest = { levels: levels.peek(), clearance: clearance.peek(), stepDown: stepDown.peek() };
      const doors = generatorDoors(now.typeJson);
      const basis = basisOf(now);
      try {
        const draft = await runWithProgress(bridge(), running, async (stop) => requestFloorDraft(bridge(), { obj: await source.read(), request, doors }, stop));
        if (!disposed) outcome.value = { phase: 'draft', draft: { ...draft, basis } };
      } catch (error) {
        if (disposed) return;
        const said = error instanceof EmptyFloor ? { text: t('tools.suggest.err.floor.none'), detail: null } : explain(error, (failure) => floorFailure(failure, request));
        outcome.value = said === null ? { phase: 'idle' } : { phase: 'failed', said };
      }
    },
    cancel() {
      running.peek()?.cancel();
    },
    accept() {
      const now = outcome.peek();
      if (now.phase !== 'draft' || stale.peek()) return false;
      if (!context.dispatch(acceptFloor(subject().typeFile, now.draft.zones))) return false;
      outcome.value = { phase: 'idle' };
      return true;
    },
    reject() {
      outcome.value = { phase: 'idle' };
    },
    dispose() {
      disposed = true;
      stopDraft();
      stopLevels();
      stopPicking();
      running.peek()?.cancel();
      context.view.overlay(DRAFT_LAYER, []);
      context.view.overlay(LEVEL_LAYER, []);
    },
  };

  const stopDraft = effect(() => {
    const now = outcome.value;
    context.view.overlay(DRAFT_LAYER, now.phase === 'draft' ? draftShapes(now.draft.zones) : []);
  });
  const stopLevels = effect(() => {
    const model = context.subject.value?.model ?? null;
    context.view.overlay(LEVEL_LAYER, model === null ? [] : levelShapes(model, levels.value));
  });
  // a level from a click on the model's floor: the click is the suggestion's, nothing is selected by it
  const stopPicking = context.view.onPick((hit: PickHit) => {
    if (!picking.peek() || hit.object === undefined || hit.point === undefined) return false;
    const model = subject().model;
    const y = model === null ? null : vertexYNear(model, hit.object, hit.point);
    if (y === null) return false;
    picking.value = false;
    suggest.addLevel(y);
    return true;
  });
  return suggest;
}
