import { describe, expect, it } from 'vitest';
import { liveryTextures, undecoded } from './livery';
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

  it('draws the base textures the livery swaps with its pictures, one not decoded as missing, and nothing else', async () => {
    const model = await exampleModel('coach');
    const decoded = new Map([[blueBody, fakeBitmap(blueBody)]]);
    expect(liveryTextures(model, undefined, model.liveries.blue, decoded)).toEqual([
      [body, decoded.get(blueBody)],
      [door, null],
    ]);
    // a swap to a texture of the model's own takes the model's picture
    expect(liveryTextures(model, undefined, { [body]: roof })).toEqual([[body, model.textures[roof]]]);
  });

  it('puts the model’s own pictures back when the livery goes, and swaps one livery for another', async () => {
    const model = await exampleModel('coach');
    expect(liveryTextures(model, model.liveries.blue, undefined)).toEqual([
      [body, model.textures[body]],
      [door, model.textures[door]],
    ]);
    expect(liveryTextures(model, model.liveries.blue, { [body]: roof })).toEqual([
      [body, model.textures[roof]],
      [door, model.textures[door]],
    ]);
    expect(liveryTextures(model, undefined, undefined)).toEqual([]);
  });
});
