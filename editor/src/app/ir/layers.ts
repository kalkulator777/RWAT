/**
 * A type of the IR session as the forms edit it (forms/context `FormLayers`, editor.md
 * §1.3, §3.7): the form's value is what the pack gets — the type and the model as the
 * converter writes them with the override merged on top — and each field's state is the
 * per-type file's (ir/recipe `fieldView`: derived, set, removed). An edit is the recipe
 * model's command (ir/recipe `setField`, `resetField`, `removeField`: a value equal to the
 * derived one is a reset, the first edit of a type creates its file, a list goes whole)
 * run through the session's journal, so undo and redo take it back and forth.
 *
 * This is also where a markup tool of the IR mode gets its type and sends its edits: the
 * pack gets {@link IrTypeView.type} (OBJ frame, as a pack's type), and an edit of a place
 * of it (`/interior/0/min`) is {@link IrTypeView.setType} — the same command as a form's.
 */

import type { Command } from '../../core/contracts';
import { parsePointer } from '../../core/json';
import type { FormLayers } from '../../forms';
import { canRemove, fieldView, removeField, resetField, setField, type JsonObject, type TypeLayers } from '../../ir/recipe';
import type { IrSession } from './session';

/** The pack's value of a form over the override: the type and the model the pack gets, `sway` among the model's. */
export function formValue(layers: TypeLayers): JsonObject {
  return { type: layers.result.type, model: layers.result.model };
}

/**
 * The layers of a type of the session for a form; `run` makes each command and runs it
 * (./actions.ts `runIrMade`: the session's journal, a refusal in the page's banner).
 */
export function overrideLayers(session: IrSession, id: string, run: (make: () => Command) => unknown): FormLayers {
  const layers = (): TypeLayers | null => session.layers(id);
  const command = (make: () => Command): void => {
    void run(make);
  };
  return {
    view: (at) => {
      const now = layers();
      if (now === null) return { state: 'derived', derived: undefined };
      try {
        const view = fieldView(now, at);
        return { state: view.state.state, derived: view.derived };
      } catch {
        return { state: 'derived', derived: undefined }; // no field of an override (a comment's place)
      }
    },
    canRemove: (at) => {
      try {
        return canRemove(at);
      } catch {
        return false;
      }
    },
    set: (at, value) => command(() => setField(session.workspace, id, at, value, { base: layers()?.base })),
    reset: (at) => command(() => resetField(session.workspace, id, at)),
    remove: (at) => command(() => removeField(session.workspace, id, at)),
  };
}

/** A type of the session as a markup tool works on it (the next step of M6): what the pack gets, and how an edit of it lands in the override. */
export interface IrTypeView {
  /** The type's id in the session and as a wagon (`<namespace>:<id>`). */
  readonly id: string;
  readonly wagon: string;
  /** The type the pack gets (OBJ frame), and the model declaration; never change them in place. */
  readonly type: JsonObject;
  readonly model: JsonObject;
  /** The per-type file (comments and all), or undefined. */
  readonly override: JsonObject | undefined;
  /** The command that puts `value` at a place of the type (`/interior`, `/cab/seats/0/at`): `/type<at>` of the override. */
  setType(at: string, value: unknown): Command;
}

/** The type as a tool works on it; null for one the session does not derive (or skips). */
export function typeView(session: IrSession, id: string): IrTypeView | null {
  const layers = session.layers(id);
  if (layers === null) return null;
  return {
    id,
    wagon: `${session.namespace}:${id}`,
    type: layers.result.type,
    model: layers.result.model,
    override: layers.override,
    setType: (at, value) => {
      parsePointer(at); // a pointer, or it throws
      return setField(session.workspace, id, `/type${at}`, value, { base: session.layers(id)?.base });
    },
  };
}
