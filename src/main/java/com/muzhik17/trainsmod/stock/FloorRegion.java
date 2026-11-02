package com.muzhik17.trainsmod.stock;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Where a rider's centre may stand on a floor of boxes (SPEC §9.8): the
 * <b>union</b> of the floor zones, shrunk by the player's half-width — a body
 * fits wherever its square ({@code 2·margin} across, axis-aligned in the
 * model frame) lies inside the union. Zones that touch therefore join with no
 * overlap, and a gap of any width between them is a wall: no rules for the
 * author to keep. Exact for boxes; a shape that isn't a box comes in as boxes.
 *
 * <p>Built once per floor. The union is cut into <b>strips</b> along Z at
 * every zone edge, each strip keeping the X intervals the floor covers there;
 * where a centre fits is kept as <b>pieces</b>: slabs along Z between the
 * strip edges ± the margin (plus the edges themselves, which matter for a
 * zone exactly a player deep), each slab with the X intervals a centre may
 * take. Pieces are closed boxes in the X–Z plane, in Z order.
 *
 * <p>A region may have <b>cuts</b> ({@link Cut}): open boxes no centre stands
 * in, a shut door between zones (SPEC §9.1). The union can't say a shut door
 * is wall where the zones on its two sides touch or overlap in its doorway
 * (the platzkart's compartment, {@code DoorKupe}); the cut does, being taken
 * out of where centres stand: the pieces end at its faces, and a step must
 * not pass through it ({@link #throughCut}) — a leaf may be thinner than a step.
 * Only a cut that takes something out is kept: one in a wall changes nothing.
 */
public final class FloorRegion {

    private static final double EPS = 1.0e-9;
    /** The thinnest a cut is across the wall: a door box thinner than this still parts the floor. */
    private static final double MIN_CUT = 0.01;

    /** One box of the region: centres with x in [minX, maxX] and z in [minZ, maxZ] fit. */
    public record Piece(double minX, double minZ, double maxX, double maxZ) {

        /** True if (x, z) lies in this box (closed). */
        public boolean holds(double x, double z) {
            return x >= minX - EPS && x <= maxX + EPS && z >= minZ - EPS && z <= maxZ + EPS;
        }

        /** The point of this box nearest to (x, z): {x, z}. */
        public double[] clamp(double x, double z) {
            return new double[]{Math.clamp(x, minX, maxX), Math.clamp(z, minZ, maxZ)};
        }

        /** True if this box and the box [minX..maxX] × [minZ..maxZ] share a point. */
        public boolean touches(double minX, double minZ, double maxX, double maxZ) {
            return Math.min(this.maxX, maxX) >= Math.max(this.minX, minX) - EPS
                    && Math.min(this.maxZ, maxZ) >= Math.max(this.minZ, minZ) - EPS;
        }
    }

    /**
     * A box of the X–Z plane no centre stands in: open, its faces are still
     * floor. A shut door between zones ({@link #shut}).
     */
    public record Cut(double minX, double minZ, double maxX, double maxZ) {

        /**
         * Where shut door {@code door} stands across the floor (SPEC §9.1): no
         * centre inside its leaf's thickness while the body, {@code margin}
         * either way of it, overlaps the leaf along the wall — the door's box
         * across the wall (at least a centimetre thick), its span grown
         * by the margin along it. The leaf isn't grown across the wall: zones
         * often run into a doorway or a little under a leaf (the platzkart's
         * aisle by the compartment, the VL80's walkway by its sliding doors),
         * and a leaf a body wide would close the floor beside it.
         */
        public static Cut shut(WagonType.Door door, double margin) {
            boolean side = door.axis() == 0;
            double lo = side ? door.minX() : door.minZ();
            double hi = side ? door.maxX() : door.maxZ();
            if (hi - lo < MIN_CUT) {
                double mid = (lo + hi) * 0.5;
                lo = mid - MIN_CUT * 0.5;
                hi = mid + MIN_CUT * 0.5;
            }
            double alongLo = door.spanMin() - margin;
            double alongHi = door.spanMax() + margin;
            return side ? new Cut(lo, alongLo, hi, alongHi) : new Cut(alongLo, lo, alongHi, hi);
        }

        /** True if a piece of the region reaches inside this box. */
        public boolean bites(Piece p) {
            return p.maxX() > minX + EPS && p.minX() < maxX - EPS && p.maxZ() > minZ + EPS && p.minZ() < maxZ - EPS;
        }

        /** True if the straight line from (x0, z0) to (x1, z1) passes inside this box (along a face doesn't). */
        public boolean crossed(double x0, double z0, double x1, double z1) {
            double[] t = {0.0, 1.0};
            return clip(x0, x1 - x0, minX + EPS, maxX - EPS, t) && clip(z0, z1 - z0, minZ + EPS, maxZ - EPS, t);
        }

        /** Narrows {@code t} to where p + t·d lies strictly inside (lo, hi); false if nowhere. */
        private static boolean clip(double p, double d, double lo, double hi, double[] t) {
            if (!(hi > lo)) {
                return false;
            }
            if (Math.abs(d) < EPS) {
                return p > lo && p < hi;
            }
            double a = (lo - p) / d;
            double b = (hi - p) / d;
            t[0] = Math.max(t[0], Math.min(a, b));
            t[1] = Math.min(t[1], Math.max(a, b));
            return t[0] < t[1];
        }
    }

    private final double margin;
    /** Strip edges along Z; strip {@code k} runs from {@code stripZ[k]} to {@code stripZ[k + 1]}. */
    private final double[] stripZ;
    /** Per strip, the X intervals the floor covers, flat {@code [a0, b0, a1, b1, …]}, sorted, disjoint. */
    private final double[][] stripX;
    private final List<Piece> pieces;
    /** {@code pieces.get(i).maxZ()}, non-decreasing: for range lookups. */
    private final double[] pieceMaxZ;
    /** The cuts taken out of where centres stand (only those that take something out). */
    private final List<Cut> cuts;

    private FloorRegion(double margin, double[] stripZ, double[][] stripX, List<Piece> pieces, List<Cut> cuts) {
        this.margin = margin;
        this.stripZ = stripZ;
        this.stripX = stripX;
        this.pieces = List.copyOf(pieces);
        this.cuts = List.copyOf(cuts);
        this.pieceMaxZ = new double[pieces.size()];
        for (int i = 0; i < pieceMaxZ.length; i++) {
            pieceMaxZ[i] = pieces.get(i).maxZ();
        }
    }

    /**
     * The region of the union of {@code zones} where a body {@code 2·margin}
     * across fits.
     *
     * @param margin the player's half-width, &gt; 0
     */
    public static FloorRegion of(List<WagonType.Interior.Zone> zones, double margin) {
        return of(zones, margin, List.of());
    }

    /**
     * {@link #of(List, double)} with {@code cuts} taken out of where centres
     * stand (shut doors, {@link Cut#shut}); a cut no centre would stand in
     * anyway is dropped, so it leaves the pieces as they are.
     */
    public static FloorRegion of(List<WagonType.Interior.Zone> zones, double margin, List<Cut> cuts) {
        if (!(margin > EPS)) {
            throw new IllegalArgumentException("margin must be positive: " + margin);
        }
        double[] edges = new double[zones.size() * 2];
        for (int i = 0; i < zones.size(); i++) {
            edges[2 * i] = zones.get(i).minZ();
            edges[2 * i + 1] = zones.get(i).maxZ();
        }
        double[] stripZ = unique(edges);
        double[][] stripX = new double[Math.max(stripZ.length - 1, 0)][];
        for (int k = 0; k < stripX.length; k++) {
            double lo = stripZ[k];
            double hi = stripZ[k + 1];
            List<double[]> spans = new ArrayList<>();
            for (WagonType.Interior.Zone zone : zones) {
                if (zone.minZ() <= lo + EPS && zone.maxZ() >= hi - EPS && zone.maxX() >= zone.minX()) {
                    spans.add(new double[]{zone.minX(), zone.maxX()});
                }
            }
            stripX[k] = merge(spans);
        }
        List<Piece> whole = new FloorRegion(margin, stripZ, stripX, List.of(), List.of()).buildPieces();
        List<Cut> biting = new ArrayList<>();
        for (Cut cut : cuts) {
            if (whole.stream().anyMatch(cut::bites)) {
                biting.add(cut);
            }
        }
        if (biting.isEmpty()) {
            return new FloorRegion(margin, stripZ, stripX, whole, List.of());
        }
        FloorRegion bare = new FloorRegion(margin, stripZ, stripX, List.of(), biting);
        return new FloorRegion(margin, stripZ, stripX, bare.buildPieces(), biting);
    }

    /** The half-width this region was shrunk by. */
    public double margin() {
        return margin;
    }

    /** Every box of the region, in Z order; empty if a player fits nowhere. */
    public List<Piece> pieces() {
        return pieces;
    }

    /** The cuts taken out of this region (each takes something out), empty if none. */
    public List<Cut> cuts() {
        return cuts;
    }

    /**
     * True if walking straight from centre (x0, z0) to (x1, z1) passes
     * through a cut — a shut door between two places that both fit.
     */
    public boolean throughCut(double x0, double z0, double x1, double z1) {
        for (Cut cut : cuts) {
            if (cut.crossed(x0, z0, x1, z1)) {
                return true;
            }
        }
        return false;
    }

    /** True if a rider centred at (x, z) fits on the floor. */
    public boolean fits(double x, double z) {
        for (int i = firstPieceReaching(z - EPS); i < pieces.size(); i++) {
            Piece p = pieces.get(i);
            if (p.minZ() > z + EPS) {
                break;
            }
            if (p.holds(x, z)) {
                return true;
            }
        }
        return false;
    }

    /** The point of the region nearest (x, z) as {x, z}, or null if a player fits nowhere. */
    public double[] nearest(double x, double z) {
        double[] best = null;
        double bestDist = Double.MAX_VALUE;
        for (Piece p : pieces) {
            double[] c = p.clamp(x, z);
            double d = Math.hypot(c[0] - x, c[1] - z);
            if (d < bestDist - EPS) {
                best = c;
                bestDist = d;
            }
        }
        return best;
    }

    /** The index of the first piece whose box reaches {@code z} or beyond along Z. */
    public int firstPieceReaching(double z) {
        int lo = 0;
        int hi = pieceMaxZ.length;
        while (lo < hi) {
            int mid = (lo + hi) >>> 1;
            if (pieceMaxZ[mid] < z) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    /**
     * How far a centre at (x, z) can go along one axis without leaving the
     * region: the furthest X ({@code axis} 0) or Z ({@code axis} 2) in
     * direction {@code dir} (±1) it can slide to in a straight line. NaN if
     * (x, z) doesn't fit.
     */
    public double reach(double x, double z, int axis, int dir) {
        if (!fits(x, z)) {
            return Double.NaN;
        }
        double at = axis == 0 ? x : z;
        boolean grew = true;
        while (grew) {
            grew = false;
            for (Piece p : pieces) {
                boolean onLine = axis == 0
                        ? z >= p.minZ() - EPS && z <= p.maxZ() + EPS
                        : x >= p.minX() - EPS && x <= p.maxX() + EPS;
                double lo = axis == 0 ? p.minX() : p.minZ();
                double hi = axis == 0 ? p.maxX() : p.maxZ();
                if (!onLine || at < lo - EPS || at > hi + EPS) {
                    continue;
                }
                double end = dir > 0 ? hi : lo;
                if (dir * (end - at) > EPS) {
                    at = end;
                    grew = true;
                }
            }
        }
        return at;
    }

    /**
     * Pairs of piece indices that touch — one walks from one into the other —
     * for the connectivity check ({@code FloorCheck}).
     */
    public List<int[]> links() {
        List<int[]> links = new ArrayList<>();
        for (int i = 0; i < pieces.size(); i++) {
            Piece a = pieces.get(i);
            for (int j = i + 1; j < pieces.size(); j++) {
                Piece b = pieces.get(j);
                if (b.minZ() > a.maxZ() + EPS) {
                    break;
                }
                if (a.touches(b.minX(), b.minZ(), b.maxX(), b.maxZ())) {
                    links.add(new int[]{i, j});
                }
            }
        }
        return links;
    }

    // --- building ---

    private List<Piece> buildPieces() {
        List<Piece> out = new ArrayList<>();
        if (stripZ.length < 2) {
            return out;
        }
        double lo = stripZ[0] + margin;
        double hi = stripZ[stripZ.length - 1] - margin;
        if (hi < lo - EPS) {
            return out; // the whole floor is shallower than a player
        }
        // slab edges: the strip edges ± the margin, the ends, the cuts' edges
        double[] edges = new double[stripZ.length * 2 + 2 + cuts.size() * 2];
        for (int k = 0; k < stripZ.length; k++) {
            edges[2 * k] = stripZ[k] - margin;
            edges[2 * k + 1] = stripZ[k] + margin;
        }
        edges[stripZ.length * 2] = lo;
        edges[stripZ.length * 2 + 1] = Math.max(lo, hi);
        for (int c = 0; c < cuts.size(); c++) {
            edges[stripZ.length * 2 + 2 + 2 * c] = cuts.get(c).minZ();
            edges[stripZ.length * 2 + 3 + 2 * c] = cuts.get(c).maxZ();
        }
        double[] breaks = Arrays.stream(unique(edges))
                .filter(v -> v >= lo - EPS && v <= Math.max(lo, hi) + EPS).toArray();
        for (int i = 0; i < breaks.length; i++) {
            addSlab(out, breaks[i], breaks[i], slice(breaks[i]));
            if (i + 1 < breaks.length && breaks[i + 1] - breaks[i] > EPS) {
                addSlab(out, breaks[i], breaks[i + 1], slice((breaks[i] + breaks[i + 1]) * 0.5));
            }
        }
        return out;
    }

    private static void addSlab(List<Piece> out, double z0, double z1, double[] xs) {
        for (int i = 0; i + 1 < xs.length; i += 2) {
            out.add(new Piece(xs[i], z0, xs[i + 1], z1));
        }
    }

    /**
     * The X intervals a centre at {@code z} may take: the intervals every
     * strip under the body covers, each shrunk by the margin, intersected —
     * less the cuts {@code z} is inside of.
     */
    private double[] slice(double z) {
        double bodyLo = z - margin;
        double bodyHi = z + margin;
        if (bodyLo < stripZ[0] - EPS || bodyHi > stripZ[stripZ.length - 1] + EPS) {
            return new double[0];
        }
        double[] fit = null;
        for (int k = 0; k < stripX.length; k++) {
            if (stripZ[k] < bodyHi - EPS && stripZ[k + 1] > bodyLo + EPS) {
                double[] shrunk = shrink(stripX[k], margin);
                fit = fit == null ? shrunk : intersect(fit, shrunk);
                if (fit.length == 0) {
                    break;
                }
            }
        }
        if (fit == null) {
            return new double[0];
        }
        for (Cut cut : cuts) {
            if (z > cut.minZ() + EPS && z < cut.maxZ() - EPS) {
                fit = without(fit, cut.minX(), cut.maxX());
            }
        }
        return fit;
    }

    /** Intervals less the open interval (a, b): what reaches into it is cut back to its ends. */
    private static double[] without(double[] xs, double a, double b) {
        double[] out = new double[xs.length * 2];
        int n = 0;
        for (int i = 0; i + 1 < xs.length; i += 2) {
            double lo = xs[i];
            double hi = xs[i + 1];
            if (hi <= a + EPS || lo >= b - EPS) {
                out[n++] = lo;
                out[n++] = hi;
                continue;
            }
            if (lo <= a + EPS) {
                out[n++] = lo;
                out[n++] = Math.max(lo, a);
            }
            if (hi >= b - EPS) {
                out[n++] = Math.min(hi, b);
                out[n++] = hi;
            }
        }
        return Arrays.copyOf(out, n);
    }

    /** Intervals pulled in by {@code m} at both ends; one narrower than 2m but within EPS becomes its midpoint. */
    private static double[] shrink(double[] xs, double m) {
        double[] out = new double[xs.length];
        int n = 0;
        for (int i = 0; i + 1 < xs.length; i += 2) {
            double a = xs[i] + m;
            double b = xs[i + 1] - m;
            if (b >= a - 2 * EPS) {
                if (b < a) {
                    a = b = (a + b) * 0.5;
                }
                out[n++] = a;
                out[n++] = b;
            }
        }
        return Arrays.copyOf(out, n);
    }

    private static double[] intersect(double[] a, double[] b) {
        double[] out = new double[a.length + b.length];
        int n = 0;
        int i = 0;
        int j = 0;
        while (i + 1 < a.length && j + 1 < b.length) {
            double lo = Math.max(a[i], b[j]);
            double hi = Math.min(a[i + 1], b[j + 1]);
            if (hi >= lo - EPS) {
                out[n++] = lo;
                out[n++] = Math.max(lo, hi);
            }
            if (a[i + 1] < b[j + 1]) {
                i += 2;
            } else {
                j += 2;
            }
        }
        return Arrays.copyOf(out, n);
    }

    /** Spans merged where they overlap or touch, flat and sorted. */
    private static double[] merge(List<double[]> spans) {
        spans.sort((p, q) -> Double.compare(p[0], q[0]));
        double[] out = new double[spans.size() * 2];
        int n = 0;
        for (double[] s : spans) {
            if (n > 0 && s[0] <= out[n - 1] + EPS) {
                out[n - 1] = Math.max(out[n - 1], s[1]);
            } else {
                out[n++] = s[0];
                out[n++] = s[1];
            }
        }
        return Arrays.copyOf(out, n);
    }

    /** Sorted values with near-duplicates (within EPS) dropped. */
    private static double[] unique(double[] values) {
        double[] sorted = values.clone();
        Arrays.sort(sorted);
        double[] out = new double[sorted.length];
        int n = 0;
        for (double v : sorted) {
            if (n == 0 || v - out[n - 1] > EPS) {
                out[n++] = v;
            }
        }
        return Arrays.copyOf(out, n);
    }
}
