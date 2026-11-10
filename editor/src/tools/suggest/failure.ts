/**
 * A failed call of the Python tools, said in words (docs/proposals/editor.md §3.12): what the
 * author reads is a sentence in the interface's language and, under it, the tool's own
 * line (`FloorConfigError: "floor".clearance must be a number…`) — never the traceback,
 * which is for the developer's console. A call the author stopped is no failure.
 */

import { t } from '../../i18n';
import type { BridgeError } from '../../ir/bridge';

/** A failure as the interface shows it. */
export interface Said {
  /** The sentence, in the interface's language. */
  readonly text: string;
  /** The tool's own wording (English), under the sentence; null when the sentence says it all. */
  readonly detail: string | null;
}

/**
 * The words for `error`, or null when the author stopped the call.
 *
 * @param known the sentence for a failure of the Python code the caller knows how to put in words, or null
 */
export function explain(error: unknown, known: (error: BridgeError) => string | null = () => null): Said | null {
  // by its name, not its class: the bridge's module is imported with the first call, not with this one
  if (error instanceof Error && error.name === 'BridgeError') {
    const failure = error as BridgeError;
    if (failure.kind === 'cancelled') return null;
    if (failure.kind === 'python') {
      const sentence = known(failure);
      return sentence === null ? { text: t('tools.suggest.err.python', { type: failure.type }), detail: failure.text } : { text: sentence, detail: failure.text };
    }
    return { text: t('tools.suggest.err.worker'), detail: failure.message };
  }
  return { text: t('tools.suggest.err.other'), detail: error instanceof Error ? error.message : String(error) };
}
