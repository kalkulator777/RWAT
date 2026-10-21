package com.muzhik17.trainsmod.path;

import org.joml.Vector3d;

/**
 * {@link TrackPath} over an ordered chain of segments, each possibly
 * travelled in reverse. Arc length is continuous across joints; the consist
 * only ever sees one monotonic {@code s} (SPEC §2.1/2.2). A closed route
 * ({@link #loop()}) wraps {@code s} modulo the length — the consist's own
 * {@code s} keeps growing monotonically, only sampling wraps, so
 * interpolation never sees a jump.
 *
 * <p>Pure math, no MC imports.
 */
public final class RoutePath implements TrackPath {

    private final HermiteSegmentPath[] parts;
    private final boolean[] reversed;
    private final boolean loop;
    /** cumulative[i] = arc length before part i; cumulative[parts.length] = total. */
    private final double[] cumulative;
    /** jointsBefore[i] = rail joints in the parts before part i (SPEC §10). */
    private final long[] jointsBefore;

    RoutePath(HermiteSegmentPath[] parts, boolean[] reversed, boolean loop) {
        if (parts.length == 0 || parts.length != reversed.length) {
            throw new IllegalArgumentException("parts/reversed mismatch or empty");
        }
        this.parts = parts;
        this.reversed = reversed;
        this.loop = loop;
        this.cumulative = new double[parts.length + 1];
        this.jointsBefore = new long[parts.length + 1];
        for (int i = 0; i < parts.length; i++) {
            cumulative[i + 1] = cumulative[i] + parts[i].length();
            jointsBefore[i + 1] = jointsBefore[i] + jointsIn(parts[i].length());
        }
    }

    public int partCount() {
        return parts.length;
    }

    /** Index of the part {@code s} falls in (after wrap/clamp into range). */
    public int partIndexAt(double s) {
        return partIndex(intoRange(s));
    }

    /** Arc length before part {@code index}. */
    public double partStartS(int index) {
        return cumulative[index];
    }

    /** Arc length of part {@code index}. */
    public double partLength(int index) {
        return cumulative[index + 1] - cumulative[index];
    }

    /** The curve of part {@code index}, in its segment's own direction. */
    public HermiteSegment partCurve(int index) {
        return parts[index].segment();
    }

    /** True if part {@code index} is travelled against its curve's direction. */
    public boolean partReversed(int index) {
        return reversed[index];
    }

    @Override
    public double length() {
        return cumulative[parts.length];
    }

    @Override
    public boolean loop() {
        return loop;
    }

    /** Wrap (loop) or clamp (open route) {@code s} into the path's range. */
    private double intoRange(double s) {
        if (loop) {
            double wrapped = s % length();
            return wrapped < 0.0 ? wrapped + length() : wrapped;
        }
        return Math.clamp(s, 0.0, length());
    }

    @Override
    public Vector3d samplePosition(double s) {
        double ranged = intoRange(s);
        int index = partIndex(ranged);
        double local = ranged - cumulative[index];
        if (reversed[index]) {
            local = parts[index].length() - local;
        }
        return parts[index].samplePosition(local);
    }

    @Override
    public Vector3d sampleTangent(double s) {
        double ranged = intoRange(s);
        int index = partIndex(ranged);
        double local = ranged - cumulative[index];
        if (reversed[index]) {
            local = parts[index].length() - local;
        }
        Vector3d tangent = parts[index].sampleTangent(local);
        return reversed[index] ? tangent.negate() : tangent;
    }

    // --- rail joints (SPEC §10) ---
    // Each segment is laid with rails from its own start node: joints at
    // 0, L, 2L … along the segment, and one at its end node (the next
    // segment's start). A part travelled in reverse meets the same joints
    // from the other end, so they stay put on the track for every route.

    /** Joints of a part of length {@code len} in [start, end): the end node is the next part's. */
    private static long jointsIn(double len) {
        return Math.max(1L, (long) Math.ceil(len / JOINT_SPACING));
    }

    @Override
    public long jointIndex(double s) {
        double total = length();
        long laps = 0;
        double ranged;
        if (loop) {
            laps = (long) Math.floor(s / total);
            ranged = s - laps * total;
        } else {
            ranged = Math.clamp(s, 0.0, total);
        }
        int index = partIndex(ranged);
        double len = partLength(index);
        double u = Math.min(ranged - cumulative[index], Math.nextDown(len));
        long inPart;
        if (!reversed[index]) {
            inPart = (long) Math.floor(u / JOINT_SPACING) + 1L; // joints at k·L ≤ u
        } else {
            // the node at u = 0, then len − k·L for k ≥ 1 while it stays > 0
            long kMax = jointsIn(len) - 1L;
            long kMin = Math.max(1L, (long) Math.ceil((len - u) / JOINT_SPACING));
            inPart = 1L + Math.max(0L, kMax - kMin + 1L);
        }
        return laps * jointsBefore[parts.length] + jointsBefore[index] + inPart;
    }

    @Override
    public double jointDistance(double s) {
        double ranged = intoRange(s);
        int index = partIndex(ranged);
        double len = partLength(index);
        double u = ranged - cumulative[index];
        double along = reversed[index] ? len - u : u; // from the segment's start node
        double into = along - Math.floor(along / JOINT_SPACING) * JOINT_SPACING;
        return Math.min(Math.min(u, len - u), Math.min(into, JOINT_SPACING - into));
    }

    private int partIndex(double s) {
        int low = 0;
        int high = parts.length - 1;
        while (low < high) {
            int mid = (low + high) >>> 1;
            if (cumulative[mid + 1] <= s) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        return low;
    }
}
