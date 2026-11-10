/**
 * When a light shines (SPEC §8) — the faces of a glowing part, a cabin lamp, a headlight
 * alike: port of `convention/ModelParts.java` `lit` and `litMask` (and the `lit` of its
 * `Light`, `Lamp` and `Headlight`). Golden: fixtures/golden/lights/ (reference Java).
 *
 * A light with no group shines always; one of a group while the group is on, or, with
 * `LINVERT`, while it is off — as IR's `LightFlare` and `ModelState` treat a lamp of a
 * group. A group is on while its control group's value is above 0 (NaN is not); only the
 * first {@link MAX_LIGHT_GROUPS} groups of a model can be on. The lit groups are a 64-bit
 * mask, as Java's `long`: a `bigint` here. Which light belongs to which group is
 * ./modelParts.ts's business. Pure.
 */

import conventions from '../../../schema/obj-conventions.json';

/** The most light groups a model's lit groups are told by: one bit each (`ModelParts.MAX_LIGHT_GROUPS`). */
export const MAX_LIGHT_GROUPS: number = (() => {
  const found = conventions.limits.find((entry) => entry.code.includes('convention/ModelParts.java#MAX_LIGHT_GROUPS'));
  if (found === undefined) throw new Error('schema/obj-conventions.json has no limit of light groups');
  return found.value;
})();

/**
 * `ModelParts.lit`: true if a light shines given the model's lit groups — with no group
 * (`group` −1) always; else while its group is on, or with `LINVERT` (`invert`) while it
 * is off. A group past the {@link MAX_LIGHT_GROUPS}th is never on.
 *
 * @param litMask the model's lit groups ({@link litMask})
 */
export function lit(group: number, invert: boolean, litMask: bigint): boolean {
  if (group < 0) return true;
  const on = group < MAX_LIGHT_GROUPS && ((litMask >> BigInt(group)) & 1n) !== 0n;
  return on !== invert;
}

/** {@link lit} of anything with a light group and `LINVERT`: a part's light, a cabin lamp, a headlight. */
export function shines(light: { group: number; invert: boolean }, litMask: bigint): boolean {
  return lit(light.group, light.invert, litMask);
}

/**
 * `ModelParts.litMask`: the lit groups of a model — bit `i` set while light group `i` is
 * on, its control group's value above 0.
 *
 * @param lightGroups the model's light groups (./modelParts.ts `ModelParts.lightGroups`)
 * @param groupValue  a control group's value on the wagon
 */
export function litMask(lightGroups: readonly string[], groupValue: (group: string) => number): bigint {
  let mask = 0n;
  for (let i = 0; i < lightGroups.length && i < MAX_LIGHT_GROUPS; i++) {
    if (groupValue(lightGroups[i]!) > 0) mask |= 1n << BigInt(i);
  }
  return mask;
}

/** The names of the groups a mask has on, in the model's order (what a panel of switches shows). */
export function groupsOn(lightGroups: readonly string[], litMask: bigint): string[] {
  const on: string[] = [];
  for (let i = 0; i < lightGroups.length && i < MAX_LIGHT_GROUPS; i++) {
    if (((litMask >> BigInt(i)) & 1n) !== 0n) on.push(lightGroups[i]!);
  }
  return on;
}
