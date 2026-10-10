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
 */
public final class FloorRegion {

    private static final double EPS = 1.0e-9;

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

    private final double margin;
    /** Strip edges along Z; strip {@code k} runs from {@code stripZ[k]} to {@code stripZ[k + 1]}. */
    private final double[] stripZ;
    /** Per strip, the X intervals the floor covers, flat {@code [a0, b0, a1, b1, …]}, sorted, disjoint. */
    private final double[][] stripX;
    private final List<Piece> pieces;
    /** {@code pieces.get(i).maxZ()}, non-decreasing: for range lookups. */
    private final double[] pieceMaxZ;

    private FloorRegion(double margin, double[] stripZ, double[][] stripX, List<Piece> pieces) {
        this.margin = margin;
        this.stripZ = stripZ;
        this.stripX = stripX;
        this.pieces = List.copyOf(pieces);
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
        FloorRegion bare = new FloorRegion(margin, stripZ, stripX, List.of());
        return new FloorRegion(margin, stripZ, stripX, bare.buildPieces());
    }

    /** The half-width this region was shrunk by. */
    public double margin() {
        return margin;
    }

    /** Every box of the region, in Z order; empty if a player fits nowhere. */
    public List<Piece> pieces() {
        return pieces;
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
        double[] cuts = new double[stripZ.length * 2 + 2];
        for (int k = 0; k < stripZ.length; k++) {
            cuts[2 * k] = stripZ[k] - margin;
            cuts[2 * k + 1] = stripZ[k] + margin;
        }
        cuts[cuts.length - 2] = lo;
        cuts[cuts.length - 1] = Math.max(lo, hi);
        double[] breaks = Arrays.stream(unique(cuts))
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
     * strip under the body covers, each shrunk by the margin, intersected.
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
        return fit == null ? new double[0] : fit;
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
