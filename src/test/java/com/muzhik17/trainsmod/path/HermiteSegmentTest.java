package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

class HermiteSegmentTest {

    private static final double EPS = 1.0e-9;

    private static void assertVecEquals(Vector3d expected, Vector3d actual, double eps) {
        assertEquals(expected.x, actual.x, eps, "x");
        assertEquals(expected.y, actual.y, eps, "y");
        assertEquals(expected.z, actual.z, eps, "z");
    }

    @Test
    void endpointsMatchControlPoints() {
        HermiteSegment segment = new HermiteSegment(
                new Vector3d(1, 2, 3), new Vector3d(5, 0, 0),
                new Vector3d(10, 4, -2), new Vector3d(0, 0, 5));
        assertVecEquals(new Vector3d(1, 2, 3), segment.position(0.0), EPS);
        assertVecEquals(new Vector3d(10, 4, -2), segment.position(1.0), EPS);
    }

    @Test
    void endpointVelocitiesMatchTangents() {
        Vector3d m0 = new Vector3d(5, 1, 0);
        Vector3d m1 = new Vector3d(0, -2, 5);
        HermiteSegment segment = new HermiteSegment(
                new Vector3d(0, 0, 0), m0, new Vector3d(10, 0, 0), m1);
        assertVecEquals(m0, segment.velocity(0.0), EPS);
        assertVecEquals(m1, segment.velocity(1.0), EPS);
    }

    @Test
    void straightSegmentIsTheLineAB() {
        Vector3d a = new Vector3d(0, 64, 0);
        Vector3d b = new Vector3d(30, 64, 40);
        HermiteSegment segment = HermiteSegment.straight(a, b);
        // straight Hermite with chord tangents is uniform in t
        assertVecEquals(new Vector3d(15, 64, 20), segment.position(0.5), EPS);
        assertVecEquals(new Vector3d(7.5, 64, 10), segment.position(0.25), EPS);
    }

    @Test
    void sharedTangentGivesC1Continuity() {
        // two segments sharing node position + tangent (the whole point of Hermite, SPEC #1)
        Vector3d shared = new Vector3d(10, 0, 10);
        Vector3d sharedTangent = new Vector3d(0, 0, 12);
        HermiteSegment first = new HermiteSegment(
                new Vector3d(0, 0, 0), new Vector3d(12, 0, 0), shared, sharedTangent);
        HermiteSegment second = new HermiteSegment(
                shared, sharedTangent, new Vector3d(10, 5, 30), new Vector3d(0, 0, 12));
        assertVecEquals(first.position(1.0), second.position(0.0), EPS);
        assertVecEquals(first.velocity(1.0), second.velocity(0.0), EPS);
    }

    @Test
    void curveStaysNearControlPolygonScale() {
        // sanity: a gentle 90° turn does not overshoot wildly
        HermiteSegment segment = new HermiteSegment(
                new Vector3d(0, 0, 0), new Vector3d(20, 0, 0),
                new Vector3d(20, 0, 20), new Vector3d(0, 0, 20));
        for (int i = 0; i <= 100; i++) {
            Vector3d p = segment.position(i / 100.0);
            assertTrue(p.x >= -1 && p.x <= 25, "x in range: " + p);
            assertTrue(p.z >= -1 && p.z <= 25, "z in range: " + p);
            assertEquals(0.0, p.y, EPS);
        }
    }
}
