/**
 * The IR mode's session of the page (editor.md §1.3, §2.6, §2.7; M6 A6.3): ./session.ts
 * (the recipe over the IR zips, derived through the bridge, edited through its journal),
 * ./state.ts (its signals), ./actions.ts (what the author does), ./model.ts (its type in
 * the 3D view), ./sources.ts (where its files come from). panels/ir draws it.
 *
 * {@link startIr} wires it into the page (app/start.ts): the IR type's model in the view
 * while the mode is 2b, each mode its own selection, and a warning when a tab with
 * unsaved changes of the recipe closes. The IR session is not kept in the browser's
 * storage (app/save keeps the pack's session only): closing the tab loses what was not
 * saved, so the warning asks first.
 */

import { computed, effect, untracked } from '@preact/signals';
import type { Link } from '../../core/contracts';
import type { PreviewSubject } from '../../preview/controller';
import type { ViewApi } from '../../core/contracts';
import type { ModelSource } from '../openModel';
import { mode, selection, type EditorMode } from '../store';
import { connectIrModel } from './model';
import { irDirtyCount, irOpenType, irSession } from './state';

export { closeIr, convertIr, importIr, openType, packFolderChanges, rederive, runIr, runIrMade, saveIr, type ImportOutcome, type PackFolder, type PackTarget } from './actions';
export { formValue, overrideLayers, typeView, type IrTypeView } from './layers';
export { connectIrModel, FLOOR_LAYER, irModelFiles, readEntry, zoneShapes } from './model';
export { failureText, IrSession, makeBridge, useBridgeMaker, type BridgeMaker, type FloorEntry, type IrBridge, type OpenRequest } from './session';
export {
  baseName,
  draftRecipe,
  fileRecipeSource,
  findRecipes,
  IrInputError,
  matchSources,
  named,
  newRecipeSource,
  recipeStem,
  sourceZips,
  type NamedBlob,
} from './sources';
export * from './state';

/** What the IR mode is wired to in the page. */
export interface IrWiring {
  loader: ModelSource;
  view: ViewApi;
  preview: { load(subject: PreviewSubject | null): void };
  target?: Window;
}

/**
 * Starts the IR mode in the page: its model in the view while the mode is 2b; the
 * selection kept for each mode (switching back finds it as it was); the open type
 * following the selection (a type's file, a field of it, one of its zones or objects);
 * closing a tab with unsaved changes of the recipe asks first. Returns how to stop it.
 */
export function startIr(wiring: IrWiring): () => void {
  const target = wiring.target ?? window;
  const stopModel = connectIrModel({ loader: wiring.loader, view: wiring.view, preview: wiring.preview, active: computed(() => mode.value === '2b') });
  const kept: Partial<Record<EditorMode, readonly Link[]>> = {};
  let last = mode.peek();
  const stopModes = effect(() => {
    const now = mode.value;
    untracked(() => {
      if (now === last) return;
      kept[last] = selection.value;
      selection.value = kept[now] ?? [];
      last = now;
    });
  });
  const stopFollow = effect(() => {
    const links = selection.value;
    const session = irSession.value;
    untracked(() => {
      if (mode.value !== '2b' || session === null) return;
      for (const link of links) {
        const id = session.typeOf(link);
        if (id !== null) {
          if (irOpenType.value !== id) irOpenType.value = id;
          return;
        }
      }
    });
  });
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (irDirtyCount.value === 0) return;
    event.preventDefault();
    event.returnValue = '';
  };
  target.addEventListener('beforeunload', onBeforeUnload);
  return () => {
    stopModel();
    stopModes();
    stopFollow();
    target.removeEventListener('beforeunload', onBeforeUnload);
  };
}
