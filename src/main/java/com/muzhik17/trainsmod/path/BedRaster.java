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
 * <p>Above the bed the rails stand up to half a block over their foot; where
 * the foot climbs high in a column, the rail heads reach into the block above
 * the bed. Those blocks are the bed's {@linkplain Raster#headroom headroom}:
 * they must be clear for the rails not to cut through whatever is there
 * (SPEC §2.2). Parts of a style drawn below the foot (an embankment, a bridge
 * deck) are ground, not headroom.
 *
 * <p>Pure math, no MC imports (SPEC principle #4); placement-time only.
 */
public final class BedRaster {

    /** A bed block. */
    public record Cell(int x, int y, int z) {
    }

    /**
     * What a swept tile needs of the world: the bed cells with their layer
     * counts, and the headroom — the cells above the bed in the same columns
     * that the drawn rails reach into (none on level track: the rails stand
     * in the bed's own block).
     */
    public record Raster(Map<Cell, Integer> bed, Set<Cell> headroom) {
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
        return raster(path, tile, area).bed();
    }

    /**
     * The bed and its headroom ({@link Raster}) of {@code tile} swept along
     * {@code path}; {@code area} limits the work as in
     * {@link #cells(TrackPath, TileFootprint, Area)}.
     */
    public static Raster raster(TrackPath path, TileFootprint tile, Area area) {
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
        return new Raster(levels(touched), headroom(touched));
    }

    /** Step the gauge band is swept in along the path: a chord this short strays under 1/1000 block on track curves. */
    private static final double GAUGE_STEP = 0.25;

    /**
     * The loading gauge over the track (SPEC §2.2): the blocks a train running
     * along {@code path} may reach into. Its profile is a band
     * ±{@code halfWidth} across the track — horizontal, normal to the path,
     * so on curves it follows the track like the bed — extruded straight up
     * from {@code floor} to {@code height} over the rail foot. The band is
     * swept in short chords and clipped against the block grid like the
     * bed's tiles: a column is in once the band covers at least
     * {@link #MIN_TOUCH} of it, and a block once the gauge reaches into it by
     * more than that. Bed cells come out too where the gauge spans them —
     * the caller keeps the bed apart.
     *
     * @param floor  where the gauge starts over the foot: blocks the foot
     *               merely grazes from below stay (they'd leave pits beside the track)
     * @param height where it ends over the foot
     */
    public static Set<Cell> gauge(TrackPath path, double halfWidth, double floor, double height) {
        Map<Long, Touch> touched = new LinkedHashMap<>();
        double length = path.length();
        if (length >= 1.0e-6 && halfWidth > 0.0 && height > floor) {
            int steps = Math.max(1, (int) Math.ceil(length / GAUGE_STEP));
            double[] frame = new double[TrackSweep.FRAME_STRIDE];
            double[] previous = new double[5];
            double[] current = new double[5];
            Scratch s = new Scratch();
            for (int i = 0; i <= steps; i++) {
                TrackSweep.frame(path, length * i / steps, frame, 0);
                // left x, z; right x, z; foot y
                current[0] = frame[0] - frame[6] * halfWidth;
                current[1] = frame[2] - frame[8] * halfWidth;
                current[2] = frame[0] + frame[6] * halfWidth;
                current[3] = frame[2] + frame[8] * halfWidth;
                current[4] = frame[1];
                if (i > 0) {
                    bandTriangle(s, previous, 0, previous, 2, current, 2, floor, height, touched);
                    bandTriangle(s, previous, 0, current, 2, current, 0, floor, height, touched);
                }
                double[] swap = previous;
                previous = current;
                current = swap;
            }
        }
        Set<Cell> cells = new LinkedHashSet<>();
        for (Map.Entry<Long, Touch> entry : touched.entrySet()) {
            Touch touch = entry.getValue();
            if (!touch.shown) {
                continue;
            }
            int x = (int) (entry.getKey() >> 32);
            int z = (int) entry.getKey().longValue();
            for (int cy = (int) Math.floor(touch.minY + LEVEL_EPSILON); touch.topY > cy + MIN_TOUCH; cy++) {
                cells.add(new Cell(x, cy, z));
            }
        }
        return cells;
    }

    /**
     * One triangle of the gauge band, corners given as (x, z) at offsets of
     * band edge arrays whose foot height is element 4; the foot carried is the
     * gauge's floor, the model height its top.
     */
    private static void bandTriangle(Scratch s, double[] a, int ao, double[] b, int bo, double[] c, int co,
            double floor, double height, Map<Long, Touch> touched) {
        double[][] corners = {a, b, c};
        int[] offsets = {ao, bo, co};
        for (int k = 0; k < 3; k++) {
            s.tx[k] = corners[k][offsets[k]];
            s.tz[k] = corners[k][offsets[k] + 1];
            s.ty[k] = corners[k][4] + floor;
            s.tm[k] = corners[k][4] + height;
        }
        rasterizeTriangle(s, touched);
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

    /** What the model leaves in one block column: whether it shows there, the foot heights, the model's top. */
    private static final class Touch {
        boolean shown;
        double minY = Double.POSITIVE_INFINITY;
        double maxY = Double.NEGATIVE_INFINITY;
        double topY = Double.NEGATIVE_INFINITY;
    }

    /** Per-tile work buffers: one bent triangle and the two clipping buffers (x, z, foot y, model y). */
    private static final class Scratch {
        final double[] tx = new double[3];
        final double[] tz = new double[3];
        final double[] ty = new double[3];
        final double[] tm = new double[3];
        double[] ax = new double[MAX_CLIPPED];
        double[] az = new double[MAX_CLIPPED];
        double[] ay = new double[MAX_CLIPPED];
        double[] am = new double[MAX_CLIPPED];
        double[] bx = new double[MAX_CLIPPED];
        double[] bz = new double[MAX_CLIPPED];
        double[] by = new double[MAX_CLIPPED];
        double[] bm = new double[MAX_CLIPPED];

        void swap() {
            double[] x = ax;
            double[] z = az;
            double[] y = ay;
            double[] m = am;
            ax = bx;
            az = bz;
            ay = by;
            am = bm;
            bx = x;
            bz = z;
            by = y;
            bm = m;
        }
    }

    /**
     * Bend every triangle of one tile like the renderer does — a vertex at
     * local (along, height, across) lands at {@code pos + right·across +
     * up·(height + RAIL_Y_OFFSET)} of its station's frame — and rasterize its
     * ground projection. The foot height carried along is the spline height
     * at the vertex's station; the model height, the vertex's own.
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
                s.tm[c] = frame[o + 1] + frame[o + 7] * across + frame[o + 10] * height;
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
                    touch.topY = Math.max(touch.topY, s.am[i]);
                }
            }
        }
    }

    /**
     * Sutherland–Hodgman: the scratch triangle clipped to the column
     * {@code [cx, cx+1] × [cz, cz+1]}, foot and model heights interpolated
     * along the cut edges. The result is left in {@code s.ax/az/ay/am};
     * returns its corner count.
     */
    private static int clipToColumn(Scratch s, int cx, int cz) {
        System.arraycopy(s.tx, 0, s.ax, 0, 3);
        System.arraycopy(s.tz, 0, s.az, 0, 3);
        System.arraycopy(s.ty, 0, s.ay, 0, 3);
        System.arraycopy(s.tm, 0, s.am, 0, 3);
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
                s.bm[out] = s.am[i];
                out++;
            }
            if (inI != inJ) {
                double f = (bound - ci) / (cj - ci);
                s.bx[out] = s.ax[i] + (s.ax[j] - s.ax[i]) * f;
                s.bz[out] = s.az[i] + (s.az[j] - s.az[i]) * f;
                s.by[out] = s.ay[i] + (s.ay[j] - s.ay[i]) * f;
                s.bm[out] = s.am[i] + (s.am[j] - s.am[i]) * f;
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

    /**
     * Touched columns → headroom: in every bed column, the cells above its top
     * bed cell that the model reaches into by more than {@link #MIN_TOUCH}.
     */
    private static Set<Cell> headroom(Map<Long, Touch> touched) {
        Set<Cell> cells = new LinkedHashSet<>();
        for (Map.Entry<Long, Touch> entry : touched.entrySet()) {
            Touch touch = entry.getValue();
            if (!touch.shown) {
                continue;
            }
            int x = (int) (entry.getKey() >> 32);
            int z = (int) entry.getKey().longValue();
            int top = (int) Math.floor(touch.maxY + LEVEL_EPSILON);
            for (int cy = top + 1; touch.topY > cy + MIN_TOUCH; cy++) {
                cells.add(new Cell(x, cy, z));
            }
        }
        return cells;
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
