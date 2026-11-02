package com.muzhik17.trainsmod.network;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * Numbers off the wire (M4): NaN and the infinities are no numbers, and a
 * clamp lets NaN through — so a packet carrying one is dropped.
 */
class PacketNumbersTest {

    @Test
    void nanAndTheInfinities_areNoNumbers() {
        assertFalse(PacketNumbers.finite(Float.NaN));
        assertFalse(PacketNumbers.finite(Float.POSITIVE_INFINITY));
        assertFalse(PacketNumbers.finite(Float.NEGATIVE_INFINITY));
        assertFalse(PacketNumbers.finite(Double.NaN));
        assertFalse(PacketNumbers.finite(Double.POSITIVE_INFINITY));
        assertFalse(PacketNumbers.finite(1.0, 2.0, Double.NEGATIVE_INFINITY));
        assertFalse(PacketNumbers.finite(0.0F, Float.NaN, 1.0F), "one bad number spoils the packet");
    }

    @Test
    void ordinaryNumbers_areNumbers_howeverLarge() {
        assertTrue(PacketNumbers.finite(0.0F, -1.0F, Float.MAX_VALUE, -Float.MIN_VALUE));
        assertTrue(PacketNumbers.finite(1.0e300, -0.0, Double.MIN_VALUE));
        assertTrue(PacketNumbers.finite(new float[0]), "nothing to spoil");
    }

    /** Why a clamp is no check: the value the server kept for a control group was NaN. */
    @Test
    void aClampLetsNanThrough() {
        assertTrue(Float.isNaN(Math.clamp(Float.NaN, 0.0F, 1.0F)));
        assertFalse(PacketNumbers.finite(Math.clamp(Float.NaN, 0.0F, 1.0F)));
    }

    @Test
    void aRidersFeet_withANanCoordinate_areDropped() {
        assertTrue(new RiderLocal(1, 2, 0.5, 1.0, -3.0).finite());
        assertFalse(new RiderLocal(1, 2, 0.5, Double.NaN, -3.0).finite());
        assertFalse(new RiderLocal(1, 2, Double.POSITIVE_INFINITY, 1.0, -3.0).finite());
    }
}
