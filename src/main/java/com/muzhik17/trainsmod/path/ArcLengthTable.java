package com.muzhik17.trainsmod.path;

import java.util.function.DoubleFunction;

import org.joml.Vector3d;

/**
 * Arc-length table for one spline segment (SPEC §2.2): a sampled mapping
 * «parameter t ↔ travelled length s». All motion is by length, never by raw
 * {@code t} — equal steps in {@code t} are not equal distances on a curve.
 *
 * <p>Built once per segment by sampling the curve at {@code samples + 1}
 * points and accumulating chord lengths; lookups interpolate linearly between
 * samples. Pure math, no MC imports (SPEC principle #4).
 *
 * <p>A curve that has no finite length — a point that is NaN or infinite, or
 * coordinates so large the distances overflow — has no table: the constructor
 * refuses it. Without that check the NaN length surfaced much later, as the
 * exception {@link Math#clamp(double, double, double)} throws for a NaN bound
 * in {@link #tForS}, wherever the first train happened to sample the curve.
 */
public final class ArcLengthTable {

    /** Default sample count: plenty for track-scale curves. */
    public static final int DEFAULT_SAMPLES = 64;

    /** cumulative[i] = arc length from t=0 to t=i/samples; cumulative[0] = 0. */
    private final double[] cumulative;

    /**
     * @throws IllegalArgumentException if {@code samples < 1} or the curve's
     *         length is not finite
     */
    public ArcLengthTable(DoubleFunction<Vector3d> curve, int samples) {
        if (samples < 1) {
            throw new IllegalArgumentException("samples must be >= 1");
        }
        this.cumulative = new double[samples + 1];
        Vector3d previous = curve.apply(0.0);
        for (int i = 1; i <= samples; i++) {
            Vector3d current = curve.apply((double) i / samples);
            cumulative[i] = cumulative[i - 1] + previous.distance(current);
            previous = current;
        }
        if (!Double.isFinite(cumulative[samples])) {
            throw new IllegalArgumentException("the curve has no finite length (a point of it is NaN or infinite)");
        }
    }

    public static ArcLengthTable of(HermiteSegment segment) {
        return new ArcLengthTable(segment::position, DEFAULT_SAMPLES);
    }

    /** Total arc length of the segment. */
    public double length() {
        return cumulative[cumulative.length - 1];
    }

    /** Arc length travelled at raw parameter {@code t ∈ [0, 1]} (clamped). */
    public double sForT(double t) {
        double scaled = Math.clamp(t, 0.0, 1.0) * (cumulative.length - 1);
        int index = (int) Math.min(scaled, cumulative.length - 2);
        double fraction = scaled - index;
        return cumulative[index] + (cumulative[index + 1] - cumulative[index]) * fraction;
    }

    /** Raw parameter {@code t} at arc length {@code s} (clamped to {@code [0, length()]}). */
    public double tForS(double s) {
        double clamped = Math.clamp(s, 0.0, length());
        // binary search for the sample interval containing s
        int low = 0;
        int high = cumulative.length - 1;
        while (high - low > 1) {
            int mid = (low + high) >>> 1;
            if (cumulative[mid] <= clamped) {
                low = mid;
            } else {
                high = mid;
            }
        }
        double span = cumulative[high] - cumulative[low];
        double fraction = span > 1.0e-12 ? (clamped - cumulative[low]) / span : 0.0;
        return (low + fraction) / (cumulative.length - 1);
    }
}
