package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

class BedRasterTest {

    private static final Vector3d X = new Vector3d(1, 0, 0);
    private static final Vector3d Z = new Vector3d(0, 0, 1);

    /** The mod's own rail tile, read from the jar's OBJ like the server does. */
    static TileFootprint standardTile() throws IOException {
        try (InputStream in = BedRasterTest.class.getResourceAsStream(
                "/assets/railswheelsandtrains/rail/standard.obj")) {
            assertNotNull(in, "standard rail OBJ on the classpath");
            return TileFootprint.fromObj(in, 1.0);
        }
    }

    /** A wider sleeper (MVP's ±1.3125) as boxes, to check the bed follows the tile, not a constant. */
    private static TileFootprint wideTile() {
        return TileFootprint.ofBoxes(1.0,
                new float[] {-0.156F, 0.0F, -1.3125F, 0.156F, 0.22F, 1.3125F},
                new float[] {-0.5F, 0.156F, 0.7187F, 0.5F, 0.406F, 0.9062F},
                new float[] {-0.5F, 0.156F, -0.9062F, 0.5F, 0.406F, -0.7187F});
    }

    private static RailSegment connect(RailGraph graph, Vector3d a, Vector3d dirA, Vector3d b, Vector3d dirB) {
        return graph.createSegment(a, dirA, b, dirB);
    }

    private static Set<BedRaster.Cell> straightRun(int fromX, int toX, int y) {
        Set<BedRaster.Cell> cells = new HashSet<>();
        for (int x = fromX; x <= toX; x++) {
            for (int z = -1; z <= 1; z++) {
                cells.add(new BedRaster.Cell(x, y, z));
            }
        }
        return cells;
    }

    @Test
    void axisAlignedStraightLaysThreeBlocksFromNodeToNode() throws IOException {
        RailGraph graph = new RailGraph();
        RailSegment segment = connect(graph, new Vector3d(0.5, 64, 0.5), X, new Vector3d(10.5, 64, 0.5), X);

        Map<BedRaster.Cell, Integer> bed = BedRaster.cells(TrackSweep.path(graph, segment), standardTile());

        // the open ends carry the rails to the node cells' outer edges, not a hair beyond
        assertEquals(straightRun(0, 10, 64), bed.keySet());
        assertTrue(bed.values().stream().allMatch(layers -> layers == 1), "a 2px frame on flat ground");
    }

    @Test
    void jointSharesTheNodeBlockAndGoesNoFurther() throws IOException {
        RailGraph graph = new RailGraph();
        RailSegment first = connect(graph, new Vector3d(0.5, 64, 0.5), X, new Vector3d(10.5, 64, 0.5), X);
        RailSegment second = connect(graph, new Vector3d(10.5, 64, 0.5), X, new Vector3d(20.5, 64, 0.5), X);
        TileFootprint tile = standardTile();

        Set<BedRaster.Cell> firstBed = BedRaster.cells(TrackSweep.path(graph, first), tile).keySet();
        Set<BedRaster.Cell> secondBed = BedRaster.cells(TrackSweep.path(graph, second), tile).keySet();

        assertEquals(straightRun(0, 10, 64), firstBed, "the rails end at the joint node's centre");
        assertEquals(straightRun(10, 20, 64), secondBed);
    }

