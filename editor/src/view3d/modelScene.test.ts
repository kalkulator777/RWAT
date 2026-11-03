import { Color, Matrix4, Ray, Texture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ALPHA_CUTOUT, DEFAULT_LOOK, GHOST_OPACITY, ModelScene, textureOf } from './modelScene';
import { roleColorCss } from './roleColors';
import { boxModel, boxPart, exampleModel } from './testModel.node';

/** A ray straight down onto the point (x, z) from high above. */
function down(x: number, z: number): Ray {
  return new Ray(new Vector3(x, 50, z), new Vector3(0, -1, 0));
}

function colourOf(scene: ModelScene, name: string): string {
  return `#${scene.node(name)?.meshes[0]?.material.color.getHexString() ?? ''}`;
}

describe('the model scene of the example coach', () => {
  const coach = exampleModel('coach');

  it('groups the parts by object with the engine roles of golden model_parts', () => {
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
    expect([scene.isDrawn('CARGO_FILL_1'), scene.node('CARGO_FILL_1')?.group.visible]).toEqual([false, false]);
    scene.setLook({ ...DEFAULT_LOOK, hiddenRoles: new Set(['door_leaf']) });
    expect([scene.isDrawn('DOOR_1_LEAF'), scene.isDrawn('BODY'), scene.isDrawn('CARGO_FILL_1')]).toEqual([false, true, true]);
    expect(scene.pick(down(3.5, 0))).toBeNull();
    scene.setLook({ ...DEFAULT_LOOK, wireframe: true });
    expect(scene.node('BODY')?.meshes[0]?.material.wireframe).toBe(true);
  });

  it('textures a part by its own texture, else by its material name, and draws one without in grey', () => {
    const image = { width: 1, height: 1 } as unknown as ImageBitmap;
    const parts = [boxPart('A', [0, 0, 0], [1, 1, 1], 'paint', 'tex/a.png'), boxPart('B', [2, 0, 0], [3, 1, 1], 'tex/b.png'), boxPart('C', [4, 0, 0], [5, 1, 1], 'none')];
    // B and C as the contract gives them, without a texture of their own
    const bare = (part: (typeof parts)[number]) => ({ object: part.object, material: part.material, positions: part.positions, normals: part.normals, uvs: part.uvs });
    const textured = { ...model, parts: [parts[0] as (typeof parts)[number], bare(parts[1] as (typeof parts)[number]), bare(parts[2] as (typeof parts)[number])], textures: { 'tex/a.png': image, 'tex/b.png': image } };
    expect(textured.parts.map((part) => textureOf(textured, part))).toEqual(['tex/a.png', 'tex/b.png', null]);
    const scene = new ModelScene({ ...textured, objects: [] });
    expect(scene.node('A')?.meshes[0]?.material.map).toBeNull();
    scene.setLook({ ...DEFAULT_LOOK, display: 'textured' });
    const a = scene.node('A')?.meshes[0]?.material;
    expect(a?.map).toBeInstanceOf(Texture);
    expect(a?.alphaTest).toBe(ALPHA_CUTOUT);
    expect(a?.map).not.toBe(scene.node('B')?.meshes[0]?.material.map);
    expect(scene.node('C')?.meshes[0]?.material.map).toBeNull();
    expect(colourOf(scene, 'C')).toBe('#808080');
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
