import { describe, expect, it } from 'vitest';
import { inLivery, liverySwaps } from './livery';
import { assetPath, baseTextures, exampleModel, exampleSubject } from './testing.node';

const obj = assetPath('stock/coach/coach.obj');

describe('a livery’s texture swaps', () => {
  it('swap each texture the livery’s folder has a file of the same name for (the example coach and shunter)', () => {
    expect([...exampleSubject('coach').liveries]).toEqual([
      [
        'blue',
        new Map([
          [assetPath('stock/coach/coach_body.png'), assetPath('stock/coach/l_blue/coach_body.png')],
          [assetPath('stock/coach/coach_door.png'), assetPath('stock/coach/l_blue/coach_door.png')],
        ]),
      ],
    ]);
    expect([...exampleSubject('shunter').liveries]).toEqual([
      ['green', new Map([[assetPath('stock/shunter/shunter_body.png'), assetPath('stock/shunter/l_green/shunter_body.png')]])],
    ]);
  });

  it('find a texture of a folder elsewhere by its file name too, and swap nothing for a folder that has none', () => {
    const files = new Set([assetPath('stock/coach/l_blue/coach_body.png'), assetPath('stock/coach/l_blue/steel.png')]);
    const swaps = liverySwaps(obj, { blue: 'l_blue', bare: 'l_none' }, baseTextures('coach'), (path) => files.has(path));
    expect(swaps.get('blue')?.get(assetPath('stock/common/steel.png'))).toBe(assetPath('stock/coach/l_blue/steel.png'));
    expect(swaps.get('bare')?.size).toBe(0);
  });

  it('follow ../ out of the OBJ’s folder but not out of the namespace, and take only paths Minecraft takes', () => {
    const base = [assetPath('stock/coach/coach_body.png')];
    const everything = (): boolean => true;
    expect(liverySwaps(obj, { up: '../liveries/up' }, base, everything).get('up')).toEqual(
      new Map([[base[0], assetPath('stock/liveries/up/coach_body.png')]]),
    );
    expect(liverySwaps(obj, { out: '../../../../x' }, base, everything).get('out')?.size).toBe(0);
    expect(liverySwaps(obj, { caps: 'L_Blue' }, base, everything).get('caps')?.size).toBe(0);
    expect(liverySwaps('pack.png', { any: 'l_blue' }, base, everything).get('any')?.size).toBe(0);
  });
});

describe('the model in a livery', () => {
  it('holds the livery’s pictures in the base textures’ places, the rest and the geometry as they are', () => {
    const model = exampleModel('coach');
    const body = assetPath('stock/coach/coach_body.png');
    const blue = assetPath('stock/coach/l_blue/coach_body.png');
    const shown = inLivery(model, new Map([[body, blue]]));
    expect(shown.textures[body]).toBe(model.textures[blue]);
    expect(shown.textures[assetPath('stock/coach/coach_roof.png')]).toBe(model.textures[assetPath('stock/coach/coach_roof.png')]);
    expect(shown.parts).toBe(model.parts);
    expect(model.textures[body]).not.toBe(model.textures[blue]);
  });

  it('is the model itself for no swaps, and a missing picture for a livery texture not decoded', () => {
    const model = exampleModel('coach');
    expect(inLivery(model, undefined)).toBe(model);
    expect(inLivery(model, new Map())).toBe(model);
    const body = assetPath('stock/coach/coach_body.png');
    expect(inLivery(model, new Map([[body, assetPath('stock/coach/l_red/coach_body.png')]])).textures[body]).toBeNull();
  });
});
