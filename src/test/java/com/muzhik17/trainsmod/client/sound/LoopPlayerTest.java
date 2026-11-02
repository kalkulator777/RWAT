package com.muzhik17.trainsmod.client.sound;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

/** One declared loop switched on and off (SPEC §10.3), against a stand-in for the sound engine. */
class LoopPlayerTest {

    /** What the loops played, and which of those the "sound engine" still has. */
    private static final class Engine implements LoopPlayer.Speaker<Engine.Voice> {
        final class Voice {
            final String ref;
            boolean active;

            Voice(String ref) {
                this.ref = ref;
            }
        }

        final List<String> played = new ArrayList<>();
        final List<Voice> voices = new ArrayList<>();
        final Map<String, Integer> lengths = new HashMap<>();
        /** No free channel: what is played now never starts. */
        boolean full;

        @Override
        public Voice play(String ref, boolean looping, double x, double y, double z, float volume, float pitch) {
            played.add(ref);
            Voice voice = new Voice(ref);
            voice.active = !full;
            voices.add(voice);
            return voice;
        }

        @Override
        public void place(Voice sound, double x, double y, double z, float volume, float pitch) {
        }

        @Override
        public boolean active(Voice sound) {
            return sound.active;
        }

        @Override
        public void end(Voice sound) {
            sound.active = false;
        }

        @Override
        public int ticks(String ref) {
            return lengths.getOrDefault(ref, -1);
        }

        /** The sound engine drops everything without a word (the sound device changed). */
        void dropAll() {
            voices.forEach(voice -> voice.active = false);
        }

        long playing(String ref) {
            return voices.stream().filter(voice -> voice.ref.equals(ref) && voice.active).count();
        }
    }

    private static final SoundSet.Loop DR1 = new SoundSet.Loop("start", "idle", "stop", null, null);

    private static void tick(LoopPlayer<?> player, boolean on, boolean resume, long now) {
        player.update(on, resume, now, 0.0, 0.0, 0.0, 1.0F, 1.0F);
    }

    @Test
    void aStartedEngineLeadsInThenLoopsAndStopsWithItsTail() {
        Engine engine = new Engine();
        engine.lengths.put("start", 10);
        LoopPlayer<Engine.Voice> player = new LoopPlayer<>(DR1, engine, false);
        tick(player, true, false, 0);
        for (long t = 1; t < 9; t++) {
            tick(player, true, false, t);
        }
        assertEquals(List.of("start"), engine.played);
        tick(player, true, false, 9); // the lead-in's last tick: the loop takes over
        assertEquals(List.of("start", "idle"), engine.played);
        tick(player, false, false, 10);
        assertEquals(List.of("start", "idle", "stop"), engine.played);
        assertEquals(0, engine.playing("idle"));
        assertFalse(player.on());
    }

    /** M30: a running engine come into hearing (or found on joining) doesn't start up again. */
    @Test
    void aResumedEngineGoesStraightIntoItsLoop() {
        Engine engine = new Engine();
        LoopPlayer<Engine.Voice> player = new LoopPlayer<>(DR1, engine, false);
        tick(player, true, true, 0);
        assertEquals(List.of("idle"), engine.played);
        player.kill(); // out of hearing: no tail
        tick(player, false, true, 1);
        tick(player, true, true, 2);
        assertEquals(List.of("idle", "idle"), engine.played);
        assertEquals(1, engine.playing("idle"));
    }

    /** H12: a loop the sound engine dropped plays again — not stays silent till it is switched off. */
    @Test
    void aDroppedLoopStartsAgain() {
        Engine engine = new Engine();
        LoopPlayer<Engine.Voice> player = new LoopPlayer<>(new SoundSet.Loop(null, "wheels", null, null, null),
                engine, false);
        tick(player, true, false, 0);
        long t = LoopPlayer.RETRY_TICKS;
        tick(player, true, false, t);
        assertEquals(1, engine.played.size());
        engine.dropAll();
        tick(player, true, false, ++t);
        assertEquals(2, engine.played.size());
        assertEquals(1, engine.playing("wheels"));
        assertTrue(player.on());
    }

    /** With no channel to spare the sound engine is asked again once per RETRY_TICKS, not every tick. */
    @Test
    void aLoopThatCannotStartIsRetriedSparingly() {
        Engine engine = new Engine();
        engine.full = true;
        LoopPlayer<Engine.Voice> player = new LoopPlayer<>(new SoundSet.Loop(null, "idle", null, null, null),
                engine, false);
        for (long t = 0; t < LoopPlayer.RETRY_TICKS; t++) {
            tick(player, true, false, t);
        }
        assertEquals(1, engine.played.size());
        tick(player, true, false, LoopPlayer.RETRY_TICKS);
        assertEquals(2, engine.played.size());
        engine.full = false;
        for (long t = LoopPlayer.RETRY_TICKS + 1; t <= 2L * LoopPlayer.RETRY_TICKS; t++) {
            tick(player, true, false, t);
        }
        assertEquals(3, engine.played.size());
        assertEquals(1, engine.playing("idle"));
        for (long t = 2L * LoopPlayer.RETRY_TICKS + 1; t < 5L * LoopPlayer.RETRY_TICKS; t++) {
            tick(player, true, false, t);
        }
        assertEquals(3, engine.played.size()); // playing: left alone
    }

    /** A single-file signal plays whole, again each time it ends while held; a short one sounds out. */
    @Test
    void aHeldSignalBlastRepeatsAndAShortOneSoundsOut() {
        Engine engine = new Engine();
        engine.lengths.put("horn", 30);
        LoopPlayer<Engine.Voice> player = new LoopPlayer<>(new SoundSet.Loop(null, "horn", null, null, null),
                engine, true);
        for (long t = 0; t < 60; t++) {
            tick(player, true, false, t);
        }
        assertEquals(List.of("horn", "horn", "horn"), engine.played); // at 0, 29 and 58
        tick(player, false, false, 60);
        assertTrue(engine.voices.get(2).active, "a short blast plays out");
        assertFalse(player.on());
    }
}
