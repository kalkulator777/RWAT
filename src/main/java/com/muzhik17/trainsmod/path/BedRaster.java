package com.muzhik17.trainsmod.path;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import org.joml.Vector3d;

/**
 * The track bed under a swept rail tile (SPEC §2.2): exactly the blocks the
 * drawn model touches — however little, as long as it shows — and no others.
 * The tile is laid along the path the way the renderer lays it
 * ({@link TrackSweep}: same tile count, same station frames, same overhang
 * at open ends), every bent triangle is projected onto the ground and clipped
 * against the block grid, and a block column is under the track once a
 * clipped piece in it is at least {@link #MIN_TOUCH} thick. So the bed
 * follows the discrete sleepers on curves and diagonals: a column the outer
 * edge of the track only passes between two sleeper ends stays empty, one a
 * sleeper corner pokes into is laid.
 *
 * <p>Height per column follows the rail's foot (the spline height at the
 * touching parts): {@code round((y − blockBase)·8)} layers of 2px, clamped
 * to 1–8 — a thin frame on flat ground, stepping up on slopes; a column the
 * foot climbs through gets a full block below and the remainder above.
 *
 * <p>Pure math, no MC imports (SPEC principle #4); placement-time only.
 */
public final class BedRaster {

    /** A bed block. */
    public record Cell(int x, int y, int z) {
    }

    /**
     * The block columns a caller cares about: tiles that reach none of them
     * are skipped, so a question about a few blocks rasterizes a few tiles,
     * not the whole segment. Only the cells in those columns are then
     * guaranteed complete.
     */
    @FunctionalInterface
    public interface Area {

        /** Whether a wanted column lies in {@code [minX, maxX] × [minZ, maxZ]} (inclusive). */
        boolean any(int minX, int minZ, int maxX, int maxZ);

        /** The columns {@code [minX, maxX] × [minZ, maxZ]} (inclusive). */
        static Area box(int minX, int minZ, int maxX, int maxZ) {
            return (x0, z0, x1, z1) -> x0 <= maxX && minX <= x1 && z0 <= maxZ && minZ <= z1;
        }

        /** The columns in a set of {@link BedRaster#column} keys. */
        static Area columns(Set<Long> columns) {
            return (x0, z0, x1, z1) -> {
                for (int x = x0; x <= x1; x++) {
                    for (int z = z0; z <= z1; z++) {
                        if (columns.contains(column(x, z))) {
                            return true;
                        }
                    }
                }
                return false;
            };
        }
    }

    /**
     * How much of the model a block column must hold to be under the track:
     * a piece of a drawn face at least this thick, thickness being
     * {@code 2·area / perimeter} of the piece inside the column — its width
     * for a sliver along a border, a third of the legs for a corner poke
     * (blocks; 1/256 = 1/16 px). Anything that shows counts; thinner is a
     * hairline graze or float noise at a block border — the rail end of an
     * axis-aligned open end lies exactly on one.
     */
    public static final double MIN_TOUCH = 1.0 / 256.0;

    /** Half-width of the bed strip versions before 2026-10-09 laid ({@link #legacyStrip}). */
    public static final double LEGACY_HALF_WIDTH = 1.49;

    /** Below this a triangle or a clipped piece is a line seen edge-on, not an area (blocks²). */
    private static final double MIN_AREA = 1.0e-9;

    /** Rounding slack when a height is floored to its block (flat track sits on whole y). */
    private static final double LEVEL_EPSILON = 1.0e-7;

    /** A triangle clipped by four half-planes has at most 7 corners. */
    private static final int MAX_CLIPPED = 8;

    private BedRaster() {
    }

    /** The bed cells of {@code tile} swept along {@code path}, with their layer counts. */
    public static Map<Cell, Integer> cells(TrackPath path, TileFootprint tile) {
        return cells(path, tile, null);
    }

    /**
     * Like {@link #cells(TrackPath, TileFootprint)}, but only the tiles that
     * reach into {@code area} (null: everywhere) are rasterized — the cells in
     * its columns are complete, others may be missing.
     */
    public static Map<Cell, Integer> cells(TrackPath path, TileFootprint tile, Area area) {
        Map<Long, Touch> touched = new LinkedHashMap<>();
        double length = path.length();
        if (length >= 1.0e-6 && tile.triangleCount > 0) {
            int count = TrackSweep.tileCount(length, tile.tileLength);
            double tileLen = length / count;
            // every part of a tile lies this close to the path point at its centre: its
            // stations are at most extent·(stretch) along the path away (a little more in
            // a straight line where the arc-length table's chords cut a bend), the parts
            // at most reach off it
            double radius = tile.reach + 1.05 * tile.extent * tileLen / tile.tileLength + 0.01;
            int stations = tile.stations.length;
            double[] frame = new double[stations * TrackSweep.FRAME_STRIDE];
            Scratch scratch = new Scratch();
            for (int i = 0; i < count; i++) {
                if (area != null) {
                    Vector3d centre = path.samplePosition((i + 0.5) * tileLen);
                    if (!area.any((int) Math.floor(centre.x - radius), (int) Math.floor(centre.z - radius),
                            (int) Math.floor(centre.x + radius), (int) Math.floor(centre.z + radius))) {
                        continue;
                    }
                }
                for (int k = 0; k < stations; k++) {
                    TrackSweep.frame(path, (i + tile.stations[k]) * tileLen, frame,
                            k * TrackSweep.FRAME_STRIDE);
                }
                rasterizeTile(tile, frame, scratch, touched);
            }
        }
        return levels(touched);
    }

