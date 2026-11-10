/**
 * The difference of two texts by lines, for the save dialog (editor.md §2.5, step 3): how
 * many lines a file gains and loses, and the lines to show. Pure.
 *
 * Myers' O(ND) difference over the lines between the common head and tail. A file with
 * more than {@link MAX_EDITS} line edits between them (a replaced OBJ) is not compared
 * line by line: all of its middle counts as removed and added, and there are no lines to show.
 */

export type DiffKind = 'same' | 'add' | 'del';

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

export interface LineDiff {
  added: number;
  removed: number;
  /** Every line of both texts in order, or null when the texts differ too much to compare. */
  lines: DiffLine[] | null;
}

/** The most line edits compared one by one (the work grows with their square). */
export const MAX_EDITS = 1000;

/** The lines of a text; a final line end does not start another line. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** The edit script turning `a` into `b`, or null past `maxEdits` edits. */
function myers(a: readonly string[], b: readonly string[], maxEdits: number): DiffLine[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number)) ? (v[offset + k + 1] as number) : (v[offset + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  // back through the trace: trace[d] holds v as it was before step d, for k in −d−1 … d+1
  const script: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const before = trace[d] as Int32Array;
    const at = (k: number): number => before[k + d + 1] as number;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      script.push({ kind: 'same', text: a[--x] as string });
      y--;
    }
    if (down) script.push({ kind: 'add', text: b[--y] as string });
    else script.push({ kind: 'del', text: a[--x] as string });
  }
  while (x > 0 && y > 0) {
    script.push({ kind: 'same', text: a[--x] as string });
    y--;
  }
  return script.reverse();
}

/** The difference of two texts by lines (see the module's comment). */
export function diffLines(before: string, after: string, maxEdits = MAX_EDITS): LineDiff {
  const a = splitLines(before);
  const b = splitLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const middleA = a.slice(head, a.length - tail);
  const middleB = b.slice(head, b.length - tail);
  const script = myers(middleA, middleB, maxEdits);
  if (script === null) return { added: middleB.length, removed: middleA.length, lines: null };
  const same = (text: string): DiffLine => ({ kind: 'same', text });
  const lines = [...a.slice(0, head).map(same), ...script, ...a.slice(a.length - tail).map(same)];
  return {
    added: script.filter((line) => line.kind === 'add').length,
    removed: script.filter((line) => line.kind === 'del').length,
    lines,
  };
}

/** A run of lines to show: the changed lines with `context` lines around them; `skipped` lines before it are left out. */
export interface Hunk {
  skipped: number;
  lines: DiffLine[];
}

/** The changed lines of a difference with their context, in runs. */
export function hunks(lines: readonly DiffLine[], context = 2): Hunk[] {
  const show = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, i) => {
    if (line.kind === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) show[j] = true;
  });
  const result: Hunk[] = [];
  let skipped = 0;
  let current: Hunk | null = null;
  lines.forEach((line, i) => {
    if (!show[i]) {
      skipped++;
      current = null;
      return;
    }
    if (current === null) {
      current = { skipped, lines: [] };
      result.push(current);
      skipped = 0;
    }
    current.lines.push(line);
  });
  return result;
}
