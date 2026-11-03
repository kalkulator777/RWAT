import type { MessageContext } from '../checks/messages';
import type { Op, Problem } from '../core/contracts';
import type { SchemaKind } from '../core/schema';

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
}
