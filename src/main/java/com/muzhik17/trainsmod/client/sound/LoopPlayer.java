package com.muzhik17.trainsmod.client.sound;

import net.minecraft.client.Minecraft;
import net.minecraft.client.sounds.SoundManager;

/**
 * Plays one declared loop (SPEC §10) — an engine, a horn, the wheels — as it
 * is switched on and off: the lead-in ({@code start}) once, then {@code main}
 * looping for as long as it stays on, then the tail ({@code stop}) once.
 * Volume, pitch and position follow every tick. {@link #kill} silences it
 * without the tail (out of hearing, the wagon gone).
 *
 * <p>A <b>signal</b> given as a single file (most of MVP's horns: one blast
 * with its own attack and fade) is not looped — looping would chop the blast
 * into a stutter. As in IR it plays whole, again each time it ends while the
 * key is held; let go, a short blast sounds out ({@link #SOUND_OUT_TICKS}),
 * a long recording is cut.
 */
final class LoopPlayer {

    /** A released signal blast no longer than this plays out, ticks. */
    private static final int SOUND_OUT_TICKS = 80;

    private enum State { OFF, STARTING, RUNNING }

    private final SoundSet.Loop loop;
    private final int distance;
    /** A single-file signal: repeated whole while on (see the class comment). */
    private final boolean repeat;
    private State state = State.OFF;
    private TrainSound lead;
    private TrainSound main;
    /** Tick the loop takes over from the lead-in (or the next blast starts); −1 = once the sound has stopped. */
    private long nextAt;

    LoopPlayer(SoundSet.Loop loop, int distance, boolean signal) {
        this.loop = loop;
        this.distance = distance;
        this.repeat = signal && loop.start() == null && loop.stop() == null;
    }

    SoundSet.Loop loop() {
        return loop;
    }

    boolean on() {
        return state != State.OFF;
    }

    void update(boolean on, long now, double x, double y, double z, float volume, float pitch) {
        SoundManager sounds = Minecraft.getInstance().getSoundManager();
        switch (state) {
            case OFF -> {
                if (!on) {
                    return;
                }
                if (loop.start() != null) {
                    lead = play(loop.start(), false, x, y, z, volume, pitch);
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
                if (over(sounds, now, lead)) {
                    startMain(now, x, y, z, volume, pitch);
                }
            }
            case RUNNING -> {
                if (!on) {
                    if (!repeat || SoundInfo.ticks(loop.main()) > SOUND_OUT_TICKS
                            || SoundInfo.ticks(loop.main()) < 0) {
                        end(main);
                    }
                    main = null;
                    playStop(x, y, z, volume, pitch);
                    state = State.OFF;
                    return;
                }
                place(main, x, y, z, volume, pitch);
                if (repeat && over(sounds, now, main)) {
                    startMain(now, x, y, z, volume, pitch); // the next blast
                }
            }
        }
    }

    private void startMain(long now, double x, double y, double z, float volume, float pitch) {
        main = play(loop.main(), !repeat, x, y, z, volume, pitch);
        nextAt = repeat ? after(now, loop.main()) : -1;
        lead = null; // a lead-in plays out by itself
        state = State.RUNNING;
    }

    /** Tick a sound started {@code now} ends, or −1 if its length is unknown. */
    private static long after(long now, String ref) {
        int length = SoundInfo.ticks(ref);
        return length > 0 ? now + length - 1 : -1;
    }

    /** True once the current sound is through: at its known end, else when it stopped playing. */
    private boolean over(SoundManager sounds, long now, TrainSound current) {
        return nextAt >= 0 ? now >= nextAt : current == null || !sounds.isActive(current);
    }

    private void playStop(double x, double y, double z, float volume, float pitch) {
        if (loop.stop() != null) {
            play(loop.stop(), false, x, y, z, volume, pitch);
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

    private TrainSound play(String ref, boolean looping, double x, double y, double z, float volume,
            float pitch) {
        TrainSound sound = TrainSound.of(ref, looping, distance);
        if (sound != null) {
            place(sound, x, y, z, volume, pitch);
            TrainSounds.play(sound);
        }
        return sound;
    }

    private static void place(TrainSound sound, double x, double y, double z, float volume,
            float pitch) {
        if (sound != null) {
            sound.moveTo(x, y, z);
            sound.set(volume, pitch);
        }
    }

    private static void end(TrainSound sound) {
        if (sound != null) {
            sound.end();
        }
    }
}
