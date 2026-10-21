package com.muzhik17.trainsmod.path;

import java.util.ArrayList;
import java.util.List;

import org.joml.Vector3d;

/**
 * A stretch of track kept apart from the rail graph (decision D2,
 * 2026-10-21): the curves a train stood on when its whole route was
 * demolished. The consist stays where it stood on them — seen, clicked and
 * broken up by blows at its bogies as before — but nothing ties it to the
 * graph any more, so new track built there, whatever its ids, never takes it.
 *
 * <p>Its {@code s} runs from 0 to {@link #length()} over a window of the
 * kept curves, starting {@link #offset()} into the first; past either end
 * it clamps, as an open route does. The curves are the route's own, sampled
 * the same way, so a train cut out onto them doesn't shift by a hair.
 *
 * <p>Pure math, no MC imports.
 */
public final class StrandedTrack implements TrackPath {

    private final List<HermiteSegment> curves;
    private final boolean[] reversed;
    private final RoutePath route;
    private final double offset;
    private final double length;

    /**
     * @param curves   the curves in the order the track runs, each in its own direction
     * @param reversed per curve, true if the track runs it backwards
     * @param offset   where {@code s = 0} lies, along the chained curves
     * @param length   the window's length past {@code offset}
     */
    public StrandedTrack(List<HermiteSegment> curves, boolean[] reversed, double offset, double length) {
        if (curves.isEmpty() || curves.size() != reversed.length) {
            throw new IllegalArgumentException("curves/reversed mismatch or empty");
        }
        this.curves = List.copyOf(curves);
        this.reversed = reversed.clone();
        HermiteSegmentPath[] parts = new HermiteSegmentPath[curves.size()];
        for (int i = 0; i < parts.length; i++) {
            parts[i] = new HermiteSegmentPath(curves.get(i));
        }
        this.route = new RoutePath(parts, this.reversed.clone(), false);
        this.offset = Math.clamp(offset, 0.0, route.length());
        this.length = Math.clamp(length, 0.0, route.length() - this.offset);
    }

    /** A track cut out of a route, and the route {@code s} its own {@code s = 0} lies at. */
    public record Cut(StrandedTrack track, double startS) {
    }

    /**
     * Cut {@code [from, to]} out of {@code path}: an open route clamps both
     * into its range, a loop wraps them (one lap at most — beyond it the
     * curves repeat). {@code startS} is unwrapped on a loop, in the same lap
     * as {@code from}: a consist at route {@code s} is at {@code s − startS}
     * on the cut.
     */
    public static Cut cut(RoutePath path, double from, double to) {
        double total = path.length();
        double lo = from;
        double hi = Math.max(from, to);
        double wrapped;
        if (path.loop()) {
            hi = Math.min(hi, lo + total);
            wrapped = lo % total;
            wrapped = wrapped < 0.0 ? wrapped + total : wrapped;
        } else {
            lo = Math.clamp(lo, 0.0, total);
            hi = Math.clamp(hi, 0.0, total);
            wrapped = lo;
        }
        int count = path.partCount();
        int part = path.partIndexAt(wrapped);
        double offset = wrapped - path.partStartS(part);
        List<HermiteSegment> curves = new ArrayList<>();
        List<Boolean> flags = new ArrayList<>();
        double covered = 0.0;
        // a window starting inside a part and running a whole lap ends in it again
        while (curves.size() <= count) {
            curves.add(path.partCurve(part));
            flags.add(path.partReversed(part));
            covered += path.partLength(part);
            part++;
            if (part == count) {
                if (!path.loop()) {
                    break;
                }
                part = 0;
            }
            if (covered - offset >= hi - lo) {
                break;
            }
        }
        boolean[] reversed = new boolean[flags.size()];
        for (int i = 0; i < reversed.length; i++) {
            reversed[i] = flags.get(i);
        }
        return new Cut(new StrandedTrack(curves, reversed, offset, hi - lo), lo);
    }

    /**
     * A straight track along {@code axis} with route {@code s = atS} at
     * {@code at}, cut to {@code [from, to]} (for a train whose curves are
     * not known, laid out along one of its wagons as it stands).
     */
    public static Cut line(Vector3d at, Vector3d axis, double atS, double from, double to) {
        Vector3d dir = axis.lengthSquared() > 1.0e-12 ? new Vector3d(axis).normalize() : new Vector3d(0, 0, 1);
        double hi = Math.max(from, to);
        Vector3d a = new Vector3d(dir).mul(from - atS).add(at);
        Vector3d b = new Vector3d(dir).mul(hi - atS).add(at);
        HermiteSegment curve = HermiteSegment.straight(a, b);
        return new Cut(new StrandedTrack(List.of(curve), new boolean[] {false}, 0.0, hi - from), from);
    }

    /** The kept curves, in track order, each in its own direction. */
    public List<HermiteSegment> curves() {
        return curves;
    }

    /** Per curve, true if the track runs it backwards (a copy). */
    public boolean[] reversed() {
        return reversed.clone();
    }

    /** Where {@code s = 0} lies along the chained curves. */
    public double offset() {
        return offset;
    }

    @Override
    public double length() {
        return length;
    }

    private double along(double s) {
        return offset + Math.clamp(s, 0.0, length);
    }

    @Override
    public Vector3d samplePosition(double s) {
        return route.samplePosition(along(s));
    }

    @Override
    public Vector3d sampleTangent(double s) {
        return route.sampleTangent(along(s));
    }

    /** The joints stay where the route laid them: each curve's from its own start. */
    @Override
    public long jointIndex(double s) {
        return route.jointIndex(along(s));
    }

    @Override
    public double jointDistance(double s) {
        return route.jointDistance(along(s));
    }
}