    @Test
    void curvesLayExactlyTheBlocksTheBentTileTouches() throws IOException {
        TileFootprint standard = standardTile();
        RailGraph graph = new RailGraph();
        List<RailSegment> curves = List.of(
                // quarter turn
                connect(graph, new Vector3d(0.5, 64, 0.5), X, new Vector3d(12.5, 64, 12.5), Z),
                // diagonal straight
                connect(graph, new Vector3d(40.5, 64, 0.5), new Vector3d(1, 0, 1),
                        new Vector3d(52.5, 64, 12.5), new Vector3d(1, 0, 1)),
                // S-bend
                connect(graph, new Vector3d(80.5, 64, 0.5), X, new Vector3d(100.5, 64, 7.5), X),
                // tight odd-angle bend
                connect(graph, new Vector3d(120.5, 64, 0.5), new Vector3d(1, 0, 0.3),
                        new Vector3d(126.5, 64, 9.5), new Vector3d(-0.2, 0, 1)));
        for (TileFootprint tile : List.of(standard, wideTile())) {
            for (RailSegment curve : curves) {
                TrackPath path = TrackSweep.path(graph, curve);
                Map<BedRaster.Cell, Integer> bed = BedRaster.cells(path, tile);
                List<double[]> triangles = bentTriangles(path, tile);
                Set<Long> columns = new HashSet<>();
                for (BedRaster.Cell cell : bed.keySet()) {
                    assertEquals(64, cell.y(), "flat track stays on its level");
                    columns.add(column(cell.x(), cell.z()));
                }
                assertTrue(bed.values().stream().allMatch(layers -> layers == 1));

                // nothing drawn hangs over a block without bed
                for (double[] tri : triangles) {
                    for (double[] p : interiorPoints(tri)) {
                        int cx = (int) Math.floor(p[0]);
                        int cz = (int) Math.floor(p[1]);
                        double border = Math.min(Math.min(p[0] - cx, cx + 1 - p[0]),
                                Math.min(p[1] - cz, cz + 1 - p[1]));
                        if (border > 0.02) {
                            assertTrue(columns.contains(column(cx, cz)),
                                    "model over block " + cx + "," + cz + " without bed (segment " + curve.id() + ")");
                        }
                    }
                }
                // and no bed block lies where nothing is drawn
                double inset = BedRaster.MIN_TOUCH / 4.0;
                for (BedRaster.Cell cell : bed.keySet()) {
                    boolean drawn = false;
                    for (double[] tri : triangles) {
                        if (overlaps(tri, cell.x() + inset, cell.z() + inset,
                                cell.x() + 1 - inset, cell.z() + 1 - inset)) {
                            drawn = true;
                            break;
                        }
                    }
                    assertTrue(drawn, "empty bed block " + cell + " (segment " + curve.id() + ")");
                }
            }
        }
    }

    @Test
    void widerSleepersWidenTheBed() throws IOException {
        RailGraph graph = new RailGraph();
        List<RailSegment> curves = List.of(
                connect(graph, new Vector3d(0.5, 64, 0.5), X, new Vector3d(12.5, 64, 12.5), Z),
                connect(graph, new Vector3d(40.5, 64, 0.5), X, new Vector3d(60.5, 64, 7.5), X),
                connect(graph, new Vector3d(80.5, 64, 0.5), new Vector3d(1, 0, 0.3),
                        new Vector3d(86.5, 64, 9.5), new Vector3d(-0.2, 0, 1)));
        TileFootprint standardTile = standardTile();
        int standardCount = 0;
        int wideCount = 0;
        for (RailSegment curve : curves) {
            TrackPath path = TrackSweep.path(graph, curve);
            Set<BedRaster.Cell> standard = BedRaster.cells(path, standardTile).keySet();
            Set<BedRaster.Cell> wide = BedRaster.cells(path, wideTile()).keySet();
            assertTrue(wide.containsAll(standard));
            standardCount += standard.size();
            wideCount += wide.size();
        }
        assertTrue(wideCount > standardCount, "the longer sleepers reach further blocks");
    }

    @Test
    void slopeClimbsLayerByLayer() throws IOException {
        RailGraph graph = new RailGraph();
        Vector3d chord = new Vector3d(16, 2, 0);
        RailSegment ramp = connect(graph, new Vector3d(0.5, 64, 0.5), chord, new Vector3d(16.5, 66, 0.5), chord);

        Map<BedRaster.Cell, Integer> bed = BedRaster.cells(TrackSweep.path(graph, ramp), standardTile());

        Map<Integer, Double> surface = new HashMap<>(); // centre line: x → bed top
        for (Map.Entry<BedRaster.Cell, Integer> cell : bed.entrySet()) {
            BedRaster.Cell c = cell.getKey();
            // the open-end overhang runs on down the slope, its foot dipping below the node, and
            // the tilted rail head leans back over the block border there (~0.05)
            assertTrue(c.y() >= 64 || c.y() == 63 && c.x() <= 0, "bed within the ramp's levels: " + c);
            assertTrue(c.x() >= -1 && c.x() <= 16, "bed within the ramp's run: " + c);
            assertTrue(c.y() <= 66, "bed within the ramp's levels: " + c);
            if (c.z() == 0) {
                surface.merge(c.x(), c.y() + cell.getValue() / 8.0, Math::max);
            }
        }
        double previous = Double.NEGATIVE_INFINITY;
        for (int x = 0; x <= 16; x++) {
            Double top = surface.get(x);
            assertNotNull(top, "centre line block " + x);
            assertTrue(top >= previous, "the bed top never steps down going up the ramp");
            // the bed top sits at the rail foot, within one 2px layer
            double foot = 64 + x / 8.0; // at the block's centre
            assertEquals(foot, top, 0.2, "bed top at the foot of the rail, block " + x);
            previous = top;
        }
    }

