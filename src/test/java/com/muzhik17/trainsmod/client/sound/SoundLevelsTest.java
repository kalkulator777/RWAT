package com.muzhik17.trainsmod.client.sound;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Which end of a declared range a sound takes, and what keeps volume above 1 from carrying it further (SPEC §10.3). */
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

    /** The engine reads the volume and stretches the distance by it; what it ends with is the declared distance. */
    @Test
    void theEnginesStretchOfTheDistanceComesOutAsDeclared() {
        for (int distance : new int[] {16, 24, 40, 48, 64, 128, 192}) {
            for (float volume = 0.0F; volume <= 3.0F; volume += 0.05F) {
                float stretch = Math.max(volume, 1.0F);
                float carried = stretch * SoundLevels.engineDistance(distance, volume);
                assertEquals(distance, carried, stretch / 2 + EPS,
                        "volume " + volume + " carried " + carried + " of " + distance);
            }
        }
        assertEquals(24, SoundLevels.engineDistance(24, 0.3F));
        assertEquals(24, SoundLevels.engineDistance(24, 1.0F));
        assertEquals(96, SoundLevels.engineDistance(192, 2.0F));
        assertEquals(1, SoundLevels.engineDistance(1, 5.0F)); // never a distance of nothing
    }

    /** A stereo sound is faded to nothing exactly at its distance, whatever the volume that would stretch it. */
    @Test
    void aStereoFadeEndsAtTheDeclaredDistanceWhateverTheVolume() {
        for (float volume : new float[] {0.2F, 1.0F, 1.5F, 2.0F}) {
            assertEquals(0.0F, SoundLevels.stereoVolume(volume, 1.0F, 48.0, 48), EPS);
            assertEquals(0.0F, SoundLevels.stereoVolume(volume, 1.0F, 60.0, 48), EPS);
            assertTrue(SoundLevels.stereoVolume(volume, 1.0F, 47.0, 48) > 0.0F);
        }
    }

    /** At the slider's full, a volume above 1 changes nothing of a stereo sound: the ceiling is 1 as for a mono one. */
    @Test
    void aStereoSoundCannotBeLouderThanItsFile() {
        assertEquals(1.0F, SoundLevels.stereoVolume(2.0F, 1.0F, 0.0, 48), EPS);
        assertEquals(0.5F, SoundLevels.stereoVolume(2.0F, 1.0F, 24.0, 48), EPS);
        assertEquals(0.3F, SoundLevels.stereoVolume(0.6F, 1.0F, 24.0, 48), EPS);
    }

    /**
     * What a stereo sound ends up at, with the engine's multiplication by the
     * slider and its ceiling, is what a mono one does: limited, then faded by
     * OpenAL's linear distance gain.
     */
    @Test
    void aStereoSoundFadesAsAMonoOneDoes() {
        for (float slider : new float[] {0.25F, 0.5F, 0.8F, 1.0F}) {
            for (float volume : new float[] {0.15F, 0.6F, 1.0F, 1.6F, 2.0F, 3.0F}) {
                for (double away : new double[] {0.0, 10.0, 24.0, 40.0, 47.0}) {
                    float mono = Math.min(volume * slider, 1.0F) * (float) (1.0 - away / 48.0);
                    float stereo = Math.min(SoundLevels.stereoVolume(volume, slider, away, 48) * slider, 1.0F);
                    assertEquals(mono, stereo, 1.0e-4F,
                            "volume " + volume + " slider " + slider + " away " + away);
                }
            }
        }
    }

    /** A lowered slider and a volume above 1 meet at the ceiling: the volume is not cut short before the slider. */
    @Test
    void aLoweredSliderStillGetsTheBoost() {
        float slider = 0.5F;
        float engineGain = Math.min(SoundLevels.stereoVolume(2.0F, slider, 0.0, 48) * slider, 1.0F);
        assertEquals(1.0F, engineGain, EPS);
        float unboosted = Math.min(SoundLevels.stereoVolume(1.0F, slider, 0.0, 48) * slider, 1.0F);
        assertEquals(0.5F, unboosted, EPS);
    }
}
