package com.muzhik17.trainsmod.path;

import java.util.Arrays;
import java.util.Objects;

/**
 * A switch's frog (крестовина, SPEC §2.2 v1) as one of its two legs sees
 * it: where the legs' inner rails — each leg's rail on the side of the
 * other — cross. Drawn as a real frog instead of two rails crossing
 * straight through each other, out of the inner rails alone (the sleepers
 * and the rest of a style are never touched), and still — it doesn't move:
 *
 * <ul>
 * <li><b>Throat and wing rails</b> (усовики): where the gap between the two
 * inner rails' gauge faces closes to a {@link #FLANGEWAY}, each inner rail
 * bends outward to keep that flangeway (желоб) from the other leg's gauge
 * line — running along it — and carries on past the nose by
 * {@link #WING_TAIL}, flared out at the end.</li>
 * <li><b>The nose</b> (сердечник): past the point where the gauge lines
 * cross, the two inner rails go on as the point rails of a V, its tip
 * toward the switch's toe: the steel between the two gauge lines, each
 * rail cut by the other. One leg owns the tip: its rail is cut along the
 * other leg's gauge line (the sharp V) and then along its own railhead's
 * outer face; the other leg's rail fills the rest of the V beyond that
 * face. The cut is one line, so the two never overlap.</li>
 * </ul>
 *
 * The other leg's lines are sampled every {@link #STEP} from {@code origin} (a
 * little before the frog, distance from the node) on, as
 * offsets across this leg's frame toward it ({@code u}, see
 * {@link SwitchThroat}): {@code gauge} — its inner rail's gauge face,
 * {@code head} — that railhead's outer face, {@code outer} — the rail's
 * farthest reach. Marks along the leg, distance from the node:
 * {@code wingStart} (the wing's foot starts to draw in), {@code throat}
 * (the wing starts to bend), {@code point} (the gauge lines cross),
 * {@code noseStart}/{@code pointEnd} (this leg's point rail),
 * {@code wingEnd}.
 *
 * <p>Pure math, no MC imports (SPEC principle #4); render only.
 */
