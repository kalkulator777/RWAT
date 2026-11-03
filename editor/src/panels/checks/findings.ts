/**
 * What the checks tab lists (docs/proposals/editor.md §3.10): the pack's findings and the
 * open model's (app/store `findings`), the floor check's of every wagon type
 * (checks/floor), and the last "Check all models" run's (checks/model) but for the open
 * model, whose own reading, done again after every edit, is newer.
 *
 * The floor check is checked as the pack's findings are: at once when a pack opens, 150 ms
 * after the last of a run of edits — type by type, giving the page back between them
 * (checks/floor/live.ts: MVP's largest types take tens of milliseconds each). It is a
 * signal of its own here, not a part of the pack's (`checkPack`, app/store), which is not
 * this tab's to change; joined there, the tree and the inspector would count its findings too.
 *
 * "Check all models" runs in the page's model worker (model/client `lazyModelWorker`, the
 * one the open model is read in), started by the first run; another pack forgets the run.
 */

import { computed, effect } from '@preact/signals';
import { findings, openModel, pack, revision } from '../../app/store';
import { liveFloorFindings } from '../../checks/floor/live';
import { ModelSweep, sweepProblems } from '../../checks/model/all';
import { lazyModelWorker } from '../../model/client';
import type { ModelCheckApi } from '../../model/types';

/** The floor check's findings of the open pack, checked with a delay, type by type (checks/floor/live.ts). */
export const floorFindings = liveFloorFindings({ pack, revision });

let worker: ModelCheckApi | null = null;

/** "Check all models": its runs and the last one's state. */
export const modelSweep = new ModelSweep(() => (worker ??= lazyModelWorker()));

effect(() => {
  const open = pack.value;
  const checked = modelSweep.state.peek().pack;
  if (checked !== null && checked !== open) modelSweep.clear();
});

/** Every finding the tab lists, in this order: the pack's, the open model's, the floor's, the other models'. */
export const shownFindings = computed(() => {
  const floor = floorFindings.value;
  const models = sweepProblems(modelSweep.state.value, openModel.value?.file ?? null);
  return floor.length === 0 && models.length === 0 ? findings.value : [...findings.value, ...floor, ...models];
});
