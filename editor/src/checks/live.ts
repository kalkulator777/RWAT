/**
 * The findings the panels show, kept up to date with the pack (docs/proposals/editor.md
 * §2.5, §3.4): checked at once when another pack opens or the schema arrives, and
 * {@link CHECK_DELAY_MS} after the last of a run of edits otherwise, so typing into a
 * form of a big pack does not check the pack on every keystroke.
 *
 * A pass checks the pack's wagon types with the floor check first, one by one, giving the
 * page back between them once a slice has run {@link SLICE_MS}: the heaviest types of MVP
 * take some 10 ms each on a quiet machine (some 50 ms all 45 of them; several times that on
 * a slow one), and the main thread is never held longer than one type (§3.11: no task over
 * 100 ms). The floor check keeps what
 * it found of a type while the type's value is the same (./floor/problems.ts), so the pack
 * check that ends the pass (./pack.ts, the floor's findings among its own) reads them from
 * there; after an edit only the edited type is checked again, and a pass whose types all
 * fit in one slice runs at once, without giving the page back. The types are taken as they
 * stand when the pass starts (the pack never changes a value in place); a pass that a newer
 * one overtakes gives up, and the findings change once a pass is through.
 */

import { effect, signal, untracked, type ReadonlySignal } from '@preact/signals';
import type { Problem } from '../core/contracts';
import type { Pack } from '../core/pack';
import type { Schema } from '../core/schema';
import { floorTypes, typeFloorProblems } from './floor/problems';
import { checkPack } from './pack';

/** How long the findings wait after an edit before they are checked again (§2.5). */
export const CHECK_DELAY_MS = 150;

/** How long a slice of a pass's floor check runs before it gives the page back, ms. */
export const SLICE_MS = 8;

export interface LiveSources {
  pack: ReadonlySignal<Pack | null>;
  schema: ReadonlySignal<Schema | null>;
  /** Grows with every change of the (mutable) pack. */
  revision: ReadonlySignal<number>;
}

export interface LiveOptions {
  delayMs?: number;
  check?: (pack: Pack, schema: Schema | null) => Problem[];
  /** How long a slice of the floor check runs before the page has its turn, ms. */
  sliceMs?: number;
  /** Gives the page back (a macrotask by default). */
  yieldToPage?: () => Promise<void>;
}

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A signal of the findings of the pack the sources hold. It lives as long as the page
 * (the editor makes one, in app/store.ts); `dispose` stops it in tests.
 */
export function liveFindings(sources: LiveSources, options: LiveOptions = {}): ReadonlySignal<Problem[]> & { dispose(): void } {
  const delay = options.delayMs ?? CHECK_DELAY_MS;
  const check = options.check ?? checkPack;
  const slice = options.sliceMs ?? SLICE_MS;
  const yieldToPage = options.yieldToPage ?? macrotask;
  const out = signal<Problem[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPack: Pack | null | undefined;
  let lastSchema: Schema | null | undefined;
  /** Grows with every pass asked for: an older one gives up. */
  let generation = 0;

  const pass = async (pack: Pack | null, schema: Schema | null, run: number): Promise<void> => {
    if (pack === null) {
      out.value = [];
      return;
    }
    const types = floorTypes(pack);
    let started = performance.now();
    for (const [i, type] of types.entries()) {
      typeFloorProblems(type.id, type.file, type.value);
      if (i + 1 < types.length && performance.now() - started >= slice) {
        await yieldToPage();
        if (run !== generation) return;
        started = performance.now();
      }
    }
    if (run === generation) out.value = untracked(() => check(pack, schema));
  };

  const stop = effect(() => {
    void sources.revision.value;
    const pack = sources.pack.value;
    const schema = sources.schema.value;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const run = ++generation;
    if (pack !== lastPack || schema !== lastSchema) {
      lastPack = pack;
      lastSchema = schema;
      untracked(() => void pass(pack, schema, run));
    } else {
      timer = setTimeout(() => {
        timer = undefined;
        void pass(pack, schema, run);
      }, delay);
    }
  });

  return Object.assign(out, {
    dispose(): void {
      stop();
      generation++;
      if (timer !== undefined) clearTimeout(timer);
    },
  });
}
