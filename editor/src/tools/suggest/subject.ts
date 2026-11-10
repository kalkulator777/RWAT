/**
 * What the Python tools need of the open wagon: its OBJ, read from the pack as the pack holds
 * it now (a model being edited is suggested from its edits, not from the file as opened).
 */

import type { ToolSubject } from '../registry';

/** The wagon's OBJ: its pack path and a way to read its bytes. */
export interface ObjSource {
  readonly file: string;
  read(): Promise<Uint8Array>;
}

/** The OBJ of the wagon's model, or null when the model names none that can be read (an invalid path) or the subject cannot read the pack. */
export function objSource(subject: ToolSubject): ObjSource | null {
  const file = subject.model?.obj ?? null;
  const read = subject.read;
  return file === null || read === undefined ? null : { file, read: () => read(file) };
}
