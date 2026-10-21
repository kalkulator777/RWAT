package com.muzhik17.trainsmod.network;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.path.HermiteSegment;
import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.StraightLinePath;
import com.muzhik17.trainsmod.path.StrandedTrack;
import com.muzhik17.trainsmod.path.TrackPath;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.DoubleTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.FriendlyByteBuf;

/**
 * Serializable description of "which path a consist is on": the v0 debug
 * straight line, a route through the rail graph (Layer 1), or the curves of
 * a train stranded when its route was demolished. One shared encoding for
 * NBT (consist persistence) and the network snapshot; both sides resolve it
 * to a {@link TrackPath} against their copy of the graph (a stranded train
 * without it).
 */
public sealed interface TrackPathSpec {

    /**
     * Resolve against a graph. Returns null if the route references missing
     * segments, or a stranded train isn't placed yet.
     */
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

    /**
     * A train's own stretch of track, apart from the graph (decision D2,
     * 2026-10-21): the curves a consist stood on when its whole route was
     * demolished ({@link StrandedTrack}), {@link #CURVE_NUMBERS} numbers each
     * — start, start tangent, end, end tangent — and the window of them its
     * {@code s} runs over. Resolves without the graph, on the server and the
     * clients alike, so it never lands on new track. No curves
     * ({@link #UNPLACED}): stranded, but where isn't known — a save whose
     * route was gone before it could be cut; one of its wagons places it
     * once it loads.
     */
    record Stranded(double[] curves, boolean[] reversed, double offset, double length)
            implements TrackPathSpec {

        /** Numbers per curve: start, start tangent, end, end tangent (x, y, z each). */
        public static final int CURVE_NUMBERS = 12;
        /** Stranded, but where isn't known yet. */
        public static final Stranded UNPLACED = new Stranded(new double[0], new boolean[0], 0.0, 0.0);

        public Stranded {
            if (curves.length != reversed.length * CURVE_NUMBERS) {
                curves = new double[0]; // malformed (a damaged save): unplaced
                reversed = new boolean[0];
            }
        }

        public static Stranded of(StrandedTrack track) {
            List<HermiteSegment> list = track.curves();
            double[] curves = new double[list.size() * CURVE_NUMBERS];
            int at = 0;
            for (HermiteSegment curve : list) {
                for (Vector3d v : new Vector3d[] {curve.start(), curve.startTangent(), curve.end(),
                        curve.endTangent()}) {
                    curves[at++] = v.x;
                    curves[at++] = v.y;
                    curves[at++] = v.z;
                }
            }
            return new Stranded(curves, track.reversed(), track.offset(), track.length());
        }

        /** True once it is known where it stands (it has its curves). */
        public boolean placed() {
            return reversed.length > 0;
        }

        @Override
        public TrackPath resolve(RailGraph graph) {
            if (!placed()) {
                return null;
            }
            List<HermiteSegment> list = new ArrayList<>(reversed.length);
            for (int i = 0; i < reversed.length; i++) {
                int at = i * CURVE_NUMBERS;
                list.add(new HermiteSegment(vector(at), vector(at + 3), vector(at + 6), vector(at + 9)));
            }
            return new StrandedTrack(list, reversed, offset, length);
        }

        private Vector3d vector(int at) {
            return new Vector3d(curves[at], curves[at + 1], curves[at + 2]);
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof Stranded stranded
                    && Arrays.equals(curves, stranded.curves)
                    && Arrays.equals(reversed, stranded.reversed)
                    && Double.compare(offset, stranded.offset) == 0
                    && Double.compare(length, stranded.length) == 0;
        }

        @Override
        public int hashCode() {
            return 31 * Arrays.hashCode(curves) + Arrays.hashCode(reversed);
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
            case Stranded stranded -> {
                buf.writeByte(2);
                buf.writeVarInt(stranded.reversed().length);
                for (int i = 0; i < stranded.reversed().length; i++) {
                    for (int k = 0; k < Stranded.CURVE_NUMBERS; k++) {
                        buf.writeDouble(stranded.curves()[i * Stranded.CURVE_NUMBERS + k]);
                    }
                    buf.writeBoolean(stranded.reversed()[i]);
                }
                buf.writeDouble(stranded.offset());
                buf.writeDouble(stranded.length());
            }
        }
    }

    static TrackPathSpec read(FriendlyByteBuf buf) {
        byte type = buf.readByte();
        if (type == 0) {
            return new Straight(buf.readDouble(), buf.readDouble(), buf.readDouble(),
                    buf.readDouble(), buf.readDouble(), buf.readDouble());
        }
        if (type == 2) {
            int curves = buf.readVarInt();
            double[] numbers = new double[curves * Stranded.CURVE_NUMBERS];
            boolean[] reversed = new boolean[curves];
            for (int i = 0; i < curves; i++) {
                for (int k = 0; k < Stranded.CURVE_NUMBERS; k++) {
                    numbers[i * Stranded.CURVE_NUMBERS + k] = buf.readDouble();
                }
                reversed[i] = buf.readBoolean();
            }
            return new Stranded(numbers, reversed, buf.readDouble(), buf.readDouble());
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
            case Stranded stranded -> {
                tag.putString("PathType", "stranded");
                ListTag curves = new ListTag();
                for (double number : stranded.curves()) {
                    curves.add(DoubleTag.valueOf(number));
                }
                tag.put("StrandCurves", curves);
                byte[] flags = new byte[stranded.reversed().length];
                for (int i = 0; i < flags.length; i++) {
                    flags[i] = (byte) (stranded.reversed()[i] ? 1 : 0);
                }
                tag.putByteArray("StrandReversed", flags);
                tag.putDouble("StrandOffset", stranded.offset());
                tag.putDouble("StrandLength", stranded.length());
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
        if ("stranded".equals(tag.getString("PathType"))) {
            ListTag list = tag.getList("StrandCurves", Tag.TAG_DOUBLE);
            double[] curves = new double[list.size()];
            for (int i = 0; i < curves.length; i++) {
                curves[i] = list.getDouble(i);
            }
            byte[] flags = tag.getByteArray("StrandReversed");
            boolean[] reversed = new boolean[flags.length];
            for (int i = 0; i < reversed.length; i++) {
                reversed[i] = flags[i] != 0;
            }
            return new Stranded(curves, reversed, tag.getDouble("StrandOffset"),
                    tag.getDouble("StrandLength"));
        }
        return new Straight(tag.getDouble("AX"), tag.getDouble("AY"), tag.getDouble("AZ"),
                tag.getDouble("BX"), tag.getDouble("BY"), tag.getDouble("BZ"));
    }
}
