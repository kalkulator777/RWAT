package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * The hover outline of a part (SPEC §9.3): its characteristic edges — a box
 * shows its twelve edges like a block, a round handle its rims and side
 * lines — never the triangulation.
 */
class EdgeOutlineTest {

    private static final double CREASE = 35.0;
    private static final double WELD = 1.0e-4;

    /** A box's six faces as quads, wound outward. */
    private static float[] box(float x0, float y0, float z0, float x1, float y1, float z1) {
        return new float[]{
            x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0, // −z
            x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, // +z
            x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, // −x
            x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1, // +x
            x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, // −y
            x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, // +y
        };
    }

    /** Each quad split into two triangles (degenerate quads, as the OBJ loader stores them). */
    private static float[] triangulated(float[] quads) {
        List<Float> out = new ArrayList<>();
        for (int q = 0; q < quads.length; q += 12) {
            int[][] tris = {{0, 1, 2, 2}, {0, 2, 3, 3}};
            for (int[] t : tris) {
                for (int k : t) {
                    out.add(quads[q + k * 3]);
                    out.add(quads[q + k * 3 + 1]);
                    out.add(quads[q + k * 3 + 2]);
                }
            }
        }
        float[] a = new float[out.size()];
        for (int i = 0; i < a.length; i++) {
            a[i] = out.get(i);
        }
        return a;
    }

    /** Each quad wound the other way. */
    private static float[] reversed(float[] quads, int everyNth) {
        float[] out = quads.clone();
        for (int q = 0, i = 0; q < quads.length; q += 12, i++) {
            if (i % everyNth != 0) {
                continue;
            }
            for (int k = 0; k < 4; k++) {
                System.arraycopy(quads, q + (3 - k) * 3, out, q + k * 3, 3);
            }
        }
        return out;
    }

    /** A capped cylinder along Y, {@code sides} facets, radius 1, height 4. */
    private static float[] cylinder(int sides) {
        List<float[]> quads = new ArrayList<>();
        for (int i = 0; i < sides; i++) {
            double a0 = 2.0 * Math.PI * i / sides;
            double a1 = 2.0 * Math.PI * (i + 1) / sides;
            float x0 = (float) Math.cos(a0);
            float z0 = (float) Math.sin(a0);
            float x1 = (float) Math.cos(a1);
            float z1 = (float) Math.sin(a1);
            quads.add(new float[]{x0, 0, z0, x0, 4, z0, x1, 4, z1, x1, 0, z1}); // side, outward
            quads.add(new float[]{0, 4, 0, x1, 4, z1, x0, 4, z0, x0, 4, z0}); // top fan, up
            quads.add(new float[]{0, 0, 0, x0, 0, z0, x1, 0, z1, x1, 0, z1}); // bottom fan, down
        }
        float[] out = new float[quads.size() * 12];
        for (int i = 0; i < quads.size(); i++) {
            System.arraycopy(quads.get(i), 0, out, i * 12, 12);
        }
        return out;
    }

    private static int drawn(EdgeOutline outline, double ex, double ey, double ez) {
        int[] n = {0};
        outline.forEach(ex, ey, ez, (x0, y0, z0, x1, y1, z1) -> n[0]++);
        return n[0];
    }

    @Test
    void box_isItsTwelveEdges_fromAnywhere() {
        EdgeOutline outline = EdgeOutline.of(box(0, 0, 0, 1, 2, 3), CREASE, WELD);
        assertEquals(12, outline.fixedCount());
        assertEquals(0, outline.smoothCount());
        assertEquals(12, drawn(outline, 5, 5, 5));
    }

    @Test
    void triangulatedBox_dropsTheDiagonals() {
        EdgeOutline outline = EdgeOutline.of(triangulated(box(0, 0, 0, 1, 2, 3)), CREASE, WELD);
        assertEquals(12, outline.fixedCount());
        assertEquals(6, outline.smoothCount()); // the face diagonals: flat, never on the silhouette
        assertEquals(12, drawn(outline, 5, 5, 5));
        assertEquals(12, drawn(outline, 0.5, -4, 1));
    }

    @Test
    void windingMixedUp_isReadOffTheSharedEdges() {
        EdgeOutline outline = EdgeOutline.of(reversed(triangulated(box(0, 0, 0, 1, 1, 1)), 3), CREASE, WELD);
        assertEquals(12, outline.fixedCount());
        assertEquals(12, drawn(outline, 3, -2, 0.5));
    }

    @Test
    void repeatedCorners_areWelded() {
        // the faces nudged apart by less than the weld: still one closed box
        float[] quads = box(0, 0, 0, 1, 1, 1);
        for (int i = 0; i < quads.length; i += 7) {
            quads[i] += 2.0e-5F;
        }
        assertEquals(12, EdgeOutline.of(quads, CREASE, WELD).fixedCount());
    }

    @Test
    void singleQuad_isItsBoundary() {
        float[] plate = {0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1};
        EdgeOutline outline = EdgeOutline.of(triangulated(plate), CREASE, WELD);
        assertEquals(4, outline.fixedCount());
        assertEquals(4, drawn(outline, 0.5, 3, 0.5));
    }

    @Test
    void roundHandle_showsRimsAndTwoSideLines() {
        EdgeOutline outline = EdgeOutline.of(cylinder(16), CREASE, WELD);
        // the rims (side against the caps) are creases, the cap spokes flat, the side edges smooth
        assertEquals(32, outline.fixedCount());
        // seen from the side, two of the side edges are on the silhouette (the
        // eye between two facets' planes: the edges either side of the limb)
        int fromSide = drawn(outline, 10.0, 2.0, 0.3);
        assertTrue(fromSide >= 32 + 2 && fromSide <= 32 + 4, "drawn " + fromSide);
        // from straight above, no side edge is on the silhouette
        assertEquals(32, drawn(outline, 0.0, 20.0, 0.0));
    }

    @Test
    void coarseHandle_isAllCreases() {
        // six facets part by 60°: each side edge is a crease, drawn from anywhere
        EdgeOutline outline = EdgeOutline.of(cylinder(6), CREASE, WELD);
        assertEquals(12 + 6, outline.fixedCount());
    }

    @Test
    void degenerateFaces_addNothing() {
        float[] sliver = {0, 0, 0, 1, 0, 0, 2, 0, 0, 2, 0, 0}; // three corners on a line
        assertEquals(0, EdgeOutline.of(sliver, CREASE, WELD).fixedCount());
    }
}
