import { describe, expect, it } from 'vitest';
import { controlValue } from '../ports/controlPose';
import { parseRole, type Control } from '../ports/objectRole';
import { controlInput, controlPosition, NOTCHES } from './inputs';

function control(name: string): Control {
  const found = parseRole(name).control;
  if (found === null) throw new Error(`${name} is no control`);
  return found;
}

describe('a control’s slider', () => {
  it('runs a train handle over its notches, the travel a notch over 8', () => {
    for (const name of ['THROTTLE_1', 'TRAIN_BRAKE_2', 'IND_BRAKE_1']) {
      const role = control(name);
      expect(controlInput(role)).toEqual({ kind: 'notches', min: 0, max: NOTCHES, step: 1, rest: 0 });
      expect([0, 1, 4, 8].map((notch) => controlPosition(role, notch))).toEqual([0, 0.125, 0.5, 1]);
    }
  });

  it('runs the reverser back, neutral, forward, and the value is centred on neutral', () => {
    const role = control('REVERSER_1_ROT_-60');
    expect(controlInput(role)).toEqual({ kind: 'reverser', min: -1, max: 1, step: 1, rest: 0 });
    expect([-1, 0, 1].map((step) => controlPosition(role, step))).toEqual([0, 0.5, 1]);
    expect([-1, 0, 1].map((step) => controlValue(role, controlPosition(role, step)))).toEqual([-0.5, 0, 0.5]);
  });

  it('runs a gauge over its reading, through its RANGE, held to 0…1', () => {
    const speed = control('GAUGE_SPEED_1_NEEDLE_RANGE_0_1.5');
    expect(controlInput(speed)).toEqual({ kind: 'reading', min: 0, max: 1.5, step: 0.01, rest: 0 });
    expect(controlPosition(speed, 0.75)).toBe(0.5);
    expect(controlPosition(speed, 1.5)).toBe(1);
    const brake = control('GAUGE_TRAIN_BRAKE_1_RANGE_0.2_0.6');
    expect(controlPosition(brake, 0.1)).toBe(0);
    expect(controlPosition(brake, 0.4)).toBeCloseTo(0.5, 6);
    expect(controlPosition(brake, 0.9)).toBe(1);
    expect(controlPosition(control('BRAKE_PRESSURE_1_RANGE_0.5_0.5'), 0.7)).toBe(0);
    const backwards = control('GAUGE_TEMPERATURE_1_RANGE_2_-1');
    expect(controlInput(backwards)).toMatchObject({ min: -1, max: 2 });
  });

  it('runs the throttle’s and the reverser’s gauges by what they read: a notch, a reverser step', () => {
    const throttle = control('GAUGE_THROTTLE_1');
    expect(controlInput(throttle).kind).toBe('notches');
    expect(controlPosition(throttle, 2)).toBe(0.25);
    const reverser = control('GAUGE_REVERSER_1_RANGE_0.5_1');
    expect(controlInput(reverser).kind).toBe('reverser');
    expect([-1, 0, 1].map((step) => controlPosition(reverser, step))).toEqual([0, 0, 1]);
  });

  it('puts the combined handle where the slider is, at rest in neutral', () => {
    const role = control('THROTTLE_BRAKE_1');
    expect(controlInput(role)).toMatchObject({ kind: 'centred', rest: 0.5 });
    expect(controlPosition(role, 0.25)).toBe(0.25);
    expect(controlValue(role, controlPosition(role, 0.5))).toBe(0);
  });

  it('turns the handbrake wheel 0…1, and a switch by its group’s value; a toggle or a button by whole steps', () => {
    expect(controlInput(control('HANDBRAKE_1_ROT_270'))).toMatchObject({ kind: 'handbrake', step: 0.01 });
    expect(controlPosition(control('HANDBRAKE_1'), 1.5)).toBe(1);
    expect(controlInput(control('WIDGET_1_TOGGLE_CG_FHL'))).toMatchObject({ kind: 'group', step: 1 });
    expect(controlInput(control('HORN_CONTROL_1_PRESS'))).toMatchObject({ kind: 'group', step: 1 });
    expect(controlInput(control('WINDOW_1_INVERT_TL_0.8_Y'))).toMatchObject({ kind: 'group', step: 0.01 });
    expect(controlPosition(control('WINDOW_1'), -0.5)).toBe(0);
    expect(controlPosition(control('WINDOW_1'), 0.3)).toBe(Math.fround(0.3));
  });
});
