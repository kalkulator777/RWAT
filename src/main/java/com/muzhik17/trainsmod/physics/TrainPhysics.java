package com.muzhik17.trainsmod.physics;

import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Longitudinal train dynamics (SPEC §5.4): the consist sits rigidly on the
 * spline, so its motion is one scalar equation per tick —
 * {@code F = Σтяга − Σтормоз − Σсопротивление − Σm·g·уклон; a = F/Σm}.
 * Pure math, no MC imports; server-only (the client only interpolates the
 * resulting {@code s}/{@code v}).
 *
 * <p>Per-wagon contributions:
 * <ul>
 *   <li><b>Traction</b> — constant-power hyperbola {@code TE = min(TE_max, P/v)}
 *       for every powered wagon (MU for free), scaled by the throttle fraction
 *       and signed by the reverser.
 *   <li><b>Resistance</b> — Davis {@code a + b·v + c·v²} per wagon, opposing
 *       motion; the {@code a} term doubles as static resistance at rest.
 *   <li><b>Grade</b> — each wagon's weight projected on the tangent <b>at its
 *       own body centre</b>, so a long train on a profile break (head downhill,
 *       tail still climbing) balances correctly.
 *   <li><b>Brakes</b> — the train (automatic) circuit acts on every wagon, the
 *       independent circuit on cab-fitted wagons only; force = notch fraction ×
 *       declared force, instant (no air-pipe simulation, SPEC §5.3). Brakes and
 *       resistance never reverse motion — the speed clamps at zero.
 * </ul>
 *
 * <p>Internally SI (m, s, N, kg; 1 block = 1 m); the block/tick conversion
 * happens at the boundary of {@link #step}.
 */
public final class TrainPhysics {

    public static final double TICKS_PER_SECOND = 20.0;
    public static final double G = 9.81;
    /** Below this (m/s) the traction hyperbola is clamped — starting effort. */
    private static final double HYPERBOLA_FLOOR_MS = 1.0;

    /**
     * Driver controls as fractions: throttle/brakes 0..1 (notch / notch count),
     * reverser −1 (back), 0 (neutral), +1 (forward).
     */
    public record Controls(int reverser, double throttle, double trainBrake, double independentBrake) {

        public static final Controls IDLE = new Controls(1, 0.0, 0.0, 0.0);
    }

    private TrainPhysics() {
    }

    /**
     * One tick of longitudinal dynamics.
     *
     * @param path  the consist's path (grade is sampled per wagon)
     * @param headS head distance along the path, blocks
     * @param v     current speed, blocks/tick (signed: + = increasing {@code s})
     * @return new speed, blocks/tick
     */
    public static double step(TrackPath path, double headS, double v,
            ConsistComposition composition, Controls controls) {
        double dt = 1.0 / TICKS_PER_SECOND;
        double vMs = v * TICKS_PER_SECOND;
        double massKg = composition.totalMassT() * 1000.0;
        if (massKg <= 0.0) {
            return 0.0;
        }

        double traction = 0.0;
        double brake = 0.0;
        double resistance = 0.0;
        double staticResistance = 0.0;
        double gravity = 0.0;
        double maxSpeedMs = Double.MAX_VALUE;

        for (int i = 0; i < composition.wagonCount(); i++) {
            WagonType type = composition.slot(i).type();

            if (type.powered() && controls.reverser() != 0 && controls.throttle() > 0.0) {
                double te = Math.min(
                        type.traction().maxTractiveEffortKn() * 1000.0,
                        type.traction().powerKw() * 1000.0
                                / Math.max(Math.abs(vMs), HYPERBOLA_FLOOR_MS));
                traction += controls.reverser() * controls.throttle() * te;
            }

            brake += type.brakes().trainKn() * 1000.0 * controls.trainBrake();
            if (type.drivable()) {
                brake += type.brakes().independentKn() * 1000.0 * controls.independentBrake();
            }

            resistance += type.resistance().newtons(vMs);
            staticResistance += type.resistance().a();

            // weight projected on the local tangent at this wagon's own centre
            double tangentY = path.sampleTangent(composition.bodyCenterS(headS, i)).y;
            gravity -= type.massT() * 1000.0 * G * tangentY;

            maxSpeedMs = Math.min(maxSpeedMs, type.maxSpeedKmh() / 3.6);
        }

        double drive = traction + gravity; // signed along +s
        double vNewMs;
        if (vMs == 0.0) {
            // at rest: brakes + static resistance hold against drive or it breaks away
            double hold = brake + staticResistance;
            if (Math.abs(drive) <= hold) {
                return 0.0;
            }
            vNewMs = (drive - Math.signum(drive) * hold) / massKg * dt;
        } else {
            double force = drive - Math.signum(vMs) * (resistance + brake);
            vNewMs = vMs + force / massKg * dt;
            // brakes/resistance stop the train, they never push it backwards
            if (vNewMs * vMs < 0.0) {
                vNewMs = 0.0;
            }
        }

        vNewMs = Math.clamp(vNewMs, -maxSpeedMs, maxSpeedMs);
        return vNewMs / TICKS_PER_SECOND;
    }
}
