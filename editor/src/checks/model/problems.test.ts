import { afterEach, describe, expect, it } from 'vitest';
import { catalog, setLang } from '../../i18n';
import { placeholders } from '../../i18n/catalog';
import { MODEL_CODES, modelFinding, type ModelCode } from '../../ports/modelCheck';
import { problemMessage } from '../messages';
import { badDeclaration, failedModel, modelProblem, type CheckedModel } from './problems';

afterEach(() => {
  setLang('en');
});

const MODEL: CheckedModel = {
  id: 't:car',
  file: 'assets/t/wagon_models/car.json',
  declaration: { obj: 'car/car.obj', animations: { Door1: 'car/d.anim' }, liveries: { 'red/blue': 'red' } },
};

/** The params of each code's line (ports/modelCheck `modelFindingText`). */
const PARAMS: Record<ModelCode, string[]> = {
  'bad-path': ['path'],
  missing: ['path'],
  'bad-face-index': ['path', 'detail'],
  unreadable: ['path', 'error'],
  'no-faces': ['path'],
  'bad-library-path': ['path', 'library'],
  'missing-library': ['path', 'library'],
  'unreadable-library': ['path', 'library', 'error'],
  'bad-texture-path': ['path', 'material', 'texture'],
  'missing-texture': ['path', 'texture', 'material'],
  'draws-nothing': ['path'],
  'untextured-faces': ['path', 'materials'],
  'group-too-long': ['path', 'group', 'limit'],
  'bad-animation-path': ['door', 'path'],
  'missing-animation': ['door', 'path'],
  'unreadable-animation': ['door', 'path', 'error'],
  'livery-replaces-nothing': ['livery', 'folder'],
};

describe("the model check's findings in the checks", () => {
  it('has a line in both languages for every code, made of its params; a declaration and a worker that fail too', () => {
    const lines: [string, string[]][] = [
      ...(Object.keys(MODEL_CODES) as ModelCode[]).map((code): [string, string[]] => [code, PARAMS[code]]),
      ['bad-declaration', ['error']],
      ['failed', ['model', 'error']],
    ];
    for (const [code, params] of lines) {
      for (const lang of ['ru', 'en'] as const) {
        const line = catalog.get(lang, `problem.model.${code}`);
        expect(line, `${lang} ${code}`).toBeTypeOf('string');
        expect(placeholders(line!).sort(), `${lang} ${code}`).toEqual([...params].sort());
      }
    }
  });

  it('points each finding where it is fixed', () => {
    const at = (code: ModelCode, params: Record<string, string>, extra: Parameters<typeof modelFinding>[2] = {}): unknown =>
      modelProblem(modelFinding(code, params, extra), MODEL).at;
    const obj = { kind: 'file', file: 'assets/t/car/car.obj' };
    expect(at('bad-path', { path: 't:Car.obj' })).toEqual([{ kind: 'field', file: MODEL.file, at: '/obj' }]);
    expect(at('missing', { path: 't:car/car.obj' })).toEqual([{ kind: 'field', file: MODEL.file, at: '/obj' }]);
    expect(at('bad-face-index', { path: 't:car/car.obj', detail: 'x' })).toEqual([obj]);
    expect(at('missing-library', { path: 't:car/car.obj', library: 't:car/car.mtl' })).toEqual([obj]);
    expect(at('unreadable-library', { path: 't:car/car.obj', library: 't:car/car.mtl', error: 'x' })).toEqual([{ kind: 'file', file: 'assets/t/car/car.mtl' }]);
    expect(at('missing-texture', { path: 't:car/car.obj', texture: 't:tex/a.png', material: 'a' }, { library: 't:car/car.mtl' })).toEqual([
      { kind: 'file', file: 'assets/t/car/car.mtl' },
    ]);
    expect(at('group-too-long', { path: 't:car/car.obj', group: 'G' }, { objects: ['LAMP_LCG_G', 'WIDGET_1_CG_G'] })).toEqual([
      obj,
      { kind: 'object', model: 't:car', name: 'LAMP_LCG_G' },
      { kind: 'object', model: 't:car', name: 'WIDGET_1_CG_G' },
    ]);
    // the engine's animation key is lower case: the link finds the key as written
    expect(at('missing-animation', { door: 'door1', path: 't:car/d.anim' })).toEqual([{ kind: 'field', file: MODEL.file, at: '/animations/Door1' }]);
    expect(at('livery-replaces-nothing', { livery: 'red/blue', folder: 'red' })).toEqual([{ kind: 'field', file: MODEL.file, at: '/liveries/red~1blue' }]);
    expect(at('livery-replaces-nothing', { livery: 'gone', folder: 'red' })).toEqual([{ kind: 'field', file: MODEL.file, at: '/liveries' }]);
  });

  it('is a model finding with its code, translated from its params', () => {
    const problem = modelProblem(modelFinding('untextured-faces', { path: 't:car/car.obj', materials: 'glass, lens' }), MODEL);
    expect(problem).toMatchObject({
      severity: 'warning',
      source: 'model',
      code: 'model.untextured-faces',
      text: "model t:car/car.obj: faces with no texture (map_Kd) aren't drawn, material(s) glass, lens",
    });
    setLang('ru');
    expect(problemMessage(problem)).toBe('модель t:car/car.obj: грани без текстуры (map_Kd) не рисуются — материалы glass, lens');
    expect(problemMessage(badDeclaration(MODEL, "'obj' is empty"))).toBe("объявление модели не читается: 'obj' is empty");
    expect(problemMessage(failedModel(MODEL, new Error('worker gone')))).toBe('модель t:car не прочитана: worker gone');
  });
});
