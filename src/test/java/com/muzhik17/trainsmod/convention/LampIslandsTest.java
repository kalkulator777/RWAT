package com.muzhik17.trainsmod.convention;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.client.render.model.Mesh;

/**
 * Cabin lamps out of a glowing part ({@link LampIslands}): faces meeting at a
 * corner are one island, a big-enough island one lamp at its box's centre,
 * lamps in the order of their islands' first faces — and a corner is its
 * rounded position, not a hash of it.
 */
class LampIslandsTest {

    private static final float EPS = 1.0e-6F;

    /** A flat square face at height {@code y}, {@code size} wide, its low corner at (x, z). */
    private static float[] square(float x, float y, float z, float size) {
        return new float[]{x, y, z, x + size, y, z, x + size, y, z + size, x, y, z + size};
    }

    private static float[] faces(float[]... faces) {
        float[] corners = new float[faces.length * 12];
        for (int i = 0; i < faces.length; i++) {
            System.arraycopy(faces[i], 0, corners, i * 12, 12);
        }
        return corners;
    }

    @Test
    void facesSharingACornerAreOneLampAndApartTwo() {
        List<float[]> lamps = LampIslands.of(faces(
                square(0.0F, 2.0F, 0.0F, 0.2F), square(0.2F, 2.0F, 0.0F, 0.2F),   // touching: one 0.4 × 0.2
                square(5.0F, 2.0F, 0.0F, 0.4F)));
        assertEquals(2, lamps.size());
        assertArrayEquals(new float[]{0.2F, 2.0F, 0.1F}, lamps.get(0), EPS);
        assertArrayEquals(new float[]{5.2F, 2.0F, 0.2F}, lamps.get(1), EPS);
    }

    @Test
    void islandsUnderTheSizeAreNoLamps() {
        assertTrue(LampIslands.of(faces(square(0.0F, 0.0F, 0.0F, 0.2F))).isEmpty(), "a 0.28 diagonal");
        assertEquals(1, LampIslands.of(faces(square(0.0F, 0.0F, 0.0F, 0.22F))).size(), "a 0.31 diagonal");
    }

    @Test
    void cornersWithin1e4AreOne() {
        // the second face starts 0.00004 off the first one's corner: rounded to 1e-4, the same corner
        List<float[]> lamps = LampIslands.of(faces(square(0.0F, 0.0F, 0.0F, 0.2F),
                square(0.20004F, 0.0F, 0.0F, 0.2F)));
        assertEquals(1, lamps.size());
    }

    @Test
    void lampsComeInTheOrderOfTheirIslandsFirstFaces() {
        List<float[]> lamps = LampIslands.of(faces(
                square(9.0F, 0.0F, 0.0F, 0.4F), square(1.0F, 0.0F, 0.0F, 0.4F), square(5.0F, 0.0F, 0.0F, 0.4F),
                square(1.4F, 0.0F, 0.0F, 0.4F)));
        assertEquals(List.of(9.2F, 1.4F, 5.2F), lamps.stream().map(l -> l[0]).toList());
    }

    /**
     * Two far corners the former key hashed alike: their islands joined into
     * one 2.4 blocks wide, a lamp where there was none. The rounded position
     * itself as the key keeps them apart.
     */
    @Test
    void farCornersAreNeverOneWhateverTheirHash() {
        float[] a = {-1.9838F, 0.322F, -1.2204F};
        float[] b = {-1.5299F, -0.5132F, 0.8569F};
        assertEquals(ModelPartsLegacyTest.Legacy.hashKey(a[0], a[1], a[2]),
                ModelPartsLegacyTest.Legacy.hashKey(b[0], b[1], b[2]), "the old key takes them for one");
        float[] corners = faces(
                new float[]{a[0], a[1], a[2], a[0] + 0.01F, a[1], a[2], a[0], a[1], a[2] + 0.01F,
                    a[0], a[1], a[2] + 0.01F},
                new float[]{b[0], b[1], b[2], b[0] + 0.01F, b[1], b[2], b[0], b[1], b[2] + 0.01F,
                    b[0], b[1], b[2] + 0.01F});
        assertTrue(LampIslands.of(corners).isEmpty(), "two specks of light, no lamp");
        Mesh mesh = new Mesh();
        for (int f = 0; f < 2; f++) {
            Mesh.Vertex[] v = new Mesh.Vertex[4];
            for (int c = 0; c < 4; c++) {
                int at = f * 12 + c * 3;
                v[c] = new Mesh.Vertex(corners[at], corners[at + 1], corners[at + 2], 0, 0, 0, 1, 0);
            }
            mesh.add(new Mesh.Quad(v[0], v[1], v[2], v[3], 1, 1, 1, 1));
        }
        assertEquals(1, ModelPartsLegacyTest.Legacy.lampIslands(mesh, 0).size(), "the old islands made a lamp");
    }
}
