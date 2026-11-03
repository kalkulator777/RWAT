package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/**
 * A switch thrown by redstone (SPEC §2.2 v1) travels to the clients as its
 * new selection alone, not as the whole graph: the server says which
 * switches were thrown and how they are set now, and a client's copy of the
 * graph, set so, routes as the server's does.
 */
class SwitchThrowTest {

    private static final Vector3d X = new Vector3d(1, 0, 0);

    /** Two Y-switches, toes at x = 0.5 and 100.5: a trunk, then a straight and a diverging leg. */
    private static RailGraph twoSwitches() {
        RailGraph graph = new RailGraph();
        for (double toe : new double[] {0.5, 100.5}) {
            graph.createSegment(new Vector3d(toe - 20, 64, 0.5), X, new Vector3d(toe, 64, 0.5), X);
            graph.createSegment(new Vector3d(toe, 64, 0.5), X, new Vector3d(toe + 20, 64, 0.5), X);
            graph.createSegment(new Vector3d(toe, 64, 0.5), X, new Vector3d(toe + 20, 64, 4.5), X);
        }
        return graph;
    }

    private static int toe(RailGraph graph, double x) {
        return graph.nodeNear(new Vector3d(x, 64, 0.5)).id();
    }

    /** The client's copy, as the full sync builds it: the same nodes and segments, its own switch state. */
    private static RailGraph copy(RailGraph graph) {
        RailGraph copy = new RailGraph();
        for (RailNode node : graph.nodes()) {
            copy.putNode(new RailNode(node.id(), node.position(), node.direction()));
        }
        for (RailSegment segment : graph.segments()) {
            copy.putSegment(segment);
        }
        copy.switchSelections().putAll(graph.switchSelections());
        return copy;
    }

    @Test
    void onlyTheSwitchesThrownTravelWithTheirNewSetting() {
        RailGraph server = twoSwitches();
        int a = toe(server, 0.5);
        int b = toe(server, 100.5);
        server.throwSwitches(List.of(a)); // set long ago: known to every client
        Map<Integer, Integer> thrown = server.throwSwitches(List.of(b));
        assertEquals(Map.of(b, 1), thrown, "not switch A, which didn't move");
        assertEquals(1, server.switchSelection(a));
        assertEquals(1, server.switchSelection(b));
    }

    @Test
    void aSwitchThrownTwiceInATickTravelsOnceAtItsLastSetting() {
        RailGraph server = twoSwitches();
        int a = toe(server, 0.5);
        int b = toe(server, 100.5);
        Map<Integer, Integer> thrown = server.throwSwitches(List.of(b, a, b));
        assertEquals(List.of(b, a), new ArrayList<>(thrown.keySet()), "once each, in the order thrown");
        assertEquals(2, thrown.get(b));
        assertEquals(1, thrown.get(a));
    }

    @Test
    void aNodeNoLongerInTheGraphIsNotThrown() {
        RailGraph server = twoSwitches();
        assertEquals(Map.of(), server.throwSwitches(List.of(999)));
        assertTrue(server.switchSelections().isEmpty());
    }

    @Test
    void theClientsCopySetSoRoutesAsTheServersDoes() {
        RailGraph server = twoSwitches();
        RailGraph client = copy(server);
        int a = toe(server, 0.5);
        RailSegment trunkSide = server.segment(server.node(a).segments().get(0));
        RailSegment before = client.continuation(trunkSide, a);

        Map<Integer, Integer> thrown = server.throwSwitches(List.of(a));
        assertTrue(client.setSwitchSelections(thrown), "a change: the client's renderer and paths must see it");
        assertEquals(server.switchSelections(), client.switchSelections());
        assertEquals(server.continuation(trunkSide, a), client.continuation(trunkSide, a));
        assertFalse(before.equals(client.continuation(trunkSide, a)), "the throw changed the route");
    }

    @Test
    void settingWhatTheCopyAlreadyHasOrDoesntKnowIsNoChange() {
        RailGraph server = twoSwitches();
        RailGraph client = copy(server);
        Map<Integer, Integer> thrown = server.throwSwitches(List.of(toe(server, 0.5)));
        client.setSwitchSelections(thrown);
        assertFalse(client.setSwitchSelections(thrown), "the same setting again");
        assertFalse(client.setSwitchSelections(Map.of(999, 3)), "a node the copy doesn't have");
        assertEquals(server.switchSelections(), client.switchSelections());
    }
}
