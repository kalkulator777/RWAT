package com.muzhik17.trainsmod.kinematics;

/**
 * A car body rocking on its springs (SPEC §10) — the "тряска": three damped
 * oscillators (bounce, pitch, roll), each pulled toward what the track and
 * the motion ask of it:
 * <ul>
 * <li><b>track irregularity</b> under each bogie — smooth noise of the
 * bogie's path position, vertical (bounce, pitch) and lateral (roll), growing
 * with speed; the body's own frequencies filter it, so it rocks at about
 * 1 Hz, hardest where the speed meets a resonance;</li>
 * <li><b>rail joints</b> — a bogie crossing one kicks the body down (and its
 * end down), the jolt that goes with the knock of the wheels;</li>
 * <li><b>curves</b> — the body leans out by the unbalanced lateral
 * acceleration (there is no cant);</li>
 * <li><b>braking and pulling</b> — the nose dips toward where inertia
 * throws it; a bump or a coupling is a sharp change of speed, so it lurches.</li>
 * </ul>
 * Cosmetic and client-side only: nothing of it goes over the network or
 * into physics; every client steps its own copy from the same synced motion,
 * so they agree closely enough. A train at rest settles level.
 *
 * <p>Pure math, no MC imports (SPEC principle #4).
 */
public final class RideMotion {

    /** Natural frequencies (Hz) and damping ratios of the body's modes. */
    private static final double BOUNCE_HZ = 1.3;
    private static final double BOUNCE_ZETA = 0.25;
    private static final double PITCH_HZ = 1.6;
    private static final double PITCH_ZETA = 0.3;
    private static final double ROLL_HZ = 0.9;
    private static final double ROLL_ZETA = 0.15;

    /** Speed at which the track excites the body fully, m/s (90 km/h); faster grows up to the cap. */
    private static final double V_FULL = 25.0;
    private static final double MAX_EXCITATION = 1.6;
    /** Vertical track irregularity at full excitation, blocks. */
    private static final double VERTICAL = 0.04;
    /** Lateral irregularity, as the body roll it asks for at full excitation, rad. */
    private static final double LATERAL_ROLL = 0.035;
    /** A bogie dropping into a joint at full excitation: kick to the body's vertical speed, blocks/s. */
    private static final double JOINT_KICK = 0.25;
    /** The same joint's sideways twitch, rad/s. */
    private static final double JOINT_ROLL_KICK = 0.01;
    /** Shortest wheelbase the pitch kick divides by, blocks (two-axle wagons). */
    private static final double MIN_WHEELBASE = 3.0;
    /** Outward lean per m/s² of unbalanced lateral acceleration, rad, and its cap. */
    private static final double LEAN_PER_ACCEL = 0.018;
    private static final double LEAN_MAX = 0.05;
    /** Nose dip per m/s² of braking, rad, and its cap. */
    private static final double DIP_PER_ACCEL = 0.004;
    private static final double DIP_MAX = 0.03;
    /** Hard limits on the state, so nothing ever runs away. */
    private static final double BOUNCE_LIMIT = 0.15;
    private static final double ANGLE_LIMIT = 0.12;

    /**
     * What the body feels this step.
     *
     * @param frontS      path position of the front bogie, blocks
     * @param rearS       path position of the rear bogie, blocks (frontS ≥ rearS)
     * @param speed       along +s, m/s
     * @param accel       along +s, m/s²
     * @param curvature   of the track under the car, 1/m, positive turning left
     *                    (toward +X of the pose frame)
     * @param frontJoints rail joints the front bogie crossed this step
     * @param rearJoints  rail joints the rear bogie crossed this step
     */
    public record Input(double frontS, double rearS, double speed, double accel,
            double curvature, int frontJoints, int rearJoints) {
    }

    private double bounce;
    private double bounceV;
    private double pitch;
    private double pitchV;
    private double roll;
    private double rollV;

    /** Where the body is now. */
    public Sway sway() {
        return new Sway(bounce, pitch, roll);
    }

    /** Back to level and still. */
    public void reset() {
        bounce = bounceV = pitch = pitchV = roll = rollV = 0.0;
    }

