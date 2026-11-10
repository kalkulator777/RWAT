/**
 * The gate of M3 (docs/proposals/editor.md §7, M3 "Готово, когда") on the shell as a user
 * has it: the example pack opened as a zip, a wagon picked in the tree, its model read by
 * the model worker and shown in the 3D view, the Preview tab driving it.
 *
 * - the coach and the shunter: the engine's role of every object is golden model_parts';
 *   the coach in the "Roles" display from the top and from three quarters, and textured;
 * - the coach's `salon_door` slider moves the door's pieces by its `.anim`; its front end
 *   coupled switches its coupler heads; the `blue` livery repaints it, the camera and the
 *   selection staying where they were;
 * - the shunter's `THROTTLE_1` at notch 8 turns the lever about its marker's axis by the
 *   marker's degrees; with the light group `FHL` on, the light display shows its headlight
 *   lit (its cover gone) and the preview's headlight arrow;
 * - the TEM2 of MVP is read and shown within the budget of §3.11, or the test says it is
 *   skipped where MVP is not in the checkout.
 *
 * Screenshots go to the folder `RWAT_M3_SHOTS` names, else to the test's output (they are
 * not compared: reference screenshots are CI's, §5.2).
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { framesAt, parse as parseAnim } from '../../src/ports/anim';
import { toObj } from '../../src/ports/objFrame';
import { EXAMPLE_PACK, GOLDEN_DIR, REPO_ROOT } from '../../src/testing/repo.node';
import { filesOf, openPack, pickWagon, watchErrors } from '../examplePack';
import { coloursAt, luminance, type HookWindow } from '../viewPixels';

type Vec3 = [number, number, number];

const COACH = 'rwat_example:coach';
const SHUNTER = 'rwat_example:shunter';

/** Saves a screenshot of the 3D view (and attaches it to the report). */
async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (window as HookWindow).__rwatView?.renderNow());
  const folder = process.env.RWAT_M3_SHOTS;
  if (folder !== undefined && folder !== '') mkdirSync(folder, { recursive: true });
  const path = folder !== undefined && folder !== '' ? join(folder, `${name}.png`) : test.info().outputPath(`${name}.png`);
  await page.getByTestId('view3d').screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

async function camera(page: Page, view: 'orbit' | 'top' | 'side' | 'front'): Promise<void> {
  await page.getByTestId('view3d').locator(`[data-toggle="camera"] [data-value="${view}"]`).click();
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-camera', view);
}

async function display(page: Page, mode: 'roles' | 'textured' | 'lit'): Promise<void> {
  await page.getByTestId('view3d').locator(`[data-toggle="display"] [data-value="${mode}"]`).click();
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-display', mode);
}

/** Opens the Preview tab at a section. */
async function previewSection(page: Page, section: 'doors' | 'controls' | 'lights' | 'liveries' | 'couplers'): Promise<void> {
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await page.getByTestId('preview').locator(`button[data-section="${section}"]`).click();
  await expect(page.getByTestId('preview')).toHaveAttribute('data-section', section);
}

/** What the view holds now of some objects: transform (column-major), hidden, lit. */
async function viewOf(page: Page, names: readonly string[]): Promise<Record<string, { transform: number[] | null; hidden: boolean; lit: boolean }>> {
  return page.evaluate((names) => {
    const view = (window as HookWindow).__rwatView?.view;
    if (!view) throw new Error('no view');
    return Object.fromEntries(
      names.map((name) => {
        const matrix = view.transforms.get(name);
        return [name, { transform: matrix === undefined ? null : Array.from(matrix), hidden: view.hidden.has(name), lit: view.lit.has(name) }];
      }),
    );
  }, names);
}

interface GoldenPart {
  object: string;
  place: string;
  front: boolean;
  owner: string | null;
  index: number;
}

