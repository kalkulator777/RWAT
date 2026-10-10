package com.muzhik17.trainsmod.network;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RailNode;
import com.muzhik17.trainsmod.path.RailSegment;
import com.muzhik17.trainsmod.rail.RailNetwork;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Full rail graph dump server→client: sent on login/dimension change and
 * after every edit (v0 simplicity — the graph is small; deltas are a later
 * optimization). The client rebuilds its {@link RailGraph} copy wholesale.
 */
public record RailGraphSyncPayload(int revision, List<SyncNode> nodes, List<SyncSegment> segments,
        List<SyncSwitch> switches) implements CustomPacketPayload {

    public record SyncNode(int id, double x, double y, double z, double dx, double dy, double dz) {
    }

    /**
     * {@code dirA}/{@code dirB} — nullable per-end tangent overrides (crossings);
     * {@code group} — structure group (one click built it), 0 = standalone;
     * {@code style}/{@code bed} — rail style and bed material.
     */
    public record SyncSegment(int id, int nodeA, int signA, int nodeB, int signB,
            Vector3d dirA, Vector3d dirB, int group, String style, String bed) {
    }

    /** A node's switch selection counter (SPEC §2.2 v1) — only non-zero ones travel. */
    public record SyncSwitch(int nodeId, int selection) {
    }

    public static final CustomPacketPayload.Type<RailGraphSyncPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "rail_graph_sync"));

    public static final StreamCodec<FriendlyByteBuf, RailGraphSyncPayload> STREAM_CODEC =
            StreamCodec.of(RailGraphSyncPayload::write, RailGraphSyncPayload::read);

    public static RailGraphSyncPayload of(RailNetwork network) {
        List<SyncNode> nodes = new ArrayList<>();
        for (RailNode node : network.graph().nodes()) {
            Vector3d position = node.position();
            Vector3d direction = node.direction();
            nodes.add(new SyncNode(node.id(), position.x, position.y, position.z,
                    direction.x, direction.y, direction.z));
        }
        List<SyncSegment> segments = new ArrayList<>();
        for (RailSegment segment : network.graph().segments()) {
            segments.add(new SyncSegment(segment.id(), segment.nodeA(), segment.signA(),
                    segment.nodeB(), segment.signB(), segment.dirA(), segment.dirB(),
                    segment.group(), segment.style(), segment.bed()));
        }
        List<SyncSwitch> switches = new ArrayList<>();
        for (Map.Entry<Integer, Integer> entry : network.graph().switchSelections().entrySet()) {
            switches.add(new SyncSwitch(entry.getKey(), entry.getValue()));
        }
        return new RailGraphSyncPayload(network.revision(), nodes, segments, switches);
    }

    /** Rebuild a pure graph from the dump (client side). */
    public RailGraph toGraph() {
        RailGraph graph = new RailGraph();
        for (SyncNode node : nodes) {
            graph.putNode(new RailNode(node.id(),
                    new Vector3d(node.x(), node.y(), node.z()),
                    new Vector3d(node.dx(), node.dy(), node.dz())));
        }
        for (SyncSegment segment : segments) {
            graph.putSegment(new RailSegment(segment.id(), segment.nodeA(), segment.signA(),
                    segment.nodeB(), segment.signB(), segment.dirA(), segment.dirB(),
                    segment.group(), segment.style(), segment.bed()));
        }
        for (SyncSwitch sw : switches) {
            graph.setSwitchSelection(sw.nodeId(), sw.selection());
        }
        return graph;
    }

    private static void write(FriendlyByteBuf buf, RailGraphSyncPayload payload) {
        buf.writeVarInt(payload.revision);
        buf.writeVarInt(payload.nodes.size());
        for (SyncNode node : payload.nodes) {
            buf.writeVarInt(node.id());
            buf.writeDouble(node.x());
            buf.writeDouble(node.y());
            buf.writeDouble(node.z());
            buf.writeDouble(node.dx());
            buf.writeDouble(node.dy());
            buf.writeDouble(node.dz());
        }
        buf.writeVarInt(payload.segments.size());
        for (SyncSegment segment : payload.segments) {
            buf.writeVarInt(segment.id());
            buf.writeVarInt(segment.nodeA());
            buf.writeByte(segment.signA());
            buf.writeVarInt(segment.nodeB());
            buf.writeByte(segment.signB());
            writeOptionalDir(buf, segment.dirA());
            writeOptionalDir(buf, segment.dirB());
            buf.writeVarInt(segment.group());
            buf.writeUtf(segment.style());
            buf.writeUtf(segment.bed());
        }
        buf.writeVarInt(payload.switches.size());
        for (SyncSwitch sw : payload.switches) {
            buf.writeVarInt(sw.nodeId());
            buf.writeVarInt(sw.selection());
        }
    }

    private static void writeOptionalDir(FriendlyByteBuf buf, Vector3d dir) {
        buf.writeBoolean(dir != null);
        if (dir != null) {
            buf.writeDouble(dir.x);
            buf.writeDouble(dir.y);
            buf.writeDouble(dir.z);
        }
    }

    private static Vector3d readOptionalDir(FriendlyByteBuf buf) {
        return buf.readBoolean()
                ? new Vector3d(buf.readDouble(), buf.readDouble(), buf.readDouble())
                : null;
    }

    private static RailGraphSyncPayload read(FriendlyByteBuf buf) {
        int revision = buf.readVarInt();
        int nodeCount = buf.readVarInt();
        List<SyncNode> nodes = new ArrayList<>(nodeCount);
        for (int i = 0; i < nodeCount; i++) {
            nodes.add(new SyncNode(buf.readVarInt(),
                    buf.readDouble(), buf.readDouble(), buf.readDouble(),
                    buf.readDouble(), buf.readDouble(), buf.readDouble()));
        }
        int segmentCount = buf.readVarInt();
        List<SyncSegment> segments = new ArrayList<>(segmentCount);
        for (int i = 0; i < segmentCount; i++) {
            segments.add(new SyncSegment(buf.readVarInt(),
                    buf.readVarInt(), buf.readByte(), buf.readVarInt(), buf.readByte(),
                    readOptionalDir(buf), readOptionalDir(buf), buf.readVarInt(), buf.readUtf(),
                    buf.readUtf()));
        }
        int switchCount = buf.readVarInt();
        List<SyncSwitch> switches = new ArrayList<>(switchCount);
        for (int i = 0; i < switchCount; i++) {
            switches.add(new SyncSwitch(buf.readVarInt(), buf.readVarInt()));
        }
        return new RailGraphSyncPayload(revision, nodes, segments, switches);
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
