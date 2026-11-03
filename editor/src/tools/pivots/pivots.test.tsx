import { act, fireEvent, render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import type { OverlayShape, Vec3 } from '../../core/contracts';
import { setLang } from '../../i18n';
import { exampleModel } from '../../model/testing.node';
import { movingMatrix } from '../../preview/pose';
import { arcPoints } from '../../view3d/overlayGeometry';
import { OVERLAY_STYLES } from '../../view3d/overlays';
import { ToolHost } from '../registry';
import { ToolSection } from '../ToolBar';
import { bench } from '../testing.node';
import { controlOfObject, GHOST_STYLE, moved, PIVOT_LAYERS, pivotsPicture, pivotViews } from './analysis';
import pivotsTool, { type PivotsSession } from './index';

const shunter = await exampleModel('shunter');
const controls = pivotViews(shunter);
const index = (key: string): number => {
  const found = controls.find((c) => c.key === key);
  if (found === undefined) throw new Error(`no ${key}`);
  return found.index;
};

function only<S extends OverlayShape['shape']>(shapes: readonly OverlayShape[], shape: S): Extract<OverlayShape, { shape: S }>[] {
  return shapes.filter((s): s is Extract<OverlayShape, { shape: S }> => s.shape === shape);
}

function close(a: Vec3, b: Vec3): void {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i] as number, 4);
}

describe('the shunter’s controls as the hinges tool shows them', () => {
  it('each with its hinge, axis, swing, slide and the ends of its travel, OBJ frame', () => {
    const throttle = controls[index('THROTTLE_1')]!;
    expect(throttle).toMatchObject({ kind: 'THROTTLE', degrees: -50, axis: [0, 0, -1], from: 0, to: 1, objects: ['THROTTLE_1_ROT_-50', 'THROTTLE_1_LEVER_LABEL_Controller', 'THROTTLE_1_KNOB'] });
    close(throttle.pivot!, [1.05, 2.52, -0.45]);
    // the reverser is drawn in neutral: its travel runs both ways from it
    expect(controls[index('REVERSER_1')]).toMatchObject({ from: -0.5, to: 0.5, degrees: -60 });
    // a slide (TL) and no hinge
    const gauge = controls[index('GAUGE_THROTTLE_1')]!;
    expect(gauge.pivot).toBeNull();
    close(gauge.slide, [0, 0, -0.72]);
    // INVERT: the travel runs the other way
    expect(controls[index('WINDOW_1')]).toMatchObject({ from: 1, to: 0, invert: true });
    // a widget offset by −0.5
    expect(controls[index('WIDGET_1')]).toMatchObject({ from: -0.5, to: 0.5, offset: -0.5 });
    // every control's hinge marked
    const picture = pivotsPicture(shunter, null);
    expect(picture.layers['pivots.markers']).toHaveLength(controls.filter((c) => c.pivot !== null).length);
    expect(picture.layers['pivots.axis']).toEqual([]);
    expect(controlOfObject(controls, 'THROTTLE_1_KNOB')).toBe(index('THROTTLE_1'));
    expect(controlOfObject(controls, 'HOODS')).toBeNull();
  });

  it('the throttle chosen: its axis, the arc of its −50° travel ending where its ghost stands at the end', () => {
    const i = index('THROTTLE_1');
    const picture = pivotsPicture(shunter, i);
    const view = controls[i]!;
    const [axis] = only(picture.layers['pivots.axis'], 'arrow');
    if (axis === undefined) throw new Error('no axis');
    // along −Z, through the hinge, its head the way a positive turn goes round
    expect(axis.to[2] - axis.from[2]).toBeLessThan(0);
    close([(axis.from[0] + axis.to[0]) / 2, (axis.from[1] + axis.to[1]) / 2, (axis.from[2] + axis.to[2]) / 2], view.pivot!);
    const [arc] = only(picture.layers['pivots.travel'], 'arc');
    if (arc === undefined) throw new Error('no arc');
    expect(arc.degrees).toBe(-50);
    const end = arcPoints(arc.centre, arc.axis, arc.from, arc.degrees).at(-1)!;
    // the arc's end is a corner of the ghost: the engine's own transform at the travel's end
    const ghost = only(picture.layers['pivots.ghost'], 'polygon');
    expect(ghost).toHaveLength(6);
    expect(ghost.every((g) => g.style === GHOST_STYLE)).toBe(true);
    const corners = ghost.flatMap((g) => g.points);
    expect(corners.some((c) => Math.hypot(c[0] - end[0], c[1] - end[1], c[2] - end[2]) < 1e-4)).toBe(true);
    const part = shunter.engine!.controls[i]!;
    close(moved(movingMatrix(part, 1), view.pivot!), view.pivot!);
    for (const layer of PIVOT_LAYERS) for (const shape of picture.layers[layer]) expect(OVERLAY_STYLES).toHaveProperty(shape.style);
  });

  it('the reverser chosen: its arc from one end of its travel through neutral to the other', () => {
    const picture = pivotsPicture(shunter, index('REVERSER_1'));
    const [arc] = only(picture.layers['pivots.travel'], 'arc');
    expect(arc?.degrees).toBe(-60);
  });

  it('a slide chosen: the TL arrow, no axis and no arc; with INVERT, the other way', () => {
    const gauge = pivotsPicture(shunter, index('GAUGE_THROTTLE_1'));
    expect(gauge.layers['pivots.axis']).toEqual([]);
    expect(only(gauge.layers['pivots.travel'], 'arc')).toEqual([]);
    const [slide] = only(gauge.layers['pivots.travel'], 'arrow');
    if (slide === undefined) throw new Error('no slide');
    close([slide.to[0] - slide.from[0], slide.to[1] - slide.from[1], slide.to[2] - slide.from[2]], [0, 0, -0.72]);
    const window = pivotsPicture(shunter, index('WINDOW_1'));
    const [down] = only(window.layers['pivots.travel'], 'arrow');
    if (down === undefined) throw new Error('no slide');
    expect(down.to[1] - down.from[1]).toBeCloseTo(-0.8, 5);
  });

  it('the handbrake’s wheel, turning about its own middle: an arc round its rim', () => {
    const [arc] = only(pivotsPicture(shunter, index('HANDBRAKE_1')).layers['pivots.travel'], 'arc');
    if (arc === undefined) throw new Error('no arc');
    expect(arc.degrees).toBe(270);
    expect(Math.hypot(arc.from[1] - arc.centre[1], arc.from[2] - arc.centre[2])).toBeGreaterThan(0.1);
  });
});

