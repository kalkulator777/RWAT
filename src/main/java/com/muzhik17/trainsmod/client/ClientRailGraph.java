package com.muzhik17.trainsmod.client;

import com.muzhik17.trainsmod.network.RailGraphSyncPayload;
import com.muzhik17.trainsmod.network.RailSwitchesPayload;
import com.muzhik17.trainsmod.path.RailGraph;

/**
 * The client's copy of the rail graph for the current dimension, replaced
 * wholesale by {@link RailGraphSyncPayload}; a switch thrown on the server
 * only sets its selection in it ({@link RailSwitchesPayload}). Like
 * {@link ClientConsists}, deliberately free of client-only MC classes.
 */
public final class ClientRailGraph {

    private static RailGraph graph;
    /**
     * Local change counter, bumped on every received graph and on every
     * switch thrown in it. Consumers compare this, not the server revision:
     * the revision is per dimension, so two dimensions with the same edit
     * count would look like "no change" across a dimension switch and keep
     * the previous dimension's rails.
     */
    private static int generation;

    private ClientRailGraph() {
    }

    public static void handleSync(RailGraphSyncPayload payload) {
        graph = payload.toGraph();
        generation++;
    }

    /**
     * Switches thrown on the server (SPEC §2.2 v1): their selections go into
     * the graph held, and the generation moves on — whoever watches it (the
     * rail renderer throwing the blades, the consists' paths) sees the change
     * as after a full sync. Before the first graph there is nothing to set:
     * the full sync that comes carries the selections.
     */
    public static void handleSwitches(RailSwitchesPayload payload) {
        if (graph != null && graph.setSwitchSelections(payload.selections())) {
            generation++;
        }
    }

    /** May be null before the first sync. */
    public static RailGraph graph() {
        return graph;
    }

    /** Changes whenever a new graph arrives or a switch in it is thrown; never repeats within a session. */
    public static int generation() {
        return generation;
    }

    public static void clear() {
        graph = null;
        generation++;
    }
}
