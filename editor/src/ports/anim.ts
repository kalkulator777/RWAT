/**
 * The port of `client/render/model/IrAnim.java` (`parse`, `frameAt`): an Immersive
 * Railroading `.anim` → its tracks, and a track's transform at a door's progress.
 * Golden: fixtures/golden/anim/ (reference Java; Python ports the objects of the tracks
 * in tools/ir2rwat.py `anim_objects`). `IrAnim.toModelSpace` is not ported: the view
 * works in the OBJ frame (editor.md §4.2).
 *
 * Format, line by line, each line trimmed: `O <object>` starts an object's track (an
 * object named again goes on with its track), `A <action>` names the Blender action
 * (skipped, as every other line), `M m00,m01,…,m33` is one frame — the object's
 * transform relative to its rest pose, 16 floats row by row, translation in the last
 * column, OBJ frame. A frame before any `O` is dropped. A frame of other than 16
 * values, or a value that is no number to `Float.parseFloat`, refuses the file
 * ({@link AnimError}).
 *
 * Pure: no DOM, it runs in a worker and in Node.
 */

import { javaLines, javaTrim } from './mtl';
import { parseJavaFloat } from './javaNumbers';

/** Values in a frame: a 4×4, row by row. */
export const FRAME_VALUES = 16;

/** The reader refuses the file: where (1-based line) and why. */
export class AnimError extends Error {
  readonly line: number;

  constructor(line: number, reason: string) {
    super(`line ${line}: ${reason}`);
    this.name = 'AnimError';
    this.line = line;
  }
}

/** `String.split(String)` of a one-character separator: no separator → the text itself; trailing empty parts dropped. */
function javaSplit(text: string, separator: string): string[] {
  if (!text.includes(separator)) return [text];
  const parts = text.split(separator);
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * `IrAnim.parse`: object → its frames, each 16 floats row by row, as written, in the
 * order the objects first come. A Map: it keeps the order of names that look like numbers.
 *
 * @throws AnimError if the engine refuses the file
 */
export function parse(text: string): Map<string, Float32Array[]> {
  const tracks = new Map<string, Float32Array[]>();
  let current: Float32Array[] | null = null;
  const lines = javaLines(text);
  for (let n = 0; n < lines.length; n++) {
    const line = javaTrim(lines[n]!);
    if (line.startsWith('O ')) {
      const object = javaTrim(line.slice(2));
      current = tracks.get(object) ?? null;
      if (current === null) {
        current = [];
        tracks.set(object, current);
      }
    } else if (line.startsWith('M ') && current !== null) {
      const values = javaSplit(line.slice(2), ',');
      if (values.length !== FRAME_VALUES) throw new AnimError(n + 1, `a frame of ${values.length} values, not ${FRAME_VALUES}`);
      const frame = new Float32Array(FRAME_VALUES);
      for (let i = 0; i < FRAME_VALUES; i++) {
        const value = parseJavaFloat(javaTrim(values[i]!));
        if (value === null) throw new AnimError(n + 1, `'${values[i]}' is no number`);
        frame[i] = value;
      }
      current.push(frame);
    }
  }
  return tracks;
}

/** Java's `(int)` of a float: toward zero, NaN 0, the `int` range at most. */
function javaInt(f: number): number {
  if (Number.isNaN(f)) return 0;
  if (f >= 2147483647) return 2147483647;
  if (f <= -2147483648) return -2147483648;
  return Math.trunc(f);
}

/**
 * `IrAnim.frameAt`: a track's transform at `progress` (0 = the first frame, the rest
 * pose; 1 = the last). Frame `f = progress × (N − 1)` (in float) lies between frames
 * `(int) f` — truncated toward zero, so below 0 the first two frames go on backwards —
 * and the next, both at most `N − 1` (the last stands for any past it); it is taken
 * element by element between them, as JOML's `Matrix4f.lerp`: `(b − a) · t + a` in float,
 * `t = f − (int) f`. The layout of the frames is kept (row by row from {@link parse}).
 *
 * @param frames the track: at least one frame of 16 floats
 * @param progress read as a float
 * @throws RangeError where the engine's index leaves the track (no frames, or progress
 *   at or below `−1 / (N − 1)`)
 */
export function frameAt(frames: readonly ArrayLike<number>[], progress: number): Float32Array {
  const last = frames.length - 1;
  const f = Math.fround(Math.fround(progress) * last);
  const i0 = Math.min(javaInt(f), last);
  const i1 = Math.min(i0 + 1, last);
  const a = frames[i0];
  const b = frames[i1];
  if (a === undefined || b === undefined) throw new RangeError(`frame ${i0} of a track of ${frames.length}`);
  const t = Math.fround(f - i0);
  const out = new Float32Array(FRAME_VALUES);
  for (let k = 0; k < FRAME_VALUES; k++) {
    const from = Math.fround(a[k]!);
    out[k] = Math.fround(Math.fround(Math.fround(Math.fround(b[k]!) - from) * t) + from);
  }
  return out;
}

/**
 * Every track of a file at one `progress` ({@link frameAt}), as a door's pieces are drawn
 * together; a track without frames has none.
 */
export function framesAt(tracks: ReadonlyMap<string, readonly ArrayLike<number>[]>, progress: number): Map<string, Float32Array> {
  const at = new Map<string, Float32Array>();
  for (const [object, frames] of tracks) {
    if (frames.length > 0) at.set(object, frameAt(frames, progress));
  }
  return at;
}
