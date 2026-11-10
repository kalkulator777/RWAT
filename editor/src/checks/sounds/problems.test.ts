import { afterEach, describe, expect, it } from 'vitest';
import { dump } from '../../core/json';
import { Pack } from '../../core/pack';
import { filesOf, MemorySource, readTree } from '../../core/pack/testing.node';
import { catalog, lang, setLang } from '../../i18n';
import { EXAMPLE_PACK } from '../../testing/repo.node';
import { problemMessage } from '../messages';
import { checkPack } from '../pack';
import { controlVerdicts, soundProblems } from './problems';

const MCMETA = dump({ pack: { pack_format: 34, description: 'x' }, rwat: { format: 1 } });
const TYPE = 'data/ns/wagon_types/coach.json';
const MODEL = 'assets/ns/wagon_models/coach.json';

afterEach(() => {
  setLang('en');
});

async function packWith(sounds: unknown, extra: Record<string, string | Uint8Array> = {}): Promise<Pack> {
  return Pack.open(
    new MemorySource(
      filesOf({
        'pack.mcmeta': MCMETA,
        [TYPE]: dump({ length: 10, bogies: [2, -2], mass_t: 40 }),
        [MODEL]: dump({ obj: 'stock/coach/coach.obj', sounds }),
        'assets/ns/stock/coach/coach.obj': '',
        ...extra,
      }),
    ),
  );
}

/** The codes of the findings and the pointers of their fields. */
async function found(sounds: unknown, extra?: Record<string, string | Uint8Array>): Promise<[string, string][]> {
  return soundProblems(await packWith(sounds, extra)).map((p) => [p.code, (p.at[0] as { at: string }).at]);
}