public record SwitchFrog(int side, boolean owner, SwitchThroat.Profile rail, double origin, double step,
        double[] gauge, double[] head, double[] outer,
        double wingStart, double throat, double point, double noseStart, double pointEnd, double wingEnd) {

    /** Sample spacing of the other leg's lines, blocks. */
    public static final double STEP = 1.0 / 16.0;
    /**
     * The flangeway (желоб) between a wing rail and the nose, blocks: ~50 mm
     * at 1 block = 1 m, a little over a third of MVP's (oversized) railhead —
     * the least that reads as a gap from a few blocks away.
     */
    public static final double FLANGEWAY = 0.05;
    /**
     * Over this much more gap than the flangeway the wing's foot draws in
     * on the gauge side, so the two feet don't overlap in the throat.
     */
    public static final double FOOT_GAP = 0.08;
    /** How far a wing rail runs on past where the other leg's rail has cleared it, blocks. */
    public static final double WING_TAIL = 0.3;
    /** How much a wing rail's end is flared out, over {@link #WING_FLARE_LENGTH}. */
    public static final double WING_FLARE = 0.06;
    public static final double WING_FLARE_LENGTH = 0.5;
    /** The wing rail's end is pinched shut over this length, so its open end doesn't show. */
    public static final double WING_END = 0.125;

    /**
     * The frog from the other leg's sampled lines (see the class doc), or
     * null if it doesn't fit within {@code reach} of the node or the lines
     * break off before it ends (the other leg ran out).
     */
    static SwitchFrog of(int side, boolean owner, SwitchThroat.Profile rail, double origin, double step,
            double[] gauge, double[] head, double[] outer, double reach) {
        double f = rail.gaugeFace();
        double wingStart = origin + first(gauge, step, g -> f - g <= FLANGEWAY + FOOT_GAP);
        double throat = origin + first(gauge, step, g -> f - g <= FLANGEWAY);
        double point = origin + first(gauge, step, g -> g >= f);
        double noseStart = owner ? point : origin + first(head, step, o -> o >= f);
        double clear = origin + first(outer, step, e -> e >= rail.outer());
        double pointEnd = owner ? clear : origin + first(head, step, o -> o >= rail.outer());
        double wingEnd = clear + WING_TAIL;
        if (Double.isNaN(wingStart) || Double.isNaN(throat) || Double.isNaN(point) || Double.isNaN(noseStart)
                || Double.isNaN(pointEnd) || Double.isNaN(clear) || wingEnd > reach
                || brokenBefore(gauge, step, wingEnd - origin) || brokenBefore(head, step, wingEnd - origin)
                || brokenBefore(outer, step, wingEnd - origin)) {
            return null;
        }
        return new SwitchFrog(side, owner, rail, origin, step, gauge, head, outer,
                wingStart, throat, point, noseStart, pointEnd, wingEnd);
    }

    /** Where the frog's bent stretch of this leg's inner rail begins. */
    public double start() {
        return wingStart;
    }

    /** Where it ends: the wing rail's end (the point rail has ended by then). */
    public double end() {
        return Math.max(wingEnd, pointEnd);
    }

    /**
     * The wing rail {@code d} from the node: {floor, cut, shift} for
     * {@link SwitchThroat#bend} — moved out to keep the flangeway from the
     * other leg's gauge line, its gauge-side foot drawn in, flared and
     * pinched shut at the end.
     */
    public void wing(double d, double[] out, int offset) {
        double f = rail.gaugeFace();
        double gap = f - at(gauge, d);
        double flareFrom = wingEnd - WING_FLARE_LENGTH;
        double flare = d > flareFrom ? WING_FLARE * square((d - flareFrom) / WING_FLARE_LENGTH) : 0.0;
        double floor = f - SwitchThroat.FOOT_REACH * Math.clamp((gap - FLANGEWAY) / FOOT_GAP, 0.0, 1.0);
        double shut = Math.clamp((d - (wingEnd - WING_END)) / WING_END, 0.0, 1.0);
        out[offset] = floor + (f - floor) * shut;
        out[offset + 1] = rail.outer() - (rail.outer() - f) * shut;
        out[offset + 2] = Math.max(0.0, FLANGEWAY - gap) + flare;
    }

    /**
     * The point rail {@code d} from the node: {floor, cut, shift} for
     * {@link SwitchThroat#bend}. The owner's is cut along the other leg's
     * gauge line (the sharp V), then along its own railhead's outer face
     * until the other rail's foot has cleared it; the other's keeps only
     * what lies beyond that line. The gauge-side foot draws in at the start,
     * so the rail starts in a point.
     */
    public void point(double d, double[] out, int offset) {
        double f = rail.gaugeFace();
        if (owner) {
            double g = at(gauge, d);
            out[offset] = f - Math.max(0.0, g - f);
            out[offset + 1] = Math.min(g, Math.max(rail.headOuter(), at(outer, d)));
        } else {
            double o = at(head, d);
            out[offset] = f - Math.max(0.0, o - f);
            out[offset + 1] = Math.max(f, Math.min(o, rail.outer()));
        }
        out[offset + 2] = 0.0;
    }

    /** A sampled line {@code d} from the node, interpolated (held at the ends of the sampled stretch). */
    double at(double[] line, double d) {
        double x = Math.clamp((d - origin) / step, 0.0, line.length - 1.0);
        int i = Math.min((int) x, line.length - 2);
        double frac = x - i;
        return line[i] * (1.0 - frac) + line[i + 1] * frac;
    }

    private static double square(double x) {
        return x * x;
    }

    /** The first distance where {@code test} holds, interpolated between samples; NaN if never (or a gap first). */
    private static double first(double[] line, double step, java.util.function.DoublePredicate test) {
        for (int i = 0; i < line.length; i++) {
            if (Double.isNaN(line[i])) {
                if (i > 0) {
                    return Double.NaN; // the other leg ran out before
                }
                continue;
            }
            if (test.test(line[i])) {
                if (i == 0 || Double.isNaN(line[i - 1])) {
                    return i * step;
                }
                // between the samples, linearly: find where the test flips
                double lo = (i - 1) * step;
                double hi = i * step;
                for (int k = 0; k < 20; k++) {
                    double mid = (lo + hi) / 2.0;
                    double value = line[i - 1] + (line[i] - line[i - 1]) * (mid / step - (i - 1));
                    if (test.test(value)) {
                        hi = mid;
                    } else {
                        lo = mid;
                    }
                }
                return hi;
            }
        }
        return Double.NaN;
    }

    /** Whether the line has a gap (the other leg ran out) up to {@code d} past its first sample. */
    private static boolean brokenBefore(double[] line, double step, double d) {
        if (Math.ceil(d / step) >= line.length) {
            return true; // not even sampled that far
        }
        int last = Math.min(line.length - 1, (int) Math.ceil(d / step) + 1);
        for (int i = 1; i <= last; i++) {
            if (Double.isNaN(line[i])) {
                return true;
            }
        }
        return false;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof SwitchFrog other && side == other.side && owner == other.owner
                && rail.equals(other.rail) && origin == other.origin && step == other.step
                && Arrays.equals(gauge, other.gauge) && Arrays.equals(head, other.head)
                && Arrays.equals(outer, other.outer);
    }

    @Override
    public int hashCode() {
        return Objects.hash(side, owner, rail, origin, step, Arrays.hashCode(gauge), Arrays.hashCode(head),
                Arrays.hashCode(outer));
    }
}
