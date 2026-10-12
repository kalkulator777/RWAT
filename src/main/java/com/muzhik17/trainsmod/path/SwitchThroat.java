package com.muzhik17.trainsmod.path;

import java.util.ArrayList;
import java.util.List;

import org.joml.Vector3d;

/**
 * The throat of a switch (SPEC §2.2 v1, point blades): the co-directional
 * legs leaving one node — a Y's two legs, a crossover's through track and
 * diagonal — seen from that node, plus the shape of the blades in it.
 *
 * <p>Every leg's rail on the side of another leg is a <b>blade</b> (остряк):
 * at the node it lies against that other leg's rail on the same side — the
 * outer, <b>stock</b> rail (рамный рельс), which runs on undisturbed. The
 * blade is planed to a point on the stock side, following the stock rail —
 * at any distance {@code d} from the node it keeps only the part of its
 * section that clears the stock rail's railhead ({@link #cut}): nothing at
 * the node, the full section once the legs have separated by a railhead
 * width. The selected leg's blades are closed (pressed against the stock
 * rail), the others are thrown off by {@link #BLADE_THROW} at the tip, fading
 * linearly to the heel {@link #bladeLength} into the leg ({@link #fade}).
 * Only the rail objects bend — the sleepers and whatever else a style
 * carries ({@code RAIL_BASE}, a bridge) are never touched; the throat
 * carries one set of them, the straightest leg's ({@link #sleeperLeg}).
 *
 * <p>Sides are the tile's: {@link #PLUS_Z} is the rail at local z &gt; 0,
 * which {@link TrackSweep#frame} lays along the frame's {@code right} axis
 * (IR names it {@code RAIL_LEFT} — it is left of the travel direction).
 * Measured in each leg's own sweep frame, so a leg ending at the node (its
 * frame runs toward the node) gets its sides mirrored, as its tiles are.
 *
 * <p>Pure math, no MC imports (SPEC principle #4). Rendering only: the track
 * bed is laid by the plain sweep and doesn't see blades.
 */
public final class SwitchThroat {

    /** Blade length along a leg from the node, blocks (at most half the leg). */
    public static final double BLADE_LENGTH = 3.0;
    /** How far an open blade's tip stands off its stock rail, blocks. */
    public static final double BLADE_THROW = 0.12;
    /**
     * Gap kept between a closed blade and its stock rail's railhead: their
     * faces would otherwise coincide and z-fight (1/256 block, invisible).
     */
    public static final double BLADE_CLEARANCE = 1.0 / 256.0;
    /**
     * How much lower the blade sits at its tip than the stock rail (fading
     * to nothing at the heel), as a real blade does: where the rail feet
     * overlap — a foot is wider than the head the cut follows — the stock
     * rail's foot covers the blade's instead of z-fighting with it.
     */
    public static final double BLADE_TIP_DROP = 1.0 / 64.0;
    /**
     * Where the wheels run: the rail axis, |z| in the tile (SPEC §6.10 —
     * MVP's and the mod's rails are at ±0.8125, the stock is calibrated to
     * it). A side's rail objects are running rails only if their railhead
     * spans this line.
     */
    public static final double WHEEL_LINE = 0.8125;
    /** Vertices within this of a side's top count as its railhead. */
    private static final double HEAD_BAND = 0.02;
    /**
     * How far inside the railhead's gauge face the rail's own foot may reach
     * (MVP 0.031, the standard rail 0.04); a vertex further in belongs to
     * something else in the rail object — the guard rail of {@code ct_rail}.
     */
    private static final double FOOT_REACH = 0.1;
    /** Spacing of the separation samples along a blade, blocks. */
    private static final double SAMPLE_STEP = 0.125;

    /** Side bit: the rail at local z &gt; 0. */
    public static final int PLUS_Z = 1;
    /** Side bit: the rail at local z &lt; 0. */
    public static final int MINUS_Z = 2;

    /** One leg: its segment, whether its start is at the node, its curve, its blade length. */
    private record Leg(RailSegment segment, boolean atStart, HermiteSegmentPath path, double bladeLength) {

        /** Path distance of the point {@code d} into the leg from the node. */
        double s(double d) {
            double clamped = Math.clamp(d, 0.0, path.length());
            return atStart ? clamped : path.length() - clamped;
        }
    }

    private final List<Leg> legs;
    /** Unit direction the legs leave the node in (they share the node's axis). */
    private final Vector3d departure;
    private final Vector3d node;