    /** Advance by {@code dt} seconds. */
    public void step(double dt, Input in) {
        double excitation = Math.min(Math.abs(in.speed()) / V_FULL, MAX_EXCITATION);
        double wheelbase = Math.max(in.frontS() - in.rearS(), MIN_WHEELBASE);

        // the track under each bogie
        double frontZ = excitation * VERTICAL * noise(in.frontS(), 0);
        double rearZ = excitation * VERTICAL * noise(in.rearS(), 0);
        double lateral = excitation * LATERAL_ROLL
                * 0.5 * (noise(in.frontS(), 1) + noise(in.rearS(), 1));

        double lean = Math.clamp(LEAN_PER_ACCEL * in.speed() * in.speed() * in.curvature(),
                -LEAN_MAX, LEAN_MAX);
        double dip = Math.clamp(-DIP_PER_ACCEL * in.accel(), -DIP_MAX, DIP_MAX);

        double bounceTarget = 0.5 * (frontZ + rearZ);
        double pitchTarget = (rearZ - frontZ) / wheelbase + dip; // front higher = nose up
        double rollTarget = lateral + lean;

        // joints: the bogie drops, the body follows it down at that end
        double jointKick = excitation * JOINT_KICK;
        for (int i = 0; i < in.frontJoints(); i++) {
            bounceV -= 0.5 * jointKick;
            pitchV += jointKick / wheelbase;
            rollV += JOINT_ROLL_KICK * excitation * Math.signum(noise(in.frontS() + i, 2));
        }
        for (int i = 0; i < in.rearJoints(); i++) {
            bounceV -= 0.5 * jointKick;
            pitchV -= jointKick / wheelbase;
            rollV += JOINT_ROLL_KICK * excitation * Math.signum(noise(in.rearS() + i, 2));
        }

        double[] b = spring(bounce, bounceV, bounceTarget, BOUNCE_HZ, BOUNCE_ZETA, dt);
        double[] p = spring(pitch, pitchV, pitchTarget, PITCH_HZ, PITCH_ZETA, dt);
        double[] r = spring(roll, rollV, rollTarget, ROLL_HZ, ROLL_ZETA, dt);
        bounce = Math.clamp(b[0], -BOUNCE_LIMIT, BOUNCE_LIMIT);
        bounceV = b[1];
        pitch = Math.clamp(p[0], -ANGLE_LIMIT, ANGLE_LIMIT);
        pitchV = p[1];
        roll = Math.clamp(r[0], -ANGLE_LIMIT, ANGLE_LIMIT);
        rollV = r[1];
    }

    /** One semi-implicit Euler step of a damped spring toward {@code target}: {x, v}. */
    private static double[] spring(double x, double v, double target, double hz, double zeta,
            double dt) {
        double omega = 2.0 * Math.PI * hz;
        double a = omega * omega * (target - x) - 2.0 * zeta * omega * v;
        v += a * dt;
        return new double[] {x + v * dt, v};
    }

    /**
     * Track irregularity at path position {@code s}, about −1…1: three octaves
     * of smooth value noise (31, 13 and 5.7 blocks), a channel apiece for
     * vertical, lateral and the joints' twitch.
     */
    static double noise(double s, int channel) {
        return 0.55 * valueNoise(s / 31.0, channel * 3)
                + 0.30 * valueNoise(s / 13.0, channel * 3 + 1)
                + 0.15 * valueNoise(s / 5.7, channel * 3 + 2);
    }

    private static double valueNoise(double x, int salt) {
        double cell = Math.floor(x);
        double t = x - cell;
        double smooth = t * t * (3.0 - 2.0 * t);
        double a = hash((long) cell, salt);
        double b = hash((long) cell + 1L, salt);
        return a + (b - a) * smooth;
    }

    /** A cell's value in −1…1 (SplitMix64 finaliser). */
    private static double hash(long cell, int salt) {
        long h = cell * 0x9E3779B97F4A7C15L + salt * 0xC2B2AE3D27D4EB4FL;
        h = (h ^ (h >>> 30)) * 0xBF58476D1CE4E5B9L;
        h = (h ^ (h >>> 27)) * 0x94D049BB133111EBL;
        h ^= h >>> 31;
        return (h >>> 11) * 0x1.0p-53 * 2.0 - 1.0;
    }
}
