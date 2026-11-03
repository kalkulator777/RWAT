/**
 * What the checks tab lists (docs/proposals/editor.md §3.10): the pack's findings — the
 * loader's, the schema's and the floor check's (checks/pack `checkPack`) — and the open
 * model's (app/store `findings`, which the tree and the inspector count too), and the last
 * "Check all models" run's (checks/model) but for the open model, whose own reading, done
 * again after every edit, is newer.
 *
 * "Check all models" runs in the page's model worker (model/client `lazyModelWorker`, the
 * one the open model is read in), started by the first run; another pack forgets the run.
 */

import { computed, effect } from '@preact/signals';
import { findings, openModel, pack } from '../../app/store';
import { ModelSweep, sweepProblems } from '../../checks/model/all';
import { lazyModelWorker } from '../../model/client';
import type { ModelCheckApi } from '../../model/types';

let worker: ModelCheckApi | null = null;

/** "Check all models": its runs and the last one's state. */
export const modelSweep = new ModelSweep(() => (worker ??= lazyModelWorker()));

effect(() => {
  const open = pack.value;
  const checked = modelSweep.state.peek().pack;
  if (checked !== null && checked !== open) modelSweep.clear();
});

/** Every finding the tab lists, in this order: the pack's (the floor's among them), the open model's, the other models'. */
export const shownFindings = computed(() => {
  const models = sweepProblems(modelSweep.state.value, openModel.value?.file ?? null);
  return models.length === 0 ? findings.value : [...findings.value, ...models];
});
