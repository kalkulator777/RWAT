package com.muzhik17.trainsmod.client;

import com.muzhik17.trainsmod.network.RailGraphSyncPayload;
import com.muzhik17.trainsmod.path.RailGraph;

/**
 * The client's copy of the rail graph for the current dimension, replaced
 * wholesale by {@link RailGraphSyncPayload}. Like {@link ClientConsists},
 * deliberately free of client-only MC classes.
 */
public final class ClientRailGraph {

    private static RailGraph graph;
    /**
     * Local sync counter, bumped on every received graph. Consumers compare
     * this, not the server revision: the revision is per dimension, so two
     * dimensions with the same edit count would look like "no change" across
     * a dimension switch and keep the previous dimension's rails.
     */
    private static int generation;

    private ClientRailGraph() {
    }

    public static void handleSync(RailGraphSyncPayload payload) {
        graph = payload.toGraph();
        generation++;
    }

    /** May be null before the first sync. */
    public static RailGraph graph() {
        return graph;
    }

    /** Changes whenever a new graph arrives; never repeats within a session. */
    public static int generation() {
        return generation;
    }

    public static void clear() {
        graph = null;
        generation++;
    }
}
