package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

class HermiteSegmentPathTest {

    @Test
    void equalStepsInSAreEqualDistances() {
        // the whole point of arc length: on a curve where t-speed varies,
        // stepping s uniformly still moves uniformly in space
        HermiteSegment segment = new HermiteSegment(
                new Vector3d(0, 0, 0), new Vector3d(40, 0, 0), // fast start
                new Vector3d(20, 0, 20), new Vector3d(0, 0, 5)); // slow end
        HermiteSegmentPath path = new HermiteSegmentPath(segment);

        int steps = 50;
        double stepLength = path.length() / steps;
        Vector3d previous = path.samplePosition(0.0);
        for (int i = 1; i <= steps; i++) {
            Vector3d current = path.samplePosition(i * stepLength);
            double moved = previous.distance(current);
            // chord of a smooth curve step: close to the arc step, never longer
            assertEquals(stepLength, moved, stepLength * 0.05,
                    "uniform motion at step " + i);
            previous = current;
        }
    }

    @Test
    void tangentIsUnitAndFollowsTravel() {
        HermiteSegmentPath path = new HermiteSegmentPath(new HermiteSegment(
                new Vector3d(0, 0, 0), new Vector3d(20, 8, 0),
                new Vector3d(20, 5, 20), new Vector3d(0, 0, 20)));
        for (int i = 0; i <= 20; i++) {
            double s = path.length() * i / 20.0;
            Vector3d tangent = path.sampleTangent(s);
            assertEquals(1.0, tangent.length(), 1.0e-9, "unit tangent at s=" + s);
            // tangent matches finite-difference travel direction
            double ds = Math.min(0.05, path.length() / 1000.0);
            if (s + ds <= path.length()) {
                Vector3d ahead = path.samplePosition(s + ds).sub(path.samplePosition(s)).normalize();
                assertTrue(tangent.dot(ahead) > 0.999, "tangent follows travel at s=" + s);
            }
        }
    }

    @Test
    void straightPathMatchesStraightLinePath() {
        Vector3d a = new Vector3d(3, 70, -5);
        Vector3d b = new Vector3d(53, 75, 45);
        HermiteSegmentPath hermite = new HermiteSegmentPath(HermiteSegment.straight(a, b));
        StraightLinePath straight = new StraightLinePath(a, b);
        assertEquals(straight.length(), hermite.length(), 1.0e-6);
        for (int i = 0; i <= 10; i++) {
            double s = straight.length() * i / 10.0;
            Vector3d expected = straight.samplePosition(s);
            Vector3d actual = hermite.samplePosition(s);
            assertEquals(0.0, expected.distance(actual), 1.0e-6, "position at s=" + s);
        }
    }
}
