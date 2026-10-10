package com.muzhik17.trainsmod.physics;

/**
 * How a server plays the physics (SPEC §5.6): one {@link Profile} — or, under
 * {@link Profile#CUSTOM}, the server's own values. Packs always describe the
 * real machine; the profile scales it. Pure, no MC imports — the config
 * adapter builds it, the physics and the consist take it as a parameter.
 *
 * @param tractionScale        multiplies every tractive effort
 * @param brakeScale           multiplies every brake force (train, independent, hand)
 * @param resistanceScale      multiplies running resistance — above 1 a train
 *                             slows by itself once the throttle closes
 * @param responseScale        multiplies the brake/traction build-up times;
 *                             0 = handles act at once
 * @param adhesionLimit        tractive and brake effort capped by wheel-rail
 *                             adhesion {@code μ(v)·m·g}
 * @param adhesionScale        multiplies the adhesion coefficient (rail state)
 * @param autoHandbrake        handbrakes set themselves on a train standing
 *                             with the throttle shut and come off when the
 *                             throttle opens; false = by hand only (crowbar)
 * @param hardSpeedLimit       the train never exceeds its slowest wagon's
 *                             design speed; false = it can, downhill or pushed
 *                             (only the locomotives' governors and an absolute
 *                             ceiling limit it)
 * @param couplingMaxSpeedKmh  faster closing than this bumps instead of
 *                             coupling; 0 = couples at any speed
 */
public record PhysicsTuning(double tractionScale, double brakeScale, double resistanceScale,
        double responseScale, boolean adhesionLimit, double adhesionScale,
        boolean autoHandbrake, boolean hardSpeedLimit, double couplingMaxSpeedKmh) {

    /** Real figures, nothing helped: brake early, park with the handbrake, couple gently. */
    public static final PhysicsTuning REALISTIC =
            new PhysicsTuning(1.0, 1.0, 1.0, 1.0, true, 1.0, false, false, 10.0);
    /**
     * Real physics with concessions to Minecraft's scale: stronger and
     * quicker brakes (a station is seldom 500 blocks ahead in view),
     * handbrakes that look after themselves.
     */
    public static final PhysicsTuning STANDARD =
            new PhysicsTuning(1.0, 1.4, 1.0, 0.5, true, 1.0, true, false, 15.0);
    /** Pick up and play: quick, forgiving, the train stops by itself. */
    public static final PhysicsTuning ARCADE =
            new PhysicsTuning(1.5, 2.0, 3.0, 0.0, false, 1.0, true, true, 0.0);

    /** The server's choice; {@link #CUSTOM} takes the config's own values. */
    public enum Profile {
        REALISTIC, STANDARD, ARCADE, CUSTOM
    }

    public PhysicsTuning {
        tractionScale = nonNegative(tractionScale);
        brakeScale = nonNegative(brakeScale);
        resistanceScale = nonNegative(resistanceScale);
        responseScale = nonNegative(responseScale);
        adhesionScale = nonNegative(adhesionScale);
        couplingMaxSpeedKmh = nonNegative(couplingMaxSpeedKmh);
    }

    /** The tuning of {@code profile}; {@code custom} is used only for {@link Profile#CUSTOM}. */
    public static PhysicsTuning of(Profile profile, PhysicsTuning custom) {
        return switch (profile) {
            case REALISTIC -> REALISTIC;
            case STANDARD -> STANDARD;
            case ARCADE -> ARCADE;
            case CUSTOM -> custom;
        };
    }

    /** The coupling speed limit as a closing speed, blocks/tick; +∞ = none. */
    public double couplingMaxClosing() {
        return couplingMaxSpeedKmh > 0.0
                ? couplingMaxSpeedKmh / 3.6 / TrainPhysics.TICKS_PER_SECOND
                : Double.POSITIVE_INFINITY;
    }

    private static double nonNegative(double value) {
        return value >= 0.0 && !Double.isInfinite(value) ? value : 0.0;
    }
}
