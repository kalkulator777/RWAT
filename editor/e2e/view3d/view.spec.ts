/**
 * The 3D view in the built site (docs/proposals/editor.md §3.8, M3): WebGL 2 works in the
 * test browser (SwiftShader without a GPU); the example pack's coach in the "Roles"
 * display from the top and from three quarters, each leaving a screenshot in the test's
 * output and showing the colours of the roles the engine gives its parts; a click selects
 * the object under the pointer in the shell's one selection, Shift adds another; the
 * textured display and the shunter with a light group lit leave screenshots too. axe finds
 * nothing serious or critical with a model shown.
 *
 * The model comes as it comes to a user: the example pack opened as a zip, the wagon
 * picked in the tree, its model read by the model worker (e2e/examplePack.ts). The test
 * hook the page exposes when asked before it starts (src/view3d/testHook.ts) draws on
 * demand and says where an object is on the page. Reference screenshots to compare against
 * are CI's (§5.2): these are not compared.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { roleColor, VIEW_BACKGROUND } from '../../src/view3d/roleColors';
import type { ViewTestHook } from '../../src/view3d/testHook';
import { openPack, pickWagon, watchErrors } from '../examplePack';

type HookWindow = { __RWAT_E2E__?: boolean; __rwatView?: ViewTestHook | null };

type ExampleWagon = 'coach' | 'shunter' | 'gondola';

/** Opens the example pack (once a page) and picks the wagon: the worker reads its model, the view shows it. */
async function show(page: Page, id: ExampleWagon): Promise<void> {
  if ((await page.getByTestId('pack-status').count()) === 0) await openPack(page);
  await pickWagon(page, `rwat_example:${id}`);
}

/**
 * Draws now and counts the drawing's pixels by the role colour they show: a pixel is a
 * role's when it is that colour shaded (a share 0.6…1.1 of it, the light of the "Roles"
 * display) within a small error; `background` counts the view's background.
 */
async function roleCounts(page: Page, roles: Record<string, number>, background: number): Promise<Record<string, number>> {
  return page.evaluate(
    async ({ roles, background }) => {
      const hook = (window as HookWindow).__rwatView;
      const canvas = document.querySelector<HTMLCanvasElement>('.view3d-gl');
      if (!hook || !canvas) throw new Error('no view');
      hook.renderNow();
      // read in the same task as the drawing: the canvas keeps no copy of it
      const url = canvas.toDataURL('image/png');
      const image = new Image();
      image.src = url;
      await image.decode();
      const copy = document.createElement('canvas');
      copy.width = image.width;
      copy.height = image.height;
      const context = copy.getContext('2d');
      if (!context) throw new Error('no 2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
      const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const;
      const colours = Object.entries(roles).map(([name, c]) => [name, rgb(c)] as const);
      const bg = rgb(background);
      const counts: Record<string, number> = { background: 0 };
      for (const [name] of colours) counts[name] = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const p = [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0] as const;
        if (Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]) < 4) {
          counts.background = (counts.background ?? 0) + 1;
          continue;
        }
        let best: string | null = null;
        let bestError = 14;
        for (const [name, c] of colours) {
          const k = (p[0] * c[0] + p[1] * c[1] + p[2] * c[2]) / Math.max(1, c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
          if (k < 0.6 || k > 1.1) continue;
          const error = Math.hypot(p[0] - k * c[0], p[1] - k * c[1], p[2] - k * c[2]);
          if (error < bestError) {
            bestError = error;
            best = name;
          }
        }
        if (best !== null) counts[best] = (counts[best] ?? 0) + 1;
      }
      return counts;
    },
    { roles, background },
  );
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (window as HookWindow).__rwatView?.renderNow());
  const path = test.info().outputPath(`${name}.png`);
  await page.getByTestId('view3d').screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

const DRAWN_ROLES = ['body', 'interior', 'bogie_front', 'bogie_rear', 'wheelset', 'door_leaf', 'anim_object', 'control', 'coupler_head'];
const ROLES = Object.fromEntries(DRAWN_ROLES.map((role) => [role, roleColor(role)]));

