package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/**
 * Loading a saved rail graph (decision D7): a damaged record is skipped with
 * a reason, never an exception, and the rest of the graph loads. What a save
 * carries is read back through {@code RailNetwork.load}, which can't run
 * without Minecraft; it only turns the tags into the values these tests hand
 * to {@link RailGraph#restoreNode} and {@link RailGraph#restoreSegment}.
 */
class RailGraphRestoreTest {

    private static final Vector3d X = new Vector3d(1, 0, 0);

    /** Nodes 1, 2, 3 on the X axis, 20 blocks apart. */
    private static RailGraph threeNodes() {
        RailGraph graph = new RailGraph();
        assertNull(graph.restoreNode(1, new Vector3d(0, 64, 0), X));
        assertNull(graph.restoreNode(2, new Vector3d(20, 64, 0), X));
        assertNull(graph.restoreNode(3, new Vector3d(40, 64, 0), X));
        return graph;
    }

    private static RailSegment segment(int id, int a, int b) {
        return new RailSegment(id, a, 1, b, 1);
    }

    private static List<Integer> segmentIds(RailGraph graph) {
        return graph.segments().stream().map(RailSegment::id).toList();
    }

    @Test
    void aSegmentWhoseNodeIsMissingIsSkippedAndTheRestLoads() {
        RailGraph graph = threeNodes();
        assertNull(graph.restoreSegment(segment(1, 1, 2)));
        String problem = graph.restoreSegment(segment(2, 2, 9));
        assertNotNull(problem);
        assertTrue(problem.contains("node B (9) is missing"), problem);
        assertNull(graph.restoreSegment(segment(3, 2, 3)));

        assertEquals(List.of(1, 3), segmentIds(graph));
        assertEquals(List.of(1, 3), graph.node(2).segments(), "node 2 holds no trace of the skipped one");
        assertNull(graph.segment(2));
        // the rest still routes
        assertEquals(List.of(new RailGraph.RouteLeg(1, false), new RailGraph.RouteLeg(3, false)),
                graph.walkRoute(1));
    }

    @Test
    void aSegmentWithNoNodeAtEitherEndIsSkipped() {
        RailGraph graph = threeNodes();
        assertTrue(graph.restoreSegment(segment(1, 7, 2)).contains("node A (7)"));
        assertTrue(graph.restoreSegment(segment(2, 0, 0)).contains("node A (0)"), "a missing 'A' reads 0");
        assertTrue(graph.segments().isEmpty());
    }

    @Test
    void aNodeWhoseTangentHasNoDirectionIsSkipped() {
        for (Vector3d bad : List.of(
                new Vector3d(0, 0, 0), // an unset or non-numeric tangent reads as zeros
                new Vector3d(Double.NaN, 0, 1),
                new Vector3d(0, Double.POSITIVE_INFINITY, 0),
                new Vector3d(1.0e-12, 0, 0))) {
            RailGraph graph = new RailGraph();
            String problem = graph.restoreNode(1, new Vector3d(0, 64, 0), bad);
            assertNotNull(problem, "tangent " + bad);
            assertTrue(problem.contains("tangent"), problem);
            assertTrue(graph.nodes().isEmpty(), "tangent " + bad);
        }
        // a tangent of any honest length is normalised, as RailNode does
        RailGraph graph = new RailGraph();
        assertNull(graph.restoreNode(1, new Vector3d(0, 64, 0), new Vector3d(0, 0, 5)));
        assertEquals(1.0, graph.node(1).direction().length(), 1.0e-12);
    }

    @Test
    void aNodeOutsideTheWorldIsSkipped() {
        RailGraph graph = new RailGraph();
        assertNotNull(graph.restoreNode(1, new Vector3d(Double.NaN, 64, 0), X));
        assertNotNull(graph.restoreNode(2, new Vector3d(0, 64, 1.0e300), X));
        assertNotNull(graph.restoreNode(3, new Vector3d(3.5e7, 64, 0), X));
        assertNull(graph.restoreNode(4, new Vector3d(-2.9e7, 64, 2.9e7), X), "the far edge of the world is fine");
        assertEquals(1, graph.nodes().size());
    }

    @Test
    void aTangentOverrideThatIsNoDirectionSkipsTheSegment() {
        RailGraph graph = threeNodes();
        RailSegment zero = new RailSegment(1, 1, 1, 2, 1, new Vector3d(), null);
        assertTrue(graph.restoreSegment(zero).contains("tangent at A"));
        RailSegment nan = new RailSegment(2, 1, 1, 2, 1, null, new Vector3d(0, Double.NaN, 1));
        assertTrue(graph.restoreSegment(nan).contains("tangent at B"));
        RailSegment good = new RailSegment(3, 1, 1, 2, 1, new Vector3d(0, 0, 1), null);
        assertNull(graph.restoreSegment(good), "an honest override is kept");
        assertEquals(List.of(3), segmentIds(graph));
    }

    @Test
    void aSegmentWhoseEndSignIsNotPlusOrMinusOneIsSkipped() {
        RailGraph graph = threeNodes();
        assertTrue(graph.restoreSegment(new RailSegment(1, 1, 0, 2, 1)).contains("signs"));
        assertTrue(graph.restoreSegment(new RailSegment(2, 1, 1, 2, 7)).contains("signs"));
        assertNull(graph.restoreSegment(new RailSegment(3, 1, -1, 2, -1)));
    }

