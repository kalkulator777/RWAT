package com.muzhik17.trainsmod.network;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.network.RailGraphSyncPayload.SyncSwitch;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Switches thrown server→client (SPEC §2.2 v1): the nodes whose switch a
 * stand's redstone threw this tick, each with the selection it has now
 * ({@code RailGraph.throwSwitches}). A throw changes nothing else of the
 * graph, so it no longer sends the whole of it ({@link RailGraphSyncPayload}):
 * the client sets the selections in the copy it holds. The connection keeps
 * the order, so this always lands on the graph the last full sync gave.
 */
public record RailSwitchesPayload(List<SyncSwitch> switches) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<RailSwitchesPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "rail_switches"));

    public static final StreamCodec<FriendlyByteBuf, RailSwitchesPayload> STREAM_CODEC =
            StreamCodec.of((buf, payload) -> RailGraphSyncPayload.writeSwitches(buf, payload.switches),
                    buf -> new RailSwitchesPayload(RailGraphSyncPayload.readSwitches(buf)));

    public RailSwitchesPayload {
        switches = List.copyOf(switches); // the integrated server hands the object over as it is
    }

    /** The payload for switches thrown: node id → its selection now. */
    public static RailSwitchesPayload of(Map<Integer, Integer> thrown) {
        List<SyncSwitch> switches = new ArrayList<>(thrown.size());
        thrown.forEach((node, selection) -> switches.add(new SyncSwitch(node, selection)));
        return new RailSwitchesPayload(switches);
    }

    /** Node id → selection, in the order sent. */
    public Map<Integer, Integer> selections() {
        Map<Integer, Integer> selections = new LinkedHashMap<>();
        for (SyncSwitch sw : switches) {
            selections.put(sw.nodeId(), sw.selection());
        }
        return selections;
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
