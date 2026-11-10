/**
 * "Check all models" (docs/proposals/editor.md §2.5, §3.10–3.11): every wagon model of the
 * open pack through the pack check (ports/modelCheck, as `/rwatc packs validate` checks
 * them) in the model worker — one model after another, with progress and a way to stop;
 * the worker builds nothing and keeps nothing between two models. The findings join the
 * checks' list (panels/checks) until the next run, another pack, or {@link ModelSweep.clear}.
 *
 * A run checks the pack as it stands when it starts; once the pack changes, its findings
 * are stale ({@link isStale}): the panel says so, and the open model's own findings
 * (app/store `modelProblems`, read again after every edit) stand for that model.
 */

import { signal, type ReadonlySignal } from '@preact/signals';
import type { Remote } from 'comlink';
import type { Problem } from '../../core/contracts';
import type { Pack } from '../../core/pack';
import { checkModelFiles } from '../../model/client';
import { packFiles, type ModelFiles } from '../../model/files';
import type { ModelCheckApi, ModelRequest } from '../../model/types';
import { failedModel } from './problems';

export type SweepStatus = 'idle' | 'running' | 'done' | 'cancelled';

/** Where a run is. */
export interface SweepState {
  status: SweepStatus;
  /** How many models are checked, of {@link total}. */
  done: number;
  total: number;
  /** The model being checked (`ns:name`) while running; null otherwise. */
  current: string | null;
  /** Each checked model's findings, by its declaration's path, in the order checked. */
  results: ReadonlyMap<string, readonly Problem[]>;
  /** The pack checked and its version then; null before any run. */
  pack: Pack | null;
  version: number;
}

const IDLE: SweepState = { status: 'idle', done: 0, total: 0, current: null, results: new Map(), pack: null, version: -1 };

/** The models of a pack a run goes through: every model declaration whose text is JSON, in id order (a broken one is the pack check's to say). */
export function modelsOf(pack: Pack): ModelRequest[] {
  return pack.stock().flatMap((entry) =>
    entry.model === null || pack.jsonError(entry.model) !== null ? [] : [{ id: entry.id, file: entry.model, declaration: pack.json(entry.model) }],
  );
}

/** True when the pack changed since the run checked it (another pack, or an edit). */
export function isStale(state: SweepState, pack: Pack | null): boolean {
  if (state.pack === null) return false;
  return pack === null || state.pack !== pack || state.version !== pack.version;
}

/** Every finding of a run, model by model, but those of the model whose declaration is `except` (the open one: its own reading is newer). */
export function sweepProblems(state: SweepState, except: string | null = null): Problem[] {
  const out: Problem[] = [];
  for (const [file, problems] of state.results) if (file !== except) out.push(...problems);
  return out;
}

/** Runs of "Check all models": one at a time, the last one's state in {@link state}. */
export class ModelSweep {
  private readonly current = signal<SweepState>(IDLE);
  /** Grows with every run, stop and clear: a model checked for an older run is dropped. */
  private generation = 0;

  /** @param worker the worker that checks (model/client `lazyModelWorker`: the page's one) */
  constructor(private readonly worker: () => ModelCheckApi | Remote<ModelCheckApi>) {}

  get state(): ReadonlySignal<SweepState> {
    return this.current;
  }

  /**
   * Checks every model of `pack` (read through `files`, the pack as it stands by
   * default), one after another; resolves when the run ends, is stopped or another
   * starts. A worker that fails on a model is that model's one finding (`model.failed`).
   */
  async start(pack: Pack, files: ModelFiles = packFiles(pack)): Promise<void> {
    const run = ++this.generation;
    const models = modelsOf(pack);
    const results = new Map<string, readonly Problem[]>();
    const update = (next: Partial<SweepState>): void => {
      this.current.value = { ...this.current.peek(), ...next };
    };
    this.current.value = { status: 'running', done: 0, total: models.length, current: models[0]?.id ?? null, results, pack, version: pack.version };
    for (const [i, model] of models.entries()) {
      let problems: readonly Problem[];
      try {
        problems = await checkModelFiles(this.worker(), files, model);
      } catch (error) {
        problems = [failedModel(model, error)];
      }
      if (run !== this.generation) return;
      results.set(model.file, problems);
      const next = models[i + 1];
      update(next === undefined ? { status: 'done', done: results.size, results: new Map(results), current: null } : { done: results.size, results: new Map(results), current: next.id });
    }
    if (models.length === 0) update({ status: 'done' });
  }

  /** Stops the run after the model being checked: what is checked so far stays. */
  cancel(): void {
    if (this.current.peek().status !== 'running') return;
    this.generation++;
    this.current.value = { ...this.current.peek(), status: 'cancelled', current: null };
  }

  /** Forgets the last run (another pack), stopping it if it runs. */
  clear(): void {
    this.generation++;
    this.current.value = IDLE;
  }
}
