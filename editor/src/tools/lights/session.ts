/**
 * The lights tool while it is on (docs/proposals/editor.md §3.9): it only shows — draws the
 * open model's headlights and cabin lamps (./analysis.ts) again whenever the model is read
 * anew or another group is chosen, and chooses the group of an object clicked in the view
 * (the view selects the object itself, as ever). The group chosen lives here, read by the
 * inspector's section (./LightsInspector.tsx). It edits nothing and takes no presses: the
 * camera keeps them.
 */

import { batch, computed, effect, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { Link, PickHit } from '../../core/contracts';
import type { ToolContext, ToolSession, ToolSubject } from '../registry';
import { groupOfObject, LIGHT_LAYERS, lightsPicture, type GroupChoice, type LightsPicture } from './analysis';

/** What the lights tool holds while it is on; its section of the inspector reads and drives it. */
export interface LightsTool {
  readonly subject: ReadonlySignal<ToolSubject | null>;
  /** The group whose lights are drawn in their own colour: an index of the model's groups, −1 for the lights of none, null for no group chosen. */
  readonly chosen: Signal<GroupChoice>;
  /** The picture drawn now; null while the model is being read. */
  readonly picture: ReadonlySignal<LightsPicture | null>;
  /** Selects objects of the open model (the view highlights them). */
  selectObjects(names: readonly string[]): void;
}

/** Turns the lights tool on: returns its state and what turns it off (the session's `dispose`). */
export function startLights(context: ToolContext): Pick<ToolSession, 'dispose'> & { tool: LightsTool } {
  const chosen = signal<GroupChoice>(null);
  const picture = signal<LightsPicture | null>(null);

  // the model alone: an edit of the type draws nothing again
  const model = computed(() => context.subject.value?.model ?? null);
  const stopDrawing = effect(() => {
    const shown = model.value;
    const group = chosen.value;
    const next = shown === null ? null : lightsPicture(shown, group);
    batch(() => {
      for (const layer of LIGHT_LAYERS) context.view.overlay(layer, next?.layers[layer] ?? []);
      picture.value = next;
    });
  });

  const stopPicking = context.view.onPick((hit: PickHit) => {
    const shown = model.peek();
    if (shown === null || hit.object === undefined) return;
    const group = groupOfObject(shown, hit.object);
    if (group !== null) chosen.value = group;
  });

  const tool: LightsTool = {
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
      for (const layer of LIGHT_LAYERS) context.view.overlay(layer, []);
    },
  };
}