describe('the hinges tool turned on', () => {
  it('lists the controls, chooses one in the list or by a click on it in the view, and selects its objects; edits nothing', async () => {
    setLang('en');
    const b = await bench('rwat_example:shunter', shunter);
    const host = new ToolHost([pivotsTool]);
    const stop = host.connect(b.wiring);
    host.use('pivots');
    const tool = (host.current.value?.session as PivotsSession).tool;
    const view = render(<ToolSection host={host} />);
    const q = <T extends Element = HTMLElement>(selector: string) => view.container.querySelector<T>(selector);
    expect(b.view.dragger).toBeNull();
    expect(q('[data-testid="pivots-tool"]')?.getAttribute('data-controls')).toBe(String(controls.length));
    expect(q('[data-key="THROTTLE_1"] .pivots-summary')?.textContent).toBe('Throttle · turns -50°');
    expect(q('[data-key="GAUGE_THROTTLE_1"] .pivots-summary')?.textContent).toBe('Throttle gauge · TL slide');
    expect(b.view.overlays.get('pivots.markers')?.length).toBeGreaterThan(0);
    expect(b.view.overlays.has('pivots.ghost')).toBe(false);

    fireEvent.click(q('[data-key="TRAIN_BRAKE_1"] .pivots-control') as HTMLElement);
    expect(tool.chosen.value).toBe(index('TRAIN_BRAKE_1'));
    expect(b.view.overlays.get('pivots.ghost')).toHaveLength(6);
    expect(q('[data-fact="degrees"]')?.textContent).toBe('90');
    expect(q('[data-fact="axis"]')?.textContent).toBe('(0, 1, 0)');
    expect(q('[data-fact="travel"]')?.textContent).toBe('value from 0 to 1');
    fireEvent.click(q('[data-action="pivots-select"]') as HTMLElement);
    expect(b.selection.value.map((l) => (l.kind === 'object' ? l.name : ''))).toEqual(['TRAIN_BRAKE_1_ROT_90', 'TRAIN_BRAKE_1_HANDLE', 'TRAIN_BRAKE_1_KNOB']);

    await act(() => b.view.emitPick({ object: 'WIDGET_1_TOGGLE_CG_FHL_OFFSET_-0.5', point: [1.05, 2.55, 0.65], shift: false, ctrl: false, alt: false, double: false }));
    expect(tool.chosen.value).toBe(index('WIDGET_1'));
    expect(q('[data-fact="travel"]')?.textContent).toBe('value from -0.5 to 0.5 (OFFSET -0.5)');
    // pressed again in the list: none chosen
    fireEvent.click(q('[data-key="WIDGET_1"] .pivots-control') as HTMLElement);
    expect(tool.chosen.value).toBeNull();
    host.use(null);
    expect([...b.view.overlays.keys()].filter((layer) => layer.startsWith('pivots.'))).toEqual([]);
    expect(b.journal.canUndo).toBe(false);
    stop();
  });
});
