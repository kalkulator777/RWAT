package com.muzhik17.trainsmod.client.render;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.client.render.TileSweeper.Template;
import com.muzhik17.trainsmod.client.render.TileSweeper.Tile;
import com.muzhik17.trainsmod.path.HermiteSegment;
import com.muzhik17.trainsmod.path.HermiteSegmentPath;
import com.muzhik17.trainsmod.path.StraightLinePath;
import com.muzhik17.trainsmod.path.TrackPath;

/**
 * One region of drawn track: it is culled by the box of what it draws, so a
 * crossing's or a bridge's deck reaching far off the centre line is never
 * dropped at the screen's edge (audit M26); its static track and the switch
 * blades lying in it bake apart (audit M27), so a throw re-uploads the
 * blades and leaves the track's meshes alone.
 */
class RailRegionTest {

    /**
     * A one-block tile of boxes {x0, y0, z0, x1, y1, z1} in tile space (rails
     * along X), every face but the ends, as triangles.
     */
    static Template boxes(float[]... boxes) {
        List<float[]> corners = new ArrayList<>();
        for (float[] b : boxes) {
            float[][] c = new float[8][];
            for (int i = 0; i < 8; i++) {
                c[i] = new float[] {(i & 1) == 0 ? b[0] : b[3], (i & 2) == 0 ? b[1] : b[4],
                        (i & 4) == 0 ? b[2] : b[5]};
            }
            int[][] quads = {{0, 1, 3, 2}, {4, 5, 7, 6}, {0, 1, 5, 4}, {2, 3, 7, 6}};
            for (int[] q : quads) {
                for (int k : new int[] {q[0], q[1], q[2], q[2], q[3], q[0]}) {
                    corners.add(c[k]);
                }
            }
        }
        int n = corners.size();
        float[] position = new float[n * 3];
        float[] normal = new float[n * 3];
        float[] uv = new float[n * 2];
        float[] rgba = new float[n * 4];
        int[] shadeFrom = new int[n];
        for (int i = 0; i < n; i++) {
            System.arraycopy(corners.get(i), 0, position, i * 3, 3);
            normal[i * 3 + 1] = 1.0F;
            rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = rgba[i * 4 + 3] = 1.0F;
            shadeFrom[i] = i - i % 3;
        }
        return new Template("test", 1.0, position, normal, uv, rgba, shadeFrom);
    }

    /** The mod's own rail, roughly: a sleeper ±1.25 across and two rails on it. */
    static final Template RAIL = boxes(new float[] {-0.14F, 0.0F, -1.25F, 0.14F, 0.16F, 1.25F},
            new float[] {-0.5F, 0.16F, 0.72F, 0.5F, 0.40625F, 0.9F},
            new float[] {-0.5F, 0.16F, -0.9F, 0.5F, 0.40625F, -0.72F});

    static List<Tile> sweep(Template template, TrackPath path) {
        List<Tile> tiles = new ArrayList<>();
        TileSweeper.sweep(template, path, tiles);
        return tiles;
    }

    private static TrackPath straight(double x0, double z0, double x1, double z1) {
        return new StraightLinePath(new Vector3d(x0, 64.0, z0), new Vector3d(x1, 64.0, z1));
    }

    /** MVP's road crossing: a deck 0.44 high and ±4 across. */
    static final Template CROSSING = boxes(new float[] {-0.5F, 0.0F, -4.0F, 0.5F, 0.4375F, 4.0F});
    /** MVP's bridge: girders ±2.63 across reaching 1.5 down, rails on top. */
    static final Template BRIDGE = boxes(new float[] {-0.5F, -1.5F, -2.63F, 0.5F, 0.0F, 2.63F},
            new float[] {-0.5F, 0.0F, 0.72F, 0.5F, 0.40625F, 0.9F},
            new float[] {-0.5F, 0.0F, -0.9F, 0.5F, 0.40625F, -0.72F});

    /** A region holding the tiles of {@code template} along {@code path} that fall into the region of its start. */
    private static RailRegion region(Template template, TrackPath path, List<Tile> mine) {
        long key = RailRegion.key(path.samplePosition(0.0).x, path.samplePosition(0.0).z);
        for (Tile tile : sweep(template, path)) {
            if (tile.regionKey == key) {
                mine.add(tile);
            }
        }
        RailRegion region = new RailRegion(key);
        region.put(1, mine);
        return region;
    }

