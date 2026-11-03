/**
 * The order of the roles the tab sorts and lists by (schema/obj-conventions.json
 * `parse_order`) and what the schema says of the roles in dispute, against the engine's
 * answers: the parts `ModelParts` places in fixtures/golden/model_parts/ (Java writes them).
 * The tab does not decide roles (the model worker does, by ports/modelParts); it shows the
 * schema's rules as the reason for each, so they have to tell the engine's order.
 */

import { describe, expect, it } from 'vitest';
import { coupled, door, parseRole } from '../../ports/objectRole';
import { readGoldenFolder } from '../../testing/golden.node';
import { GOLDEN_DIR } from '../../testing/repo.node';
import { roleEntry, ROLE_ORDER } from './roles';

interface GoldenPart {
  object: string;
  place: string;
  owner: string | null;
}

const parts = readGoldenFolder(`${GOLDEN_DIR}/model_parts`)
  .files.flatMap((file) => file.cases)
  .flatMap((c) => ((c.expected as { parts?: GoldenPart[] }).parts ?? []).map((part) => ({ case: c.id, ...part })));

/** The roles a part's name alone would give it, besides untextured. */
function named(object: string): string[] {
  const roles: string[] = [];
  if (coupled(object) !== null) roles.push('coupler_head');
  if (object.startsWith('BOGEY_FRONT')) roles.push(object.includes('_WHEEL_') ? 'wheelset' : 'bogie_front');
  if (object.startsWith('BOGEY_REAR')) roles.push(object.includes('_WHEEL_') ? 'wheelset' : 'bogie_rear');
  if (door(object) !== null) roles.push('door_leaf');
  if (parseRole(object).control !== null) roles.push('control');
  return roles;
}

const rank = (role: string): number => ROLE_ORDER.indexOf(role);

describe('the parse order of the schema against the engine (golden model_parts)', () => {
  it('makes a part without a texture untextured before anything its name says, but hidden and skip', () => {
    const untextured = parts.filter((part) => part.place === 'UNTEXTURED' && named(part.object).length > 0);
    // the evidence: a coupler head, a wheelset and hinge markers the engine leaves untextured
    expect(new Set(untextured.flatMap((part) => named(part.object)))).toEqual(new Set(['coupler_head', 'wheelset', 'control', 'door_leaf']));
    for (const part of untextured) {
      for (const role of named(part.object)) expect([part.case, part.object, role, rank('untextured') < rank(role)]).toEqual([part.case, part.object, role, true]);
    }
    expect(ROLE_ORDER.slice(0, 3)).toEqual(['hidden', 'skip', 'untextured']);
  });

  it('makes a coupler head named like a control that control', () => {
    const heads = parts.filter((part) => coupled(part.object) !== null && part.place === 'CONTROL');
    expect(heads.map((part) => part.object)).toEqual(['COUPLED_FRONT_1_WIDGET_3_CG_X']);
    expect(rank('control')).toBeLessThan(rank('coupler_head'));
    expect(roleEntry('coupler_head')?.effect).toContain('named like a control too (COUPLED_FRONT_1_WIDGET_3) is that control');
  });

  it('lets a hinge marker without a texture make a door leaf: the leaf rule counts it', () => {
    const markers = parts.filter((part) => part.place === 'UNTEXTURED' && door(part.object)?.pivotDegrees != null);
    const leaves = new Set(parts.filter((part) => part.place === 'DOOR_LEAF').map((part) => `${part.case} ${part.owner}`));
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) expect(leaves.has(`${marker.case} ${marker.owner}`), marker.object).toBe(true);
    const leaf = roleEntry('door_leaf')!;
    expect(leaf.effect).not.toContain('Only objects drawn as parts of their own count');
    expect(leaf.effect).toContain('still makes the leaf');
    expect(leaf['x-description-ru']).toContain('створку всё равно создаёт');
  });
});
