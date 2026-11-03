/**
 * The 3D view in the built site (docs/proposals/editor.md §3.8, M3): WebGL 2 works in the
 * test browser (SwiftShader without a GPU); the example pack's coach in the "Roles"
 * display from the top and from three quarters, each leaving a screenshot in the test's
 * output and showing the colours of the roles the engine gives its parts; a click selects
 * the object under the pointer in the shell's one selection, Shift adds another; the
 * textured display and the shunter with a light group lit leave screenshots too. axe finds
 * nothing serious or critical with a model shown.
 *
 * Until the model worker is wired in (A3.1), the model is built in Node by the ports, as
 * the worker builds it (src/view3d/testModel.node.ts), and handed to the page through the
 * test hook the page exposes when asked before it starts (src/view3d/testHook.ts).
 * Reference screenshots to compare against are CI's (§5.2): these are not compared.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { loadWagonType } from '../../src/ports/wagonType';
import { EXAMPLE_PACK } from '../../src/testing/repo.node';
import { wagonFrame, type WagonFrame } from '../../src/view3d/frame';
import { roleColor, VIEW_BACKGROUND } from '../../src/view3d/roleColors';
import type { ViewTestHook } from '../../src/view3d/testHook';
import { exampleFile, exampleModel, type ExampleWagon } from '../../src/view3d/testModel.node';

type HookWindow = { __RWAT_E2E__?: boolean; __rwatView?: ViewTestHook | null };

interface SerializedModel {
  id: string;
  objects: unknown[];
  parts: { object: string; material: string; texture: string | null; positions: number[]; normals: number[]; uvs: number[] }[];
  /** PNG bytes in base64 by pack path. */
  textures: Record<string, string>;
}

function serialized(id: ExampleWagon): SerializedModel {
  const model = exampleModel(id);
  return {
    id: model.id,
    objects: model.objects,
    parts: model.parts.map((part) => ({
      object: part.object,
      material: part.material,
      texture: part.texture,
      positions: Array.from(part.positions),
      normals: Array.from(part.normals),
      uvs: Array.from(part.uvs),
    })),
    textures: Object.fromEntries(Object.keys(model.textures).map((path) => [path, exampleFile(path).toString('base64')])),
  };
}

function frameOf(id: ExampleWagon): WagonFrame {
  const json: unknown = JSON.parse(readFileSync(join(EXAMPLE_PACK, 'data', 'rwat_example', 'wagon_types', `${id}.json`), 'utf8'));
  const { type } = loadWagonType(`rwat_example:${id}`, json);
  if (type === null) throw new Error(`${id} does not load`);
  return wagonFrame(type);
}

/** Hands the model to the page's view, its textures decoded there as the worker decodes them (flipped upright). */
async function show(page: Page, id: ExampleWagon): Promise<void> {
  await page.evaluate(
    async ({ data, frame }) => {
      const hook = (window as HookWindow).__rwatView;
      if (!hook) throw new Error('no view hook');
      const textures: Record<string, ImageBitmap | null> = {};
      for (const [path, base64] of Object.entries(data.textures)) {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        textures[path] = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { imageOrientation: 'flipY' });
      }
      const parts = data.parts.map((part) => ({
        ...part,
        positions: new Float32Array(part.positions),
        normals: new Float32Array(part.normals),
        uvs: new Float32Array(part.uvs),
      }));
      hook.setFrame(frame);
      hook.view.show({ id: data.id, parts, objects: data.objects as never, textures, problems: [] });
    },
    { data: serialized(id), frame: frameOf(id) },
  );
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-model', `rwat_example:${id}`);
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

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
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
