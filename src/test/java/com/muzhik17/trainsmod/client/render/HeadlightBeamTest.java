package com.muzhik17.trainsmod.client.render;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * Where a headlight's light reaches (M28): the box the wagon renderer keeps
 * a car drawn by while its light may be in view must hold all of it — the
 * flare, the beam's spots, the light on the track to its far end.
 */
class HeadlightBeamTest {

    private static final float EPS = 1.0e-4F;

    /** A ChME3-like front lamp: 6.7 blocks ahead of the centre, 3 up, lens radius 0.17. */
    @Test
    void aFrontLampsLightReachesTheEndOfItsLightOnTheTrack() {
        float[] box = HeadlightBeam.reach(0.0F, 3.0F, 6.7F, 1.0F, 0.17F, null);
        float rim = HeadlightBeam.END_RADIUS * HeadlightBeam.SPOT_SPREAD;
        assertEquals(6.7F + HeadlightBeam.POOL_FAR, box[5], EPS, "ahead: the far end of the track light");
        assertTrue(box[5] >= 6.7F + HeadlightBeam.LENGTH + rim, "ahead: past the beam's last spot");
        assertEquals(-rim, box[0], EPS, "across: the beam's widest spot");
        assertEquals(rim, box[3], EPS);
        assertEquals(Math.min(HeadlightBeam.POOL_Y, 3.0F - rim), box[1], EPS, "down: the track light, the last spot");
        assertEquals(3.0F + rim, box[4], EPS, "up: the beam's widest spot");
        float flare = 0.17F * (HeadlightBeam.FLARE_HALO + HeadlightBeam.FLARE_HALO_GROWTH) + HeadlightBeam.FLARE_PULL;
        assertEquals(6.7F - flare, box[2], EPS, "behind the lens: its flare");
    }

    @Test
    void aRearLampShinesBack() {
        float[] box = HeadlightBeam.reach(0.0F, 2.5F, -6.7F, -1.0F, 0.17F, null);
        assertEquals(-6.7F - HeadlightBeam.POOL_FAR, box[2], EPS);
        assertTrue(box[5] < 0.0F, "nothing ahead of the car's middle: " + box[5]);
    }

    /** A big lens' halo reaches further than the beam's spots round it. */
    @Test
    void aWideLensFlareGrowsTheBox() {
        float[] box = HeadlightBeam.reach(0.0F, 3.0F, 0.0F, 1.0F, 0.5F, null);
        float flare = 0.5F * (HeadlightBeam.FLARE_HALO + HeadlightBeam.FLARE_HALO_GROWTH) + HeadlightBeam.FLARE_PULL;
        assertEquals(-flare, box[0], EPS);
        assertEquals(3.0F + flare, box[4], EPS);
        assertEquals(-flare, box[2], EPS);
    }

    /** No lens is smaller than the drawn minimum. */
    @Test
    void aTinyLensFlaresAsTheSmallestDrawn() {
        assertArrayEquals(HeadlightBeam.reach(0.0F, 3.0F, 0.0F, 1.0F, HeadlightBeam.MIN_RADIUS, null),
                HeadlightBeam.reach(0.0F, 3.0F, 0.0F, 1.0F, 0.01F, null), EPS);
    }

    @Test
    void twoLampsMakeOneBoxRoundBoth() {
        float[] front = HeadlightBeam.reach(1.0F, 3.0F, 6.7F, 1.0F, 0.17F, null);
        float[] box = HeadlightBeam.reach(-1.0F, 2.5F, -6.7F, -1.0F, 0.17F,
                HeadlightBeam.reach(1.0F, 3.0F, 6.7F, 1.0F, 0.17F, null));
        float[] rear = HeadlightBeam.reach(-1.0F, 2.5F, -6.7F, -1.0F, 0.17F, null);
        for (int i = 0; i < 3; i++) {
            assertEquals(Math.min(front[i], rear[i]), box[i], EPS);
            assertEquals(Math.max(front[i + 3], rear[i + 3]), box[i + 3], EPS);
        }
        float[] given = new float[6];
        given[0] = given[1] = given[2] = Float.MAX_VALUE;
        given[3] = given[4] = given[5] = -Float.MAX_VALUE;
        assertSame(given, HeadlightBeam.reach(0.0F, 0.0F, 0.0F, 1.0F, 0.2F, given), "grows the box it is given");
    }
}
