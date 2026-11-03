/**
 * The hint to an unknown key. Ported from tools/validate_pack.py (`suggestion`,
 * `similarity`); golden: fixtures/golden/validate/suggestion.json. Same algorithm and
 * threshold: the known key most like it (lower case, 1 − edit distance / the longer
 * length), the first of equals, and only from 0.6.
 */

import { pyRepr } from './pyformat';

/** Closest known key must be at least this much like the unknown one. */
export const SUGGESTION_THRESHOLD = 0.6;

/** 1 − edit distance / longer length, over code points. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const x = Array.from(a);
  const y = Array.from(b);
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      current.push(
        Math.min(
          (previous[j] ?? 0) + 1,
          (current[j - 1] ?? 0) + 1,
          (previous[j - 1] ?? 0) + (x[i - 1] === y[j - 1] ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return 1 - (previous[y.length] ?? 0) / Math.max(x.length, y.length);
}

/** The known key closest to `key`, or undefined when none is near enough. */
export function nearestKey(key: string, known: Iterable<string>): string | undefined {
  let best: string | undefined;
  let score = 0;
  for (const candidate of known) {
    const s = similarity(key.toLowerCase(), candidate.toLowerCase());
    if (s > score) {
      best = candidate;
      score = s;
    }
  }
  return best !== undefined && score >= SUGGESTION_THRESHOLD ? best : undefined;
}

/** `" (did you mean 'x'?)"` for the closest known key, else `""` — validate_pack's wording. */
export function suggestion(key: string, known: Iterable<string>): string {
  const best = nearestKey(key, known);
  return best === undefined ? '' : ` (did you mean ${pyRepr(best)}?)`;
}
