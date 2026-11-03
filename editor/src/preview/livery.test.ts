import { describe, expect, it } from 'vitest';
import { inLivery, undecoded } from './livery';
import { assetPath, exampleModel, fakeBitmap } from './testing.node';

const body = assetPath('stock/coach/coach_body.png');
const door = assetPath('stock/coach/coach_door.png');
const roof = assetPath('stock/coach/coach_roof.png');
const blueBody = assetPath('stock/coach/l_blue/coach_body.png');
const blueDoor = assetPath('stock/coach/l_blue/coach_door.png');

describe('the model in a livery', () => {
  it('has the coach’s blue livery swap its body and door textures, whose pictures are still to decode', async () => {
    const model = await exampleModel('coach');
    expect(model.liveries).toEqual({ blue: { [body]: blueBody, [door]: blueDoor } });
    expect(undecoded(model, model.liveries.blue!, new Map())).toEqual([blueBody, blueDoor]);
    expect(undecoded(model, model.liveries.blue!, new Map([[blueBody, null]]))).toEqual([blueDoor]);
    expect(undecoded(model, { [body]: roof }, new Map())).toEqual([]); // the model has that one
  });

  it('holds the livery’s pictures in the base textures’ places, the rest and the geometry as they are', async () => {
    const model = await exampleModel('coach');
    const decoded = new Map([[blueBody, fakeBitmap(blueBody)]]);
    const shown = inLivery(model, model.liveries.blue, decoded);
    expect(shown.textures[body]).toBe(decoded.get(blueBody));
    expect(shown.textures[door]).toBeNull(); // not decoded: drawn as missing
    expect(shown.textures[roof]).toBe(model.textures[roof]);
    expect(shown.parts).toBe(model.parts);
    expect(shown.engine).toBe(model.engine);
    expect(model.textures[body]).not.toBe(decoded.get(blueBody));
  });

  it('is the model itself for no swaps', async () => {
    const model = await exampleModel('coach');
    expect(inLivery(model, undefined)).toBe(model);
    expect(inLivery(model, {})).toBe(model);
  });
});
