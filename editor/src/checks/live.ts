/**
 * The findings the panels show, kept up to date with the pack (docs/proposals/editor.md
 * §2.5, §3.4): checked at once when another pack opens or the schema arrives, and
 * {@link CHECK_DELAY_MS} after the last of a run of edits otherwise, so typing into a
 * form of a big pack does not check the pack on every keystroke.
 */

import { effect, signal, untracked, type ReadonlySignal } from '@preact/signals';
import type { Problem } from '../core/contracts';
import type { Pack } from '../core/pack';
import type { Schema } from '../core/schema';
import { checkPack } from './pack';

/** How long the findings wait after an edit before they are checked again (§2.5). */
export const CHECK_DELAY_MS = 150;

export interface LiveSources {
  pack: ReadonlySignal<Pack | null>;
  schema: ReadonlySignal<Schema | null>;
  /** Grows with every change of the (mutable) pack. */
  revision: ReadonlySignal<number>;
}

export interface LiveOptions {
  delayMs?: number;
  check?: (pack: Pack, schema: Schema | null) => Problem[];
}

/**
 * A signal of the findings of the pack the sources hold. It lives as long as the page
 * (the editor makes one, in app/store.ts); `dispose` stops it in tests.
 */
export function liveFindings(sources: LiveSources, options: LiveOptions = {}): ReadonlySignal<Problem[]> & { dispose(): void } {
  const delay = options.delayMs ?? CHECK_DELAY_MS;
  const check = options.check ?? checkPack;
  const out = signal<Problem[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPack: Pack | null | undefined;
  let lastSchema: Schema | null | undefined;

  const stop = effect(() => {
    void sources.revision.value;
    const pack = sources.pack.value;
    const schema = sources.schema.value;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const run = (): void => {
      timer = undefined;
      out.value = pack === null ? [] : untracked(() => check(pack, schema));
    };
    if (pack !== lastPack || schema !== lastSchema) {
      lastPack = pack;
      lastSchema = schema;
      run();
    } else {
      timer = setTimeout(run, delay);
    }
  });

  return Object.assign(out, {
    dispose(): void {
      stop();
      if (timer !== undefined) clearTimeout(timer);
    },
  });
}
