/**
 * When a light shines — a glowing face, a cabin lamp, a headlight alike — and which light
 * groups are on: `ModelParts.lit` and `ModelParts.litMask` of the engine
 * (`convention/ModelParts.java`, golden fixtures/golden/lights/).
 *
 * TODO(merge A3.1): a stand-in until ports/lights.ts (agent A3.1) is merged; then this file
 * goes and the preview calls the port. It is the engine's rule word for word and is held
 * to the golden cases of that folder that need no model (./lights.test.ts), so the two
 * cannot differ meanwhile.
 */

/** The most light groups a model's lit groups are told by (`ModelParts.MAX_LIGHT_GROUPS`). */
export const MAX_LIGHT_GROUPS = 64;

/**
 * The light groups that are on (`ModelParts.litMask`): group `i` is on while its control
 * group's value is above 0 (NaN is not); only the first {@link MAX_LIGHT_GROUPS}.
 *
 * @param lightGroups the model's light groups, in its order
 * @param value a control group's value on the wagon (0 for one never set)
 * @returns on/off by the index of {@link lightGroups}
 */
export function groupsOn(lightGroups: readonly string[], value: (group: string) => number): boolean[] {
  return lightGroups.map((group, i) => i < MAX_LIGHT_GROUPS && value(group) > 0);
}

/**
 * Whether a light shines (`ModelParts.lit`): with no group (−1) always; else while its
 * group is on, or with `LINVERT` while it is off. A group past the 64th is never on.
 */
export function lit(group: number, invert: boolean, on: readonly boolean[]): boolean {
  if (group < 0) return true;
  const groupOn = group < MAX_LIGHT_GROUPS && on[group] === true;
  return groupOn !== invert;
}
