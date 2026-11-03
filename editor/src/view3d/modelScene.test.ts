import { Color, Matrix4, Ray, Texture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ALPHA_CUTOUT, DEFAULT_LOOK, GHOST_OPACITY, ModelScene } from './modelScene';
import { roleColorCss } from './roleColors';
import { boxModel, boxObject, boxPart, exampleModel } from './testModel.node';

/** A ray straight down onto the point (x, z) from high above. */
function down(x: number, z: number): Ray {
  return new Ray(new Vector3(x, 50, z), new Vector3(0, -1, 0));
}

function colourOf(scene: ModelScene, name: string): string {
  return `#${scene.node(name)?.meshes[0]?.material.color.getHexString() ?? ''}`;
}

const coach = await exampleModel('coach');

describe('the model scene of the example coach', () => {
  it('groups the parts by object with the engine roles the model worker reads (golden model_parts)', () => {
    const scene = new ModelScene(coach);
    expect(scene.objectNames()).toEqual(coach.objects.map((o) => o.name));
    expect(scene.node('ROOF')?.role).toBe('body');
    expect(scene.node('BOGEY_FRONT')?.role).toBe('bogie_front');
    expect(scene.node('BOGEY_REAR_WHEEL_1')?.role).toBe('wheelset');
    expect(scene.node('DOOR_1_TL_0.95_X')?.role).toBe('door_leaf');
    expect(scene.node('SALON_DOOR_KNOB')?.role).toBe('anim_object');
    expect(scene.node('GUIDE_FLOOR_0')?.ghost).toBe(true);
    expect(coach.objects.find((o) => o.name === 'INTERIOR_SEATS_LCG_IL')?.lightGroup).toBe('IL');
  });

  it('picks the roof from above, then the floor when the roof is hidden, never a ghost', () => {
    const scene = new ModelScene(coach);
    const roof = scene.pick(down(0, 0));
    expect(roof?.object).toBe('ROOF');
    expect(roof?.point[1]).toBeCloseTo(scene.bounds(['ROOF']).max.y, 1);
    scene.setVisible('ROOF', false);
    expect(scene.pick(down(0, 0))?.object).not.toBe('ROOF');
    scene.setLook({ ...DEFAULT_LOOK, hiddenRoles: new Set(['body', 'interior', 'anim_object']) });
    // the guide floors (skip: ghosts) lie under the roof; they are never picked
    const below = scene.pick(down(-5, 0));
    expect(below === null || !scene.node(below.object)?.ghost).toBe(true);
  });

  it('frames the whole coach, and the bounds follow what is drawn', () => {
    const scene = new ModelScene(coach);
    const all = scene.bounds();
    expect(all.max.x - all.min.x).toBeGreaterThan(19);
    expect(all.min.y).toBeLessThan(0);
    const door = scene.bounds(['DOOR_1_TL_0.95_X']);
    expect(door.max.x - door.min.x).toBeLessThan(1.5);
    scene.setVisible('DOOR_1_TL_0.95_X', false);
    expect(scene.bounds(['DOOR_1_TL_0.95_X']).isEmpty()).toBe(true);
  });
});

