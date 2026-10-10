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
 *       for every powered wagon (MU for free), scaled by the throttle fraction,
 *       signed by the reverser, faded out by the unit's governor at its own
 *       design speed and capped by <b>adhesion</b> {@code μ(v)·m·g} (Curtius–
 *       Kniffler) — no wagon pulls harder than its wheels grip.
 *   <li><b>Resistance</b> — Davis {@code a + b·v + c·v²} per wagon, plus the
 *       nose drag {@code c_front·v²} of the wagon leading in the direction of
 *       travel; opposes motion; the {@code a} term doubles as static
 *       resistance at rest.
 *   <li><b>Grade</b> — each wagon's weight projected on the tangent <b>at its
 *       own body centre</b>, so a long train on a profile break (head downhill,
 *       tail still climbing) balances correctly.
 *   <li><b>Brakes</b> — the train (automatic) circuit acts on every wagon, the
 *       independent circuit on cab-fitted wagons only, the handbrake on the
 *       wagons it is set on; on the move each wagon's braking is capped by its
 *       adhesion (beyond it the wheels would slide). Brakes and resistance
 *       never reverse motion — the speed clamps at zero.
 * </ul>
 * The driver's handles reach this step already lagged ({@link ControlResponse}):
 * {@link Controls} carry the effort in effect, not the handle positions. How
 * hard the server plays it is the {@link PhysicsTuning}.
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
     * Nothing runs faster than this, km/h, whatever the profile: far above any
     * stock, it keeps a runaway down an endless grade finite.
     */
    public static final double ABSOLUTE_MAX_KMH = 400.0;
    /** A powered unit's traction fades to zero over this top fraction of its design speed. */
    static final double GOVERNOR_BAND = 0.05;

    /**
     * The efforts in effect as fractions: throttle/brakes 0..1, reverser −1
     * (back), 0 (neutral), +1 (forward).
     */
    public record Controls(int reverser, double throttle, double trainBrake, double independentBrake) {

        public static final Controls IDLE = new Controls(1, 0.0, 0.0, 0.0);
    }

    private TrainPhysics() {
    }

    /** A speed in blocks/tick as km/h (1 block = 1 m), sign kept. */
    public static double kmh(double blocksPerTick) {
        return blocksPerTick * TICKS_PER_SECOND * 3.6;
    }

    /**
     * Dry-rail adhesion coefficient at {@code vMs} (m/s), Curtius–Kniffler:
     * {@code μ = 0.161 + 7.5 / (v_kmh + 44)} — 0.33 at a standstill, 0.23 at
     * 60 km/h, 0.21 at 120.
     */
    public static double adhesion(double vMs) {
        return 0.161 + 7.5 / (Math.abs(vMs) * 3.6 + 44.0);
    }

    /** One tick at realistic tuning with no handbrakes set. */
    public static double step(TrackPath path, double headS, double v,
            ConsistComposition composition, Controls controls) {
        return step(path, headS, v, composition, controls, null, PhysicsTuning.REALISTIC);
    }

    /**
     * One tick of longitudinal dynamics.
     *
     * @param path       the consist's path (grade is sampled per wagon)
     * @param headS      head distance along the path, blocks
     * @param v          current speed, blocks/tick (signed: + = increasing {@code s})
     * @param handbrakes per wagon index, true = its handbrake is set; null = none
     * @return new speed, blocks/tick
     */
    public static double step(TrackPath path, double headS, double v,
            ConsistComposition composition, Controls controls, boolean[] handbrakes,
            PhysicsTuning tuning) {
        double dt = 1.0 / TICKS_PER_SECOND;
        double vMs = v * TICKS_PER_SECOND;
        double massKg = composition.totalMassT() * 1000.0;
        if (massKg <= 0.0) {
            return 0.0;
        }
        boolean moving = vMs != 0.0;
        double mu = tuning.adhesionScale() * adhesion(vMs);
        int count = composition.wagonCount();
        int leading = vMs >= 0.0 ? 0 : count - 1;

        double traction = 0.0;
        double brake = 0.0;
        double resistance = 0.0;
        double staticResistance = 0.0;
        double gravity = 0.0;
        double permittedMs = Double.MAX_VALUE;

        for (int i = 0; i < count; i++) {
            WagonType type = composition.slot(i).type();
            double wagonKg = type.massT() * 1000.0;
            double grip = tuning.adhesionLimit() ? mu * wagonKg * G : Double.MAX_VALUE;

            if (type.powered() && controls.reverser() != 0 && controls.throttle() > 0.0) {
                WagonType.Traction t = type.traction();
                double te = tuning.tractionScale() * Math.min(
                        t.maxTractiveEffortKn() * 1000.0,
                        t.powerKw() * 1000.0 / Math.max(Math.abs(vMs), HYPERBOLA_FLOOR_MS));
                te *= controls.throttle() * governor(type, vMs, controls.reverser());
                traction += controls.reverser() * Math.min(te, grip * t.adhesion());
            }

            WagonType.Brakes brakes = type.brakes();
            double wagonBrake = brakes.trainKn() * controls.trainBrake();
            if (type.drivable()) {
                wagonBrake += brakes.independentKn() * controls.independentBrake();
            }
            if (handbrakes != null && i < handbrakes.length && handbrakes[i]) {
                wagonBrake += brakes.parkingKn();
            }
            wagonBrake *= 1000.0 * tuning.brakeScale();
            // a sliding wheel brakes no harder than it grips; standing, the
            // shoes simply hold
            brake += moving ? Math.min(wagonBrake, grip) : wagonBrake;

            double drag = type.resistance().newtons(vMs);
            if (i == leading) {
                drag += type.resistance().frontalNewtons(vMs);
            }
            resistance += tuning.resistanceScale() * drag;
            staticResistance += tuning.resistanceScale() * type.resistance().a();

            // weight projected on the local tangent at this wagon's own centre
            double tangentY = path.sampleTangent(composition.bodyCenterS(headS, i)).y;
            gravity -= wagonKg * G * tangentY;

            if (type.maxSpeedKmh() > 0.0) {
                permittedMs = Math.min(permittedMs, type.maxSpeedKmh() / 3.6);
            }
        }

        double drive = traction + gravity; // signed along +s
        double vNewMs;
        if (!moving) {
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

        double ceilingMs = ABSOLUTE_MAX_KMH / 3.6;
        if (tuning.hardSpeedLimit()) {
            ceilingMs = Math.min(ceilingMs, permittedMs);
        }
        vNewMs = Math.clamp(vNewMs, -ceilingMs, ceilingMs);
        return vNewMs / TICKS_PER_SECOND;
    }

    /**
     * The governor of a powered unit: full traction up to the last
     * {@link #GOVERNOR_BAND} of its design speed, then down to none at it —
     * only while pulling the way it moves (traction against the motion is a
     * brake, never cut). No design speed declared, no governor.
     */
    static double governor(WagonType type, double vMs, int pull) {
        double maxMs = type.maxSpeedKmh() / 3.6;
        if (maxMs <= 0.0 || vMs * pull < 0.0) {
            return 1.0;
        }
        return Math.clamp((maxMs - Math.abs(vMs)) / (GOVERNOR_BAND * maxMs), 0.0, 1.0);
    }
}
