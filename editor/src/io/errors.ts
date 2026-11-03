/**
 * What goes wrong in the io/ module, as one error type with a stable code. The text of
 * a {@link PackIoError} is English for the log; the interface translates by the code
 * (`describeIoError` gives the key in ./i18n.ts and its values).
 */

export type PackIoErrorCode =
  /** A name in an archive or folder (or a file to write) is not a path inside the pack: `..`, absolute, … */
  | 'unsafe-path'
  /** The same pack path twice: in an archive, in a folder listing or among the changes to write. */
  | 'duplicate-path'
  /** No such file. */
  | 'not-found'
  /** The archive is not a readable zip. */
  | 'bad-zip'
  /** The browser or the system does not let the editor read or write the folder. */
  | 'permission-denied'
  /** The browser (or the file) cannot do this: no File System Access, an encrypted zip. */
  | 'unsupported'
  /** Any other failure of reading or writing. */
  | 'io';

export class PackIoError extends Error {
  override readonly name = 'PackIoError';

  constructor(
    readonly code: PackIoErrorCode,
    message: string,
    /** The paths the error is about: the offending names, the missing file. */
    readonly paths: readonly string[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** How many paths a message names before it says "and more". */
const NAMED = 3;

/** The paths of an error as one line: the first few, then a count of the rest. */
export function pathsSummary(paths: readonly string[]): string {
  const shown = paths.slice(0, NAMED).map((path) => JSON.stringify(path));
  return paths.length > NAMED ? `${shown.join(', ')} (+${paths.length - NAMED})` : shown.join(', ');
}

/** The cause's own message, for a line of text; '' when there is none. */
export function causeText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

/**
 * Turns whatever a browser or Node API threw into a {@link PackIoError} about `path`
 * (a PackIoError passes unchanged). The DOM exceptions of File System Access and the
 * `code`s of Node's file errors map to the codes above. While `writing`, a missing
 * file is not the answer (the sink makes what is missing): a file or folder in the way is `io`.
 */
export function wrapIoError(error: unknown, path?: string, writing = false): PackIoError {
  if (error instanceof PackIoError) return error;
  const paths = path === undefined ? [] : [path];
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error).name) : '';
  const nodeCode = typeof error === 'object' && error !== null && 'code' in error ? String((error).code) : '';
  const detail = causeText(error);
  const what = path === undefined ? '' : ` ${JSON.stringify(path)}`;
  const missing = name === 'NotFoundError' || name === 'TypeMismatchError' || nodeCode === 'ENOENT' || nodeCode === 'ENOTDIR' || nodeCode === 'EISDIR';
  if (missing && !writing) return new PackIoError('not-found', `No file${what}`, paths, { cause: error });
  if (name === 'NotAllowedError' || name === 'SecurityError' || nodeCode === 'EACCES' || nodeCode === 'EPERM') {
    return new PackIoError('permission-denied', `No permission${what ? ` for${what}` : ''}`, paths, { cause: error });
  }
  return new PackIoError('io', `Cannot read or write${what}: ${detail || name || 'unknown error'}`, paths, { cause: error });
}

/** The i18n key (./i18n.ts) and values to show a {@link PackIoError} to the user. */
export function describeIoError(error: PackIoError): { key: string; params: Record<string, string | number> } {
  return {
    key: `io.error.${error.code}`,
    params: {
      paths: pathsSummary(error.paths),
      count: error.paths.length,
      detail: causeText(error.cause) || error.message,
    },
  };
}