    @Test
    void levelTrackNeedsNoHeadroom() throws IOException {
        RailGraph graph = new RailGraph();
        RailSegment segment = connect(graph, new Vector3d(0.5, 64, 0.5), X, new Vector3d(12.5, 64, 12.5), Z);
        // an embankment tile reaching a block below the foot: ground, not headroom
        TileFootprint embankment = TileFootprint.ofBoxes(1.625,
                new float[] {-0.81F, -1.0F, -2.44F, 0.81F, 0.344F, 2.44F},
                new float[] {-0.81F, 0.156F, 0.72F, 0.81F, 0.406F, 0.91F});
        for (TileFootprint tile : new TileFootprint[] {standardTile(), embankment}) {
            BedRaster.Raster raster = BedRaster.raster(TrackSweep.path(graph, segment), tile, null);
            assertFalse(raster.bed().isEmpty());
            assertTrue(raster.headroom().isEmpty(), "the rails stand in the bed's own blocks");
        }
    }

    @Test
    void onASlopeTheRailHeadsReachIntoTheBlockAboveTheBed() throws IOException {
        RailGraph graph = new RailGraph();
        Vector3d chord = new Vector3d(16, 2, 0);
        RailSegment ramp = connect(graph, new Vector3d(0.5, 64, 0.5), chord, new Vector3d(16.5, 66, 0.5), chord);

        BedRaster.Raster raster = BedRaster.raster(TrackSweep.path(graph, ramp), standardTile(), null);

        Map<Long, Integer> topBed = new HashMap<>();
        raster.bed().keySet().forEach(c -> topBed.merge(BedRaster.column(c.x(), c.z()), c.y(), Math::max));
        for (BedRaster.Cell c : raster.headroom()) {
            assertEquals(topBed.get(BedRaster.column(c.x(), c.z())) + 1, c.y(),
                    "headroom sits right on the bed's top block: " + c);
        }
        // the foot climbs 1/8 per block from 64 at x = 0.5; the rail heads stand 0.41 over it,
        // the sleepers 0.16: in block 5 the foot reaches 64.69 — the heads poke into y 65
        assertTrue(raster.headroom().contains(new BedRaster.Cell(5, 65, 1)), "left rail head");
        assertTrue(raster.headroom().contains(new BedRaster.Cell(5, 65, -1)), "right rail head");
        assertFalse(raster.headroom().contains(new BedRaster.Cell(5, 65, 0)), "the sleeper stays below");
        assertTrue(raster.headroom().contains(new BedRaster.Cell(7, 65, 0)), "higher up the sleeper too");
        assertFalse(raster.headroom().contains(new BedRaster.Cell(4, 65, 1)), "lower down the heads stay in");
        assertFalse(raster.headroom().contains(new BedRaster.Cell(8, 66, 1)),
                "where the bed itself steps up into y 65, the heads stay in it");
    }

    @Test
    void areaLimitedRasterIsExactInsideTheArea() throws IOException {
        RailGraph graph = new RailGraph();
        RailSegment curve = connect(graph, new Vector3d(0.5, 64, 0.5), X, new Vector3d(12.5, 64, 12.5), Z);
        TrackPath path = TrackSweep.path(graph, curve);
        TileFootprint tile = standardTile();
        BedRaster.Area area = BedRaster.Area.box(6, 1, 9, 4);

        Map<BedRaster.Cell, Integer> full = BedRaster.cells(path, tile);
        Map<BedRaster.Cell, Integer> limited = BedRaster.cells(path, tile, area);

        int inside = 0;
        for (Map.Entry<BedRaster.Cell, Integer> cell : full.entrySet()) {
            BedRaster.Cell c = cell.getKey();
            if (c.x() >= 6 && c.x() < 10 && c.z() >= 1 && c.z() < 5) {
                assertEquals(cell.getValue(), limited.get(c), "block " + c);
                inside++;
            }
        }
        assertTrue(inside > 0);
        assertTrue(limited.size() < full.size(), "far tiles skipped");

        Set<Long> picked = new HashSet<>();
        for (BedRaster.Cell cell : full.keySet()) {
            if ((cell.x() + cell.z()) % 5 == 0) {
                picked.add(BedRaster.column(cell.x(), cell.z()));
            }
        }
        Map<BedRaster.Cell, Integer> sparse = BedRaster.cells(path, tile, BedRaster.Area.columns(picked));
        for (Map.Entry<BedRaster.Cell, Integer> cell : full.entrySet()) {
            BedRaster.Cell c = cell.getKey();
            if (picked.contains(BedRaster.column(c.x(), c.z()))) {
                assertEquals(cell.getValue(), sparse.get(c), "block " + c);
            }
        }
    }

