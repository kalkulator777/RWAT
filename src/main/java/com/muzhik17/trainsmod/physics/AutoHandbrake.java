package com.muzhik17.trainsmod.physics;

/**
 * The auto handbrakes of a profile with {@link PhysicsTuning#autoHandbrake()}
 * (SPEC §5.3): they come off the moment the throttle opens and go on when the
 * train stands with the throttle shut — a parked, uncoupled or freshly placed
 * train holds on a grade, a driver simply drives away. Pure, no MC imports.
 */
public final class AutoHandbrake {

    /** Below this speed (blocks/tick) the train stands — the reverser's rule. */
    public static final double STANDING = 1.0e-3;

    private AutoHandbrake() {
    }

    /**
     * What the auto handbrakes do now: {@code TRUE} set them all,
     * {@code FALSE} release them all, null leave them be (rolling with the
     * throttle shut — coasting, or pushed).
     *
     * @param throttleNotch the throttle handle, 0 = shut
     * @param reverser      the reverser handle, 0 = neutral
     * @param v             speed, blocks/tick
     */
    public static Boolean target(int throttleNotch, int reverser, double v) {
        if (throttleNotch > 0 && reverser != 0) {
            return Boolean.FALSE;
        }
        if (throttleNotch == 0 && Math.abs(v) < STANDING) {
            return Boolean.TRUE;
        }
        return null;
    }
}
