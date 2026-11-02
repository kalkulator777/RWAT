package com.muzhik17.trainsmod.client.sound;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** Which part of a declared range a sound takes (SPEC §10.3). */
class SoundLevelsTest {

    private static final float EPS = 1.0e-5F;

    private static SoundSet.Loop signal(float[] pitch, float[] volume) {
        return new SoundSet.Loop(null, "mvp:horn.ogg", null, pitch, volume);
    }

    /** The horn and whistle took no part of their range: they played at 1.0 whatever the pack gave. */
    @Test
    void aHeldSignalSoundsAtTheFullEndOfItsRange() {
        SoundSet.Loop horn = signal(new float[] {0.8F, 1.2F}, new float[] {0.4F, 0.9F});
        assertEquals(1.2F, SoundLevels.signalPitch(horn), EPS);
        assertEquals(0.9F, SoundLevels.signalVolume(horn), EPS);
    }

    @Test
    void aSignalWithoutARangeIsTheFileAsItIs() {
        SoundSet.Loop horn = signal(null, null);
        assertEquals(1.0F, SoundLevels.signalPitch(horn), EPS);
        assertEquals(1.0F, SoundLevels.signalVolume(horn), EPS);
    }

    @Test
    void aSignalsPitchAndVolumeAreDeclaredApart() {
        SoundSet.Loop quiet = signal(null, new float[] {0.5F, 0.5F});
        assertEquals(1.0F, SoundLevels.signalPitch(quiet), EPS);
        assertEquals(0.5F, SoundLevels.signalVolume(quiet), EPS);
        SoundSet.Loop high = signal(new float[] {1.1F, 1.1F}, null);
        assertEquals(1.1F, SoundLevels.signalPitch(high), EPS);
        assertEquals(1.0F, SoundLevels.signalVolume(high), EPS);
    }

    /** The second number counts as written, also when it is the smaller one. */
    @Test
    void aSignalsRangeIsNotSortedOrAveraged() {
        SoundSet.Loop falling = signal(new float[] {1.3F, 0.9F}, new float[] {1.0F, 0.6F});
        assertEquals(0.9F, SoundLevels.signalPitch(falling), EPS);
        assertEquals(0.6F, SoundLevels.signalVolume(falling), EPS);
    }

    @Test
    void aRangeIsReadByPositionAndFallsBackToTheDefault() {
        float[] byDefault = {0.7F, 1.3F};
        assertEquals(0.7F, SoundLevels.at(null, byDefault, 0.0F), EPS);
        assertEquals(1.0F, SoundLevels.at(null, byDefault, 0.5F), EPS);
        assertEquals(1.3F, SoundLevels.at(null, byDefault, 1.0F), EPS);
        float[] declared = {1.0F, 2.0F};
        assertEquals(1.25F, SoundLevels.at(declared, byDefault, 0.25F), EPS);
        assertEquals(2.2F, SoundLevels.at(declared, byDefault, 1.2F), EPS); // the wheels' pitch runs on past 100 km/h
    }
}