/** The engine's role of each object of an example wagon, golden model_parts: its first drawn part's, else its first part's. */
function goldenRoles(wagon: 'coach' | 'shunter'): Record<string, Omit<GoldenPart, 'object'>> {
  const file = JSON.parse(readFileSync(join(GOLDEN_DIR, 'model_parts', 'parts.json'), 'utf8')) as { cases: { id: string; expected: { parts: GoldenPart[] } }[] };
  const found = file.cases.find((c) => c.id === `example-pack-${wagon}`);
  if (found === undefined) throw new Error(`no golden example-pack-${wagon}`);
  const notDrawn = new Set(['HIDDEN', 'SKIPPED', 'UNTEXTURED']);
  const roles: Record<string, Omit<GoldenPart, 'object'>> = {};
  for (const { object, place, front, owner, index } of found.expected.parts) {
    const role = { place, front, owner, index };
    const first = roles[object];
    if (first === undefined || (notDrawn.has(first.place) && !notDrawn.has(role.place))) roles[object] = role;
  }
  return roles;
}

/** The engine's role of each object of the model the view shows. */
async function shownRoles(page: Page): Promise<Record<string, Omit<GoldenPart, 'object'>>> {
  return page.evaluate(() => {
    const model = (window as HookWindow).__rwatView?.view.model.value;
    if (!model) throw new Error('no model');
    return Object.fromEntries(model.objects.map((o) => [o.name, { place: o.engine.place, front: o.engine.front, owner: o.engine.owner, index: o.engine.index }]));
  });
}

test.use({ locale: 'en-US', viewport: { width: 1600, height: 1000 }, colorScheme: 'light' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as HookWindow).__RWAT_E2E__ = true;
  });
  await page.goto('./');
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-webgl', 'ok');
});

test('the coach from the pack: its roles are golden model_parts’, seen from the top and three quarters, and textured', async ({ page }) => {
  const errors = watchErrors(page);
  await openPack(page);
  await pickWagon(page, COACH);
  expect(await shownRoles(page)).toEqual(goldenRoles('coach'));
  await expect(page.getByTestId('objects')).toHaveAttribute('data-wagon', COACH);

  await camera(page, 'top');
  await shot(page, 'coach-roles-top');
  await camera(page, 'orbit');
  await shot(page, 'coach-roles-three-quarter');
  await display(page, 'textured');
  await shot(page, 'coach-textured');
  await camera(page, 'side');
  await shot(page, 'coach-textured-side');
  expect(errors).toEqual([]);
});

test('the coach in the preview: salon_door swings by its .anim, a coupled end switches its heads, the blue livery repaints it in place', async ({ page }) => {
  const errors = watchErrors(page);
  await openPack(page);
  await pickWagon(page, COACH);

  // salon_door open all the way: every piece its .anim moves stands at the track's last frame
  const tracks = parseAnim(readFileSync(join(EXAMPLE_PACK, 'assets/rwat_example/stock/coach/salon_door.anim'), 'utf8'));
  const open = framesAt(tracks, 1);
  const pieces = [...open.keys()];
  expect(pieces.length).toBeGreaterThan(0);
  const shut = await viewOf(page, pieces);
  await previewSection(page, 'doors');
  await page.locator('tr[data-door="salon_door"] input[type="range"]').fill('1');
  await expect.poll(async () => (await viewOf(page, pieces))[pieces[0]!]?.transform).not.toEqual(shut[pieces[0]!]?.transform);
  const moved = await viewOf(page, pieces);
  for (const piece of pieces) {
    const rows = Array.from(open.get(piece)!);
    // the .anim's frame is written row by row; the view takes it column by column
    const columns = [0, 1, 2, 3].flatMap((c) => [0, 1, 2, 3].map((r) => rows[r * 4 + c]!));
    const got = moved[piece]!.transform!;
    columns.forEach((value, i) => expect(Math.abs(got[i]! - value), `${piece} [${i}]`).toBeLessThan(1e-6));
  }
  await camera(page, 'side');
  await shot(page, 'coach-salon-door-open');

  // the front end coupled: its free head goes, its coupled head comes
  await previewSection(page, 'couplers');
  const heads = ['COUPLED_FRONT_2_HIDE', 'COUPLED_FRONT_3_HIDE_INVERT'];
  expect(Object.values(await viewOf(page, heads)).map((o) => o.hidden)).toEqual([false, true]);
  await page.locator('label[data-end="front"] input').check();
  await expect.poll(async () => Object.values(await viewOf(page, heads)).map((o) => o.hidden)).toEqual([true, false]);
  await camera(page, 'orbit');
  await shot(page, 'coach-front-coupled');

  // the blue livery: the body's band turns from green to blue; the camera and the selection stay
  await camera(page, 'side');
  await display(page, 'textured');
  const side: Vec3 = [-4.45, 1.4, 1.45];
  const [green] = await coloursAt(page, [side]);
  // an object selected in the objects tab stays selected
  await page.getByRole('tab', { name: 'Objects', exact: true }).click();
  await page.locator('tr[data-object="ROOF"] .objects-pick').click();
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-selected', 'ROOF');
  const before = await page.evaluate(() => (window as HookWindow).__rwatView?.pointOnPage([0, 2, 0]));
  await previewSection(page, 'liveries');
  await page.locator('label[data-livery="blue"] input').check();
  const body = 'assets/rwat_example/stock/coach/coach_body.png';
  await expect.poll(() => page.evaluate((path) => (window as HookWindow).__rwatView?.view.textures.has(path), body)).toBe(true);
  const [blue] = await coloursAt(page, [side]);
  expect(green![1]).toBeGreaterThan(green![2]); // green: more green than blue
  expect(blue![2]).toBeGreaterThan(blue![1]); // blue: more blue than green
  expect(await page.evaluate(() => (window as HookWindow).__rwatView?.pointOnPage([0, 2, 0]))).toEqual(before);
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-selected', 'ROOF');
  await shot(page, 'coach-livery-blue');
  expect(errors).toEqual([]);
});

