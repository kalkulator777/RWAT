package com.muzhik17.trainsmod.consist;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RailSegment;

/**
 * Issue-2 regression (2026-06-11): the routing a consist's {@code reanchor}
 * relies on — re-walking from the segment under the head after a switch is
 * thrown — must reach the previously inactive leg facing, and pass the switch
 * trailing from either leg. {@code Consist} itself can't be unit-tested here
 * (it pulls in the MC runtime, absent on the plain test classpath), so this
 * exercises the graph-level walk reanchor performs.
 */
class ConsistReanchorTest {

    private static RailSegment connect(RailGraph graph, Vector3d a, Vector3d b) {
        Vector3d chord = new Vector3d(b).sub(a);
        return graph.createSegment(a, chord, b, chord);
    }

    /** trunk —→ toe, two legs diverging from the toe (lower id = legStraight). */
    private record Switch(RailGraph graph, int toe, RailSegment trunk,
            RailSegment legStraight, RailSegment legDiverge) {
    }

    private static Switch buildSwitch() {
        RailGraph graph = new RailGraph();
        RailSegment trunk = connect(graph, new Vector3d(-20, 0, 0), new Vector3d(0, 0, 0));
        RailSegment legStraight = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 0));
        RailSegment legDiverge = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 18));
        int toe = graph.nodeNear(new Vector3d(0, 0, 0)).id();
        return new Switch(graph, toe, trunk, legStraight, legDiverge);
    }

    private static boolean routeHas(List<RailGraph.RouteLeg> route, int segmentId) {
        for (RailGraph.RouteLeg leg : route) {
            if (leg.segmentId() == segmentId) {
                return true;
            }
        }
        return false;
    }

    @Test
    void reWalkingAfterAThrowReachesThePreviouslyInactiveLeg() {
        Switch sw = buildSwitch();
        // head on the trunk, default selection → the route through the straight leg
        List<RailGraph.RouteLeg> before = sw.graph().walkRoute(sw.trunk().id());
        assertTrue(routeHas(before, sw.legStraight().id()), "default route takes the straight leg");

        // the throw: re-walking from the trunk (what reanchor does) takes the other leg
        sw.graph().setSwitchSelection(sw.toe(), 1);
        List<RailGraph.RouteLeg> after = sw.graph().walkRoute(sw.trunk().id());
        assertTrue(routeHas(after, sw.legDiverge().id()),
                "after the throw the route runs onto the diverging leg");
        assertTrue(routeHas(after, sw.trunk().id()), "and still includes the trunk under the head");
    }

    @Test
    void trailingExitsTheSwitchFromEitherLeg() {
        for (boolean fromDiverging : new boolean[] {false, true}) {
            Switch sw = buildSwitch();
            // select the OTHER leg, so the one we sit on is the inactive path
            sw.graph().setSwitchSelection(sw.toe(), fromDiverging ? 0 : 1);
            RailSegment leg = fromDiverging ? sw.legDiverge() : sw.legStraight();

            List<RailGraph.RouteLeg> route = sw.graph().walkRoute(leg.id());
            assertTrue(routeHas(route, sw.trunk().id()),
                    "trailing out of the inactive leg reaches the trunk (fromDiverging=" + fromDiverging + ")");
            assertEquals(2, route.size(), "leg + trunk, nothing dropped");
        }
    }
}
