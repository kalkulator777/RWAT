package com.muzhik17.trainsmod.client.sound;

/**
 * Plays one declared loop (SPEC §10) — an engine, a horn, the wheels — as it
 * is switched on and off: the lead-in ({@code start}) once, then {@code main}
 * looping for as long as it stays on, then the tail ({@code stop}) once.
 * Volume, pitch and position follow every tick. {@link #kill} silences it
 * without the tail (out of hearing, the wagon gone).
 *
 * <p>The sound engine drops a loop without a word: the sound device changed,
 * {@code /stopsound}, no free channel. A loop found dropped starts again — at
 * most once per {@link #RETRY_TICKS}, so an engine with no channel to spare
 * isn't asked every tick.
 *
 * <p>A <b>signal</b> given as a single file (most of MVP's horns: one blast
 * with its own attack and fade) is not looped — looping would chop the blast
 * into a stutter. As in IR it plays whole, again each time it ends while the
 * key is held; let go, a short blast sounds out ({@link #SOUND_OUT_TICKS}),
 * a long recording is cut.
 *
 * <p>No MC types: the sounds go out through a {@link Speaker} — the game's
 * sound engine ({@link TrainSounds}), a stand-in in the tests.
 *
 * @param <S> a playing sound, as the speaker hands it back
 */
final class LoopPlayer<S> {

    /** A released signal blast no longer than this plays out, ticks. */
    private static final int SOUND_OUT_TICKS = 80;
    /** A dropped loop is started again at most this often, ticks. */
    static final int RETRY_TICKS = 40;

    /** Where a loop's sounds play. */
    interface Speaker<S> {
        /** Start a sound there, at that volume and pitch; null if the reference can't be played. */
        S play(String ref, boolean looping, double x, double y, double z, float volume, float pitch);

        /** Move a playing sound, and set its volume and pitch. */
        void place(S sound, double x, double y, double z, float volume, float pitch);

        /** False once the sound engine no longer has the sound: it ended, was dropped, or never got a channel. */
        boolean active(S sound);

        /** Stop the sound at the sound engine's next tick. */
        void end(S sound);

        /** Ticks a sound plays, or −1 if unknown. */
        int ticks(String ref);
    }

    private enum State { OFF, STARTING, RUNNING }

    private final SoundSet.Loop loop;
    private final Speaker<S> speaker;
    /** A single-file signal: repeated whole while on (see the class comment). */
    private final boolean repeat;
    private State state = State.OFF;
    private S lead;
    private S main;
    /** Tick the loop takes over from the lead-in (or the next blast starts); −1 = once the sound has stopped. */
    private long nextAt;
    /** Before this tick a dropped loop is not started again. */
    private long retryAt;

    LoopPlayer(SoundSet.Loop loop, Speaker<S> speaker, boolean signal) {
        this.loop = loop;
        this.speaker = speaker;
        this.repeat = signal && loop.start() == null && loop.stop() == null;
    }

    SoundSet.Loop loop() {
        return loop;
    }

    boolean on() {
        return state != State.OFF;
    }

    void update(boolean on, long now, double x, double y, double z, float volume, float pitch) {
        switch (state) {
            case OFF -> {
                if (!on) {
                    return;
                }
                if (loop.start() != null) {
                    lead = speaker.play(loop.start(), false, x, y, z, volume, pitch);
                    nextAt = after(now, loop.start());
                    state = State.STARTING;
                } else {
                    startMain(now, x, y, z, volume, pitch);
                }
            }
            case STARTING -> {
                if (!on) {
                    end(lead);
                    lead = null;
                    playStop(x, y, z, volume, pitch);
                    state = State.OFF;
                    return;
                }
                place(lead, x, y, z, volume, pitch);
                if (over(now, lead)) {
                    startMain(now, x, y, z, volume, pitch);
                }
            }
            case RUNNING -> {
                if (!on) {
                    if (!repeat || speaker.ticks(loop.main()) > SOUND_OUT_TICKS
                            || speaker.ticks(loop.main()) < 0) {
                        end(main);
                    }
                    main = null;
                    playStop(x, y, z, volume, pitch);
                    state = State.OFF;
                    return;
                }
                place(main, x, y, z, volume, pitch);
                if (repeat) {
                    if (over(now, main)) {
                        startMain(now, x, y, z, volume, pitch); // the next blast
                    }
                } else if (main != null && now >= retryAt && !speaker.active(main)) {
                    end(main); // the sound engine let it go: start it again
                    startMain(now, x, y, z, volume, pitch);
                }
            }
        }
    }

    private void startMain(long now, double x, double y, double z, float volume, float pitch) {
        main = speaker.play(loop.main(), !repeat, x, y, z, volume, pitch);
        nextAt = repeat ? after(now, loop.main()) : -1;
        retryAt = now + RETRY_TICKS;
        lead = null; // a lead-in plays out by itself
        state = State.RUNNING;
    }

    /** Tick a sound started {@code now} ends, or −1 if its length is unknown. */
    private long after(long now, String ref) {
        int length = speaker.ticks(ref);
        return length > 0 ? now + length - 1 : -1;
    }

    /** True once the current sound is through: at its known end, else when it stopped playing. */
    private boolean over(long now, S current) {
        return nextAt >= 0 ? now >= nextAt : current == null || !speaker.active(current);
    }

    private void playStop(double x, double y, double z, float volume, float pitch) {
        if (loop.stop() != null) {
            speaker.play(loop.stop(), false, x, y, z, volume, pitch);
        }
    }

    /** Silence it now, without the tail. */
    void kill() {
        end(lead);
        end(main);
        lead = null;
        main = null;
        state = State.OFF;
    }

    private void place(S sound, double x, double y, double z, float volume, float pitch) {
        if (sound != null) {
            speaker.place(sound, x, y, z, volume, pitch);
        }
    }

    private void end(S sound) {
        if (sound != null) {
            speaker.end(sound);
        }
    }
}
