package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

class ArcLengthTableTest {

    @Test
    void straightSegmentLengthIsChordLength() {
        HermiteSegment segment = HermiteSegment.straight(
                new Vector3d(0, 0, 0), new Vector3d(30, 40, 0));
        ArcLengthTable table = ArcLengthTable.of(segment);
        assertEquals(50.0, table.length(), 1.0e-6);
    }

    @Test
    void curvedSegmentIsLongerThanChord() {
        HermiteSegment segment = new HermiteSegment(
                new Vector3d(0, 0, 0), new Vector3d(20, 0, 0),
                new Vector3d(20, 0, 20), new Vector3d(0, 0, 20));
        ArcLengthTable table = ArcLengthTable.of(segment);
        double chord = new Vector3d(20, 0, 20).length();
        assertTrue(table.length() > chord, "curve longer than chord");
        // quarter-circle-ish turn of radius 20 ≈ 31.4; sampled curve should be in that ballpark
        assertTrue(table.length() < 2.0 * chord, "no wild overshoot");
    }

    @Test
    void sAndTAreMonotonicInverses() {
        HermiteSegment segment = new HermiteSegment(
                new Vector3d(0, 0, 0), new Vector3d(25, 10, 0),
                new Vector3d(20, 5, 20), new Vector3d(0, -5, 25));
        ArcLengthTable table = ArcLengthTable.of(segment);
        double previousS = -1.0;
        for (int i = 0; i <= 200; i++) {
            double t = i / 200.0;
            double s = table.sForT(t);
            assertTrue(s >= previousS, "s monotonic in t");
            previousS = s;
            assertEquals(t, table.tForS(s), 1.0e-6, "tForS(sForT(t)) == t at t=" + t);
        }
        assertEquals(0.0, table.sForT(0.0), 1.0e-12);
        assertEquals(table.length(), table.sForT(1.0), 1.0e-12);
    }

    @Test
    void lookupsClampOutOfRange() {
        ArcLengthTable table = ArcLengthTable.of(
                HermiteSegment.straight(new Vector3d(0, 0, 0), new Vector3d(10, 0, 0)));
        assertEquals(0.0, table.tForS(-5.0), 1.0e-12);
        assertEquals(1.0, table.tForS(999.0), 1.0e-12);
        assertEquals(0.0, table.sForT(-1.0), 1.0e-12);
        assertEquals(table.length(), table.sForT(2.0), 1.0e-12);
    }
}