describe('the findings about a model’s sounds', () => {
  it('find nothing in the example pack', async () => {
    const pack = await Pack.open(new MemorySource(readTree(EXAMPLE_PACK)));
    expect(soundProblems(pack)).toEqual([]);
  });

  it('find nothing in sounds that are in order', async () => {
    expect(
      await found({
        idle: { main: 'ns:sounds/idle.ogg', pitch: [0.8, 1.4], volume: [0.5, 1] },
        wheels: 'minecraft:entity.minecart.riding',
        horn: { main: 'sounds/horn.ogg', pitch: [0.9, 0.9], volume: [1, 1] },
        controls: { THROTTLE_1: { move: 'minecraft:block.lever.click' }, TRAIN_BRAKE_1: {}, REVERSER_1: {}, IND_BRAKE_1: {} },
      }),
    ).toEqual([]);
  });

  describe('a range', () => {
    it('that runs backwards is a warning for a loop that follows the throttle or the speed', async () => {
      const pack = await packWith({ idle: { main: 'x.ogg', pitch: [1.4, 0.8] }, wheels: { main: 'minecraft:a', volume: [0.6, 0.2] } });
      const problems = soundProblems(pack);
      expect(problems.map((p) => [p.severity, p.code, p.at])).toEqual([
        ['warning', 'sound.range-reversed', [{ kind: 'field', file: MODEL, at: '/sounds/idle/pitch' }]],
        ['warning', 'sound.range-reversed', [{ kind: 'field', file: MODEL, at: '/sounds/wheels/volume' }]],
      ]);
      expect(problems[0]).toMatchObject({ params: { key: 'idle', name: 'pitch', from: 1.4, to: 0.8 }, source: 'loader' });
      expect(problems[0]?.text).toContain('runs backwards');
    });

    it('that rises is no finding, nor is a flat one', async () => {
      expect(await found({ idle: { main: 'x.ogg', pitch: [0.8, 1.4], volume: [1, 1] } })).toEqual([]);
    });

    it('that runs backwards or differs in its first number in a signal is no finding: only its second number is read', async () => {
      expect(await found({ horn: { main: 'minecraft:a', pitch: [1.2, 0.9], volume: [1, 0.9] } })).toEqual([]);
    });

    it('with a pitch the game bends is a warning, for the numbers the engine reads', async () => {
      const pack = await packWith({ idle: { main: 'x.ogg', pitch: [0.3, 1] }, wheels: { main: 'minecraft:a', pitch: [1, 2.5] }, bell: { main: 'minecraft:b', pitch: [0.1, 1.5] } });
      expect(soundProblems(pack).map((p) => [p.code, p.params.key, p.params.value])).toEqual([
        ['sound.pitch-clamped', 'idle', 0.3],
        ['sound.pitch-clamped', 'wheels', 2.5],
      ]);
      // the bell's first number is not read, so 0.1 is no pitch the engine would bend
    });

    it('takes the edges of the game’s limits as in order', async () => {
      expect(await found({ idle: { main: 'x.ogg', pitch: [0.5, 2] } })).toEqual([]);
    });

    it('with a negative volume is a warning', async () => {
      expect(await found({ idle: { main: 'x.ogg', volume: [-0.1, 1] } })).toEqual([['sound.volume-negative', '/sounds/idle/volume']]);
      expect(await found({ idle: { main: 'x.ogg', volume: [0, 1.5] } })).toEqual([]);
    });

    it('is left to the schema when it is not two numbers', async () => {
      expect(await found({ idle: { main: 'x.ogg', pitch: [1], volume: 'loud' } })).toEqual([]);
    });
  });

  describe('a controls key', () => {
    it('that names no cab control never sounds', async () => {
      expect(await found({ controls: { MY_LEVER_1: { move: 'x.ogg' }, THROTTLE: { move: 'x.ogg' } } })).toEqual([
        ['sound.control-unknown', '/sounds/controls/MY_LEVER_1'],
        ['sound.control-unknown', '/sounds/controls/THROTTLE'],
      ]);
    });

    it('of a control whose handle makes no sound is no finding: the engine accepts it, and the tab marks it', async () => {
      const controls = { WIDGET_1: {}, ENGINE_START_1: {}, THROTTLE_BRAKE_1: {}, GAUGE_THROTTLE_1: {}, THROTTLE_1: {}, REVERSER_1: {} };
      expect(await found({ controls })).toEqual([]);
      expect([...controlVerdicts(controls)].map(([key, v]) => [key, v.verdict])).toEqual([
        ['WIDGET_1', 'silent'],
        ['ENGINE_START_1', 'silent'],
        ['THROTTLE_BRAKE_1', 'silent'],
        ['GAUGE_THROTTLE_1', 'silent'],
        ['THROTTLE_1', 'plays'],
        ['REVERSER_1', 'plays'],
      ]);
      expect(controlVerdicts({ GAUGE_THROTTLE_1: {} }).get('GAUGE_THROTTLE_1')).toEqual({ verdict: 'silent', kind: 'GAUGE_THROTTLE' });
    });

    it('that is a key the engine documents as silent but names no control (COUPLER_ENGAGED_1) never sounds', async () => {
      expect(await found({ controls: { COUPLER_ENGAGED_1: {} } })).toEqual([['sound.control-unknown', '/sounds/controls/COUPLER_ENGAGED_1']]);
    });

    it('is read as the engine reads it: any case, IND_BRAKE for the independent brake, the first of a kind sounds', async () => {
      const pack = await packWith({
        controls: { throttle_1: {}, THROTTLE_2: {}, IND_BRAKE_1: {}, independent_brake_2: {}, Train_Brake_1: {} },
      });
      expect(soundProblems(pack).map((p) => [p.code, p.params.key, p.params.first])).toEqual([
        ['sound.control-shadowed', 'THROTTLE_2', 'throttle_1'],
        ['sound.control-shadowed', 'independent_brake_2', 'IND_BRAKE_1'],
      ]);
    });

    it('twice in two cases is one key of the engine’s: the later is the one read', async () => {
      const pack = await packWith({ controls: { THROTTLE_1: {}, throttle_1: {} } });
      expect(soundProblems(pack)).toEqual([]);
    });
  });

  describe('a reference', () => {
    it('that ends like another audio format is read as a sound event id', async () => {
      expect(await found({ horn: 'sounds/horn.wav', doors: { d: 'minecraft:x.MP3' }, controls: { THROTTLE_1: { move: 'a/b.OGG' } } })).toEqual([
        ['sound.not-ogg', '/sounds/horn'],
        ['sound.not-ogg', '/sounds/doors/d'],
        ['sound.not-ogg', '/sounds/controls/THROTTLE_1/move'],
      ]);
    });

    it('that is a sound event of the pack’s namespace its sounds.json does not define is a warning', async () => {
      expect(await found({ wheels: 'entity.minecart.riding', clack: 'ns:clack' })).toEqual([
        ['sound.event-undefined', '/sounds/wheels'],
        ['sound.event-undefined', '/sounds/clack'],
      ]);
    });

    it('that is defined in the sounds.json of its namespace, or the game’s, or another pack’s, is no finding', async () => {
      expect(
        await found(
          { wheels: 'rolling', clack: 'minecraft:block.chain.step', horn: 'other:horn', bell: 'ns:ding' },
          { 'assets/ns/sounds.json': dump({ rolling: { sounds: [] }, ding: { sounds: [] } }) },
        ),
      ).toEqual([]);
    });

    it('names the unqualified event the engine reads, and its sounds.json', async () => {
      const [problem] = soundProblems(await packWith({ wheels: 'entity.minecart.riding' }));
      expect(problem).toMatchObject({ code: 'sound.event-undefined', params: { ref: 'entity.minecart.riding', id: 'ns:entity.minecart.riding', file: 'assets/ns/sounds.json' } });
    });

    it('is left alone when it is a file: the missing ones are the loader’s to say', async () => {
      expect(await found({ horn: 'sounds/missing.ogg' })).toEqual([]);
    });
  });

  it('are among the pack’s findings, and ignore a model that is not JSON or has no sounds', async () => {
    const schema = (await import('../../core/schema')).createSchema((await import('../../core/schema/files.node')).readSchemaFiles());
    const pack = await packWith({ idle: { main: 'minecraft:a', pitch: [3, 1] } });
    expect(checkPack(pack, schema).map((p) => p.code)).toEqual(['sound.range-reversed', 'sound.pitch-clamped']);
    const broken = await Pack.open(
      new MemorySource(filesOf({ 'pack.mcmeta': MCMETA, [TYPE]: dump({ length: 10, bogies: [2, -2], mass_t: 40 }), [MODEL]: '{ "obj": ' })),
    );
    expect(soundProblems(broken)).toEqual([]);
  });

  it('have a line in both languages, said from their own params', async () => {
    const pack = await packWith({
      idle: { main: 'minecraft:a', pitch: [3, 1], volume: [-1, 1] },
      horn: { main: 'minecraft:h', pitch: [1, 1.5] },
      controls: { MY_1: {}, WIDGET_1: {}, THROTTLE_1: {}, THROTTLE_2: {} },
      bell: 'x.wav',
      wheels: 'rolling',
    });
    const problems = soundProblems(pack);
    const codes = [...new Set(problems.map((p) => p.code))].sort();
    expect(codes).toEqual([
      'sound.control-shadowed',
      'sound.control-unknown',
      'sound.event-undefined',
      'sound.not-ogg',
      'sound.pitch-clamped',
      'sound.range-reversed',
      'sound.volume-negative',
    ]);
    for (const code of codes) {
      expect(catalog.get('ru', `problem.${code}`), code).toBeTypeOf('string');
      expect(catalog.get('en', `problem.${code}`), code).toBeTypeOf('string');
    }
    for (const language of ['ru', 'en'] as const) {
      setLang(language);
      for (const problem of problems) expect(problemMessage(problem), `${language} ${problem.code}`).not.toMatch(/\{|undefined/);
    }
    setLang('ru');
    const reversed = problems.find((p) => p.code === 'sound.range-reversed');
    expect(problemMessage(reversed as NonNullable<typeof reversed>)).toBe(
      '«sounds.idle.pitch» идёт задом наперёд: [3, 1] — 3 в покое и 1 на полной (звук не растёт, а убывает; так и задумано?)',
    );
    expect(lang.value).toBe('ru');
  });
});
