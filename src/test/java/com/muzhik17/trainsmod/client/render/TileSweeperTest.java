package com.muzhik17.trainsmod.client.render;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.client.render.TileSweeper.Tile;
import com.muzhik17.trainsmod.path.HermiteSegment;
import com.muzhik17.trainsmod.path.HermiteSegmentPath;
import com.muzhik17.trainsmod.path.TrackPath;

/**
 * Rail vertices far from the world's origin (audit M25): a float has a step
 * of 1/32 block at 300 000, so vertices stored as world floats were up to
 * 1.6 cm off and the rails shook against the terrain. Stored relative to
 * their region, they keep the precision they have near the origin.
 */
class TileSweeperTest {

    private static final double FAR = 300_000.0;

    /** A curve from {@code (x, y, z)}, a quarter turn of radius ~20. */
    private static TrackPath curve(double x, double y, double z) {
        return new HermiteSegmentPath(new HermiteSegment(new Vector3d(x, y, z), new Vector3d(31.0, 0, 0),
                new Vector3d(x + 20.0, y + 1.0, z + 20.0), new Vector3d(0, 0, 31.0)));
    }

    private static List<Tile> sweep(TrackPath path) {
        List<Tile> tiles = new ArrayList<>();
        TileSweeper.sweep(RailRegionTest.BRIDGE, path, tiles);
        return tiles;
    }

    @Test
    void verticesAt300000BlocksKeepTheirShape() {
        // the same curve near the origin and 300 000 blocks out along X and Z
        List<Tile> near = sweep(curve(5.37, 64.0, 7.81));
        List<Tile> far = sweep(curve(FAR + 5.37, 64.0, FAR + 7.81));
        assertEquals(near.size(), far.size());
        double worst = 0.0;
        for (int t = 0; t < near.size(); t++) {
            Tile a = near.get(t);
            Tile b = far.get(t);
            for (int i = 0; i < a.template.vertexCount(); i++) {
                worst = Math.max(worst, Math.abs(b.x(i) - FAR - a.x(i)));
                worst = Math.max(worst, Math.abs(b.y(i) - a.y(i)));
                worst = Math.max(worst, Math.abs(b.z(i) - FAR - a.z(i)));
            }
        }
        assertEquals(0.0, worst, 1.0e-4, "largest vertex shift between the near and the far curve, blocks");
    }

    @Test
    void theDrawOffsetCarriesTheRegionToTheCameraExactly() {
        List<Tile> tiles = sweep(curve(FAR + 5.37, 64.0, FAR + 7.81));
        // a camera a few blocks off, at a position no float can hold
        double camX = FAR + 9.123456;
        double camY = 66.5;
        double camZ = FAR + 11.654321;
        for (Tile tile : tiles) {
            RailRegion region = new RailRegion(tile.regionKey);
            float[] offset = region.drawOffset(camX, camY, camZ);
            for (int i = 0; i < tile.template.vertexCount(); i++) {
                // what the shader computes, in float: vertex + ChunkOffset
                float x = tile.xyz[i * 3] + offset[0];
                float y = tile.xyz[i * 3 + 1] + offset[1];
                float z = tile.xyz[i * 3 + 2] + offset[2];
                assertEquals(tile.x(i) - camX, x, 1.0e-4);
                assertEquals(tile.y(i) - camY, y, 1.0e-4);
                assertEquals(tile.z(i) - camZ, z, 1.0e-4);
            }
        }
    }

    @Test
    void regionsTileTheWorldOnBothSidesOfZero() {
        assertEquals(RailRegion.keyOf(0, 0), RailRegion.key(0.0, 63.99));
        assertEquals(RailRegion.keyOf(-1, 0), RailRegion.key(-0.01, 0.0));
        assertEquals(RailRegion.keyOf(4687, -4688), RailRegion.key(FAR, -FAR));
        RailRegion region = new RailRegion(RailRegion.key(-0.01, FAR));
        assertEquals(-64, region.originX());
        assertEquals(299_968, region.originZ());
    }
}
