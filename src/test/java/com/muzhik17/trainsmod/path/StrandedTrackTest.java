package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/**
 * Decision D2 (2026-10-21): a consist whose whole route was demolished stays
 * where it stood, on the curves under it cut out of the route — the same
 * geometry, independent of the graph.
 */
class StrandedTrackTest {

    private static RailSegment connect(RailGraph graph, Vector3d a, Vector3d b) {
        Vector3d chord = new Vector3d(b).sub(a);
        return graph.createSegment(a, chord, b, chord);
    }

    /** A straight, a bend built from its far end (the route runs it backwards), a straight. */
    private static RoutePath bendRoute() {
        RailGraph graph = new RailGraph();
        RailSegment first = connect(graph, new Vector3d(0, 64, 0), new Vector3d(20, 64, 0));
        connect(graph, new Vector3d(40, 65, 12), new Vector3d(20, 64, 0));
        connect(graph, new Vector3d(40, 65, 12), new Vector3d(60, 66, 24));
        return graph.buildRoutePath(graph.walkRoute(first.id()));
    }

    private static RoutePath squareLoop() {
        RailGraph graph = new RailGraph();
        RailSegment first = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 0));
        connect(graph, new Vector3d(20, 0, 0), new Vector3d(20, 0, 20));
        connect(graph, new Vector3d(20, 0, 20), new Vector3d(0, 0, 20));
        connect(graph, new Vector3d(0, 0, 20), new Vector3d(0, 0, 0));
        return graph.buildRoutePath(graph.walkRoute(first.id()));
    }

    private static void assertSameTrack(TrackPath expected, double expectedFrom, TrackPath actual,
            double length, double tolerance) {
        for (int i = 0; i <= 100; i++) {
            double s = length * i / 100.0;
            assertEquals(0.0, actual.samplePosition(s).distance(expected.samplePosition(expectedFrom + s)),
                    tolerance, "position at s=" + s);
            assertEquals(0.0, actual.sampleTangent(s).distance(expected.sampleTangent(expectedFrom + s)),
                    tolerance, "tangent at s=" + s);
        }
    }

    @Test
    void aCutKeepsTheRoutesOwnGeometry() {
        RoutePath route = bendRoute();
        assertEquals(3, route.partCount());
        assertTrue(route.partReversed(1), "the bend is walked against its build direction");

        double from = 12.0;
        double to = route.length() - 9.0;
        StrandedTrack.Cut cut = StrandedTrack.cut(route, from, to);
        assertEquals(from, cut.startS(), 1.0e-12, "a consist at route s sits at s − startS on the cut");
        assertEquals(to - from, cut.track().length(), 1.0e-9);
        assertEquals(3, cut.track().curves().size(), "every curve under the window, no more");
        assertFalse(cut.track().loop());
        assertSameTrack(route, from, cut.track(), to - from, 1.0e-9);

        StrandedTrack.Cut inside = StrandedTrack.cut(route, 2.0, 5.0);
        assertEquals(1, inside.track().curves().size(), "a window inside one curve keeps that one");
        assertSameTrack(route, 2.0, inside.track(), 3.0, 1.0e-9);
    }

    @Test
    void anOpenRouteClampsTheWindowAndTheCutClampsPastItsEnds() {
        RoutePath route = bendRoute();
        StrandedTrack.Cut cut = StrandedTrack.cut(route, -10.0, route.length() + 10.0);
        assertEquals(0.0, cut.startS(), 1.0e-12);
        assertEquals(route.length(), cut.track().length(), 1.0e-9);
        StrandedTrack track = cut.track();
        assertEquals(0.0, track.samplePosition(-3.0).distance(track.samplePosition(0.0)), 1.0e-12,
                "a dead end before s = 0");
        assertEquals(0.0, track.samplePosition(track.length() + 3.0)
                .distance(track.samplePosition(track.length())), 1.0e-12, "and past its length");
    }

    @Test
    void aCutAcrossTheSeamOfALoopIsUnwrapped() {
        RoutePath loop = squareLoop();
        assertTrue(loop.loop());
        double length = loop.length();
        // a consist circulating on a loop: its s has grown past several laps
        double from = 3.0 * length - 6.0;
        StrandedTrack.Cut cut = StrandedTrack.cut(loop, from, from + 14.0);
        assertEquals(from, cut.startS(), 1.0e-9, "startS in the lap of from");
        assertFalse(cut.track().loop(), "a cut has two ends, a loop doesn't");
        assertEquals(14.0, cut.track().length(), 1.0e-9);
        assertSameTrack(loop, from, cut.track(), 14.0, 1.0e-9);

        StrandedTrack.Cut lap = StrandedTrack.cut(loop, 5.0, 5.0 + 3.0 * length);
        assertEquals(length, lap.track().length(), 1.0e-9, "one lap at most");
        assertEquals(5, lap.track().curves().size(), "a lap begun inside a curve ends in it again");
    }

    @Test
    void rebuiltFromItsCurvesItIsTheSameTrack() {
        // what NBT and the snapshot carry: the curves, the flags and the window
        StrandedTrack track = StrandedTrack.cut(bendRoute(), 7.5, 41.0).track();
        List<HermiteSegment> copies = new ArrayList<>();
        for (HermiteSegment curve : track.curves()) {
            copies.add(new HermiteSegment(curve.start(), curve.startTangent(), curve.end(), curve.endTangent()));
        }
        StrandedTrack rebuilt = new StrandedTrack(copies, track.reversed(), track.offset(), track.length());
        assertEquals(track.length(), rebuilt.length(), 0.0);
        assertSameTrack(track, 0.0, rebuilt, track.length(), 0.0);
    }

    @Test
    void aLineLaysTheTrainAlongTheWagon() {
        Vector3d at = new Vector3d(100, 64, -20);
        StrandedTrack.Cut cut = StrandedTrack.line(at, new Vector3d(3, 0, 4), 50.0, 40.0, 65.0);
        StrandedTrack track = cut.track();
        assertEquals(40.0, cut.startS(), 0.0);
        assertEquals(25.0, track.length(), 1.0e-9);
        assertEquals(0.0, track.samplePosition(50.0 - cut.startS()).distance(at), 1.0e-9,
                "the wagon's own spot stays put");
        assertEquals(0.0, track.sampleTangent(3.0).distance(new Vector3d(0.6, 0, 0.8)), 1.0e-9);
        assertEquals(0.0, track.samplePosition(0.0).distance(new Vector3d(94, 64, -28)), 1.0e-9);
    }
}
