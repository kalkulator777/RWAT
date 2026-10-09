package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

class TrackSweepTest {

    private static final Vector3d X = new Vector3d(1, 0, 0);

    @Test
    void openEndsCarryTheRailsHalfABlockFurther() {
        RailGraph graph = new RailGraph();
        RailSegment segment = graph.createSegment(new Vector3d(0.5, 64, 0.5), X, new Vector3d(10.5, 64, 0.5), X);

        TrackPath path = TrackSweep.path(graph, segment);

        assertTrue(graph.overhangAt(segment, segment.nodeA()));
        assertTrue(graph.overhangAt(segment, segment.nodeB()));
        assertEquals(11.0, path.length(), 1.0e-9);
        assertEquals(0.0, path.samplePosition(0.0).x, 1.0e-9);
        assertEquals(11.0, path.samplePosition(11.0).x, 1.0e-9);
    }

    @Test
    void jointIsNoOpenEnd() {
        RailGraph graph = new RailGraph();
        RailSegment first = graph.createSegment(new Vector3d(0.5, 64, 0.5), X, new Vector3d(10.5, 64, 0.5), X);
        RailSegment second = graph.createSegment(new Vector3d(10.5, 64, 0.5), X, new Vector3d(20.5, 64, 0.5), X);
        int joint = first.nodeB();

        assertFalse(graph.overhangAt(first, joint));
        assertFalse(graph.overhangAt(second, joint));
        assertEquals(10.5, TrackSweep.path(graph, first).length(), 1.0e-9, "open at the far end only");
    }

    @Test
    void coDirectionalTwinsShareOneOverhang() {
        RailGraph graph = new RailGraph();
        Vector3d toe = new Vector3d(0.5, 64, 0.5);
        RailSegment straight = graph.createSegment(toe, X, new Vector3d(12.5, 64, 0.5), X);
        RailSegment diverging = graph.createSegment(toe, X, new Vector3d(12.5, 64, 4.5), X);

        assertTrue(graph.overhangAt(straight, straight.nodeA()), "the lower id draws the toe overhang");
        assertFalse(graph.overhangAt(diverging, diverging.nodeA()));
    }

    @Test
    void tileCountRoundsToWholeTilesAtLeastOne() {
        assertEquals(10, TrackSweep.tileCount(10.4, 1.0));
        assertEquals(11, TrackSweep.tileCount(10.5, 1.0));
        assertEquals(1, TrackSweep.tileCount(0.2, 1.0));
        assertEquals(2, TrackSweep.tileCount(3.25, 1.625));
    }

    @Test
    void frameIsOrthonormalWithHorizontalRight() {
        TrackPath path = new HermiteSegmentPath(new HermiteSegment(
                new Vector3d(0, 64, 0), new Vector3d(10, 2, 0), new Vector3d(10, 66, 8), new Vector3d(0, 2, 10)));
        double[] frame = new double[TrackSweep.FRAME_STRIDE];
        TrackSweep.frame(path, 5.0, frame, 0);
        Vector3d fwd = new Vector3d(frame[3], frame[4], frame[5]);
        Vector3d right = new Vector3d(frame[6], frame[7], frame[8]);
        Vector3d up = new Vector3d(frame[9], frame[10], frame[11]);

        assertEquals(1.0, fwd.length(), 1.0e-9);
        assertEquals(1.0, right.length(), 1.0e-9);
        assertEquals(1.0, up.length(), 1.0e-9);
        assertEquals(0.0, right.y, 1.0e-12, "right stays horizontal: the gauge is level");
        assertEquals(0.0, fwd.dot(right), 1.0e-9);
        assertEquals(0.0, fwd.dot(up), 1.0e-9);
        assertTrue(up.y > 0.0);
    }
}