test.use({ locale: 'en-US', viewport: { width: 1600, height: 1000 }, colorScheme: 'light' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as HookWindow).__RWAT_E2E__ = true;
  });
  await page.goto('./');
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-webgl', 'ok');
});

test('the coach in the roles display, from the top and from three quarters', async ({ page }) => {
  const errors = watchErrors(page);
  await show(page, 'coach');
  const view = page.getByTestId('view3d');

  await view.locator('[data-toggle="camera"] [data-value="top"]').click();
  await expect(view).toHaveAttribute('data-camera', 'top');
  const top = await roleCounts(page, ROLES, VIEW_BACKGROUND.light);
  await screenshot(page, 'coach-roles-top');
  // from the top the roof (body) is nearly all of the car, and the car lies in the background
  const car = Object.entries(top).filter(([name]) => name !== 'background').reduce((sum, [, n]) => sum + n, 0);
  expect(top.body).toBeGreaterThan(car * 0.8);
  expect(top.background).toBeGreaterThan(car);

  await view.locator('[data-toggle="camera"] [data-value="orbit"]').click();
  await expect(view).toHaveAttribute('data-camera', 'orbit');
  const quarter = await roleCounts(page, ROLES, VIEW_BACKGROUND.light);
  await screenshot(page, 'coach-roles-three-quarter');
  // from three quarters front left: the side doors, both bogies and their wheelsets show
  for (const role of ['body', 'door_leaf', 'bogie_front', 'bogie_rear', 'wheelset', 'coupler_head']) {
    expect([role, (quarter[role] ?? 0) > 50]).toEqual([role, true]);
  }
  expect(errors).toEqual([]);
});

test('a click selects the object under the pointer, Shift adds another', async ({ page }) => {
  const errors = watchErrors(page);
  await show(page, 'coach');
  const view = page.getByTestId('view3d');
  await view.locator('[data-toggle="camera"] [data-value="top"]').click();
  const roof = await page.evaluate(() => (window as HookWindow).__rwatView?.screenOf('ROOF'));
  if (!roof) throw new Error('the roof is not drawn');

  await page.mouse.move(roof.x, roof.y);
  await expect(page.getByTestId('view3d-status')).toHaveAttribute('data-hover', 'ROOF');
  await expect(page.getByTestId('view3d-status')).toContainText('ROOF · body');
  await page.mouse.click(roof.x, roof.y);
  await expect(view).toHaveAttribute('data-selected', 'ROOF');
  await expect(page.locator('#view3d-description')).toContainText('Selected: ROOF.');
  await screenshot(page, 'coach-roof-selected');

  await view.locator('[data-toggle="camera"] [data-value="orbit"]').click();
  const door = await page.evaluate(() => (window as HookWindow).__rwatView?.screenOf('DOOR_1_TL_0.95_X'));
  if (!door) throw new Error('the door is not drawn');
  await page.keyboard.down('Shift');
  await page.mouse.click(door.x, door.y);
  await page.keyboard.up('Shift');
  await expect(view).toHaveAttribute('data-selected', 'ROOF,DOOR_1_TL_0.95_X');

  // a click on nothing keeps the selection: it also says which wagon is open
  const box = await page.locator('.view3d-gl').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + 4, box.y + 4);
  await expect(view).toHaveAttribute('data-selected', 'ROOF,DOOR_1_TL_0.95_X');

  // the keys of the view: 7 top, Home frames everything
  await page.locator('.view3d-canvas').focus();
  await page.keyboard.press('7');
  await expect(view).toHaveAttribute('data-camera', 'top');
  await page.keyboard.press('1');
  await expect(view).toHaveAttribute('data-camera', 'side');
  expect(errors).toEqual([]);
});

