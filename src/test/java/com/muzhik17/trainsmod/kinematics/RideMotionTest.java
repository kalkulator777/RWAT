package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/** The car body on its springs (SPEC §10): settles at rest, rocks with speed, leans, jolts at joints. */
class RideMotionTest {

    private static final double DT = 0.05; // one client tick
    private static final double WHEELBASE = 17.0;

    /** Run {@code seconds} at a steady speed on a curve; returns the RMS and mean roll. */
    private static double[] run(RideMotion motion, double speed, double curvature, double seconds) {
        double s = 1000.0;
        double sumSq = 0.0;
        double sum = 0.0;
        int steps = (int) (seconds / DT);
        for (int i = 0; i < steps; i++) {
            s += speed * DT;
            motion.step(DT, new RideMotion.Input(s, s - WHEELBASE, speed, 0.0, curvature, 0, 0));
            sumSq += motion.sway().roll() * motion.sway().roll();
            sum += motion.sway().roll();
        }
        return new double[] {Math.sqrt(sumSq / steps), sum / steps};
    }

    @Test
    void atRestTheBodySettlesLevel() {
        RideMotion motion = new RideMotion();
        run(motion, 30.0, 0.0, 10.0); // rocking at speed…
        run(motion, 0.0, 0.0, 10.0);  // …then standing
        Sway sway = motion.sway();
        assertEquals(0.0, sway.bounce(), 1e-4);
        assertEquals(0.0, sway.pitch(), 1e-4);
        assertEquals(0.0, sway.roll(), 1e-4);
    }

    @Test
    void rocksMoreTheFasterItGoes() {
        double slow = run(new RideMotion(), 3.0, 0.0, 60.0)[0];
        double fast = run(new RideMotion(), 30.0, 0.0, 60.0)[0];
        assertTrue(fast > 3.0 * slow, "slow " + slow + " fast " + fast);
        assertTrue(fast > Math.toRadians(0.1), "fast rocking too faint: " + Math.toDegrees(fast) + "°");
        assertTrue(fast < Math.toRadians(3.0), "fast rocking too wild: " + Math.toDegrees(fast) + "°");
    }

    @Test
    void leansOutOfACurve() {
        // turning left at 20 m/s on a 300 m radius: the top leans right (+roll)
        double mean = run(new RideMotion(), 20.0, 1.0 / 300.0, 30.0)[1];
        assertTrue(mean > Math.toRadians(0.5), "mean roll " + Math.toDegrees(mean) + "°");
        double right = run(new RideMotion(), 20.0, -1.0 / 300.0, 30.0)[1];
        assertTrue(right < -Math.toRadians(0.5), "mean roll " + Math.toDegrees(right) + "°");
    }

    @Test
    void aJointDropsTheBody() {
        RideMotion motion = new RideMotion();
        motion.step(DT, new RideMotion.Input(0.0, -WHEELBASE, 20.0, 0.0, 0.0, 1, 0));
        double minBounce = 0.0;
        double maxPitch = 0.0;
        for (int i = 0; i < 10; i++) {
            motion.step(DT, new RideMotion.Input(0.0, -WHEELBASE, 0.0, 0.0, 0.0, 0, 0));
            minBounce = Math.min(minBounce, motion.sway().bounce());
            maxPitch = Math.max(maxPitch, motion.sway().pitch());
        }
        assertTrue(minBounce < -0.002, "bounce " + minBounce);
        assertTrue(maxPitch > 0.0, "the front bogie's joint should dip the nose");
    }

    @Test
    void brakingDipsTheNose() {
        RideMotion motion = new RideMotion();
        for (int i = 0; i < 40; i++) {
            motion.step(DT, new RideMotion.Input(0.0, -WHEELBASE, 0.0, -1.5, 0.0, 0, 0));
        }
        assertTrue(motion.sway().pitch() > 0.0, "pitch " + motion.sway().pitch());
    }

    @Test
    void sameTrackSameMotion() {
        double[] a = run(new RideMotion(), 25.0, 0.002, 20.0);
        double[] b = run(new RideMotion(), 25.0, 0.002, 20.0);
        assertEquals(a[0], b[0], 0.0);
        assertEquals(a[1], b[1], 0.0);
    }

    @Test
    void swayTurnsAboutTheRockingCentre() {
        Sway roll = new Sway(0.0, 0.0, Math.toRadians(10.0));
        Vector3d centre = roll.apply(new Vector3d(0.0, Sway.CENTRE_Y, 0.0));
        assertEquals(0.0, centre.distance(0.0, Sway.CENTRE_Y, 0.0), 1e-9);
        Vector3d head = roll.apply(new Vector3d(0.0, Sway.CENTRE_Y + 2.0, 0.0));
        assertTrue(head.x < -0.3, "positive roll tips the top to the right (−X): " + head.x);
        Vector3d nose = new Sway(0.05, Math.toRadians(5.0), 0.0)
                .apply(new Vector3d(0.0, Sway.CENTRE_Y, 10.0));
        assertTrue(nose.y < Sway.CENTRE_Y, "positive pitch dips the nose: " + nose.y);
    }
}
