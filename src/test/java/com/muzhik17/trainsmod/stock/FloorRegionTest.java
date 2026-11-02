package com.muzhik17.trainsmod.stock;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
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

    @Test
    void aCut_partsTheFloorAtItsFaces() {
        // a thin shut door across a one-box floor
        FloorRegion r = FloorRegion.of(List.of(zone(-1.0, 0.0, 1.0, 5.0)), M,
                List.of(new FloorRegion.Cut(-0.05, -1.0, 0.05, 6.0)));
        assertEquals(1, r.cuts().size());
        assertFalse(r.fits(0.0, 2.0), "inside the cut");
        assertTrue(r.fits(-0.05, 2.0), "on its face");
        assertEquals(-0.05, r.reach(-0.5, 2.0, 0, 1), EPS);
        int[] parent = new int[r.pieces().size()];
        for (int i = 0; i < parent.length; i++) {
            parent[i] = i;
        }
        for (int[] link : r.links()) {
            parent[root(parent, link[0])] = root(parent, link[1]);
        }
        for (int i = 0; i < parent.length; i++) {
            for (int j = 0; j < parent.length; j++) {
                if (r.pieces().get(i).maxX() < 0.0 && r.pieces().get(j).minX() > 0.0) {
                    assertNotEquals(root(parent, i), root(parent, j), "pieces " + i + " and " + j + " joined");
                }
            }
        }
        assertTrue(r.throughCut(-0.5, 2.0, 0.5, 2.0), "a step through it");
        assertFalse(r.throughCut(-0.05, 1.0, -0.05, 3.0), "along its face");
        assertFalse(r.throughCut(-0.5, 2.0, -0.05, 2.0), "up to its face");
    }

    @Test
    void aCutNobodyStandsIn_changesNothing() {
        // a door in the wall between two zones: the gap is wall already
        List<WagonType.Interior.Zone> zones = List.of(zone(-1.0, 0.0, 1.0, 5.0), zone(-1.0, 5.2, 1.0, 9.0));
        FloorRegion r = FloorRegion.of(zones, M, List.of(new FloorRegion.Cut(-0.7, 5.0, 0.7, 5.2)));
        assertTrue(r.cuts().isEmpty());
        assertEquals(FloorRegion.of(zones, M).pieces(), r.pieces());
    }

    @Test
    void aShutDoorsCut_isItsLeafAcrossTheWall_itsSpanGrownByTheMargin() {
        // the platzkart's compartment door: a side door, thin across X
        WagonType.Door kupe = new WagonType.Door("DoorKupe", 0.375, 1.811, 6.875, 0.5, 3.936, 7.5, true, false);
        assertEquals(new FloorRegion.Cut(0.375, 6.875 - M, 0.5, 7.5 + M), FloorRegion.Cut.shut(kupe, M));
        // an end door drawn without thickness: a centimetre
        WagonType.Door flat = new WagonType.Door("flat", -0.4, 1.0, 5.0, 0.4, 3.0, 5.0, true, false);
        FloorRegion.Cut cut = FloorRegion.Cut.shut(flat, M);
        assertEquals(-0.4 - M, cut.minX(), EPS);
        assertEquals(0.4 + M, cut.maxX(), EPS);
        assertEquals(0.01, cut.maxZ() - cut.minZ(), EPS);
        assertEquals(5.0, (cut.minZ() + cut.maxZ()) * 0.5, EPS);
    }

    private static int root(int[] parent, int i) {
        while (parent[i] != i) {
            i = parent[i];
        }
        return i;
    }
}
