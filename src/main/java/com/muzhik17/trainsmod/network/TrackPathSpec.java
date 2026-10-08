package com.muzhik17.trainsmod.network;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.StraightLinePath;
import com.muzhik17.trainsmod.path.TrackPath;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.FriendlyByteBuf;

/**
 * Serializable description of "which path a consist is on": either the v0
 * debug straight line, or a route through the rail graph (Layer 1). One
 * shared encoding for NBT (consist persistence) and the network snapshot;
 * both sides resolve it to a {@link TrackPath} against their copy of the
 * graph.
 */
public sealed interface TrackPathSpec {

    /** Resolve against a graph. Returns null if the route references missing segments. */
    TrackPath resolve(RailGraph graph);

    record Straight(double ax, double ay, double az, double bx, double by, double bz)
            implements TrackPathSpec {

        public static Straight of(Vector3d a, Vector3d b) {
            return new Straight(a.x, a.y, a.z, b.x, b.y, b.z);
        }

        @Override
        public TrackPath resolve(RailGraph graph) {
            return new StraightLinePath(new Vector3d(ax, ay, az), new Vector3d(bx, by, bz));
        }
    }

    record Route(int[] segments, boolean[] reversed) implements TrackPathSpec {

        public static Route of(List<RailGraph.RouteLeg> legs) {
            int[] segments = new int[legs.size()];
            boolean[] reversed = new boolean[legs.size()];
            for (int i = 0; i < legs.size(); i++) {
                segments[i] = legs.get(i).segmentId();
                reversed[i] = legs.get(i).reversed();
            }
            return new Route(segments, reversed);
        }

        public List<RailGraph.RouteLeg> legs() {
            List<RailGraph.RouteLeg> legs = new ArrayList<>(segments.length);
            for (int i = 0; i < segments.length; i++) {
                legs.add(new RailGraph.RouteLeg(segments[i], reversed[i]));
            }
            return legs;
        }

        /**
         * The same track walked the other way: legs in reverse order, each
         * traversed backwards. A point at {@code s} on this route sits at
         * {@code length − s} on the inverted one.
         */
        public Route inverted() {
            int n = segments.length;
            int[] invSegments = new int[n];
            boolean[] invReversed = new boolean[n];
            for (int i = 0; i < n; i++) {
                invSegments[i] = segments[n - 1 - i];
                invReversed[i] = !reversed[n - 1 - i];
            }
            return new Route(invSegments, invReversed);
        }

        @Override
        public TrackPath resolve(RailGraph graph) {
            return graph == null ? null : graph.buildRoutePath(legs());
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof Route route
                    && Arrays.equals(segments, route.segments)
                    && Arrays.equals(reversed, route.reversed);
        }

        @Override
        public int hashCode() {
            return 31 * Arrays.hashCode(segments) + Arrays.hashCode(reversed);
        }
    }

    // --- network ---

    static void write(FriendlyByteBuf buf, TrackPathSpec spec) {
        switch (spec) {
            case Straight straight -> {
                buf.writeByte(0);
                buf.writeDouble(straight.ax());
                buf.writeDouble(straight.ay());
                buf.writeDouble(straight.az());
                buf.writeDouble(straight.bx());
                buf.writeDouble(straight.by());
                buf.writeDouble(straight.bz());
            }
            case Route route -> {
                buf.writeByte(1);
                buf.writeVarInt(route.segments().length);
                for (int i = 0; i < route.segments().length; i++) {
                    buf.writeVarInt(route.segments()[i]);
                    buf.writeBoolean(route.reversed()[i]);
                }
            }
        }
    }

    static TrackPathSpec read(FriendlyByteBuf buf) {
        byte type = buf.readByte();
        if (type == 0) {
            return new Straight(buf.readDouble(), buf.readDouble(), buf.readDouble(),
                    buf.readDouble(), buf.readDouble(), buf.readDouble());
        }
        int count = buf.readVarInt();
        int[] segments = new int[count];
        boolean[] reversed = new boolean[count];
        for (int i = 0; i < count; i++) {
            segments[i] = buf.readVarInt();
            reversed[i] = buf.readBoolean();
        }
        return new Route(segments, reversed);
    }

    // --- NBT ---

    default CompoundTag save(CompoundTag tag) {
        switch (this) {
            case Straight straight -> {
                tag.putString("PathType", "straight");
                tag.putDouble("AX", straight.ax());
                tag.putDouble("AY", straight.ay());
                tag.putDouble("AZ", straight.az());
                tag.putDouble("BX", straight.bx());
                tag.putDouble("BY", straight.by());
                tag.putDouble("BZ", straight.bz());
            }
            case Route route -> {
                tag.putString("PathType", "route");
                tag.putIntArray("RouteSegments", route.segments());
                byte[] flags = new byte[route.reversed().length];
                for (int i = 0; i < flags.length; i++) {
                    flags[i] = (byte) (route.reversed()[i] ? 1 : 0);
                }
                tag.putByteArray("RouteReversed", flags);
            }
        }
        return tag;
    }

    static TrackPathSpec load(CompoundTag tag) {
        if ("route".equals(tag.getString("PathType"))) {
            int[] segments = tag.getIntArray("RouteSegments");
            byte[] flags = tag.getByteArray("RouteReversed");
            boolean[] reversed = new boolean[segments.length];
            for (int i = 0; i < reversed.length && i < flags.length; i++) {
                reversed[i] = flags[i] != 0;
            }
            return new Route(segments, reversed);
        }
        return new Straight(tag.getDouble("AX"), tag.getDouble("AY"), tag.getDouble("AZ"),
                tag.getDouble("BX"), tag.getDouble("BY"), tag.getDouble("BZ"));
    }
}
