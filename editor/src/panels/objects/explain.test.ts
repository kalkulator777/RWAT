import { describe, expect, it } from 'vitest';
import { CONVENTIONS, ROLE_ORDER, roleEntry } from './roles';
import { explainObject } from './explain';
import { roleColor, ROLE_COLORS } from '../../view3d/roleColors';

const en = { skip: [] as string[], lang: 'en' as const };
const ru = { skip: [] as string[], lang: 'ru' as const };

describe('the rule behind a role', () => {
  it('names the prefix of a bogie and the schema\'s words for it, in both languages', () => {
    const why = explainObject('BOGEY_FRONT_FRAME_1', 'bogie_front', en);
    expect(why).toMatchObject({ rule: 'BOGEY_FRONT*', how: 'prefix', matched: 'BOGEY_FRONT', input: 'raw', engine: 'active' });
    expect(why.effect).toBe(roleEntry('bogie_front')?.effect);
    const russian = explainObject('BOGEY_FRONT_FRAME_1', 'bogie_front', ru);
    expect(russian.effect).toBe(roleEntry('bogie_front')?.['x-description-ru']);
    expect(russian.effect).not.toBe(why.effect);
  });

  it('says HIDE is a substring and the object is dropped', () => {
    const why = explainObject('WINDOW_HIDE_GLASS', 'hidden', en);
    expect(why).toMatchObject({ how: 'substring', matched: 'HIDE', engine: 'dropped' });
  });

  it('tells CARGO_FILL from a prefix of the model\'s skip', () => {
    expect(explainObject('CARGO_FILL_20', 'skip', en)).toMatchObject({ how: 'prefix', matched: 'CARGO_FILL' });
    expect(explainObject('GUIDE_FLOOR_0', 'skip', { skip: ['GUIDE_'], lang: 'en' })).toMatchObject({ how: 'skip', matched: 'GUIDE_' });
  });

  it('reads a wheelset, a coupler head (on the name without the copy suffix) and an .anim object', () => {
    expect(explainObject('BOGEY_REAR_WHEEL_2', 'wheelset', en)).toMatchObject({ how: 'regex', matched: 'BOGEY_REAR_WHEEL_' });
    const head = explainObject('COUPLED_FRONT_2_HIDE.001', 'coupler_head', en);
    expect(head).toMatchObject({ input: 'normalized', matched: 'COUPLED_FRONT_2' });
    expect(head.marks.map((m) => m.id)).toEqual(['HIDE']);
    expect(explainObject('SALON_DOOR_LEAF', 'anim_object', en)).toMatchObject({ how: 'anim', matched: 'SALON_DOOR_LEAF' });
  });

  it('gives a control its kind and every modifier and flag of its name, with their effects', () => {
    const why = explainObject('WIDGET_1_TOGGLE_CG_IL_OFFSET_-0.5', 'control', en);
    expect(why.kind).toMatchObject({ id: 'WIDGET', matched: 'WIDGET_1' });
    expect(why.marks.map((m) => [m.group, m.id, m.matched])).toEqual([
      ['modifier', 'CG', 'CG_IL'],
      ['modifier', 'OFFSET', 'OFFSET_-0.5'],
      ['flag', 'TOGGLE', 'TOGGLE'],
    ]);
    for (const mark of why.marks) expect(mark.effect).not.toBe('');
    const hinge = explainObject('THROTTLE_1_ROT_-50', 'control', en);
    expect(hinge.kind?.id).toBe('THROTTLE');
    expect(hinge.marks.map((m) => m.id)).toContain('ROT');
    // GAUGE_THROTTLE is a gauge, not a THROTTLE
    expect(explainObject('GAUGE_THROTTLE_1', 'control', en).kind?.id).toBe('GAUGE_THROTTLE');
  });

  it('gives a door leaf its door kind and its slide', () => {
    const why = explainObject('DOOR_1_TL_0.95_X', 'door_leaf', en);
    expect(why.kind).toMatchObject({ id: 'DOOR', matched: 'DOOR_1' });
    expect(why.marks.map((m) => m.id)).toContain('TL');
  });

  it('lists the light marks of any object, and no control modifiers of a body', () => {
    const why = explainObject('LAMPS_FULLBRIGHT_LCG_IL_LINVERT', 'body', en);
    expect(why.how).toBe('fallback');
    expect(why.marks.map((m) => [m.group, m.id])).toEqual([
      ['light', 'LCG'],
      ['light', 'LINVERT'],
      ['light', 'FULLBRIGHT'],
    ]);
    expect(explainObject('CAB_ROOF', 'body', en).marks).toEqual([]);
    expect(explainObject('HEADLIGHT_1_LCG_FHL_0XFFF2CC', 'interior', en).marks.map((m) => m.id)).toEqual(['LCG', 'HEADLIGHT', 'RGB']);
  });

  it('is honest about a role the schema does not know, and about the two that match by something else than the name', () => {
    expect(explainObject('X', 'wormhole', en)).toMatchObject({ rule: null, how: 'unknown', matched: null, effect: '' });
    expect(explainObject('SIDE_PANEL', 'untextured', en)).toMatchObject({ how: 'material', matched: null, engine: 'dropped' });
  });

  it('has an English and a Russian text for every wagon role of the schema, and a colour', () => {
    for (const id of ROLE_ORDER) {
      const entry = roleEntry(id);
      expect(entry, id).toBeDefined();
      for (const lang of [en.lang, ru.lang]) {
        const why = explainObject('SOME_NAME', id, { skip: [], lang });
        expect(why.effect, `${id} ${lang}`).not.toBe('');
        expect(why.rule, `${id} ${lang}`).toBeTruthy();
      }
      expect(ROLE_COLORS[id], `colour of ${id}`).toBeDefined();
    }
    expect(roleColor('wormhole')).toBe(0xf0e442);
    expect(CONVENTIONS.parse_order.steps.length).toBe(ROLE_ORDER.length);
  });
});