test('the shunter: THROTTLE_1 at notch 8 turns the lever about its marker; FHL on lights its headlight in the light display', async ({ page }) => {
  const errors = watchErrors(page);
  await openPack(page);
  await pickWagon(page, SHUNTER);
  expect(await shownRoles(page)).toEqual(goldenRoles('shunter'));

  // the engine's hinge of THROTTLE_1 (model frame) taken into the OBJ frame the view draws in
  const hinge = await page.evaluate(() => {
    const control = (window as HookWindow).__rwatView?.view.model.value?.engine?.controls.find((c) => c.role.key === 'THROTTLE_1');
    return control === undefined || control.pivot === null ? null : { pivot: control.pivot, axis: control.axis, degrees: control.degrees };
  });
  if (hinge === null) throw new Error('THROTTLE_1 has no hinge');
  expect(hinge.degrees).toBe(-50); // THROTTLE_1_ROT_-50
  const pivot = toObj(...hinge.pivot);
  const axis: Vec3 = [-hinge.axis[2], hinge.axis[1], hinge.axis[0]];
  await previewSection(page, 'controls');
  await page.locator('tr[data-control="THROTTLE_1"] input[type="range"]').fill('8');
  await expect(page.locator('tr[data-control="THROTTLE_1"]')).toContainText('8');
  const knob = (await viewOf(page, ['THROTTLE_1_KNOB'])).THROTTLE_1_KNOB!.transform!;
  const apply = (m: number[], p: Vec3, w: number): Vec3 => [0, 1, 2].map((r) => m[r]! * p[0] + m[4 + r]! * p[1] + m[8 + r]! * p[2] + m[12 + r]! * w) as Vec3;
  // a turn about the marker's axis through its hinge: the hinge and the axis stay, by 50°
  apply(knob, pivot, 1).forEach((v, i) => expect(v).toBeCloseTo(pivot[i]!, 4));
  apply(knob, axis, 0).forEach((v, i) => expect(v).toBeCloseTo(axis[i]!, 4));
  const trace = knob[0]! + knob[5]! + knob[10]!;
  expect((Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2))) * 180) / Math.PI).toBeCloseTo(50, 3);
  await camera(page, 'side');
  await page.evaluate(() => (window as HookWindow).__rwatView?.view.requestFraming('all'));
  await shot(page, 'shunter-throttle-8');

  // FHL on: the lens's cover goes, the lens lights, the preview draws its beam
  const lens = 'HEADLIGHT_1_LCG_FHL_0XFFF2CC';
  const cover = 'WIDGET_7_CG_FHL_HIDE_NOTOUCH';
  await camera(page, 'front');
  await display(page, 'lit');
  const box = await page.evaluate((name) => (window as HookWindow).__rwatView?.view.model.value?.objects.find((o) => o.name === name)?.bbox ?? null, lens);
  if (box === null) throw new Error(`no ${lens}`);
  const face: Vec3 = [box[0][0] - 0.02, (box[0][1] + box[1][1]) / 2, (box[0][2] + box[1][2]) / 2];
  const [dark] = await coloursAt(page, [face]);
  await previewSection(page, 'lights');
  await page.locator('label[data-group="FHL"] input').check();
  await page.getByRole('button', { name: 'Show in the Light display' }).click();
  await expect.poll(async () => await viewOf(page, [lens, cover])).toEqual({ [lens]: { transform: null, hidden: false, lit: true }, [cover]: expect.objectContaining({ hidden: true }) as unknown });
  const [bright] = await coloursAt(page, [face]);
  expect(luminance(bright!)).toBeGreaterThan(luminance(dark!) + 90);
  const beams = await page.evaluate(() => (window as HookWindow).__rwatView?.view.overlays.get('preview.lights')?.map((s) => `${s.shape} ${s.style}`) ?? []);
  expect(beams).toContain('arrow preview.headlight');
  await shot(page, 'shunter-light-fhl-front');
  await camera(page, 'orbit');
  await shot(page, 'shunter-light-fhl');
  expect(errors).toEqual([]);
});

