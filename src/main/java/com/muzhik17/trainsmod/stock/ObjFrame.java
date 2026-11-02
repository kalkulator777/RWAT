package com.muzhik17.trainsmod.stock;

/**
 * The two frames a wagon's geometry is told in, and the one way between them
 * (roadmap R6; {@code docs/pack-format.md}, "Системы координат").
 *
 * <p><b>The OBJ frame</b> is the pack's: the model as Blender exports it, by
 * the IR convention. X runs along the car, the front towards −X; Y is up; Z
 * runs across, +Z the left side looking forward; the origin is the model's,
 * with the wheel tread bottoming out at y = {@link #TREAD_BOTTOM_Y}. From pack
 * format 1 a type's markup — floor zones, door boxes, driver's chairs — is
 * written in it, so the numbers read off in Blender go into the JSON as they
 * are.
 *
 * <p><b>The model frame</b> is the engine's: +Z forward, X across (+X the left
 * side), Y up; the origin is the body centre on the path spline (y = 0), the
 * railhead at y = {@link #RAILHEAD_Y}. The renderer draws the OBJ in it
 * ({@code IrStockModel}), riders walk it, {@link WagonType} holds it.
 *
 * <p>From the one to the other: {@code x = z_obj}, {@code y = y_obj + Y_LIFT},
 * {@code z = −x_obj} — a quarter turn about Y and a lift. A box keeps its min
 * and max on X and Y, while along the car they trade places: the OBJ's
 * greatest x is the model's least z. A quarter turn about Y keeps every yaw
 * (0 = forward, +90 = the right side) and every distance along the car
 * ({@code length}, {@code bogies}, {@code couplers}: + forward): only points
 * and boxes are translated. {@code tools/floorgen.py} ports this ({@code
 * Y_LIFT}, {@code point_from_obj}, {@code box_from_obj} and back). Pure.
 */
public final class ObjFrame {

    /** Railhead height above the path spline: {@code TrackSweep.RAIL_Y_OFFSET} (0) + the rail model's head 0.40625. */
    public static final double RAILHEAD_Y = 0.40625;
    /**
     * OBJ y where the wheel tread (the rolling circle, r = 0.53 around the
     * axle at y = 0.5) bottoms out. The meshes' lowest wheel point is the
     * flange tip at −0.0625; seating THAT on the railhead floated the whole
     * train by the flange height 0.0325 (second ChME3 play-test fix).
     */
    public static final double TREAD_BOTTOM_Y = -0.03;
    /** How far the model frame lifts the OBJ: the wheel tread onto the railhead, 0.43625. */
    public static final double Y_LIFT = RAILHEAD_Y - TREAD_BOTTOM_Y;

    private ObjFrame() {
    }

    /** A point of the OBJ frame in the model frame: {@code {x, y, z}}. */
    public static double[] point(double xObj, double yObj, double zObj) {
        return new double[]{zObj, yObj + Y_LIFT, -xObj};
    }

    /**
     * A box of the OBJ frame, given by its least and greatest corners
     * ({@code {x, y, z}} each), in the model frame:
     * {@code {minX, minY, minZ, maxX, maxY, maxZ}}. The OBJ's x range turns
     * round into the model's z range: {@code minZ = −max.x_obj}.
     */
    public static double[] box(double[] minObj, double[] maxObj) {
        return new double[]{minObj[2], minObj[1] + Y_LIFT, -maxObj[0],
                maxObj[2], maxObj[1] + Y_LIFT, -minObj[0]};
    }

    /** A point of the model frame in the OBJ frame, where the author finds it in Blender: {@code {x, y, z}}. */
    public static double[] toObj(double x, double y, double z) {
        return new double[]{-z, y - Y_LIFT, x};
    }
}
