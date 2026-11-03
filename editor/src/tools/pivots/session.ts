/**
 * The hinges tool while it is on (docs/proposals/editor.md §3.9): it only shows — draws
 * the open model's hinges and the chosen control's axis, travel and end (./analysis.ts)
 * again whenever the model is read anew or another control is chosen, and chooses the
 * control of an object clicked in the view (the view selects the object itself, as ever).
 * The control chosen lives here, read by the inspector's section (./PivotsInspector.tsx).
 * It edits nothing and takes no presses: the camera keeps them.
 */

import { batch, computed, effect, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { Link, PickHit } from '../../core/contracts';
import type { ToolContext, ToolSession, ToolSubject } from '../registry';
import { controlOfObject, PIVOT_LAYERS, pivotsPicture, type PivotsPicture } from './analysis';

/** What the hinges tool holds while it is on; its section of the inspector reads and drives it. */
export interface PivotsTool {
  readonly subject: ReadonlySignal<ToolSubject | null>;
  /** The control chosen, an index of the model's controls; null for none. */
  readonly chosen: Signal<number | null>;
  /** The picture drawn now; null while the model is being read. */
  readonly picture: ReadonlySignal<PivotsPicture | null>;
  /** Selects objects of the open model (the view highlights them). */
  selectObjects(names: readonly string[]): void;
}

/** Turns the hinges tool on: returns its state and what turns it off (the session's `dispose`). */
export function startPivots(context: ToolContext): Pick<ToolSession, 'dispose'> & { tool: PivotsTool } {
  const chosen = signal<number | null>(null);
  const picture = signal<PivotsPicture | null>(null);
  // the model alone: an edit of the type draws nothing again
  const model = computed(() => context.subject.value?.model ?? null);

  const stopDrawing = effect(() => {
    const shown = model.value;
    const control = chosen.value;
    const next = shown === null ? null : pivotsPicture(shown, control);
    batch(() => {
      for (const layer of PIVOT_LAYERS) context.view.overlay(layer, next?.layers[layer] ?? []);
      picture.value = next;
    });
  });

  const stopPicking = context.view.onPick((hit: PickHit) => {
    const controls = picture.peek()?.controls;
    if (controls === undefined || hit.object === undefined) return;
    const control = controlOfObject(controls, hit.object);
    if (control !== null) chosen.value = control;
  });

  const tool: PivotsTool = {
    subject: context.subject,
    chosen,
    picture,
    selectObjects(names) {
      const shown = model.peek();
      if (shown === null || names.length === 0) return;
      context.selection.value = names.map((name): Link => ({ kind: 'object', model: shown.id, name }));
    },
  };

  return {
    tool,
    dispose() {
      stopDrawing();
      stopPicking();
      context.view.setDragger(null);
      for (const layer of PIVOT_LAYERS) context.view.overlay(layer, []);
    },
  };
}