const MVP = join(REPO_ROOT, 'run', 'rwat_packs', 'MatoiVanillaPack');
const TEM2 = 'assets/mvp/stock/rolling_stock/locomotives/mvp_ir_tem2';
const mvpPresent = existsSync(join(MVP, TEM2, 'mvp_ir_tem2.obj'));
/** §3.11: the TEM2 of MVP is read in the worker within 3 s on a CI runner. */
const TEM2_BUDGET_MS = 3000;

/** The TEM2 of MVP alone as a pack: its declaration, type, folder (OBJ, MTL, textures, .anims, liveries), the shared texture its MTL names. */
async function tem2Zip(): Promise<Buffer> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  const files = ['pack.mcmeta', 'assets/mvp/wagon_models/tem2.json', 'data/mvp/wagon_types/tem2.json', 'assets/mvp/stock/rolling_stock/common/mvp_cargocouple.png', ...filesOf(join(MVP, TEM2)).map((name) => `${TEM2}/${name}`)];
  for (const name of files) await writer.add(name, new Uint8ArrayReader(readFileSync(join(MVP, name))));
  return Buffer.from(await writer.close());
}

test.describe('the TEM2 of MVP', () => {
  test.skip(!mvpPresent, 'skipped: MVP (run/rwat_packs/MatoiVanillaPack) is not in this checkout');

  test(`is read in the worker and shown within ${TEM2_BUDGET_MS} ms (§3.11)`, async ({ page }) => {
    const errors = watchErrors(page);
    await openPack(page, await tem2Zip(), 'tem2.zip');
    await page.evaluate(() => {
      const w = window as unknown as { __longTasks: number[] };
      w.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__longTasks.push(entry.duration);
      }).observe({ type: 'longtask' });
    });
    const started = Date.now();
    await pickWagon(page, 'mvp:tem2', 30_000);
    const ms = Date.now() - started;
    const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
    const objects = await page.evaluate(() => (window as HookWindow).__rwatView?.view.model.value?.objects.length ?? 0);
    test.info().annotations.push({ type: 'TEM2', description: `${ms} ms from the pick to the model shown, ${objects} objects; main thread's long tasks meanwhile: ${longTasks.map((d) => d.toFixed(0)).join(', ') || 'none'} ms` });
    console.info(`TEM2: ${ms} ms, ${objects} objects, long tasks ${JSON.stringify(longTasks.map((d) => Math.round(d)))}`);
    expect(objects).toBeGreaterThan(100);
    expect(ms).toBeLessThanOrEqual(TEM2_BUDGET_MS);
    await shot(page, 'tem2-roles');
    expect(errors).toEqual([]);
  });
});
