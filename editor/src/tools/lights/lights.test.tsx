import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import type { OverlayShape } from '../../core/contracts';
import { setLang } from '../../i18n';
import { exampleModel } from '../../model/testing.node';
import { OVERLAY_STYLES } from '../../view3d/overlays';
import { ToolHost } from '../registry';
import { ToolSection } from '../ToolBar';
import { bench } from '../testing.node';
import { CHOSEN_STYLE, colourOf, CONE_LENGTH, groupOfObject, LIGHT_LAYERS, lightsPicture, NO_GROUP } from './analysis';
import lightsTool, { type LightsSession } from './index';

const shunter = await exampleModel('shunter');
const coach = await exampleModel('coach');

const styles = (shapes: readonly OverlayShape[] | undefined) => (shapes ?? []).map((s) => s.style);
const times = (n: number, style: string): string[] => Array.from({ length: n }, () => style);

describe('the lights of the shunter', () => {
  it('two headlights, each a cone out of its lens the way the half of the model it is in says, of their colour and group', () => {
    const p = lightsPicture(shunter, null);
    expect(p.headlights.map((h) => [h.forward, h.colour, h.group, h.way])).toEqual([
      [true, '#fff2cc', 0, [-1, 0, 0]],
      [false, '#fff2cc', 1, [1, 0, 0]],
    ]);
    // the front lens on the front end (−X), the rear one on the rear end
    expect(p.headlights[0]?.lens[0]).toBeCloseTo(-6.73, 5);
    expect(p.headlights[1]?.lens[0]).toBeCloseTo(6.73, 5);
    const cones = p.layers['lights.headlights'];
    expect(cones).toHaveLength(8);
    const axis = cones[0];
    if (axis?.shape !== 'arrow') throw new Error('no axis');
    expect(axis.to[0] - axis.from[0]).toBeCloseTo(-CONE_LENGTH, 6);
    const back = cones[4];
    if (back?.shape !== 'arrow') throw new Error('no axis');
    expect(back.to[0] - back.from[0]).toBeCloseTo(CONE_LENGTH, 6);
    expect(new Set(styles(cones))).toEqual(new Set(['headlight']));
    for (const layer of LIGHT_LAYERS) for (const shape of p.layers[layer]) expect(OVERLAY_STYLES).toHaveProperty(shape.style);
  });

  it('its light groups in the model’s order, each with what it lights; the cab lamp of IL lights the inside', () => {
    const p = lightsPicture(shunter, null);
    expect(p.groups.map((g) => [g.name, g.headlights, g.lamps, g.interior])).toEqual([
      ['FHL', [0], [], false],
      ['RHL', [1], [], false],
      ['REL', [], [], false],
      ['IL', [], [0], true],
      ['DeskL', [], [], false],
    ]);
    expect(p.groups[0]?.inverted).toEqual(['IND_LAMP_FULLBRIGHT_LCG_FHL_LINVERT']);
    expect(p.groups[3]?.objects).toContain('CAB_LAMP_FULLBRIGHT_LCG_IL');
    expect(p.lamps).toHaveLength(1);
    expect(p.lamps[0]?.at[1]).toBeCloseTo(3.86, 5);
    expect(p.layers['lights.lamps'].map((s) => s.shape)).toEqual(['point', 'circle']);
  });

  it('a group chosen: its headlight and lamps drawn in a colour of their own', () => {
    expect(styles(lightsPicture(shunter, 0).layers['lights.headlights'])).toEqual([...times(4, CHOSEN_STYLE), ...times(4, 'headlight')]);
    expect(styles(lightsPicture(shunter, 3).layers['lights.lamps'])).toEqual([CHOSEN_STYLE, CHOSEN_STYLE]);
    expect(styles(lightsPicture(shunter, 3).layers['lights.headlights'])).not.toContain(CHOSEN_STYLE);
  });

  it('the coach: no headlight, eight cabin lamps in its one group; a model that cannot be read: nothing', () => {
    const p = lightsPicture(coach, null);
    expect(p.headlights).toEqual([]);
    expect(p.groups.map((g) => [g.name, g.lamps.length, g.interior])).toEqual([['IL', 8, true]]);
    expect(lightsPicture({ ...coach, engine: null }, null).groups).toEqual([]);
    expect(colourOf(0xff)).toBe('#0000ff');
  });

  it('an object clicked is about the group it is lit by, or the one its control switches', () => {
    expect(groupOfObject(shunter, 'CAB_LAMP_FULLBRIGHT_LCG_IL')).toBe(3);
    // the shutter over the front lens (`WIDGET_7_CG_FHL_HIDE`) and the cab's switch of the cab lights
    expect(groupOfObject(shunter, 'WIDGET_7_CG_FHL_HIDE_NOTOUCH')).toBe(0);
    expect(groupOfObject(shunter, 'WIDGET_3_TOGGLE_CG_IL_OFFSET_-0.5')).toBe(3);
    expect(groupOfObject(shunter, 'THROTTLE_1_KNOB')).toBeNull();
    expect(groupOfObject(shunter, 'HOODS')).toBeNull();
    expect(groupOfObject(shunter, 'NO_SUCH_OBJECT')).toBeNull();
  });

  it('lights of no group come last, as a group of their own', () => {
    const engine = shunter.engine!;
    const free = { ...shunter, engine: { ...engine, headlights: [{ ...engine.headlights[0]!, group: -1 }] } };
    const p = lightsPicture(free, NO_GROUP);
    expect(p.groups.at(-1)).toMatchObject({ index: NO_GROUP, name: null, headlights: [0] });
    expect(styles(p.layers['lights.headlights'])).toEqual(times(4, CHOSEN_STYLE));
  });
});