describe('a model scene', () => {
  const model = boxModel('m', [
    ['BODY', 'body', [-2, 0, -1], [2, 2, 1]],
    ['DOOR_1_LEAF', 'door_leaf', [3, 0, -1], [4, 2, 1]],
    ['CARGO_FILL_1', 'skip', [5, 0, -1], [6, 2, 1]],
  ]);

  it('moves an object by its transform, column-major, and back to rest with null', () => {
    const scene = new ModelScene(model);
    expect(scene.pick(down(3.5, 0))?.object).toBe('DOOR_1_LEAF');
    const slide = new Matrix4().makeTranslation(0, 0, 3);
    scene.setTransform('DOOR_1_LEAF', new Float32Array(slide.elements));
    expect(scene.pick(down(3.5, 0))).toBeNull();
    const hit = scene.pick(down(3.5, 3));
    expect(hit?.object).toBe('DOOR_1_LEAF');
    expect(hit?.point).toEqual([3.5, 2, 3]);
    expect(scene.bounds(['DOOR_1_LEAF']).min.z).toBeCloseTo(2, 6);
    scene.setTransform('DOOR_1_LEAF', null);
    expect(scene.pick(down(3.5, 0))?.object).toBe('DOOR_1_LEAF');
    scene.setTransform('NO_SUCH', null);
  });

  it('paints by role, ghosts see-through and hidden as a whole or by role', () => {
    const scene = new ModelScene(model);
    expect(colourOf(scene, 'BODY')).toBe(roleColorCss('body'));
    expect(colourOf(scene, 'DOOR_1_LEAF')).toBe(roleColorCss('door_leaf'));
    const ghost = scene.node('CARGO_FILL_1')?.meshes[0]?.material;
    expect([ghost?.transparent, ghost?.opacity, ghost?.depthWrite]).toEqual([true, GHOST_OPACITY, false]);
    expect(scene.isDrawn('CARGO_FILL_1')).toBe(true);
    scene.setLook({ ...DEFAULT_LOOK, ghosts: false });
    expect([scene.isDrawn('CARGO_FILL_1'), scene.node('CARGO_FILL_1')?.meshes[0]?.visible]).toEqual([false, false]);
    scene.setLook({ ...DEFAULT_LOOK, hiddenRoles: new Set(['door_leaf']) });
    expect([scene.isDrawn('DOOR_1_LEAF'), scene.isDrawn('BODY'), scene.isDrawn('CARGO_FILL_1')]).toEqual([false, true, true]);
    expect(scene.pick(down(3.5, 0))).toBeNull();
    scene.setLook({ ...DEFAULT_LOOK, wireframe: true });
    expect(scene.node('BODY')?.meshes[0]?.material.wireframe).toBe(true);
  });

  it('textures a part by its texture, one texture for the parts that share it, and draws one without, or missing, in grey', () => {
    const image = { width: 1, height: 1 } as unknown as ImageBitmap;
    const parts = [
      boxPart('A', [0, 0, 0], [1, 1, 1], { material: 'paint', texture: 'tex/a.png' }),
      boxPart('B', [2, 0, 0], [3, 1, 1], { material: 'paint', texture: 'tex/a.png' }),
      boxPart('C', [4, 0, 0], [5, 1, 1], { material: 'none' }),
      boxPart('D', [6, 0, 0], [7, 1, 1], { material: 'gone', texture: 'tex/gone.png' }),
    ];
    const scene = new ModelScene({ ...model, parts, objects: [], textures: { 'tex/a.png': image, 'tex/gone.png': null } });
    expect(scene.node('A')?.meshes[0]?.material.map).toBeNull();
    scene.setLook({ ...DEFAULT_LOOK, display: 'textured' });
    const a = scene.node('A')?.meshes[0]?.material;
    expect(a?.map).toBeInstanceOf(Texture);
    expect(a?.map?.image).toBe(image);
    expect(a?.alphaTest).toBe(ALPHA_CUTOUT);
    expect(a?.map).toBe(scene.node('B')?.meshes[0]?.material.map);
    expect(scene.node('C')?.meshes[0]?.material.map).toBeNull();
    expect(colourOf(scene, 'C')).toBe('#808080');
    expect(colourOf(scene, 'D')).toBe('#808080');
  });

  it('draws a texture with another picture when told, and back, the other textures as they were', () => {
    const base = { width: 1, height: 1, name: 'base' } as unknown as ImageBitmap;
    const blue = { width: 1, height: 1, name: 'blue' } as unknown as ImageBitmap;
    const other = { width: 1, height: 1, name: 'other' } as unknown as ImageBitmap;
    const parts = [boxPart('A', [0, 0, 0], [1, 1, 1], { texture: 'tex/body.png' }), boxPart('B', [2, 0, 0], [3, 1, 1], { material: 'n', texture: 'tex/roof.png' })];
    const scene = new ModelScene({ ...model, parts, objects: [], textures: { 'tex/body.png': base, 'tex/roof.png': other } });
    scene.setLook({ ...DEFAULT_LOOK, display: 'textured' });
    scene.setTexture('tex/body.png', blue);
    expect(scene.node('A')?.meshes[0]?.material.map?.image).toBe(blue);
    expect(scene.node('B')?.meshes[0]?.material.map?.image).toBe(other);
    scene.setTexture('tex/body.png', null);
    expect(scene.node('A')?.meshes[0]?.material.map).toBeNull();
    expect(colourOf(scene, 'A')).toBe('#808080');
    scene.setTexture('tex/body.png', base);
    expect(scene.node('A')?.meshes[0]?.material.map?.image).toBe(base);
    scene.setTexture('tex/nobody-uses.png', blue);
    expect(scene.texture('tex/nobody-uses.png')).toBeUndefined();
    // the first pictures may come from elsewhere than the model: what the view was told before
    const told = new ModelScene({ ...model, parts, objects: [], textures: { 'tex/body.png': base, 'tex/roof.png': other } }, (path) => (path === 'tex/body.png' ? blue : null));
    expect(told.texture('tex/body.png')?.image).toBe(blue);
    expect(told.texture('tex/roof.png')).toBeNull();
  });

  it('ghosts the parts the engine does not draw, part by part: an object half drawn is picked by its drawn half', () => {
    const drawn = boxPart('HALF', [0, 0, 0], [1, 1, 1], { role: 'body' });
    const bare = boxPart('HALF', [3, 0, 0], [4, 1, 1], { material: 'bare', role: 'untextured' });
    const scene = new ModelScene({ ...model, parts: [drawn, bare], objects: [boxObject(drawn, [0, 0, 0], [4, 1, 1])] });
    const node = scene.node('HALF')!;
    expect(node.ghost).toBe(false);
    expect(node.parts.map((part) => [part.role, part.ghost])).toEqual([
      ['body', false],
      ['untextured', true],
    ]);
    expect([node.meshes[0]?.material.transparent, node.meshes[1]?.material.opacity]).toEqual([false, GHOST_OPACITY]);
    expect(colourOf(scene, 'HALF')).toBe(roleColorCss('body'));
    expect(scene.pick(down(0.5, 0.5))?.object).toBe('HALF');
    expect(scene.pick(down(3.5, 0.5))).toBeNull();
    scene.setLook({ ...DEFAULT_LOOK, ghosts: false });
    expect([node.meshes[0]?.visible, node.meshes[1]?.visible, scene.isDrawn('HALF')]).toEqual([true, false, true]);
    expect(scene.bounds(['HALF']).max.x).toBe(1);
    scene.setLook({ ...DEFAULT_LOOK, hiddenRoles: new Set(['body']) });
    expect([node.meshes[0]?.visible, node.meshes[1]?.visible]).toEqual([false, true]);
  });

  it('lights the lit objects in the lit display only, and tints and boxes the highlight', () => {
    const scene = new ModelScene(model);
    scene.setLit('BODY', true);
    const body = scene.node('BODY')?.meshes[0]?.material;
    expect(body?.emissive.getHex()).toBe(0x000000);
    scene.setLook({ ...DEFAULT_LOOK, display: 'lit' });
    expect(body?.emissive.getHex()).not.toBe(0x000000);
    scene.setLit('BODY', false);
    expect(body?.emissive.getHex()).toBe(0x000000);
    scene.setHighlight('DOOR_1_LEAF', new Set(['BODY']));
    expect(scene.node('BODY')?.outline.visible).toBe(true);
    expect(scene.node('DOOR_1_LEAF')?.outline.visible).toBe(false);
    expect(scene.node('DOOR_1_LEAF')?.meshes[0]?.material.emissive.equals(new Color(0x000000))).toBe(false);
    scene.setHighlight(null, new Set());
    expect(scene.node('BODY')?.outline.visible).toBe(false);
    expect(scene.node('DOOR_1_LEAF')?.meshes[0]?.material.emissive.getHex()).toBe(0x000000);
    scene.dispose();
    expect(scene.root.children).toHaveLength(0);
  });
});
