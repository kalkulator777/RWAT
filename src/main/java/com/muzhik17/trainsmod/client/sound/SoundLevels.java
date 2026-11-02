package com.muzhik17.trainsmod.client.sound;

/**
 * Which pitch and volume a train sound plays at (SPEC §10.3), apart from the
 * game's sound engine so it can be tested: which part of a pack's
 * {@code pitch}/{@code volume} range a sound takes.
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
}