describe('the lights tool turned on', () => {
  async function on() {
    setLang('en');
    const b = await bench('rwat_example:shunter', shunter);
    const host = new ToolHost([lightsTool]);
    const stop = host.connect(b.wiring);
    host.use('lights');
    const tool = (host.current.value?.session as LightsSession).tool;
    const view = render(<ToolSection host={host} />);
    const q = <T extends Element = HTMLElement>(selector: string) => view.container.querySelector<T>(selector);
    return { b, host, stop, tool, q };
  }

  it('draws the lights, keeps the camera and its presses, edits nothing; turned off, takes its layers back', async () => {
    const { b, host, stop, q } = await on();
    expect(b.view.camera.value).toBe('orbit');
    expect(b.view.dragger).toBeNull();
    expect(b.view.overlays.get('lights.headlights')).toHaveLength(8);
    expect(b.view.overlays.get('lights.lamps')).toHaveLength(2);
    expect(q('[data-testid="lights-tool"]')?.getAttribute('data-groups')).toBe('5');
    expect(q('[data-headlight="0"]')?.textContent).toBe('Headlight 0shines forward#fff2ccgroup FHL');
    expect(q('[data-headlight="1"]')?.getAttribute('data-way')).toBe('back');
    host.use(null);
    expect([...b.view.overlays.keys()].filter((layer) => layer.startsWith('lights.'))).toEqual([]);
    expect(b.journal.canUndo).toBe(false);
    stop();
  });

  it('chooses a group in its list or by a click on one of its objects, and selects the group’s objects', async () => {
    const { b, tool, stop, q } = await on();
    fireEvent.click(q('[data-group="3"] .lights-group') as HTMLElement);
    expect(tool.chosen.value).toBe(3);
    expect(styles(b.view.overlays.get('lights.lamps'))).toEqual([CHOSEN_STYLE, CHOSEN_STYLE]);
    expect(q('[data-testid="lights-chosen"]')?.getAttribute('data-group')).toBe('3');
    fireEvent.click(q('[data-action="lights-select-group"]') as HTMLElement);
    expect(b.selection.value.map((l) => (l.kind === 'object' ? l.name : ''))).toEqual([
      'CAB_LAMP_FULLBRIGHT_LCG_IL',
      'INTERIOR_CAB_FLOOR_LCG_IL',
      'INTERIOR_DESKS_LCG_IL',
      'INTERIOR_CHAIRS_LCG_IL',
    ]);
    // pressed again: no group chosen
    fireEvent.click(q('[data-group="3"] .lights-group') as HTMLElement);
    expect(tool.chosen.value).toBeNull();
    // a click in the view on the front headlight's lens
    b.view.emitPick({ object: 'HEADLIGHT_1_LCG_FHL_0XFFF2CC', point: [-6.7, 2.95, 0], shift: false, ctrl: false, alt: false, double: false });
    expect(tool.chosen.value).toBe(0);
    expect(styles(b.view.overlays.get('lights.headlights')).slice(0, 4)).toEqual(times(4, CHOSEN_STYLE));
    // an object of no group chooses nothing else
    b.view.emitPick({ object: 'HOODS', point: [0, 3.3, 0], shift: false, ctrl: false, alt: false, double: false });
    expect(tool.chosen.value).toBe(0);
    // the switch of the rear headlight: its control group is the light group RHL
    b.view.emitPick({ object: 'WIDGET_2_TOGGLE_CG_RHL_OFFSET_-0.5', point: [1.05, 2.55, 0.77], shift: false, ctrl: false, alt: false, double: false });
    expect(tool.chosen.value).toBe(1);
    stop();
  });

  it('says the model is being read while it is', async () => {
    setLang('en');
    const b = await bench('rwat_example:shunter', null);
    const host = new ToolHost([lightsTool]);
    const stop = host.connect(b.wiring);
    host.use('lights');
    const view = render(<ToolSection host={host} />);
    expect(view.container.textContent).toContain('The model is being read…');
    expect(b.view.overlays.has('lights.headlights')).toBe(false);
    stop();
  });
});