    private static void assertInside(RailRegion region, List<Tile> tiles) {
        double[] box = region.cullBox();
        assertFalse(tiles.isEmpty());
        for (Tile tile : tiles) {
            for (int i = 0; i < tile.template.vertexCount(); i++) {
                double x = tile.x(i);
                double y = tile.y(i);
                double z = tile.z(i);
                // the float a vertex is kept in may round it by a hair past the box
                double eps = 1.0e-4;
                assertTrue(x >= box[0] - eps && y >= box[1] - eps && z >= box[2] - eps
                        && x <= box[3] + eps && y <= box[4] + eps && z <= box[5] + eps,
                        String.format(Locale.ROOT, "vertex (%.3f, %.3f, %.3f) outside the cull box"
                                + " [%.3f, %.3f, %.3f]..[%.3f, %.3f, %.3f]", x, y, z,
                                box[0], box[1], box[2], box[3], box[4], box[5]));
            }
        }
    }

    /** Audit M26: a crossing's deck reaches 4 blocks off its centre line — 2 past the old margin. */
    @Test
    void aCrossingsDeckIsInsideItsRegionsCullBox() {
        List<Tile> tiles = new ArrayList<>();
        RailRegion region = region(CROSSING, straight(10.5, 3.5, 10.5, 60.5), tiles);
        assertInside(region, tiles);
    }

    /** A bridge's girders on a curve: 2.63 across, 1.5 down, swung out by the bend. */
    @Test
    void aBridgeOnACurveIsInsideItsRegionsCullBox() {
        List<Tile> tiles = new ArrayList<>();
        TrackPath curve = new HermiteSegmentPath(new HermiteSegment(new Vector3d(2.5, 70.0, 2.5),
                new Vector3d(31.0, 0, 0), new Vector3d(22.5, 72.0, 22.5), new Vector3d(0, 0, 31.0)));
        RailRegion region = region(BRIDGE, curve, tiles);
        assertInside(region, tiles);
    }

    /** The box is what the tiles draw, not a margin around their centres: no larger than the sleepers. */
    @Test
    void aPlainTracksCullBoxIsItsSleepers() {
        List<Tile> tiles = new ArrayList<>();
        RailRegion region = region(RAIL, straight(10.5, 3.5, 10.5, 60.5), tiles);
        double[] box = region.cullBox();
        assertEquals(10.5 - 1.25, box[0], 1.0e-6);
        assertEquals(10.5 + 1.25, box[3], 1.0e-6);
        assertEquals(64.0, box[1], 1.0e-6);
        assertEquals(64.0 + 0.40625, box[4], 1.0e-6);
        assertEquals(3.5, box[2], 1.0e-6);
        assertEquals(60.5, box[5], 1.0e-6);
    }

    @Test
    void aThrowReplacesTheBladesAndLeavesTheTrackClean() {
        RailRegion region = new RailRegion(RailRegion.key(0.0, 0.0));
        region.put(1, sweep(RAIL, straight(2.5, 10.5, 30.5, 10.5)));
        int trackVertices = region.vertexCount;
        region.putBlades(7, sweep(RAIL, straight(10.5, 11.5, 14.5, 11.5)));
        region.dirty = false; // both baked
        region.bladesDirty = false;

        region.putBlades(7, sweep(RAIL, straight(10.5, 11.6, 14.5, 11.6))); // the next frame of the throw
        assertTrue(region.bladesDirty);
        assertFalse(region.dirty, "the static track's meshes stay as they are");
        assertEquals(trackVertices, region.vertexCount, "the bake budget counts the static track only");
        assertEquals(4, region.bladeTiles().size());
        assertEquals(28, region.tiles().size());
    }

    @Test
    void aRegionWithBladesOnlyIsNotEmpty() {
        RailRegion region = new RailRegion(RailRegion.key(0.0, 0.0));
        region.putBlades(3, sweep(RAIL, straight(60.5, 5.5, 63.5, 5.5)));
        assertFalse(region.isEmpty());
        assertTrue(region.hasBlades());
        assertTrue(region.minX > 60.0 && region.maxX < 64.0, "its bounds take the blades in");

        region.removeBlades(3);
        assertTrue(region.isEmpty());
        assertFalse(region.hasBlades());
    }
}
