package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/**
 * Editing the rail graph (SPEC §2.2): ids that outlive a restart.
 */
class RailGraphEditTest {

    private static final Vector3d X = new Vector3d(1, 0, 0);

    private static RailSegment connect(RailGraph graph, double ax, double bx) {
        return graph.createSegment(new Vector3d(ax, 64, 0.5), X, new Vector3d(bx, 64, 0.5), X);
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
