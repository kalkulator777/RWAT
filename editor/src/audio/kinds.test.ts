import { describe, expect, it } from 'vitest';
import { descriptorAt } from '../checks/fields';
import { createSchema } from '../core/schema';
import { readSchemaFiles } from '../core/schema/files.node';
import { BEHAVIOUR, LOOP_KEYS, SOUND_KEYS, SOUNDING_HANDLES, isLoopKey } from './kinds';
import { DISTANCES } from './levels';

const schema = createSchema(readSchemaFiles());
const root = schema.fields.root('wagon_model');

describe('what the engine does with each key of sounds', () => {
  it('is told for every key the schema has, and for no other', () => {
    const sounds = descriptorAt(root, {}, '/sounds');
    expect((sounds?.properties ?? []).map((p) => p.key)).toEqual([...SOUND_KEYS]);
    expect(Object.keys(BEHAVIOUR).sort()).toEqual([...SOUND_KEYS].sort());
  });

  it('knows the loops by the schema’s own form: a sound or an object with a main', () => {
    for (const key of SOUND_KEYS) {
      const d = descriptorAt(root, {}, `/sounds/${key}`);
      const isLoop = d?.variants?.some((v) => v.shape === 'object' && v.properties?.some((p) => p.key === 'main')) === true;
      expect(isLoopKey(key), key).toBe(isLoop);
    }
    expect([...LOOP_KEYS]).toEqual(['idle', 'wheels', 'horn', 'bell']);
  });

  it('carries each sound as far as the hearing distances say', () => {
    expect(BEHAVIOUR.horn.distance).toBe(DISTANCES.horn);
    expect(BEHAVIOUR.controls.distance).toBe(DISTANCES.controls);
    expect(SOUNDING_HANDLES).toEqual(['THROTTLE', 'TRAIN_BRAKE', 'INDEPENDENT_BRAKE', 'REVERSER']);
  });
});