    @Test
    void aSegmentWithNoChordIsSkipped() {
        RailGraph graph = threeNodes();
        // a loop on one node: what the rails item could build before M19 — its tangents were NaN
        assertTrue(graph.restoreSegment(segment(1, 2, 2)).contains("both its ends are on node 2"));
        assertNull(graph.restoreNode(4, new Vector3d(20, 64, 0), X), "a node on the spot of node 2");
        assertTrue(graph.restoreSegment(segment(2, 2, 4)).contains("lie in one spot"));
        assertTrue(graph.segments().isEmpty());
    }

    @Test
    void anIdAlreadyTakenOrNotPositiveIsSkipped() {
        RailGraph graph = threeNodes();
        assertTrue(graph.restoreNode(2, new Vector3d(99, 64, 0), X).contains("already"));
        assertTrue(graph.restoreNode(0, new Vector3d(99, 64, 0), X).contains("no valid id"));
        assertNull(graph.restoreSegment(segment(5, 1, 2)));
        assertTrue(graph.restoreSegment(segment(5, 2, 3)).contains("already"));
        assertTrue(graph.restoreSegment(segment(-1, 2, 3)).contains("no valid id"));
        assertEquals(3, graph.nodes().size());
        assertEquals(List.of(5), segmentIds(graph));
        assertEquals(List.of(5), graph.node(2).segments(), "the one that was skipped isn't on the node");
    }

    @Test
    void theIdsOfSkippedRecordsAreNotHandedOutAgain() {
        RailGraph graph = new RailGraph();
        assertNotNull(graph.restoreNode(7, new Vector3d(), new Vector3d()));
        assertNull(graph.restoreNode(1, new Vector3d(0, 64, 0), X));
        assertNull(graph.restoreNode(2, new Vector3d(20, 64, 0), X));
        assertNotNull(graph.restoreSegment(segment(9, 1, 5)));
        assertEquals(8, graph.nextNodeId(), "a train's route may still name the skipped segment: its id stays dead");
        assertEquals(10, graph.nextSegmentId());
        RailSegment built = graph.createSegment(new Vector3d(0, 64, 0), X, new Vector3d(20, 64, 0), X);
        assertEquals(10, built.id());
    }

    @Test
    void aRouteOverASkippedSegmentIsGoneAsAfterADemolition() {
        RailGraph graph = threeNodes();
        assertNull(graph.restoreSegment(segment(1, 1, 2)));
        assertNotNull(graph.restoreSegment(segment(2, 2, 9)));
        assertNull(graph.restoreSegment(segment(3, 2, 3)));
        // the signal Consist.resolvePath turns into a stranded train (TrackPathSpec.Stranded.UNPLACED)
        assertNull(graph.buildRoutePath(List.of(new RailGraph.RouteLeg(1, false),
                new RailGraph.RouteLeg(2, false), new RailGraph.RouteLeg(3, false))));
        assertNotNull(graph.buildRoutePath(List.of(new RailGraph.RouteLeg(1, false),
                new RailGraph.RouteLeg(3, false))), "a route over what loaded is untouched");
    }

    @Test
    void nodesLeftWithoutSegmentsAreDroppedWithTheirSwitchSettings() {
        RailGraph graph = threeNodes();
        assertNull(graph.restoreSegment(segment(1, 1, 2)));
        assertNotNull(graph.restoreSegment(segment(2, 3, 8))); // node 3 is left alone
        assertEquals(List.of(3), graph.dropOrphanNodes());
        assertEquals(List.of(1, 2), graph.nodes().stream().map(RailNode::id).toList());

        assertNull(graph.restoreSwitchSelection(2, 3));
        assertEquals(3, graph.switchSelection(2));
        assertTrue(graph.restoreSwitchSelection(3, 1).contains("not in the graph"));
        assertEquals(Map.of(2, 3), graph.switchSelections());
        assertEquals(List.of(), graph.dropOrphanNodes(), "a healthy graph has no orphans");
    }

    /** What a healthy save carries comes back as it was: nothing a check could mistake for damage. */
    @Test
    void aHealthyGraphLoadsWholeThroughTheChecks() {
        RailGraph saved = new RailGraph();
        Vector3d diagonal = new Vector3d(1, 0, 1).normalize();
        saved.createSegment(new Vector3d(0.5, 64, 0.5), X, new Vector3d(20.5, 64, 0.5), X);
        saved.createSegment(new Vector3d(20.5, 64, 0.5), X, new Vector3d(40.5, 64, 12.5), diagonal);
        // a forced axis: the segment carries its own override, as an X-crossing leg does
        saved.createSegment(new Vector3d(0.5, 64, 0.5), diagonal, true, new Vector3d(20.5, 64, 0.5), X, false);
        saved.setSegmentGroup(2, saved.newGroupId());

        RailGraph loaded = new RailGraph();
        for (RailNode node : saved.nodes()) {
            assertNull(loaded.restoreNode(node.id(), node.position(), node.direction()));
        }
        for (RailSegment segment : saved.segments()) {
            assertNull(loaded.restoreSegment(segment));
        }
        assertEquals(List.of(), loaded.dropOrphanNodes());
        loaded.restoreNextIds(saved.nextNodeId(), saved.nextSegmentId(), saved.nextGroupId());

        assertEquals(saved.nodes().size(), loaded.nodes().size());
        assertEquals(saved.segments().size(), loaded.segments().size());
        for (RailSegment segment : saved.segments()) {
            assertEquals(segment, loaded.segment(segment.id()));
            assertEquals(new HermiteSegmentPath(saved.hermite(segment)).length(),
                    new HermiteSegmentPath(loaded.hermite(segment)).length(), 0.0);
        }
        assertEquals(saved.nextSegmentId(), loaded.nextSegmentId());
    }
}
