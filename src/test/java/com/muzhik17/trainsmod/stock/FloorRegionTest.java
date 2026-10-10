package com.muzhik17.trainsmod.stock;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * The floor as the union of its zones (SPEC §9.8): a centre fits wherever
 * the body's square lies inside the union, so zones that touch join without
 * overlapping and any gap between them is a wall.
 */
class FloorRegionTest {

    private static final double M = 0.3;
    private static final double EPS = 1.0e-9;

    private static WagonType.Interior.Zone zone(double minX, double minZ, double maxX, double maxZ) {
        return new WagonType.Interior.Zone(minX, 1.0, minZ, maxX, 3.0, maxZ);
    }

    private static FloorRegion region(WagonType.Interior.Zone... zones) {
        return FloorRegion.of(List.of(zones), M);
    }

    @Test
    void oneBox_isTheBoxShrunkByTheHalfWidth() {
        FloorRegion r = region(zone(-1.0, -5.0, 1.0, 5.0));
        assertTrue(r.fits(0.0, 0.0));
        assertTrue(r.fits(0.7, 4.7), "the corner a body just fits in");
        assertFalse(r.fits(0.71, 0.0));
        assertFalse(r.fits(0.0, 4.71));
        assertEquals(0.7, r.reach(0.0, 0.0, 0, 1), EPS);
        assertEquals(-4.7, r.reach(0.0, 0.0, 2, -1), EPS);
    }

    @Test
    void zonesThatTouch_joinWithoutOverlapping() {
        // a corridor ending where a cross passage begins: an L, no overlap
        FloorRegion r = region(zone(0.0, 0.0, 1.0, 9.0), zone(0.0, 9.0, 10.0, 10.0));
        assertTrue(r.fits(0.5, 9.0), "the body straddles the joint");
        assertEquals(9.7, r.reach(0.5, 5.0, 2, 1), EPS); // up the corridor into the passage
        assertEquals(9.7, r.reach(0.5, 9.5, 0, 1), EPS); // and along it
        assertFalse(r.fits(1.5, 8.9), "beside the corridor, under the passage, is wall");
    }

    @Test
    void anyGapBetweenZones_isAWall() {
        FloorRegion r = region(zone(-1.0, 0.0, 1.0, 5.0), zone(-1.0, 5.01, 1.0, 10.0));
        assertFalse(r.fits(0.0, 5.0));
        assertEquals(4.7, r.reach(0.0, 1.0, 2, 1), EPS);
        assertTrue(r.fits(0.0, 5.31));
    }

    @Test
    void aZoneExactlyAPlayerWide_leavesOneLine() {
        FloorRegion r = region(zone(0.0, 0.0, 0.6, 5.0));
        assertTrue(r.fits(0.3, 2.0));
        assertFalse(r.fits(0.31, 2.0));
        assertEquals(4.7, r.reach(0.3, 2.0, 2, 1), EPS);
    }

    @Test
    void tooNarrowEverywhere_fitsNowhere() {
        FloorRegion r = region(zone(0.0, 0.0, 0.5, 5.0));
        assertTrue(r.pieces().isEmpty());
        assertNull(r.nearest(0.0, 0.0));
        assertTrue(Double.isNaN(r.reach(0.25, 2.0, 2, 1)));
    }

    @Test
    void narrowStripsBesideEachOther_makeAWideFloor() {
        // a 1-wide floor drawn as five 0.2 strips: no strip holds a player, the union does
        FloorRegion r = region(zone(0.0, 0.0, 0.2, 4.0), zone(0.2, 0.0, 0.4, 4.0),
                zone(0.4, 0.0, 0.6, 4.0), zone(0.6, 0.0, 0.8, 4.0), zone(0.8, 0.0, 1.0, 4.0));
        assertTrue(r.fits(0.5, 2.0));
        assertEquals(0.7, r.reach(0.5, 2.0, 0, 1), EPS);
    }

    @Test
    void nearest_isThePointWhereTheBodyFits() {
        FloorRegion r = region(zone(0.0, 0.0, 1.0, 9.0), zone(0.0, 9.0, 10.0, 10.0));
        double[] at = r.nearest(5.0, 7.0); // under the passage, well beside the corridor
        assertEquals(5.0, at[0], EPS);
        assertEquals(9.3, at[1], EPS);
    }

    @Test
    void links_joinTouchingPieces() {
        FloorRegion r = region(zone(0.0, 0.0, 1.0, 9.0), zone(0.0, 9.0, 10.0, 10.0));
        int[] parent = new int[r.pieces().size()];
        for (int i = 0; i < parent.length; i++) {
            parent[i] = i;
        }
        for (int[] link : r.links()) {
            parent[root(parent, link[0])] = root(parent, link[1]);
        }
        for (int i = 1; i < parent.length; i++) {
            assertEquals(root(parent, 0), root(parent, i), "piece " + i + " is reachable");
        }
    }

    private static int root(int[] parent, int i) {
        while (parent[i] != i) {
            i = parent[i];
        }
        return i;
    }
}
