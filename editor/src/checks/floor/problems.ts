/**
 * The floor check in the checks (docs/proposals/editor.md §3.10, item 3): what
 * ports/floorCheck (`FloorCheck.findings`) says of each wagon type of the pack that loads,
 * as {@link Problem}s of source `floor` — warnings, as the type loader logs them. Each
 * has the code `floor.<code>` (`ZONE_TOO_NARROW` → `floor.zone-too-narrow`, translated in
 * ./i18n.ts), the engine's line as its text and the params the line is made of, numbers
 * written as the line writes them (`%.2f` sizes and places, `%.1f` limits, the doorway's
 * slack as `Double.toString`) and the subject's `index` among them.
 *
 * A finding points at what it is about, twice: the field of the type's file (the
 * inspector goes there) and the zone, door or chair itself (the markup tools of M4 take
 * that one):
 *
 * - a zone: `{field, /interior/<i>}` and `{zone, <type id>, <i>}`; zones cut off: each of them;
 * - a door: `{field, /doors/<i>}` and `{door, <type id>, <i>}`;
 * - a chair: `{field, /cab/seats/<i>}` (`/cab/seat` for the older one-chair form) and `{seat, <type id>, <i>}`;
 * - the floor as a whole: `/interior`; the cab: `/cab` (its `seats`, for chairs without a floor).
 *
 * A type that doesn't load is checked by nothing here: the loader's checks and the
 * schema's say why. The findings of a type are kept while its file's value is the same
 * object (the pack model never changes a value in place), so after an edit only the
 * edited type is checked again.
 */

import type { FloorFinding, Link, Problem, ProblemParam } from '../../core/contracts';
import { isJsonObject } from '../../core/json';
import type { Pack } from '../../core/pack';
import { findings } from '../../ports/floorCheck';
import { formatFixed, javaDoubleToString } from '../../ports/javaNumbers';
import { PackJsonError } from '../../ports/packJson';
import { parseWagonType } from '../../ports/wagonType';

/** `ZONE_TOO_NARROW` → `zone-too-narrow`. */
export function floorCode(code: string): string {
  return code.toLowerCase().replace(/_/g, '-');
}

/** How the engine's line writes each numeric param (`FloorFinding.text`): `%.2f`, `%.1f`, or as `Double.toString`. */
const NUMBER_FORMAT: Readonly<Record<string, (x: number) => string>> = {
  size_x: (x) => formatFixed(x, 2),
  size_z: (x) => formatFixed(x, 2),
  thickness: (x) => formatFixed(x, 2),
  x: (x) => formatFixed(x, 2),
  y: (x) => formatFixed(x, 2),
  z: (x) => formatFixed(x, 2),
  reach: (x) => formatFixed(x, 2),
  height: (x) => formatFixed(x, 2),
  player_width: (x) => formatFixed(x, 1),
  sit_reach: (x) => formatFixed(x, 1),
  min_height: (x) => formatFixed(x, 1),
  max_height: (x) => formatFixed(x, 1),
  slack: javaDoubleToString,
};

/** The params as the interface words them: the numbers as the engine's line writes them, the subject's index among them. */
function wordedParams(finding: FloorFinding): Record<string, ProblemParam> {
  const out: Record<string, ProblemParam> = finding.index >= 0 ? { index: finding.index } : {};
  for (const [name, value] of Object.entries(finding.params)) {
    const format = NUMBER_FORMAT[name];
    out[name] = typeof value === 'number' && format !== undefined ? format(value) : value;
  }
  return out;
}

/** The pointer of chair `index`: the older one-chair form `cab.seat` has none of its own. */
function seatPointer(type: unknown, index: number): string {
  const cab = isJsonObject(type) ? type.cab : undefined;
  return isJsonObject(cab) && Object.hasOwn(cab, 'seat') && !Object.hasOwn(cab, 'seats') ? '/cab/seat' : `/cab/seats/${index}`;
}

/** Where a finding points: the field of the type's file, and the zone, door or chair itself. */
function linksOf(finding: FloorFinding, id: string, file: string, type: unknown): Link[] {
  const field = (at: string): Link => ({ kind: 'field', file, at });
  const { index } = finding;
  switch (finding.subject) {
    case 'zone': {
      const zones = index >= 0 ? [index] : Array.isArray(finding.params.zones) ? finding.params.zones : [];
      return [...zones.map((z) => field(`/interior/${z}`)), ...zones.map((z): Link => ({ kind: 'zone', type: id, index: z }))];
    }
    case 'door':
      return [field(`/doors/${index}`), { kind: 'door', type: id, index }];
    case 'seat':
      return [field(seatPointer(type, index)), { kind: 'seat', type: id, index }];
    case 'floor':
      return [field('/interior')];
    case 'cab': {
      if (finding.code !== 'SEATS_WITHOUT_INTERIOR') return [field('/cab')];
      const chair = seatPointer(type, 0);
      return [field(chair === '/cab/seat' ? chair : '/cab/seats')];
    }
  }
}

/** A floor finding of type `id` (file `file`, value `type`) as a finding of the checks. */
export function floorProblem(finding: FloorFinding, id: string, file: string, type: unknown): Problem {
  return {
    severity: 'warning',
    source: 'floor',
    code: `floor.${floorCode(finding.code)}`,
    params: wordedParams(finding),
    text: finding.text,
    at: linksOf(finding, id, file, type),
  };
}

interface Checked {
  file: string;
  problems: Problem[];
}

/** Type value → its findings, while the value stays the same object. */
const checked = new WeakMap<object, Checked>();

/** What the floor check says of one type (id `id`, its file and value); nothing for a type that doesn't load. */
export function typeFloorProblems(id: string, file: string, type: unknown): Problem[] {
  const known = isJsonObject(type) ? checked.get(type) : undefined;
  if (known !== undefined && known.file === file) return known.problems;
  let problems: Problem[];
  try {
    problems = findings(parseWagonType(id, type)).map((finding) => floorProblem(finding, id, file, type));
  } catch (error) {
    if (!(error instanceof PackJsonError)) throw error;
    problems = []; // the type doesn't load: the loader's and the schema's checks say why
  }
  if (isJsonObject(type)) checked.set(type, { file, problems });
  return problems;
}

/** The floor check's findings of every type of the pack, in id order. */
export function floorProblems(pack: Pack): Problem[] {
  const out: Problem[] = [];
  for (const entry of pack.stock()) {
    if (entry.type === null || pack.jsonError(entry.type) !== null) continue;
    out.push(...typeFloorProblems(entry.id, entry.type, pack.json(entry.type)));
  }
  return out;
}
