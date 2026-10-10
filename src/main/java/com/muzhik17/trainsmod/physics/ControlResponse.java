package com.muzhik17.trainsmod.physics;

import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

/**
 * How fast the driver's handles take effect (SPEC §5.3): the brake cylinders
 * fill and vent, a diesel spools up. A handle sets a target; the effort the
 * physics sees follows it with a first-order lag, reaching ~95% of a step in
 * the given seconds. The slowest wagon sets the train's timing — one freight
 * car in a train brakes like a freight train. The air pipe itself (its
 * pressure wave, depletion) is still not simulated.
 *
 * <p>Pure, no MC imports.
 *
 * @param tractionUpS          throttle opening
 * @param tractionDownS        throttle closing (power drops faster than it builds)
 * @param brakeApplyS          train brake applying
 * @param brakeReleaseS        train brake releasing
 * @param independentApplyS    loco brake applying
 * @param independentReleaseS  loco brake releasing
 */
public record ControlResponse(double tractionUpS, double tractionDownS,
        double brakeApplyS, double brakeReleaseS,
        double independentApplyS, double independentReleaseS) {

    /** Power drops this much faster than it builds. */
    static final double TRACTION_DOWN_FACTOR = 0.5;
    /** Closer than this to the target the effort snaps to it. */
    private static final double SNAP = 1.0e-4;

    /** The timing of {@code composition}, every time multiplied by {@code scale} (0 = instant). */
    public static ControlResponse of(ConsistComposition composition, double scale) {
        double tractionUp = 0.0;
        double brakeApply = 0.0;
        double brakeRelease = 0.0;
        double indApply = 0.0;
        double indRelease = 0.0;
        for (ConsistComposition.Slot slot : composition.slots()) {
            WagonType type = slot.type();
            if (type.powered()) {
                tractionUp = Math.max(tractionUp, type.traction().rampS());
            }
            WagonType.Brakes brakes = type.brakes();
            if (brakes.trainKn() > 0.0) {
                brakeApply = Math.max(brakeApply, brakes.applyS());
                brakeRelease = Math.max(brakeRelease, brakes.releaseS());
            }
            if (type.drivable() && brakes.independentKn() > 0.0) {
                indApply = Math.max(indApply, brakes.applyS());
                indRelease = Math.max(indRelease, brakes.releaseS());
            }
        }
        return new ControlResponse(tractionUp * scale, tractionUp * TRACTION_DOWN_FACTOR * scale,
                brakeApply * scale, brakeRelease * scale, indApply * scale, indRelease * scale);
    }

    /**
     * One tick of the lag: {@code current} moved toward {@code target},
     * reaching ~95% of a step in {@code upS} seconds when rising and
     * {@code downS} when falling. A time of 0, or no current value yet (NaN —
     * e.g. after a server restart), takes the target at once.
     */
    public static double approach(double current, double target, double upS, double downS) {
        double t95 = target > current ? upS : downS;
        if (Double.isNaN(current) || !(t95 > 0.0)) {
            return target;
        }
        double tau = t95 / 3.0; // e^-3 ≈ 5% left
        double next = current + (target - current)
                * (1.0 - Math.exp(-1.0 / (TrainPhysics.TICKS_PER_SECOND * tau)));
        return Math.abs(target - next) < SNAP ? target : next;
    }
}
