package com.muzhik17.trainsmod.client.sound;

/**
 * The numbers behind how loud, how high and how far a train sound plays
 * (SPEC §10.3), apart from the game's sound engine so they can be tested:
 * which end of a pack's {@code pitch}/{@code volume} range a sound takes, and
 * what keeps the {@code trainVolume} setting above 1 from also carrying a sound
 * further.
 *
 * <p><b>Ranges.</b> A loop's {@code pitch} and {@code volume} are
 * {@code [from, to]}: where the sound sits at rest and at full — the engine
 * by its throttle, the wheels by their speed ({@link #at}). A pack that gives
 * none gets the defaults of whoever plays the loop.
 *
 * <p><b>Horn and whistle (agent's decision).</b> They have no such quantity:
 * the key is held or it is not. A held signal sounds at the <b>full end of its
 * range — the second number</b>, {@code to}; the first, the rest, is not used.
 * Why: everywhere else the range reads "from rest to full", and a key held
 * down is the signal at full, as an engine at full throttle is; the rest would
 * be the signal not sounding, and a midpoint is a value neither of the author's
 * numbers says. To set a signal's pitch or level, write the number twice:
 * {@code [0.9, 0.9]}. No range: the file as it is (1.0), as before signals
 * read ranges. The game limits pitch to 0.5–2.0 whatever the pack says.
 *
 * <p><b>Volume above 1.</b> For the game's sound engine (1.21.1,
 * {@code SoundEngine}) a sound's volume has two other jobs besides loudness:
 * <ul>
 * <li>the source's gain is the volume times the sound category's slider, and
 * <b>limited to 0…1</b> ({@code calculateVolume}): a source is never louder
 * than its file at full, whatever the volume. So {@code trainVolume} up to 2
 * lifts what is quiet — the wheels at 0.15–0.6, a door under a lowered slider —
 * until it reaches that ceiling, and cannot make a sound that is already at the
 * ceiling louder;</li>
 * <li>for a sound it starts, the engine <b>stretches the distance it fades out
 * over</b> by {@code max(volume, 1)} ({@code play}) — thunder carrying further
 * is how the game means volume above 1. That is not what the setting is for:
 * the sound would still be audible where {@link TrainSounds} stops the loops at
 * their hearing distance, cutting them off. {@link #engineDistance} hands the
 * engine the distance divided by that stretch, so it comes out as declared.</li>
 * </ul>
 * The volume itself is passed on unlimited: the slider is multiplied in after
 * it, so a lowered slider and a volume above 1 still meet the ceiling.
 */
final class SoundLevels {

    /** A sound as it is in its file: no change of pitch or volume. */
    static final float UNCHANGED = 1.0F;

    private SoundLevels() {
    }

    /**
     * A range's value at {@code t}: 0 = at rest, 1 = full (beyond 1 it carries
     * on, as the wheels' pitch does past 100 km/h).
     *
     * @param declared the pack's {@code [from, to]}, or null
     * @param byDefault the range to use when the pack gives none
     */
    static float at(float[] declared, float[] byDefault, float t) {
        float[] range = declared != null ? declared : byDefault;
        return range[0] + (range[1] - range[0]) * t;
    }

    /** The pitch a held horn or whistle sounds at: the full end of its range, else unchanged (see the class comment). */
    static float signalPitch(SoundSet.Loop signal) {
        return signal.pitch() != null ? signal.pitch()[1] : UNCHANGED;
    }

    /** The volume a held horn or whistle sounds at, before the {@code trainVolume} setting: as {@link #signalPitch}. */
    static float signalVolume(SoundSet.Loop signal) {
        return signal.volume() != null ? signal.volume()[1] : UNCHANGED;
    }

    /**
     * The hearing distance to give the sound engine for a sound it will read
     * {@code volume} from: the engine multiplies it by {@code max(volume, 1)},
     * so the product comes out as {@code distance}. A whole number of blocks —
     * the engine takes no other — so the product is right to within half the
     * stretch of a block.
     *
     * @param distance how far the sound should carry, blocks
     * @param volume what the engine reads when it starts the sound
     */
    static int engineDistance(int distance, float volume) {
        float stretch = volume > 1.0F ? volume : 1.0F;
        return Math.max(1, Math.round(distance / stretch));
    }

    /**
     * The volume a stereo file is played at, {@code away} blocks from the
     * listener: OpenAL doesn't fade a stereo source by distance, so the fade
     * is made here — linear to nothing at {@code distance}, as OpenAL does a
     * mono source. A mono source is limited to the engine's ceiling and
     * <i>then</i> faded; so the volume is limited here first, to the most the
     * engine lets through at this slider, and a stereo sound under a volume
     * above 1 fades as a mono one does.
     *
     * @param volume the sound's volume before the slider
     * @param slider the volume slider of the sound's category, 0..1
     */
    static float stereoVolume(float volume, float slider, double away, int distance) {
        float ceiling = slider > 0.0F ? 1.0F / slider : volume;
        return Math.min(volume, ceiling) * (float) Math.max(0.0, 1.0 - away / distance);
    }
}