    /** A block column's key, as {@link Area#columns} takes them. */
    public static long column(int x, int z) {
        return ((long) x << 32) | (z & 0xFFFFFFFFL);
    }

    /**
     * The bed versions before 2026-10-09 laid: a strip ±{@link #LEGACY_HALF_WIDTH}
     * around the bare curve (no end overhang), sampled every 0.05 along it and
     * 13 times across, each sample's cell filled — wider than the rails
     * (empty gravel beside them on curves). Kept only to clean up: a re-laid
     * or demolished segment sweeps these cells too, so worlds built back then
     * don't keep orphaned bed blocks.
     */
    public static Set<Cell> legacyStrip(TrackPath curve) {
        Set<Cell> cells = new LinkedHashSet<>();
        double length = curve.length();
        for (double s = 0.0; s <= length; s += 0.05) {
            Vector3d pos = curve.samplePosition(s);
            Vector3d tangent = curve.sampleTangent(s);
            Vector3d fwd = new Vector3d(tangent.x, 0.0, tangent.z);
            if (fwd.lengthSquared() < 1.0e-6) {
                fwd.set(1, 0, 0);
            } else {
                fwd.normalize();
            }
            Vector3d right = new Vector3d(fwd.z, 0.0, -fwd.x);
            int cy = (int) Math.floor(pos.y);
            for (int i = -6; i <= 6; i++) {
                double a = LEGACY_HALF_WIDTH * i / 6;
                cells.add(new Cell((int) Math.floor(pos.x + right.x * a), cy,
                        (int) Math.floor(pos.z + right.z * a)));
            }
        }
        return cells;
    }

    /** What the model leaves in one block column: whether it shows there, and the foot heights. */
    private static final class Touch {
        boolean shown;
        double minY = Double.POSITIVE_INFINITY;
        double maxY = Double.NEGATIVE_INFINITY;
    }

    /** Per-tile work buffers: one bent triangle and the two clipping buffers (x, z, foot y). */
    private static final class Scratch {
        final double[] tx = new double[3];
        final double[] tz = new double[3];
        final double[] ty = new double[3];
        double[] ax = new double[MAX_CLIPPED];
        double[] az = new double[MAX_CLIPPED];
        double[] ay = new double[MAX_CLIPPED];
        double[] bx = new double[MAX_CLIPPED];
        double[] bz = new double[MAX_CLIPPED];
        double[] by = new double[MAX_CLIPPED];

        void swap() {
            double[] x = ax;
            double[] z = az;
            double[] y = ay;
            ax = bx;
            az = bz;
            ay = by;
            bx = x;
            bz = z;
            by = y;
        }
    }

    /**
     * Bend every triangle of one tile like the renderer does — a vertex at
     * local (along, height, across) lands at {@code pos + right·across +
     * up·(height + RAIL_Y_OFFSET)} of its station's frame — and rasterize its
     * ground projection. The foot height carried along is the spline height
     * at the vertex's station.
     */
    private static void rasterizeTile(TileFootprint tile, double[] frame, Scratch s,
            Map<Long, Touch> touched) {
        for (int t = 0; t < tile.triangleCount; t++) {
            for (int c = 0; c < 3; c++) {
                int v = t * 3 + c;
                int o = tile.station[v] * TrackSweep.FRAME_STRIDE;
                double across = tile.z[v];
                double height = tile.y[v] + TrackSweep.RAIL_Y_OFFSET;
                s.tx[c] = frame[o] + frame[o + 6] * across + frame[o + 9] * height;
                s.tz[c] = frame[o + 2] + frame[o + 8] * across + frame[o + 11] * height;
                s.ty[c] = frame[o + 1];
            }
            rasterizeTriangle(s, touched);
        }
    }

