package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/**
 * Editing the rail graph (SPEC §2.2): segments the graph refuses — no track
 * left once the ends snap — and ids that outlive a restart.
 */
class RailGraphEditTest {

    private static final Vector3d X = new Vector3d(1, 0, 0);

    private static RailSegment connect(RailGraph graph, double ax, double bx) {
        return graph.createSegment(new Vector3d(ax, 64, 0.5), X, new Vector3d(bx, 64, 0.5), X);
    }

    private static Vector3d at(double x, double z) {
        return new Vector3d(x, 64, z);
    }

    /** The graph refuses the segment for {@code expected} and is left exactly as it was. */
    private static void assertRefused(RailGraph graph, RailGraph.Refusal expected,
            Vector3d a, Vector3d dirA, Vector3d b, Vector3d dirB) {
        int nodes = graph.nodes().size();
        int segments = graph.segments().size();
        int nextNode = graph.nextNodeId();
        assertEquals(expected, graph.refusal(a, dirA, false, b, dirB, false));
        assertNull(graph.createSegment(a, dirA, b, dirB), "refused: " + expected);
        assertEquals(nodes, graph.nodes().size(), "no node left behind");
        assertEquals(segments, graph.segments().size());
        assertEquals(nextNode, graph.nextNodeId(), "nothing was created, not even for a moment");
    }

    @Test
    void bothEndsSnappingToOneNodeAreRefused() {
        RailGraph graph = new RailGraph();
        connect(graph, 0.5, 20.5);
        // markers 2.8 blocks apart, each 1.4 from the track end: both snap onto it
        assertRefused(graph, RailGraph.Refusal.SAME_NODE, at(19.5, 1.5), X, at(21.5, -0.5), X);
    }

    @Test
    void theFarEndDoesNotSnapToTheNodeTheNearEndJustMade() {
        RailGraph graph = new RailGraph();
        // nothing to snap to: the far end used to snap onto the near end's new node — a loop
        assertRefused(graph, RailGraph.Refusal.TOO_SHORT, at(0.5, 0.5), X, at(1.9, 0.5), X);
        assertNotNull(graph.createSegment(at(0.5, 0.5), X, at(2.5, 0.5), X), "two blocks is enough");
    }

    @Test
    void endsSnappingToNodesTooCloseTogetherAreRefused() {
        RailGraph graph = new RailGraph();
        connect(graph, 0.5, 20.5);
        connect(graph, 22.1, 42.1); // another track ends 1.6 blocks on
        // the markers are 4.3 apart, but they snap to the two track ends
        assertRefused(graph, RailGraph.Refusal.TOO_SHORT, at(19.2, 0.5), X, at(23.5, 0.5), X);
    }

    @Test
    void aSecondSegmentOntoTheSameTwoNodesWithTheSameAxesIsADuplicate() {
        RailGraph graph = new RailGraph();
        connect(graph, 0.5, 20.5);
        assertRefused(graph, RailGraph.Refusal.DUPLICATE, at(1.0, 0.5), X, at(20.0, 0.5), X);
        assertRefused(graph, RailGraph.Refusal.DUPLICATE, at(20.0, 1.0), X, at(1.0, 0.0), X);
        // a marker's own axis at a snapped end doesn't matter: the node's is used
        assertRefused(graph, RailGraph.Refusal.DUPLICATE, at(1.0, 0.5), new Vector3d(0, 0, 1),
                at(20.0, 0.5), X);
    }

    @Test
    void anotherCurveBetweenTheSameTwoNodesIsNotADuplicate() {
        RailGraph graph = new RailGraph();
        connect(graph, 0.5, 20.5);
        Vector3d diagonal = new Vector3d(1, 0, 1).normalize();
        // a forced axis at one end (as X-crossing legs carry) is another curve
        assertNull(graph.refusal(at(0.5, 0.5), diagonal, true, at(20.5, 0.5), X, false));
        assertNotNull(graph.createSegment(at(0.5, 0.5), diagonal, true, at(20.5, 0.5), X, false));
        assertEquals(2, graph.segments().size());
    }

    @Test
    void aSwitchFromOneToeIsNoDuplicate() {
        RailGraph graph = new RailGraph();
        assertNotNull(graph.createSegment(at(0.5, 0.5), X, at(16.5, 0.5), X));
        assertNotNull(graph.createSegment(at(0.5, 0.5), X, at(16.5, 4.5), X), "the diverging leg");
        assertEquals(3, graph.nodes().size());
    }

    /** What a save and a load carry over: the nodes, the segments and the id counters. */
    private static RailGraph reloaded(RailGraph saved) {
        RailGraph loaded = new RailGraph();
        for (RailNode node : saved.nodes()) {
            loaded.putNode(new RailNode(node.id(), node.position(), node.direction()));
        }
        for (RailSegment segment : saved.segments()) {
            loaded.putSegment(segment);
        }
        loaded.restoreNextIds(saved.nextNodeId(), saved.nextSegmentId(), saved.nextGroupId());
        return loaded;
    }

    @Test
    void idsOfDemolishedTrackAreNotHandedOutAgainAfterARestart() {
        RailGraph graph = new RailGraph();
        connect(graph, 0.5, 20.5);
        RailSegment last = connect(graph, 20.5, 40.5);
        int group = graph.newGroupId();
        graph.setSegmentGroup(last.id(), group);
        graph.removeSegment(last.id()); // demolished: its far node goes with it

        RailGraph loaded = reloaded(graph);
        RailSegment rebuilt = connect(loaded, 60.5, 80.5);
        assertEquals(last.id() + 1, rebuilt.id(),
                "a consist still holding the demolished id must not find new track under it");
        assertEquals(4, loaded.node(rebuilt.nodeA()).id(), "node ids 1–3 were taken before the restart");
        assertEquals(group + 1, loaded.newGroupId());
    }

    @Test
    void aSaveWithoutCountersLoadsAndCountsOnFromTheLoadedIds() {
        RailGraph graph = new RailGraph();
        connect(graph, 0.5, 20.5);
        RailSegment second = connect(graph, 20.5, 40.5);

        RailGraph loaded = new RailGraph();
        for (RailNode node : graph.nodes()) {
            loaded.putNode(new RailNode(node.id(), node.position(), node.direction()));
        }
        for (RailSegment segment : graph.segments()) {
            loaded.putSegment(segment);
        }
        loaded.restoreNextIds(0, 0, 0); // the fields are missing: getInt reads 0

        assertEquals(second.id() + 1, loaded.nextSegmentId());
        assertEquals(4, loaded.nextNodeId());
        assertEquals(1, loaded.nextGroupId());
    }

    @Test
    void savedCountersNeverPullTheLoadedIdsBack() {
        RailGraph graph = new RailGraph();
        connect(graph, 0.5, 20.5);
        RailSegment second = connect(graph, 20.5, 40.5);

        RailGraph loaded = reloaded(graph);
        loaded.restoreNextIds(1, 1, 1); // a stale or hand-edited save
        assertEquals(second.id() + 1, loaded.nextSegmentId());
        assertEquals(4, loaded.nextNodeId());
    }
}
