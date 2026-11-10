/**
 * «Двери по именам» (docs/proposals/editor.md §3.9, M6): the doors the converter finds in a
 * model by the names of its objects (`tools/ir2rwat.py` `model_doors`, run in Pyodide as it
 * is), offered to the wagon of the author's own pack as a **draft**.
 *
 * What it understands is the IR convention of object names (SPEC §9.6, §9.8):
 *
 * - `DOOR_<n>` groups: the objects named `DOOR_<n>…` are the leaves of one door (a sliding
 *   pair is one door); `EXTERNAL` in the name makes it a way in and out, `CONNECTING` a
 *   gangway door, anything else a door between floor zones (`inner`); its box is the
 *   group's bounding box, its id the control group (`CG_<name>`) or `door_<n>`; doors on
 *   one control group get it as their `group`;
 * - `WIDGET_<n>` leaves flagged `TOGGLE`, thin and door-sized, whose control group the model
 *   animates (a key of the model's `animations`): inner doors by the group's name.
 *
 * Markers and handles too small for a doorway are left out. The draft is drawn as dashed
 * boxes; «Принять» adds the doors the type lacks — by id, case aside, as the engine matches
 * them — in one command and leaves the doors it has as they are.
 */

import { computed, effect, signal, type ReadonlySignal } from '@preact/signals';
import { typeFloorProblems } from '../../checks/floor/problems';
import type { Command, OverlayShape, Problem } from '../../core/contracts';
import { isJsonObject } from '../../core/json';
import type { PackDoor } from '../../ir/bridge';
import { t } from '../../i18n';
import { idTaken } from '../doors/doors';
import type { ToolContext, ToolSubject } from '../registry';
import { suggestBridge, type SuggestBridge } from './bridge';
import { explain, type Said } from './failure';
import { runWithProgress, type Running } from './run';
import { objSource } from './subject';

/** The overlay layer of the draft's doors. */
export const DOORS_DRAFT_LAYER = 'suggest.doors';

/** A door the converter found, and whether the type has one of that id already. */
export interface FoundDoor {
  readonly door: PackDoor;
  /** True when a door of the type has this id (case aside): «Принять» leaves it alone. */
  readonly present: boolean;
}

/** The control groups an animation of the model moves: the keys of its `animations`, which `widget_doors` matches without case. */
export function animatedGroups(modelJson: unknown): string[] {
  return isJsonObject(modelJson) && isJsonObject(modelJson.animations) ? Object.keys(modelJson.animations) : [];
}

/** What the converter found, set against the doors the type has. */
export function foundDoors(typeJson: unknown, doors: readonly PackDoor[]): FoundDoor[] {
  return doors.map((door) => ({ door, present: idTaken(typeJson, door.id) }));
}

/**
 * Asks the bridge for the doors of `obj` (the OBJ's bytes): the converter reads the object
 * names itself; the model's animated groups are what tells a widget leaf from a switch.
 */
export async function requestDoorsDraft(
  bridge: Pick<SuggestBridge, 'modelDoors'>,
  input: { obj: Uint8Array; modelJson: unknown },
  signal?: AbortSignal,
): Promise<PackDoor[]> {
  return bridge.modelDoors(input.obj, animatedGroups(input.modelJson), signal === undefined ? {} : { signal });
}

/**
 * The command that adds the doors of `found` the type lacks, at the end of its `doors` in
 * the order found (the list made when the type has none): one entry of the journal. No ops
 * when every one is there.
 */
export function acceptDoors(typeFile: string, typeJson: unknown, found: readonly FoundDoor[]): Command {
  const fresh = found.filter((entry) => !entry.present).map(({ door }) => ({ ...door, min: [...door.min], max: [...door.max] }));
  const has = isJsonObject(typeJson) && Array.isArray(typeJson.doors);
  const ops: Command['ops'] =
    fresh.length === 0
      ? []
      : has
        ? fresh.map((value) => ({ op: 'insert' as const, file: typeFile, at: '/doors/-', value }))
        : [{ op: 'set', file: typeFile, at: '/doors', value: fresh }];
  return { label: 'tools.suggest.cmd.doors', labelParams: { count: fresh.length }, ops };
}

/**
 * What the floor check would newly say of the type with the doors the draft adds: its
 * findings with them, less the ones it has already, as the checks word them.
 */
export function addedProblems(wagon: string, typeFile: string, typeJson: unknown, found: readonly FoundDoor[]): Problem[] {
  if (!isJsonObject(typeJson)) return [];
  const fresh = found.filter((entry) => !entry.present).map(({ door }) => door);
  if (fresh.length === 0) return [];
  const doors: unknown[] = Array.isArray(typeJson.doors) ? (typeJson.doors as unknown[]) : [];
  const before = typeFloorProblems(wagon, typeFile, typeJson);
  return typeFloorProblems(wagon, typeFile, { ...typeJson, doors: [...doors, ...fresh] }).filter((problem) => !before.some((known) => known.code === problem.code && known.text === problem.text));
}