    /** Clip one projected triangle against every block column under its bounds. */
    private static void rasterizeTriangle(Scratch s, Map<Long, Touch> touched) {
        double[] x = s.tx;
        double[] z = s.tz;
        double doubleArea = (x[1] - x[0]) * (z[2] - z[0]) - (x[2] - x[0]) * (z[1] - z[0]);
        if (Math.abs(doubleArea) < 2.0 * MIN_AREA) {
            return; // a vertical face, seen edge-on from above
        }
        int fromX = (int) Math.floor(Math.min(x[0], Math.min(x[1], x[2])));
        int toX = (int) Math.floor(Math.max(x[0], Math.max(x[1], x[2])));
        int fromZ = (int) Math.floor(Math.min(z[0], Math.min(z[1], z[2])));
        int toZ = (int) Math.floor(Math.max(z[0], Math.max(z[1], z[2])));
        for (int cx = fromX; cx <= toX; cx++) {
            for (int cz = fromZ; cz <= toZ; cz++) {
                int n = clipToColumn(s, cx, cz);
                if (n < 3) {
                    continue;
                }
                double area = area(s.ax, s.az, n);
                if (area < MIN_AREA) {
                    continue;
                }
                Touch touch = touched.computeIfAbsent(column(cx, cz), k -> new Touch());
                touch.shown |= 2.0 * area / perimeter(s.ax, s.az, n) >= MIN_TOUCH;
                for (int i = 0; i < n; i++) {
                    touch.minY = Math.min(touch.minY, s.ay[i]);
                    touch.maxY = Math.max(touch.maxY, s.ay[i]);
                }
            }
        }
    }

    /**
     * Sutherland–Hodgman: the scratch triangle clipped to the column
     * {@code [cx, cx+1] × [cz, cz+1]}, foot height interpolated along the cut
     * edges. The result is left in {@code s.ax/az/ay}; returns its corner count.
     */
    private static int clipToColumn(Scratch s, int cx, int cz) {
        System.arraycopy(s.tx, 0, s.ax, 0, 3);
        System.arraycopy(s.tz, 0, s.az, 0, 3);
        System.arraycopy(s.ty, 0, s.ay, 0, 3);
        int n = 3;
        n = clip(s, n, true, cx, true);
        n = clip(s, n, true, cx + 1, false);
        n = clip(s, n, false, cz, true);
        return clip(s, n, false, cz + 1, false);
    }

    /**
     * One half-plane pass from {@code s.a*} into {@code s.b*}, then swapped
     * back so the result is in {@code s.a*}: keeps the side of {@code x = bound}
     * (or {@code z = bound}) where the coordinate is ≥ bound ({@code keepAbove})
     * or ≤ bound.
     */
    private static int clip(Scratch s, int n, boolean alongX, double bound, boolean keepAbove) {
        if (n == 0) {
            return 0;
        }
        int out = 0;
        for (int i = 0; i < n; i++) {
            int j = (i + 1) % n;
            double ci = alongX ? s.ax[i] : s.az[i];
            double cj = alongX ? s.ax[j] : s.az[j];
            boolean inI = keepAbove ? ci >= bound : ci <= bound;
            boolean inJ = keepAbove ? cj >= bound : cj <= bound;
            if (inI) {
                s.bx[out] = s.ax[i];
                s.bz[out] = s.az[i];
                s.by[out] = s.ay[i];
                out++;
            }
            if (inI != inJ) {
                double f = (bound - ci) / (cj - ci);
                s.bx[out] = s.ax[i] + (s.ax[j] - s.ax[i]) * f;
                s.bz[out] = s.az[i] + (s.az[j] - s.az[i]) * f;
                s.by[out] = s.ay[i] + (s.ay[j] - s.ay[i]) * f;
                out++;
            }
        }
        s.swap();
        return out;
    }

    /** Area of a simple polygon (shoelace). */
    private static double area(double[] x, double[] z, int n) {
        double sum = 0.0;
        for (int i = 0; i < n; i++) {
            int j = (i + 1) % n;
            sum += x[i] * z[j] - x[j] * z[i];
        }
        return Math.abs(sum) / 2.0;
    }

    private static double perimeter(double[] x, double[] z, int n) {
        double sum = 0.0;
        for (int i = 0; i < n; i++) {
            int j = (i + 1) % n;
            sum += Math.hypot(x[j] - x[i], z[j] - z[i]);
        }
        return sum;
    }

    /** Touched columns → bed cells: drop mere grazes ({@link #MIN_TOUCH}), stack the levels. */
    private static Map<Cell, Integer> levels(Map<Long, Touch> touched) {
        Map<Cell, Integer> cells = new LinkedHashMap<>();
        for (Map.Entry<Long, Touch> entry : touched.entrySet()) {
            Touch touch = entry.getValue();
            if (!touch.shown) {
                continue;
            }
            int x = (int) (entry.getKey() >> 32);
            int z = (int) entry.getKey().longValue();
            int bottom = (int) Math.floor(touch.minY + LEVEL_EPSILON);
            int top = (int) Math.floor(touch.maxY + LEVEL_EPSILON);
            for (int cy = bottom; cy <= top; cy++) {
                double surface = Math.min(touch.maxY, cy + 1.0);
                int layers = Math.clamp((int) Math.round((surface - cy) * 8.0), 1, 8);
                cells.merge(new Cell(x, cy, z), layers, Math::max);
            }
        }
        return cells;
    }
}
