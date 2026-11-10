import type { MessageContext } from '../checks/messages';
import type { JsonPointer, Op, Problem } from '../core/contracts';
import type { SchemaKind } from '../core/schema';

/** Where a field of a layered form stands: as derived, set in the layer on top, or removed there (`null`). */
export type LayerState = 'derived' | 'set' | 'removed';

/**
 * A form over layers (editor.md §1.3, §3.7; 2b: a type's override on top of what the IR
 * converter derives). The form's `root` is what the pack gets; each field is in one of
 * three states — derived (the converter's value, shown grey), set in the override (marked,
 * with a way back to the derived value) or removed (`null`, where that removes what was
 * derived). Edits go through these, not as ops on the form's file: the override's rules
 * (ir/recipe/fields) decide what is written. Pointers are the form's own (`/type/mass_t`).
 */
export interface FormLayers {
  /** The field's state on top, and its value without the layer on top (undefined where nothing is derived). */
  view(at: JsonPointer): { state: LayerState; derived: unknown };
  /** True where a `null` on top removes what is derived (else "remove" is not offered). */
  canRemove(at: JsonPointer): boolean;
  /** Puts a value on top (one equal to the derived one may count as a reset: the layer decides). */
  set(at: JsonPointer, value: unknown): void;
  /** The field back to the derived value: out of the layer on top. */
  reset(at: JsonPointer): void;
  /** `null` on top: what was derived there is dropped. */
  remove(at: JsonPointer): void;
}

/** What every field of a form needs: the file and its value, its findings, and how an edit is committed. */
export interface FormContext {
  /** The pack path of the file the form edits. */
  file: string;
  kind: SchemaKind;
  /** The file's JSON value as it stands. */
  root: unknown;
  /** No edits: a generated pack (edited through its recipe), or a view. */
  readOnly: boolean;
  /** The file's findings by the pointer of the field they are about (a missing required key: at that key). */
  problems: ReadonlyMap<string, readonly Problem[]>;
  /** For wording the findings (checks/messages). */
  messages: MessageContext;
  /** Show spatial markup as a summary, not as fields (until the 3D tools of M4). */
  spatialNote: boolean;
  /** The name of a coordinate frame (schema/pack-layout.json `frames`) in the interface language. */
  frameName(id: string): string;
  /** Applies the ops as one command of the journal; `label` is its i18n key, `field` fills its `{field}`. */
  commit(ops: Op[], label: string, field: string): void;
  /** A form over layers ({@link FormLayers}): `root` is the result, edits go to the layer on top; undefined — a plain file. */
  layers?: FormLayers;
}
