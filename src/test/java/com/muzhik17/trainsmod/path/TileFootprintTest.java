package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import org.junit.jupiter.api.Test;

class TileFootprintTest {

    private static InputStream obj(String text) {
        return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));
    }

    private static double[] sortedStations(TileFootprint tile) {
        double[] stations = tile.stations.clone();
        Arrays.sort(stations);
        return stations;
    }

    @Test
    void standardRailTile() throws IOException {
        TileFootprint tile = BedRasterTest.standardTile();

        assertEquals(1.0, tile.tileLength());
        assertTrue(tile.triangleCount() > 0);
        // rail ends and sleeper sides: x = −0.5, −0.14, 0.14, 0.5
        assertArrayEquals(new double[] {0.0, 0.36, 0.64, 1.0}, sortedStations(tile), 1.0e-6);
        assertEquals(Math.hypot(1.25, 0.16), tile.reach(), 1.0e-6, "sleeper top corner");
        assertEquals(0.5, tile.extent(), 1.0e-6);
    }

    @Test
    void railsAreStretchedToTheTileAndHiddenObjectsSkipped() throws IOException {
        TileFootprint tile = TileFootprint.fromObj(obj("""
                o RAIL_LEFT
                v -0.25 0.2 0.7
                v 0.25 0.2 0.7
                v 0.25 0.2 0.9
                v -0.25 0.2 0.9
                f 1 2 3 4
                o RAIL_BASE
                v -0.1 0 -1.2
                v 0.1 0 -1.2
                v 0.1 0 1.2
                v -0.1 0 1.2
                f 5/1/1 6/1/1 7/1/1 8/1/1
                o SIGN_HIDE
                v -3 0 -3
                v 3 0 -3
                v 3 0 3
                f 9 10 11
                """), 1.0);

        assertEquals(4, tile.triangleCount(), "two quads, the hidden triangle dropped");
        // rails ±0.25 → ±0.5 (fractions 0 and 1); the sleeper keeps ±0.1
        assertArrayEquals(new double[] {0.0, 0.4, 0.6, 1.0}, sortedStations(tile), 1.0e-6);
        assertEquals(1.2, tile.reach(), 1.0e-6);
        assertEquals(0.5, tile.extent(), 1.0e-6);
    }

    @Test
    void longerTileKeepsTheBaseSizeAndStretchesTheRails() throws IOException {
        TileFootprint tile = TileFootprint.fromObj(obj("""
                o RAIL_RIGHT
                v -0.5 0.2 -0.9
                v 0.5 0.2 -0.9
                v 0.5 0.2 -0.7
                f 1 2 3
                o RAIL_BASE_ballast
                v -0.8125 -1 -2.4
                v 0.8125 -1 -2.4
                v 0.8125 -1 2.4
                f 4 5 6
                """), 1.625);

        // rails stretched to ±0.8125, the ballast already spans it
        assertArrayEquals(new double[] {0.0, 1.0}, sortedStations(tile), 1.0e-6);
    }

    @Test
    void railStretchIsNullForTheIrNorm() {
        assertNull(TileFootprint.railStretch(new float[] {-0.5F, 0.5F}, 1.0));
        assertNull(TileFootprint.railStretch(null, 1.0));
        float[] stretch = TileFootprint.railStretch(new float[] {-0.25F, 0.25F}, 1.0);
        assertEquals(-0.5F, TileFootprint.stretchX(-0.25F, stretch), 1.0e-6F);
        assertEquals(0.5F, TileFootprint.stretchX(0.25F, stretch), 1.0e-6F);
    }

    @Test
    void objectRoles() {
        assertTrue(TileFootprint.isRailObject("RAIL_LEFT_mvpRail"));
        assertTrue(TileFootprint.isRailObject("rail_right"));
        assertFalse(TileFootprint.isRailObject("RAIL_BASE_mvpRail"));
        assertFalse(TileFootprint.isRailObject("SLEEPER"));
        assertTrue(TileFootprint.isHiddenObject("RAIL_LEFT_HIDE"));
    }

    @Test
    void faceWithAMissingVertexIsRejected() {
        assertThrows(IOException.class, () -> TileFootprint.fromObj(obj("""
                v 0 0 0
                v 1 0 0
                f 1 2 3
                """), 1.0));
    }
}