/** Draws now and reads the drawing's colour at each point of the OBJ frame, as `[r, g, b]`. */
async function coloursAt(page: Page, points: readonly [number, number, number][]): Promise<[number, number, number][]> {
  return page.evaluate(async (points) => {
    const hook = (window as HookWindow).__rwatView;
    const canvas = document.querySelector<HTMLCanvasElement>('.view3d-gl');
    if (!hook || !canvas) throw new Error('no view');
    hook.renderNow();
    const url = canvas.toDataURL('image/png');
    const image = new Image();
    image.src = url;
    await image.decode();
    const copy = document.createElement('canvas');
    copy.width = image.width;
    copy.height = image.height;
    const context = copy.getContext('2d');
    if (!context) throw new Error('no 2d');
    context.drawImage(image, 0, 0);
    const rect = canvas.getBoundingClientRect();
    return points.map((point) => {
      const at = hook.pointOnPage(point);
      const x = Math.round(((at.x - rect.left) / rect.width) * image.width);
      const y = Math.round(((at.y - rect.top) / rect.height) * image.height);
      const pixel = context.getImageData(x, y, 1, 1).data;
      return [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0] as [number, number, number];
    });
  }, points);
}

/** The name of the colour a pixel is, lit by any share 0.4…1.3 of white: the nearest after the best share. */
function nearest(pixel: readonly number[], colours: Readonly<Record<string, number>>): string {
  let best = '';
  let bestError = Infinity;
  for (const [name, c] of Object.entries(colours)) {
    const rgb = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const k = Math.min(1.3, Math.max(0.4, (pixel[0]! * rgb[0]! + pixel[1]! * rgb[1]! + pixel[2]! * rgb[2]!) / Math.max(1, rgb[0]! ** 2 + rgb[1]! ** 2 + rgb[2]! ** 2)));
    const error = Math.hypot(pixel[0]! - k * rgb[0]!, pixel[1]! - k * rgb[1]!, pixel[2]! - k * rgb[2]!);
    if (error < bestError) {
      bestError = error;
      best = name;
    }
  }
  return best;
}

test('the textures stand as their files are drawn: the coach’s cream band under its windows, its dark sill at the bottom', async ({ page }) => {
  const errors = watchErrors(page);
  await show(page, 'coach');
  const view = page.getByTestId('view3d');
  await view.locator('[data-toggle="camera"] [data-value="side"]').click();
  await view.locator('[data-toggle="display"] [data-value="textured"]').click();
  await expect(view).toHaveAttribute('data-display', 'textured');
  // coach_body.png (tools/gen_example_pack.py tex_bands), mapped onto the side from y 0.95 to
  // 3.60 by the OBJ's V, up from the picture's bottom: the dark sill at v 0…0.03, the cream
  // band at v 0.33…0.40 (y 1.82…2.01, under the windows at 2.15…3.05), green the rest. Upside
  // down the band would cross the windows at y 2.54…2.73 and the green go under them.
  const band = { sill: 0x1c2a20, cream: 0xe8ddb5, green: 0x2e6b3a };
  const x = -4.45; // between two windows
  const side = 1.45; // the left side's outer face, which the side view (from +Z) looks at
  const [sill, cream, below, between] = await coloursAt(page, [
    [x, 0.98, side],
    [x, 1.92, side],
    [x, 1.4, side],
    [x, 2.62, side],
  ]);
  expect([sill, cream, below, between].map((pixel) => nearest(pixel!, band))).toEqual(['sill', 'cream', 'green', 'green']);
  await screenshot(page, 'coach-textured-side');
  expect(errors).toEqual([]);
});

test('the textured display, the shunter with its headlight group lit, and axe with a model shown', async ({ page }) => {
  const errors = watchErrors(page);
  await show(page, 'coach');
  const view = page.getByTestId('view3d');
  await view.locator('[data-toggle="display"] [data-value="textured"]').click();
  await expect(view).toHaveAttribute('data-display', 'textured');
  const textured = await roleCounts(page, ROLES, VIEW_BACKGROUND.light);
  await screenshot(page, 'coach-textured');
  expect(textured.background).toBeGreaterThan(0);

  await show(page, 'shunter');
  await page.evaluate(() => {
    const hook = (window as HookWindow).__rwatView;
    const model = hook?.view.model.value;
    if (!hook || !model) throw new Error('no model');
    hook.view.setDisplay('lit');
    for (const object of model.objects) if (object.lightGroup !== undefined) hook.view.setLit(object.name, true);
  });
  await expect(view).toHaveAttribute('data-display', 'lit');
  await screenshot(page, 'shunter-lit');

  const serious = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(errors).toEqual([]);
});
