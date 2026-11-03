/**
 * What a control's slider sets in the preview, and the raw position 0…1 the engine makes
 * of it (`ControlValue.position`, `Handles.travel`). The position then goes the engine's
 * way: ports/controlPose `controlValue` (`OFFSET`, `INVERT`, the reverser's half) gives the
 * animation value, `controlVisible` hides a `HIDE` control at value 1.
 *
 * As in the engine, in this order:
 * - a train handle (`THROTTLE`, `TRAIN_BRAKE`, `INDEPENDENT_BRAKE`) stands on a notch
 *   0…{@link NOTCHES}, travel = notch / {@link NOTCHES}; the `REVERSER` on −1 back, 0
 *   neutral, +1 forward, travel = (step + 1) / 2;
 * - a gauge shows a reading through its `RANGE`: position = (reading − min) / (max − min),
 *   held to 0…1 (0 for an empty range). The slider sets the reading: the throttle's gauge
 *   reads the throttle's notch / 8, the reverser's gauge the reverser's travel, the others
 *   a fraction (of the type's top speed, of full braking);
 * - the combined handle (`THROTTLE_BRAKE`) stands where the slider puts it (the engine
 *   always draws it in neutral, ½);
 * - the `HANDBRAKE` wheel turns 0 released … 1 set;
 * - everything else (switches, windows, buttons, widgets) shows its control group's value
 *   0…1 — one value for every control of the group and for the light group of that name.
 *
 * Each control has its own slider, a train handle too: the preview shows how each one
 * moves, not which cab drives (*решение агента*: in the engine only the driving cab's
 * handles move, all of them by the consist's one value).
 */

import type { Control, ControlKind } from '../ports/objectRole';

/** Throttle and brake handles run 0…NOTCHES (`Consist.NOTCHES`). */
export const NOTCHES = 8;

/** How a control is set. */
export type InputKind = 'notches' | 'reverser' | 'reading' | 'centred' | 'handbrake' | 'group';

/** A control's slider: what it sets, its ends, its step and where it rests. */
export interface ControlInput {
  kind: InputKind;
  min: number;
  max: number;
  step: number;
  /** The value of a control nobody has touched: the engine's rest pose. */
  rest: number;
}

const f = Math.fround;

/** The train handle a lever kind drives (`ControlValue.handle`), or null. */
function handle(kind: ControlKind): 'notches' | 'reverser' | null {
  switch (kind) {
    case 'THROTTLE':
    case 'TRAIN_BRAKE':
    case 'INDEPENDENT_BRAKE':
      return 'notches';
    case 'REVERSER':
      return 'reverser';
    default:
      return null;
  }
}

/** The slider of a control: see the file's comment. */
export function controlInput(role: Control): ControlInput {
  const lever = handle(role.kind);
  if (lever === 'notches') return { kind: 'notches', min: 0, max: NOTCHES, step: 1, rest: 0 };
  if (lever === 'reverser') return { kind: 'reverser', min: -1, max: 1, step: 1, rest: 0 };
  if (role.gauge) {
    if (role.kind === 'GAUGE_THROTTLE') return { kind: 'notches', min: 0, max: NOTCHES, step: 1, rest: 0 };
    if (role.kind === 'GAUGE_REVERSER') return { kind: 'reverser', min: -1, max: 1, step: 1, rest: 0 };
    const min = Math.min(0, role.rangeMin, role.rangeMax);
    const max = Math.max(1, role.rangeMin, role.rangeMax);
    return { kind: 'reading', min, max, step: 0.01, rest: 0 };
  }
  if (role.kind === 'THROTTLE_BRAKE') return { kind: 'centred', min: 0, max: 1, step: 0.01, rest: 0.5 };
  if (role.kind === 'HANDBRAKE') return { kind: 'handbrake', min: 0, max: 1, step: 0.01, rest: 0 };
  return { kind: 'group', min: 0, max: 1, step: role.toggle || role.press ? 1 : 0.01, rest: 0 };
}

/** `Math.clamp(value, 0, 1)` of Java: NaN stays NaN. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The raw position 0…1 of a control set to `input` on its slider (`ControlValue.position`),
 * in float as the engine reckons it. A group-driven control's input is its group's value.
 */
export function controlPosition(role: Control, input: number): number {
  const slider = controlInput(role);
  let reading: number;
  switch (slider.kind) {
    case 'notches':
      reading = f(input / NOTCHES);
      break;
    case 'reverser':
      reading = f((input + 1) * 0.5);
      break;
    case 'reading':
      reading = f(input);
      break;
    case 'centred':
      return f(input);
    default:
      return clamp01(f(input));
  }
  if (!role.gauge) return reading;
  const span = f(role.rangeMax - role.rangeMin);
  return span === 0 ? 0 : clamp01(f(f(reading - role.rangeMin) / span));
}
