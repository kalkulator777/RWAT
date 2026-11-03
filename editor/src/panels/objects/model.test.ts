import { describe, expect, it } from 'vitest';
import { NO_FILTER, buildRows, filterRows, flagsOf, roleCounts, rolesPresent, sortRows } from './model';
import { exampleModel } from './example.node';
import { ROLE_ORDER } from './roles';

const shunter = await exampleModel('rwat_example:shunter');
const coach = await exampleModel('rwat_example:coach');
const shunterRows = buildRows(shunter.model, shunter.texturedMaterials);
const coachRows = buildRows(coach.model, coach.texturedMaterials);

function row(rows: typeof shunterRows, name: string) {
  const found = rows.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no row ${name}`);
  return found;
}

describe('the table of a model', () => {
  it('has a row per object, in the file order, with the materials, texture and faces of its parts', () => {
    expect(shunterRows.map((r) => r.index)).toEqual(shunterRows.map((_, at) => at));
    expect(shunterRows[0]).toMatchObject({ name: 'FRAME', role: 'body', materials: ['dark_steel'], textured: true });
    expect(shunterRows[0]?.faces).toBeGreaterThan(0);
    // a quad is two triangles: a box of six quads is 12
    expect(row(shunterRows, 'CAB_LAMP_FULLBRIGHT_LCG_IL').faces % 2).toBe(0);
  });

  it('reads the control, its group, the light group and the flags from the name', () => {
    expect(row(shunterRows, 'THROTTLE_1_ROT_-50')).toMatchObject({ role: 'control', key: 'THROTTLE_1', controlGroup: null, lit: false });
    expect(row(shunterRows, 'THROTTLE_1_ROT_-50').flags).toEqual(['ROT -50']);
    expect(row(shunterRows, 'WIDGET_7_CG_FHL_HIDE_NOTOUCH')).toMatchObject({ role: 'control', key: 'WIDGET_7', controlGroup: 'FHL' });
    expect(row(shunterRows, 'WIDGET_7_CG_FHL_HIDE_NOTOUCH').flags).toEqual(['HIDE', 'NOTOUCH']);
    expect(row(shunterRows, 'HEADLIGHT_1_LCG_FHL_0XFFF2CC')).toMatchObject({ lightGroup: 'FHL', lit: true });
    expect(row(shunterRows, 'TAIL_LAMPS_FULLBRIGHT_LCG_REL').flags).toEqual(['FULLBRIGHT']);
    expect(row(coachRows, 'DOOR_1_TL_0.95_X')).toMatchObject({ role: 'door_leaf', key: 'DOOR_1' });
    expect(row(coachRows, 'DOOR_1_TL_0.95_X').flags).toEqual(['TL 0.95 X']);
    expect(row(coachRows, 'COUPLED_FRONT_3_HIDE_INVERT')).toMatchObject({ role: 'coupler_head', key: 'COUPLED_FRONT' });
    expect(row(coachRows, 'COUPLED_FRONT_3_HIDE_INVERT').flags).toEqual(['INVERT', 'HIDE']);
    expect(flagsOf('LAMPS_FULLBRIGHT_LCG_IL.001')).toEqual(['FULLBRIGHT']);
  });

  it('gives the example wagons the roles the engine gives', () => {
    expect(row(coachRows, 'GUIDE_FLOOR_0').role).toBe('skip');
    expect(row(coachRows, 'BOGEY_FRONT').role).toBe('bogie_front');
    expect(row(coachRows, 'BOGEY_REAR_WHEEL_2').role).toBe('wheelset');
    expect(row(coachRows, 'SALON_DOOR_LEAF_INTERIOR_LCG_IL').role).toBe('anim_object');
    expect(row(coachRows, 'INTERIOR_SEATS_LCG_IL').role).toBe('interior');
    expect(row(coachRows, 'COUPLED_REAR_2_HIDE').role).toBe('coupler_head');
    expect(row(shunterRows, 'TRAIN_BRAKE_1_KNOB').role).toBe('control');
    expect(row(shunterRows, 'GUIDE_FLOOR_0')?.role).toBe('skip');
  });

  it('says nothing about a texture it cannot know', () => {
    const unknown = buildRows(shunter.model, null);
    expect(unknown.every((r) => r.textured === null)).toBe(true);
  });
});

describe('search, role filter and the light filter', () => {
  it('finds by name, key, group, flag and material, whatever the case', () => {
    expect(filterRows(shunterRows, { ...NO_FILTER, text: 'throttle_1' }).map((r) => r.name)).toContain('THROTTLE_1_KNOB');
    expect(filterRows(shunterRows, { ...NO_FILTER, text: 'fhl' }).map((r) => r.name)).toEqual([
      'HEADLIGHT_1_LCG_FHL_0XFFF2CC',
      'WIDGET_7_CG_FHL_HIDE_NOTOUCH',
      'IND_LAMP_FULLBRIGHT_LCG_FHL_LINVERT',
      'WIDGET_1_TOGGLE_CG_FHL_OFFSET_-0.5',
    ]);
    expect(filterRows(shunterRows, { ...NO_FILTER, text: ' NOTOUCH ' })).toHaveLength(1);
    expect(filterRows(shunterRows, { ...NO_FILTER, text: 'red_lamp' }).map((r) => r.materials)).toSatisfy((m: string[][]) => m.length > 0 && m.every((list) => list.includes('red_lamp')));
    expect(filterRows(shunterRows, { ...NO_FILTER, text: 'no such thing' })).toEqual([]);
    expect(filterRows(shunterRows, NO_FILTER)).toHaveLength(shunterRows.length);
  });

  it('keeps the roles asked for, and the lit objects whatever their role', () => {
    const controls = filterRows(shunterRows, { ...NO_FILTER, roles: new Set(['control']) });
    expect(controls.length).toBeGreaterThan(5);
    expect(controls.every((r) => r.role === 'control')).toBe(true);
    const both = filterRows(shunterRows, { ...NO_FILTER, roles: new Set(['control', 'skip']) });
    expect(new Set(both.map((r) => r.role))).toEqual(new Set(['control', 'skip']));
    const lit = filterRows(shunterRows, { ...NO_FILTER, lit: true });
    expect(lit.length).toBeGreaterThan(3);
    expect(lit.every((r) => r.lit)).toBe(true);
    const throttles = filterRows(shunterRows, { text: 'throttle', roles: new Set(['control']), lit: false });
    expect(throttles.length).toBeGreaterThan(0);
    expect(throttles.every((r) => r.role === 'control' && r.name.includes('THROTTLE'))).toBe(true);
    // search and role filter both have to hold
    expect(filterRows(shunterRows, { text: 'throttle', roles: new Set(['skip']) })).toEqual([]);
  });

  it('counts the roles and lists the present ones in the engine order', () => {
    const counts = roleCounts(shunterRows);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(shunterRows.length);
    const present = rolesPresent(shunterRows);
    expect(present).toEqual([...present].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b)));
    expect(present).toContain('control');
  });
});

describe('sorting', () => {
  it('sorts names with numbers by their value, either way, and keeps the file order for ties', () => {
    const asc = sortRows(shunterRows, 'name').map((r) => r.name);
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })));
    expect(sortRows(shunterRows, 'name', 'desc').map((r) => r.name)).toEqual([...asc].reverse());
    const byRole = sortRows(shunterRows, 'role');
    expect(byRole.map((r) => ROLE_ORDER.indexOf(r.role))).toEqual(byRole.map((r) => ROLE_ORDER.indexOf(r.role)).sort((a, b) => a - b));
    // stable: inside a role the file order stays
    const bodies = byRole.filter((r) => r.role === 'body').map((r) => r.index);
    expect(bodies).toEqual([...bodies].sort((a, b) => a - b));
  });

  it('puts the blank keys and groups last whichever way it sorts, and the file order back', () => {
    const byKey = sortRows(shunterRows, 'key');
    expect(byKey[0]?.key).not.toBeNull();
    expect(byKey[byKey.length - 1]?.key).toBeNull();
    const desc = sortRows(shunterRows, 'key', 'desc');
    expect(desc[desc.length - 1]?.key).toBeNull();
    expect(sortRows(sortRows(shunterRows, 'faces', 'desc'), 'file').map((r) => r.index)).toEqual(shunterRows.map((r) => r.index));
    const faces = sortRows(shunterRows, 'faces', 'desc').map((r) => r.faces);
    expect(faces).toEqual([...faces].sort((a, b) => b - a));
  });
});
