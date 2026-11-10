package com.muzhik17.trainsmod.stock;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** The OBJ frame a pack's markup is written in and the engine's model frame (roadmap R6). */
class ObjFrameTest {

    private static final double EPS = 1.0e-12;

    /** The wheel tread onto the railhead: the lift the renderer has always used, to the last float bit. */
    @Test
    void theLift_isTheTreadOntoTheRailhead() {
        assertEquals(0.43625, ObjFrame.Y_LIFT, EPS);
        assertEquals(0.40625F - -0.03F, (float) ObjFrame.Y_LIFT);
    }

    /** x = z_obj, y = y_obj + lift, z = −x_obj: the OBJ's front (−X) is the model's +Z. */
    @Test
    void aPoint_turnsAQuarterAboutYAndLifts() {
        assertArrayEquals(new double[]{0.6, 1.9 + ObjFrame.Y_LIFT, 8.75}, ObjFrame.point(-8.75, 1.9, 0.6), EPS);
        assertArrayEquals(new double[]{-8.75, 1.9, 0.6},
                ObjFrame.toObj(0.6, 1.9 + ObjFrame.Y_LIFT, 8.75), EPS);
    }

    /** Along the car a box's corners trade places: the OBJ's greatest x is the model's least z. */
    @Test
    void aBox_keepsItsMinBelowItsMax() {
        // the platzkart's vestibule door (docs/pack-format.md, "Системы координат")
        double[] box = ObjFrame.box(new double[]{10.781, 1.37475, 0.344}, new double[]{10.844, 3.62475, 1.031});
        assertArrayEquals(new double[]{0.344, 1.811, -10.844, 1.031, 4.061, -10.781}, box, 1.0e-9);
    }

    /** Back and forth, a point is where it was. */
    @Test
    void toObj_undoesPoint() {
        double[][] points = {{0.0, 0.0, 0.0}, {-12.5, 2.3, 1.4}, {9.0, -0.43625, -1.7}};
        for (double[] p : points) {
            double[] model = ObjFrame.point(p[0], p[1], p[2]);
            assertArrayEquals(p, ObjFrame.toObj(model[0], model[1], model[2]), EPS);
        }
    }
}