    private SwitchThroat(List<Leg> legs, Vector3d departure, Vector3d node) {
        this.legs = legs;
        this.departure = departure;
        this.node = node;
    }

    /**
     * The throat of the legs {@code legIds} (two or more co-directional
     * segments, see {@link RailGraph#CONTINUATION_DOT}) at {@code nodeId}.
     */
    public static SwitchThroat of(RailGraph graph, int nodeId, List<Integer> legIds) {
        if (legIds.size() < 2) {
            throw new IllegalArgumentException("a throat needs two legs: " + legIds);
        }
        List<Leg> legs = new ArrayList<>();
        for (int id : legIds) {
            RailSegment segment = graph.segment(id);
            HermiteSegmentPath path = new HermiteSegmentPath(graph.hermite(segment));
            legs.add(new Leg(segment, segment.nodeA() == nodeId, path,
                    Math.min(BLADE_LENGTH, path.length() / 2.0)));
        }
        RailSegment first = graph.segment(legIds.get(0));
        return new SwitchThroat(List.copyOf(legs), graph.departure(first, nodeId),
                graph.node(nodeId).position());
    }

    /** The legs' segment ids, as given. */
    public List<Integer> legIds() {
        List<Integer> ids = new ArrayList<>();
        for (Leg leg : legs) {
            ids.add(leg.segment().id());
        }
        return ids;
    }

    /** How far the blades of leg {@code legId} reach into it from the node. */
    public double bladeLength(int legId) {
        return leg(legId).bladeLength();
    }

    /** Whether leg {@code legId} starts (its node A) at the throat's node. */
    public boolean atStart(int legId) {
        return leg(legId).atStart();
    }

    /**
     * The sides of leg {@code legId} that are blades — another leg lies that
     * way ({@link #PLUS_Z}/{@link #MINUS_Z} bits; both for the middle leg of
     * a three-way switch).
     */
    public int bladeSides(int legId) {
        Leg self = leg(legId);
        int sides = 0;
        for (Leg other : legs) {
            if (other != self) {
                sides |= sideOf(self, other);
            }
        }
        return sides;
    }

    /**
     * How far apart leg {@code legId} and its nearest neighbour on {@code side}
     * are, sampled every {@link #SAMPLE_STEP} from the node to the blade's
     * heel: the lateral offset of the neighbour's point at the same distance
     * from the node, across this leg's frame — 0 at the node, growing as the
     * legs diverge. Infinite where no leg lies on that side.
     */
    public Separation separation(int legId, int side) {
        Leg self = leg(legId);
        int count = Math.max(1, (int) Math.ceil(self.bladeLength() / SAMPLE_STEP));
        double step = self.bladeLength() / count;
        double[] values = new double[count + 1];
        double sign = side == PLUS_Z ? 1.0 : -1.0;
        double[] frame = new double[TrackSweep.FRAME_STRIDE];
        for (int i = 0; i <= count; i++) {
            double d = i * step;
            TrackSweep.frame(self.path(), self.s(d), frame, 0);
            double best = Double.POSITIVE_INFINITY;
            for (Leg other : legs) {
                if (other == self || sideOf(self, other) != side) {
                    continue;
                }
                Vector3d gap = other.path().samplePosition(other.s(d)).sub(frame[0], frame[1], frame[2]);
                double across = sign * (gap.x * frame[6] + gap.y * frame[7] + gap.z * frame[8]);
                best = Math.min(best, Math.max(0.0, across));
            }
            values[i] = best;
        }
        return new Separation(step, values);
    }

    /**
     * The leg whose sleepers the throat keeps: the straightest one — least
     * off the node's axis a blade length in (a turnout's straight track),
     * the lowest id on a tie (a symmetric Y). Fixed by geometry, not by the
     * switch state, so the sleepers don't jump when the switch is thrown.
     */
    public int sleeperLeg() {
        Leg best = null;
        double bestOff = Double.POSITIVE_INFINITY;
        for (Leg leg : legs) {
            Vector3d at = leg.path().samplePosition(leg.s(leg.bladeLength())).sub(node);
            double off = Math.abs(at.x * departure.z - at.z * departure.x);
            int id = leg.segment().id();
            if (best == null || off < bestOff - 1.0e-6
                    || off < bestOff + 1.0e-6 && id < best.segment().id()) {
                best = leg;
                bestOff = off;
            }
        }
        return best.segment().id();
    }

