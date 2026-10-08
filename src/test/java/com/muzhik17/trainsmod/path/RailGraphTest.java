package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

class RailGraphTest {

    /** Connect two points with chord-aligned tangents (what straight markers produce). */
    private static RailSegment connect(RailGraph graph, Vector3d a, Vector3d b) {
        Vector3d chord = new Vector3d(b).sub(a);
        return graph.createSegment(a, chord, b, chord);
    }

    @Test
    void chainedSegmentsReuseNodesAndStayConnected() {
        RailGraph graph = new RailGraph();
        connect(graph, new Vector3d(0, 64, 0), new Vector3d(20, 64, 0));
        // second segment starts where the first ended (within snap radius)
        connect(graph, new Vector3d(20.4, 64, 0.3), new Vector3d(40, 64, 10));

        assertEquals(3, graph.nodes().size(), "shared middle node, not four nodes");
        assertEquals(2, graph.segments().size());
        RailNode middle = graph.nodeNear(new Vector3d(20, 64, 0));
        assertNotNull(middle);
        assertEquals(2, middle.segments().size(), "middle node connects both segments");
    }

    @Test
    void sharedNodeGivesDirectionContinuityAcrossJoint() {
        RailGraph graph = new RailGraph();
        RailSegment first = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 0));
        RailSegment second = connect(graph, new Vector3d(20, 0, 0), new Vector3d(40, 0, 20));

        Vector3d endOfFirst = graph.hermite(first).velocity(1.0).normalize();
        Vector3d startOfSecond = graph.hermite(second).velocity(0.0).normalize();
        assertEquals(1.0, endOfFirst.dot(startOfSecond), 1.0e-9, "G1 continuity at the joint");
    }

    @Test
    void removingSegmentCleansUpOrphanNodes() {
        RailGraph graph = new RailGraph();
        RailSegment first = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 0));
        connect(graph, new Vector3d(20, 0, 0), new Vector3d(40, 0, 0));

        graph.removeSegment(first.id());
        assertEquals(1, graph.segments().size());
        assertEquals(2, graph.nodes().size(), "orphan start node removed, shared node kept");
        assertNull(graph.nodeNear(new Vector3d(0, 0, 0)));
    }

    @Test
    void walkRouteCoversTheWholeBranchInOrder() {
        RailGraph graph = new RailGraph();
        RailSegment s1 = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 0));
        RailSegment s2 = connect(graph, new Vector3d(20, 0, 0), new Vector3d(40, 0, 0));
        RailSegment s3 = connect(graph, new Vector3d(40, 0, 0), new Vector3d(60, 0, 0));

        // start from the middle: route must include all three, in line order
        List<RailGraph.RouteLeg> route = graph.walkRoute(s2.id());
        assertEquals(3, route.size());
        assertEquals(s1.id(), route.get(0).segmentId());
        assertEquals(s2.id(), route.get(1).segmentId());
        assertEquals(s3.id(), route.get(2).segmentId());

        RoutePath path = graph.buildRoutePath(route);
        assertNotNull(path);
        assertEquals(60.0, path.length(), 1.0e-6);
        // monotonic s sweeps the whole line start→end
        assertEquals(0.0, path.samplePosition(0.0).distance(new Vector3d(0, 0, 0)), 1.0e-6);
        assertEquals(0.0, path.samplePosition(60.0).distance(new Vector3d(60, 0, 0)), 1.0e-6);
        assertEquals(0.0, path.samplePosition(30.0).distance(new Vector3d(30, 0, 0)), 1.0e-6);
    }

    @Test
    void routePathHandlesSegmentsBuiltInOppositeDirections() {
        RailGraph graph = new RailGraph();
        // second segment built "backwards": from far point toward the shared node
        RailSegment s1 = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 0));
        connect(graph, new Vector3d(40, 0, 0), new Vector3d(20, 0, 0));

        RoutePath path = graph.buildRoutePath(graph.walkRoute(s1.id()));
        assertNotNull(path);
        assertEquals(40.0, path.length(), 1.0e-6);
        Vector3d previous = path.samplePosition(0.0);
        for (int i = 1; i <= 40; i++) {
            Vector3d current = path.samplePosition(i);
            assertEquals(1.0, previous.distance(current), 1.0e-6, "uniform 1-block steps at s=" + i);
            // tangent always points in travel direction, no flip at the joint
            Vector3d tangent = path.sampleTangent(i - 0.5);
            assertTrue(tangent.x > 0.99, "tangent follows travel at s=" + (i - 0.5));
            previous = current;
        }
    }

    @Test
    void walkRouteFollowsSwitchSelection() {
        RailGraph graph = new RailGraph();
        RailSegment trunk = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 0));
        // two diverging legs leaving the same node: a facing switch (SPEC §2.2 v1)
        RailSegment straight = connect(graph, new Vector3d(20, 0, 0), new Vector3d(40, 0, 0));
        RailSegment diverging = connect(graph, new Vector3d(20, 0, 0), new Vector3d(40, 0, 20));
        int toe = graph.nodeNear(new Vector3d(20, 0, 0)).id();

        // default selection: the lowest-id leg
        List<RailGraph.RouteLeg> route = graph.walkRoute(trunk.id());
        assertEquals(2, route.size(), "route follows the selected leg through the switch");
        assertEquals(straight.id(), route.get(1).segmentId());

        // thrown switch: the other leg
        graph.setSwitchSelection(toe, 1);
        route = graph.walkRoute(trunk.id());
        assertEquals(2, route.size());
        assertEquals(diverging.id(), route.get(1).segmentId());

        // trailing entry (from a leg) passes through to the trunk regardless
        route = graph.walkRoute(straight.id());
        assertEquals(2, route.size(), "trailing move passes the switch onto the trunk");
        assertEquals(trunk.id(), route.get(0).segmentId());
    }

    @Test
    void walkRouteStopsAtCusps() {
        RailGraph graph = new RailGraph();
        // second segment doubles back at ~117° — a train cannot pass that joint
        RailSegment first = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 0));
        connect(graph, new Vector3d(20, 0, 0), new Vector3d(10, 0, 20));

        List<RailGraph.RouteLeg> route = graph.walkRoute(first.id());
        assertEquals(1, route.size(), "a cusp ends the route");
    }

    @Test
    void crossingForcedTangentsKeepBothPathsStraightThroughTheSharedNode() {
        RailGraph graph = new RailGraph();
        // X-crossing built the way RailItem does it: centre node M carries the
        // first path's axis, the second path's legs force their own axis at M
        Vector3d m = new Vector3d(10, 0, 10);
        Vector3d axis1 = new Vector3d(1, 0, 0);
        Vector3d axis2 = new Vector3d(0, 0, 1);
        graph.createSegment(new Vector3d(0, 0, 10), axis1, false, m, axis1, false);
        graph.createSegment(m, axis1, false, new Vector3d(20, 0, 10), axis1, false);
        RailSegment leg3 = graph.createSegment(new Vector3d(10, 0, 0), axis2, false, m, axis2, true);
        RailSegment leg4 = graph.createSegment(m, axis2, true, new Vector3d(10, 0, 20), axis2, false);

        assertEquals(5, graph.nodes().size(), "four ends + one shared centre");
        RailNode centre = graph.nodeNear(m);
        assertNotNull(centre);
        assertEquals(4, centre.segments().size(), "centre node joins all four legs");

        // the second path must run along its own axis at M, not bend toward the
        // node's stored axis1 — that is exactly what the per-end override fixes
        Vector3d intoCentre = graph.hermite(leg3).velocity(1.0).normalize();
        Vector3d outOfCentre = graph.hermite(leg4).velocity(0.0).normalize();
        assertEquals(1.0, Math.abs(intoCentre.dot(axis2)), 1.0e-9, "leg C–M stays on its axis at M");
        assertEquals(1.0, Math.abs(outOfCentre.dot(axis2)), 1.0e-9, "leg M–D stays on its axis at M");
        assertEquals(1.0, intoCentre.dot(outOfCentre), 1.0e-9, "G1 continuity through the crossing");
    }

    @Test
    void walkRouteRunsStraightThroughACrossingCentre() {
        RailGraph graph = new RailGraph();
        Vector3d m = new Vector3d(10, 0, 10);
        Vector3d axis1 = new Vector3d(1, 0, 0);
        Vector3d axis2 = new Vector3d(0, 0, 1);
        RailSegment in = graph.createSegment(new Vector3d(0, 0, 10), axis1, false, m, axis1, false);
        RailSegment out = graph.createSegment(m, axis1, false, new Vector3d(20, 0, 10), axis1, false);
        graph.createSegment(new Vector3d(10, 0, 0), axis2, false, m, axis2, true);
        graph.createSegment(m, axis2, true, new Vector3d(10, 0, 20), axis2, false);

        // the perpendicular path is no continuation: the route crosses straight over
        List<RailGraph.RouteLeg> route = graph.walkRoute(in.id());
        assertEquals(2, route.size(), "route crosses the centre without turning");
        assertEquals(in.id(), route.get(0).segmentId());
        assertEquals(out.id(), route.get(1).segmentId());
    }

    @Test
    void groupedSegmentsFormOneStructure() {
        RailGraph graph = new RailGraph();
        RailSegment leg1 = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 0));
        RailSegment leg2 = connect(graph, new Vector3d(20, 0, 0), new Vector3d(40, 0, 10));
        RailSegment lone = connect(graph, new Vector3d(100, 0, 0), new Vector3d(120, 0, 0));

        int group = graph.newGroupId();
        graph.setSegmentGroup(leg1.id(), group);
        graph.setSegmentGroup(leg2.id(), group);

        assertEquals(2, graph.structureOf(graph.segment(leg1.id())).size(),
                "both grouped segments belong to the structure");
        assertEquals(1, graph.structureOf(graph.segment(lone.id())).size(),
                "an ungrouped segment is its own structure");
        // grouping must not disturb node wiring (setSegmentGroup replaces the record)
        assertEquals(2, graph.nodeNear(new Vector3d(20, 0, 0)).segments().size());
    }

    /** A smooth closed square loop: every corner shares the node tangent (no cusps). */
    private static RailSegment squareLoop(RailGraph graph) {
        RailSegment s1 = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 0));
        connect(graph, new Vector3d(20, 0, 0), new Vector3d(20, 0, 20));
        connect(graph, new Vector3d(20, 0, 20), new Vector3d(0, 0, 20));
        connect(graph, new Vector3d(0, 0, 20), new Vector3d(0, 0, 0)); // closes the loop
        return s1;
    }

    @Test
    void walkRouteTerminatesOnCycles() {
        RailGraph graph = new RailGraph();
        RailSegment s1 = squareLoop(graph);

        List<RailGraph.RouteLeg> route = graph.walkRoute(s1.id());
        assertEquals(4, route.size(), "cycle walked exactly once");
    }

    @Test
    void closedRouteIsALoopAndWrapsInsteadOfClamping() {
        RailGraph graph = new RailGraph();
        RailSegment s1 = squareLoop(graph);

        RoutePath path = graph.buildRoutePath(graph.walkRoute(s1.id()));
        assertNotNull(path);
        assertTrue(path.loop(), "closed route must report loop()");
        double length = path.length();
        // wrap: s beyond the end and s negative both land back on the loop
        assertEquals(0.0, path.samplePosition(length + 1.0)
                .distance(path.samplePosition(1.0)), 1.0e-9, "wraps past the end");
        assertEquals(0.0, path.samplePosition(-1.0)
                .distance(path.samplePosition(length - 1.0)), 1.0e-9, "wraps below zero");

        // an open chain must stay clamped
        RailGraph open = new RailGraph();
        RailSegment o1 = connect(open, new Vector3d(0, 0, 0), new Vector3d(20, 0, 0));
        connect(open, new Vector3d(20, 0, 0), new Vector3d(40, 0, 0));
        RoutePath openPath = open.buildRoutePath(open.walkRoute(o1.id()));
        assertNotNull(openPath);
        assertTrue(!openPath.loop(), "open route must not report loop()");
    }

    @Test
    void nearestPointIsExactAndRespectsTheReach() {
        RailGraph graph = new RailGraph();
        connect(graph, new Vector3d(0, 64, 0), new Vector3d(100, 64, 0));
        RailSegment far = connect(graph, new Vector3d(0, 64, 50), new Vector3d(100, 64, 50));

        // a click on the bed 1.2 blocks beside the far track, mid-length
        RailGraph.SegmentHit hit = graph.nearestPoint(new Vector3d(37.3, 64.1, 51.2), 2.5);
        assertNotNull(hit);
        assertEquals(far.id(), hit.segment().id());
        assertEquals(37.3, hit.s(), 1.0e-3, "arc length of the foot point, not a coarse sample");
        assertEquals(Math.hypot(0.1, 1.2), hit.distance(), 1.0e-3);

        assertNull(graph.nearestPoint(new Vector3d(50, 64, 25), 2.5), "between the tracks: out of reach");
    }

    @Test
    void routeArcLengthFollowsLegOrderAndDirection() {
        RailGraph graph = new RailGraph();
        RailSegment first = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 0));
        // built from its far end: the route walks it B→A
        RailSegment second = connect(graph, new Vector3d(50, 0, 0), new Vector3d(20, 0, 0));

        List<RailGraph.RouteLeg> legs = graph.walkRoute(first.id());
        RoutePath path = graph.buildRoutePath(legs);
        assertNotNull(path);
        // 10 blocks into the second segment from its own A end = x 40
        double s = graph.routeS(legs, second.id(), 10.0);
        assertEquals(0.0, path.samplePosition(s).distance(new Vector3d(40, 0, 0)), 1.0e-6);
        assertTrue(Double.isNaN(graph.routeS(legs, 999, 1.0)), "segment not on the route");
    }
}
