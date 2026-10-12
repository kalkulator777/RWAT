package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.joml.Matrix3d;
import org.joml.Matrix4d;
import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/**
 * Coupler heads turn to meet (SPEC §6.12): a head aims its outward axis at
 * the point the two coupled cars' heads share, within its swing limit.
 */
class CouplerAimTest {

    private static final double EPS = 1.0e-9;

    /** The head's outward axis after the turn, model frame. */
    private static Vector3d axis(double[] angles, boolean front) {
        return new Matrix3d().rotateY(angles[0]).rotateX(angles[1])
                .transform(new Vector3d(0.0, 0.0, front ? 1.0 : -1.0));
    }

    @Test
    void straightAhead_noTurn() {
        double[] a = CouplerAim.angles(0.0, 1.0, 11.9, 0.0, 1.0, 12.5, true, CouplerAim.LIMIT_DEGREES);
        assertEquals(0.0, a[0], EPS);
        assertEquals(0.0, a[1], EPS);
    }

    @Test
    void front_turnsAtTheTarget() {
        // the meeting point 0.6 ahead and 0.1 to the left, a little lower
        double[] a = CouplerAim.angles(0.0, 1.0, 11.9, 0.1, 0.95, 12.5, true, CouplerAim.LIMIT_DEGREES);
        Vector3d wanted = new Vector3d(0.1, -0.05, 0.6).normalize();
        assertEquals(0.0, axis(a, true).distance(wanted), 1.0e-9);
    }

    @Test
    void rear_turnsAtTheTarget() {
        double[] a = CouplerAim.angles(0.0, 1.0, -11.9, -0.15, 1.04, -12.5, false, CouplerAim.LIMIT_DEGREES);
        Vector3d wanted = new Vector3d(-0.15, 0.04, -0.6).normalize();
        assertEquals(0.0, axis(a, false).distance(wanted), 1.0e-9);
    }

    @Test
    void swing_isLimited() {
        // 45° off the car's axis: held at the limit, still toward that side
        double[] a = CouplerAim.angles(0.0, 1.0, 11.9, 0.5, 1.0, 12.4, true, CouplerAim.LIMIT_DEGREES);
        assertEquals(Math.toRadians(CouplerAim.LIMIT_DEGREES), a[0], EPS);
        double[] b = CouplerAim.angles(0.0, 1.0, -11.9, 0.5, 1.0, -12.4, false, CouplerAim.LIMIT_DEGREES);
        assertEquals(-Math.toRadians(CouplerAim.LIMIT_DEGREES), b[0], EPS);
    }

    /**
     * Two cars coupled in a curve, the second turned {@code degrees} to the
     * first about their shared coupler point: the angle, degrees, between
     * the two heads' axes when each aims at the middle of the pivots (0: in
     * one line), and the first head's turn.
     */
    private static double[] coupledInACurve(float degrees) {
        double reach = 12.44;
        double pivotZ = 11.875;
        Matrix4d first = PoseMath.drawnBody(new Vector3d(), 0.0F, 0.0F, Sway.ZERO, false);
        Vector3d coupler = new Vector3d(0.0, 0.0, -reach);
        Vector3d back = new Matrix3d().rotateY(Math.toRadians(-degrees)).transform(new Vector3d(0.0, 0.0, reach));
        Matrix4d second = PoseMath.drawnBody(new Vector3d(coupler).sub(back), degrees, 0.0F, Sway.ZERO, false);
        Vector3d a = first.transformPosition(new Vector3d(0.0, 1.0, -pivotZ));
        Vector3d b = second.transformPosition(new Vector3d(0.0, 1.0, pivotZ));
        Vector3d meet = new Vector3d(a).add(b).mul(0.5);
        Vector3d inFirst = first.invertAffine(new Matrix4d()).transformPosition(new Vector3d(meet));
        Vector3d inSecond = second.invertAffine(new Matrix4d()).transformPosition(new Vector3d(meet));
        double[] rear = CouplerAim.angles(0.0, 1.0, -pivotZ, inFirst.x, inFirst.y, inFirst.z, false,
                CouplerAim.LIMIT_DEGREES);
        double[] front = CouplerAim.angles(0.0, 1.0, pivotZ, inSecond.x, inSecond.y, inSecond.z, true,
                CouplerAim.LIMIT_DEGREES);
        Vector3d rearAxis = first.transformDirection(axis(rear, false));
        Vector3d frontAxis = second.transformDirection(axis(front, true));
        return new double[]{Math.toDegrees(rearAxis.angle(frontAxis.negate())), Math.toDegrees(rear[0])};
    }

    @Test
    void coupledHeads_meetInOneLine_inACurve() {
        // platzkarts on a radius of 40: the cars stand 32° to each other
        double[] r = coupledInACurve(32.0F);
        assertEquals(0.0, r[0], 1.0e-6);
        assertEquals(16.0, Math.abs(r[1]), 1.0e-6); // each takes half of the cars' angle
    }

    @Test
    void coupledHeads_inASharpCurve_stopAtTheLimit() {
        double[] r = coupledInACurve(60.0F);
        assertEquals(CouplerAim.LIMIT_DEGREES, Math.abs(r[1]), 1.0e-6);
        assertEquals(60.0 - 2.0 * CouplerAim.LIMIT_DEGREES, r[0], 1.0e-6);
    }

    @Test
    void targetAtThePivot_noTurn() {
        double[] a = CouplerAim.angles(0.0, 1.0, 11.9, 0.0, 1.0, 11.9, true, CouplerAim.LIMIT_DEGREES);
        assertEquals(0.0, a[0], EPS);
        assertEquals(0.0, a[1], EPS);
    }
}