/** The draft's doors as the view draws them: dashed boxes, selecting nothing. */
export function doorShapes(found: readonly FoundDoor[]): OverlayShape[] {
  return found.map(({ door }) => ({ shape: 'box', min: [...door.min], max: [...door.max], style: 'draft' }));
}

/** What the draft was made from: the model's OBJ, the animated groups (the widgets' doors) and the doors the type had. */
export function doorsBasis(subject: ToolSubject): string {
  const ids = isJsonObject(subject.typeJson) && Array.isArray(subject.typeJson.doors) ? subject.typeJson.doors.map((door) => (isJsonObject(door) ? door.id : null)) : [];
  return JSON.stringify([subject.model?.obj ?? null, animatedGroups(subject.modelJson), ids]);
}

/** Where the doors tool's section stands. */
export type DoorsSuggestOutcome =
  | { readonly phase: 'idle' }
  | { readonly phase: 'draft'; readonly doors: readonly PackDoor[]; readonly basis: string }
  | { readonly phase: 'failed'; readonly said: Said };

/** What the doors tool's section holds and does for the doors by names. */
export interface DoorsByNames {
  readonly outcome: ReadonlySignal<DoorsSuggestOutcome>;
  readonly running: ReadonlySignal<Running | null>;
  /** The draft's doors against the type's now: new ones, and ones whose id the type has (empty without a draft). */
  readonly found: ReadonlySignal<readonly FoundDoor[]>;
  /** What the floor check would newly say of the type with the doors the draft adds. */
  readonly problems: ReadonlySignal<readonly Problem[]>;
  /** True when the model, its animated groups or the type's door ids changed since the draft: it is made again. */
  readonly stale: ReadonlySignal<boolean>;
  request(): Promise<void>;
  cancel(): void;
  /** Adds the doors the type lacks: one command. False when there is no draft, it is stale, nothing is new, or the pack refused. */
  accept(): boolean;
  reject(): void;
  dispose(): void;
}

/**
 * The state of «Двери по именам» for the wagon of a tool's context. It draws the draft and
 * asks the bridge only when {@link DoorsByNames.request} is called.
 *
 * @param bridge the Python bridge ({@link suggestBridge} when left out)
 */
export function startDoorsByNames(context: ToolContext, bridge: () => SuggestBridge = suggestBridge): DoorsByNames {
  const subject = (): ToolSubject => context.subject.peek() as ToolSubject;
  const outcome = signal<DoorsSuggestOutcome>({ phase: 'idle' });
  const running = signal<Running | null>(null);
  let disposed = false;

  const found = computed<readonly FoundDoor[]>(() => {
    const now = outcome.value;
    const open = context.subject.value;
    return now.phase === 'draft' && open !== null ? foundDoors(open.typeJson, now.doors) : [];
  });
  const problems = computed<readonly Problem[]>(() => {
    const open = context.subject.value;
    return open === null ? [] : addedProblems(open.wagon, open.typeFile, open.typeJson, found.value);
  });
  const stale = computed(() => {
    const now = outcome.value;
    const open = context.subject.value;
    return now.phase === 'draft' && open !== null && doorsBasis(open) !== now.basis;
  });

  const by: DoorsByNames = {
    outcome,
    running,
    found,
    problems,
    stale,
    async request() {
      if (running.peek() !== null) return;
      const now = subject();
      const source = objSource(now);
      if (source === null) {
        outcome.value = { phase: 'failed', said: { text: t('tools.suggest.err.noModel'), detail: null } };
        return;
      }
      outcome.value = { phase: 'idle' };
      const basis = doorsBasis(now);
      try {
        const doors = await runWithProgress(bridge(), running, async (stop) => requestDoorsDraft(bridge(), { obj: await source.read(), modelJson: now.modelJson }, stop));
        if (!disposed) outcome.value = { phase: 'draft', doors, basis };
      } catch (error) {
        if (disposed) return;
        const said = explain(error);
        outcome.value = said === null ? { phase: 'idle' } : { phase: 'failed', said };
      }
    },
    cancel() {
      running.peek()?.cancel();
    },
    accept() {
      if (outcome.peek().phase !== 'draft' || stale.peek()) return false;
      const now = subject();
      const command = acceptDoors(now.typeFile, now.typeJson, found.peek());
      if (command.ops.length === 0 || !context.dispatch(command)) return false;
      outcome.value = { phase: 'idle' };
      return true;
    },
    reject() {
      outcome.value = { phase: 'idle' };
    },
    dispose() {
      disposed = true;
      stopDraft();
      running.peek()?.cancel();
      context.view.overlay(DOORS_DRAFT_LAYER, []);
    },
  };

  const stopDraft = effect(() => {
    context.view.overlay(DOORS_DRAFT_LAYER, doorShapes(found.value));
  });
  return by;
}