    @Test
    void legacyStripIsTheOldThreeWideRun() {
        RailGraph graph = new RailGraph();
        RailSegment segment = connect(graph, new Vector3d(0.5, 64, 0.5), X, new Vector3d(10.5, 64, 0.5), X);

        Set<BedRaster.Cell> legacy = BedRaster.legacyStrip(new HermiteSegmentPath(graph.hermite(segment)));

        assertEquals(straightRun(0, 10, 64), legacy);
    }

    @Test
    void zeroLengthPathLaysNothing() throws IOException {
        TrackPath point = new HermiteSegmentPath(HermiteSegment.straight(
                new Vector3d(0.5, 64, 0.5), new Vector3d(0.5, 64, 0.5)));
        assertFalse(BedRaster.cells(point, standardTile()).size() > 0);
    }

    // --- an independent look at the bent tile ---

    private static long column(int x, int z) {
        return ((long) x << 32) | (z & 0xFFFFFFFFL);
    }

    /** The tile's triangles bent along the path as the renderer bends them: {x0, z0, x1, z1, x2, z2}. */
    private static List<double[]> bentTriangles(TrackPath path, TileFootprint tile) {
        List<double[]> out = new ArrayList<>();
        int count = TrackSweep.tileCount(path.length(), tile.tileLength());
        double tileLen = path.length() / count;
        double[] frame = new double[TrackSweep.FRAME_STRIDE];
        for (int i = 0; i < count; i++) {
            for (int t = 0; t < tile.triangleCount(); t++) {
                double[] tri = new double[6];
                for (int c = 0; c < 3; c++) {
                    int v = t * 3 + c;
                    TrackSweep.frame(path, (i + tile.stations[tile.station[v]]) * tileLen, frame, 0);
                    double across = tile.z[v];
                    double height = tile.y[v] + TrackSweep.RAIL_Y_OFFSET;
                    tri[c * 2] = frame[0] + frame[6] * across + frame[9] * height;
                    tri[c * 2 + 1] = frame[2] + frame[8] * across + frame[11] * height;
                }
                double doubleArea = (tri[2] - tri[0]) * (tri[5] - tri[1]) - (tri[4] - tri[0]) * (tri[3] - tri[1]);
                if (Math.abs(doubleArea) > 1.0e-9) {
                    out.add(tri); // faces seen edge-on cover nothing
                }
            }
        }
        return out;
    }

    /** A barycentric grid of points strictly inside the triangle. */
    private static List<double[]> interiorPoints(double[] tri) {
        List<double[]> points = new ArrayList<>();
        int n = 16;
        for (int i = 0; i < n; i++) {
            for (int j = 0; i + j < n; j++) {
                double a = (i + 0.3) / (n + 0.9);
                double b = (j + 0.3) / (n + 0.9);
                double c = 1.0 - a - b;
                if (c <= 0.0) {
                    continue;
                }
                points.add(new double[] {
                        a * tri[0] + b * tri[2] + c * tri[4],
                        a * tri[1] + b * tri[3] + c * tri[5]});
            }
        }
        return points;
    }

    /** Separating-axis test: does the triangle overlap the open box (touching is not overlapping)? */
    private static boolean overlaps(double[] tri, double minX, double minZ, double maxX, double maxZ) {
        double triMinX = Math.min(tri[0], Math.min(tri[2], tri[4]));
        double triMaxX = Math.max(tri[0], Math.max(tri[2], tri[4]));
        double triMinZ = Math.min(tri[1], Math.min(tri[3], tri[5]));
        double triMaxZ = Math.max(tri[1], Math.max(tri[3], tri[5]));
        if (triMaxX <= minX || triMinX >= maxX || triMaxZ <= minZ || triMinZ >= maxZ) {
            return false;
        }
        for (int e = 0; e < 3; e++) {
            int f = (e + 1) % 3;
            double nx = tri[f * 2 + 1] - tri[e * 2 + 1];
            double nz = -(tri[f * 2] - tri[e * 2]);
            double t0 = nx * tri[0] + nz * tri[1];
            double t1 = nx * tri[2] + nz * tri[3];
            double t2 = nx * tri[4] + nz * tri[5];
            double b0 = nx * minX + nz * minZ;
            double b1 = nx * maxX + nz * minZ;
            double b2 = nx * maxX + nz * maxZ;
            double b3 = nx * minX + nz * maxZ;
            double tMin = Math.min(t0, Math.min(t1, t2));
            double tMax = Math.max(t0, Math.max(t1, t2));
            double bMin = Math.min(Math.min(b0, b1), Math.min(b2, b3));
            double bMax = Math.max(Math.max(b0, b1), Math.max(b2, b3));
            if (tMax <= bMin || bMax <= tMin) {
                return false;
            }
        }
        return true;
    }
}
