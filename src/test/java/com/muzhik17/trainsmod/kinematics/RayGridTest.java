package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * The nearest triangle a ray hits — what keeps a click from reaching through a
 * car's wall (SPEC §9.3, §9.5).
 */
class RayGridTest {

    private static final double EPS = 1.0e-6;

    /** A box's six faces, two triangles each. */
    private static float[] box(float x0, float y0, float z0, float x1, float y1, float z1) {
        List<float[]> quads = new ArrayList<>();
        quads.add(new float[]{x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0}); // z0
        quads.add(new float[]{x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1}); // z1
        quads.add(new float[]{x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1}); // x0
        quads.add(new float[]{x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1}); // x1
        quads.add(new float[]{x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1}); // y0
        quads.add(new float[]{x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1}); // y1
        float[] tris = new float[quads.size() * 18];
        int n = 0;
        for (float[] q : quads) {
            int[] order = {0, 1, 2, 0, 2, 3};
            for (int k : order) {
                tris[n++] = q[k * 3];
                tris[n++] = q[k * 3 + 1];
                tris[n++] = q[k * 3 + 2];
            }
        }
        return tris;
    }

    /** A car's shell: 3 wide, 4 tall, 20 long. */
    private static final RayGrid CAR = RayGrid.of(box(-1.5f, 0f, -10f, 1.5f, 4f, 10f), 0.25);

    @Test
    void fromOutside_theNearWall() {
        assertEquals(1.0, CAR.nearest(2.5, 2.0, 3.0, -1.0, 0.0, 0.0, 10.0), EPS);
    }

    @Test
    void fromInside_theWallAhead_alongTheCar() {
        assertEquals(7.0, CAR.nearest(0.0, 2.0, 3.0, 0.0, 0.0, 1.0, 20.0), EPS);
        assertEquals(13.0, CAR.nearest(0.0, 2.0, 3.0, 0.0, 0.0, -1.0, 20.0), EPS);
    }

    @Test
    void aslant_theFirstFaceItCrosses() {
        double s = Math.sqrt(0.5);
        // from the middle at 45° towards +X/+Z: the side wall 1.5 across, 1.5·√2 along the ray
        assertEquals(1.5 / s, CAR.nearest(0.0, 2.0, 0.0, s, 0.0, s, 20.0), EPS);
    }

    @Test
    void beyondReach_orAway_isNoHit() {
        assertEquals(-1.0, CAR.nearest(0.0, 2.0, 3.0, 0.0, 0.0, 1.0, 6.9), EPS);
        assertEquals(-1.0, CAR.nearest(5.0, 2.0, 3.0, 1.0, 0.0, 0.0, 10.0), EPS);
        assertEquals(-1.0, CAR.nearest(5.0, 2.0, 30.0, 0.0, 0.0, 1.0, 10.0), EPS);
    }

    @Test
    void noTriangles_noHit() {
        assertEquals(-1.0, RayGrid.of(new float[0], 0.25).nearest(0, 0, 0, 1, 0, 0, 10), EPS);
    }
}