    /** Which side of {@code self} {@code other} lies on, judged where the legs have parted (a blade length in). */
    private static int sideOf(Leg self, Leg other) {
        double d = Math.min(self.bladeLength(), other.bladeLength());
        double[] frame = new double[TrackSweep.FRAME_STRIDE];
        TrackSweep.frame(self.path(), self.s(d), frame, 0);
        Vector3d gap = other.path().samplePosition(other.s(d)).sub(frame[0], frame[1], frame[2]);
        return gap.x * frame[6] + gap.y * frame[7] + gap.z * frame[8] >= 0.0 ? PLUS_Z : MINUS_Z;
    }

    private Leg leg(int legId) {
        for (Leg leg : legs) {
            if (leg.segment().id() == legId) {
                return leg;
            }
        }
        throw new IllegalArgumentException("no leg " + legId + " in the throat");
    }

    /**
     * Samples of the lateral gap between a leg and its neighbour, every
     * {@code step} from the node; {@link #at} interpolates.
     */
    public record Separation(double step, double[] values) {

        /** The gap {@code d} into the leg from the node (clamped to the sampled stretch). */
        public double at(double d) {
            double x = Math.clamp(d / step, 0.0, values.length - 1.0);
            int i = Math.min((int) x, values.length - 2);
            if (i < 0 || Double.isInfinite(values[i])) {
                return values[Math.max(i, 0)]; // a single sample, or no neighbour that side at all
            }
            double f = x - i;
            return values[i] * (1.0 - f) + values[i + 1] * f;
        }
    }

    // --- the blade's shape (SPEC §2.2 v1) ---

    /**
     * The railhead gauge face of one side's rail objects — the |z| of the
     * head's inner edge, where a blade lies against its stock rail — or NaN
     * if they are no running rail: no vertices, or a head (the vertices
     * within {@link #HEAD_BAND} of their top) that doesn't span the
     * {@link #WHEEL_LINE}. MVP's bridge keeps its running rails in
     * {@code RAIL_BASE} and names guard rails {@code RAIL_LEFT/RIGHT}; its
     * level crossing names the road deck so — neither may be bent into a
     * blade.
     *
     * @param across per vertex: local z, all on one side
     * @param height per vertex: local y
     */
    public static double gaugeFace(float[] across, float[] height) {
        if (across.length == 0) {
            return Double.NaN;
        }
        float top = Float.NEGATIVE_INFINITY;
        for (float y : height) {
            top = Math.max(top, y);
        }
        double inner = Double.POSITIVE_INFINITY;
        double outer = Double.NEGATIVE_INFINITY;
        for (int i = 0; i < across.length; i++) {
            if (height[i] >= top - HEAD_BAND) {
                inner = Math.min(inner, Math.abs(across[i]));
                outer = Math.max(outer, Math.abs(across[i]));
            }
        }
        return inner <= WHEEL_LINE && WHEEL_LINE <= outer ? inner : Double.NaN;
    }

    /**
     * How far out (|z|) a blade's section reaches where its stock rail is
     * {@code separation} away: up to the stock railhead's gauge face, less
     * the {@link #BLADE_CLEARANCE}. At the node (no separation) that's the
     * blade's own gauge face — the head is planed away to an edge.
     */
    public static double cut(double gaugeFace, double separation) {
        return gaugeFace + separation - BLADE_CLEARANCE;
    }

    /** 1 at the blade's tip ({@code d} = 0), falling linearly to 0 at its heel. */
    public static double fade(double d, double bladeLength) {
        return Math.clamp(1.0 - d / bladeLength, 0.0, 1.0);
    }

    /**
     * A blade vertex's local z: clipped to {@link #cut} on the stock side,
     * then moved {@code thrown} toward the track centre (an open blade). The
     * rail's foot, wider than its head on the gauge side too, is drawn in
     * toward the gauge face as much ({@link #FOOT_REACH}) — so at the tip the
     * whole section meets in one edge, a point in plan, not a stub of foot.
     * Anything further in (a guard rail sharing the object) is left alone.
     *
     * @param side {@link #PLUS_Z} or {@link #MINUS_Z}, the blade's side
     */
    public static double bladeAcross(double across, int side, double gaugeFace, double separation,
            double thrown) {
        double sign = side == PLUS_Z ? 1.0 : -1.0;
        double u = sign * across;
        double cut = cut(gaugeFace, separation);
        if (u > gaugeFace - FOOT_REACH) {
            u = Math.max(u, Math.min(cut, gaugeFace - separation - BLADE_CLEARANCE));
        }
        return sign * (Math.min(u, cut) - thrown);
    }
}
