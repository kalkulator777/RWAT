/**
 * What the engine does with each key of `sounds` (docs/proposals/pack-capabilities.md §8,
 * `client/sound/TrainSounds.java`): the part of it the schema has no field for. The keys
 * themselves are the schema's (`wagon_model` → `sounds.properties`); this table only tells
 * how each is played, and a test keeps the two lists equal (./kinds.test.ts), so a key the
 * schema gains makes it fail until the table says what the engine does with it.
 */

import { DISTANCES } from './levels';

/** How the engine plays a key. */
export type SoundBehaviour =
  /** A loop that follows the throttle: pitch and volume from rest to full throttle. */
  | 'engine'
  /** A loop that follows the speed (full at 100 km/h). */
  | 'rolling'
  /** A loop that sounds while the driver holds a key, at the second number of each range. */
  | 'signal'
  /** A one-shot under each bogie crossing a rail joint; level and pitch by speed. */
  | 'joint'
  /** One sound per door, played on opening and on closing. */
  | 'doors'
  /** A sound per handle of the train in the cab that drives. */
  | 'controls';

export const SOUND_KEYS = ['idle', 'wheels', 'horn', 'bell', 'clack', 'doors', 'controls'] as const;

export type SoundKey = (typeof SOUND_KEYS)[number];

/** How the engine plays each key and how far it carries (blocks). */
export const BEHAVIOUR: Readonly<Record<SoundKey, { behaviour: SoundBehaviour; distance: number }>> = {
  idle: { behaviour: 'engine', distance: DISTANCES.idle },
  wheels: { behaviour: 'rolling', distance: DISTANCES.wheels },
  horn: { behaviour: 'signal', distance: DISTANCES.horn },
  bell: { behaviour: 'signal', distance: DISTANCES.bell },
  clack: { behaviour: 'joint', distance: DISTANCES.clack },
  doors: { behaviour: 'doors', distance: DISTANCES.doors },
  controls: { behaviour: 'controls', distance: DISTANCES.controls },
};

/** The keys that are loops (`pitch` and `volume` ranges, a lead-in and a tail). */
export const LOOP_KEYS: readonly SoundKey[] = ['idle', 'wheels', 'horn', 'bell'];

/** True for a loop key. */
export function isLoopKey(key: string): key is 'idle' | 'wheels' | 'horn' | 'bell' {
  return (LOOP_KEYS as readonly string[]).includes(key);
}

/**
 * The kinds of handle that sound, by the kind of control a `controls` key names
 * (`SoundSet.control`; `TrainSounds.cab` asks for these four).
 */
export const SOUNDING_HANDLES = ['THROTTLE', 'TRAIN_BRAKE', 'INDEPENDENT_BRAKE', 'REVERSER'] as const;

export type SoundingHandle = (typeof SOUNDING_HANDLES)[number];
