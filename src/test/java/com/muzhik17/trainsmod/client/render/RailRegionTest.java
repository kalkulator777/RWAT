package com.muzhik17.trainsmod.client.render;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.client.render.TileSweeper.Template;
import com.muzhik17.trainsmod.client.render.TileSweeper.Tile;
import com.muzhik17.trainsmod.path.StraightLinePath;
import com.muzhik17.trainsmod.path.TrackPath;

/**
 * One region of drawn track: its static track and the switch blades lying
 * in it bake apart (audit M27), so a throw re-uploads the blades and leaves
 * the track's meshes alone.
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
