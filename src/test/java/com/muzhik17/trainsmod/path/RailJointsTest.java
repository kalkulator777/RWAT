package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/** Rail joints along a route (SPEC §10): laid per segment, the same whichever way a route runs. */
class RailJointsTest {

    private static final double L = TrackPath.JOINT_SPACING;

    private static HermiteSegmentPath straight(double fromX, double toX) {
        return new HermiteSegmentPath(HermiteSegment.straight(
                new Vector3d(fromX, 0, 0), new Vector3d(toX, 0, 0)));
    }

    /** Joints crossed going from {@code a} to {@code b}. */
    private static long crossed(TrackPath path, double a, double b) {
        return Math.abs(path.jointIndex(b) - path.jointIndex(a));
    }

    @Test
    void forwardSegmentHasJointsEveryRailFromItsStart() {
        // one 60-block segment: joints at 0, 25, 50 (and the end node at 60)
        RoutePath route = new RoutePath(new HermiteSegmentPath[] {straight(0, 60)},
                new boolean[] {false}, false);
        assertEquals(0, crossed(route, 1.0, 24.0));
        assertEquals(1, crossed(route, 24.0, 26.0));
        assertEquals(1, crossed(route, 49.0, 51.0));
        assertEquals(2, crossed(route, 1.0, 59.0));
        assertEquals(0.0, route.jointDistance(25.0), 1e-6);
        assertEquals(5.0, route.jointDistance(55.0), 1e-6); // 50 and the end node at 60
        assertEquals(12.5, route.jointDistance(37.5), 1e-6);
    }

    @Test
    void reversedSegmentMeetsTheSameJointsFromTheOtherEnd() {
        // the same 60-block segment run backwards: route s = 60 − segment s,
        // so the joints at segment 0/25/50 sit at route s 60/35/10
        RoutePath route = new RoutePath(new HermiteSegmentPath[] {straight(0, 60)},
                new boolean[] {true}, false);
        assertEquals(1, crossed(route, 9.0, 11.0));
        assertEquals(1, crossed(route, 34.0, 36.0));
        assertEquals(0, crossed(route, 11.0, 34.0));
        assertEquals(0.0, route.jointDistance(10.0), 1e-6);
        assertEquals(0.0, route.jointDistance(35.0), 1e-6);
        assertEquals(0.0, route.jointDistance(0.0), 1e-6); // the segment's end node
        assertEquals(5.0, route.jointDistance(5.0), 1e-6);
    }

    @Test
    void everyNodeIsAJointAndCountsStayMonotonic() {
        // 30 forward + 40 reversed: joints at 0, 25 | 30 (node), 45 (= 70 − 25), 70 (end)
        RoutePath route = new RoutePath(new HermiteSegmentPath[] {straight(0, 30), straight(70, 30)},
                new boolean[] {false, true}, false);
        assertEquals(1, crossed(route, 29.0, 31.0));
        assertEquals(1, crossed(route, 44.0, 46.0));
        assertEquals(0, crossed(route, 31.0, 44.0));
        long previous = route.jointIndex(0.0);
        for (double s = 0.25; s < route.length(); s += 0.25) {
            long index = route.jointIndex(s);
            assertTrue(index >= previous, "joint count fell at s = " + s);
            assertTrue(index - previous <= 1, "two joints within a quarter block at s = " + s);
            previous = index;
        }
        assertEquals(3, crossed(route, 0.1, 69.9)); // 25, 30, 45 — not the start node, not the end
    }

    @Test
    void loopKeepsCountingRoundAndRound() {
        RoutePath loop = new RoutePath(new HermiteSegmentPath[] {straight(0, 50), straight(50, 0)},
                new boolean[] {false, false}, true);
        // 4 joints per lap: 0, 25 | 50, 75
        assertEquals(4, crossed(loop, 1.0, 101.0));
        assertEquals(1, crossed(loop, 99.0, 101.0)); // over the seam
        assertEquals(0.0, loop.jointDistance(125.0), 1e-6);
    }

    @Test
    void plainPathSpacesJointsEvenly() {
        TrackPath line = straight(0, 100);
        assertEquals(1, crossed(line, L - 1, L + 1));
        assertEquals(0.0, line.jointDistance(2 * L), 1e-6);
        assertEquals(L / 2, line.jointDistance(L / 2), 1e-6);
    }
}
