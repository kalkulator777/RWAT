package com.muzhik17.trainsmod.convention;

import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.Handles;
import com.muzhik17.trainsmod.physics.TrainPhysics;
import com.muzhik17.trainsmod.stock.ConsistComposition;

/**
 * What the driver's panel shows (SPEC §9.7): the train's handles, its speed
 * and which way it rolls as seen from the driver's own cab, and the
 * speedometer's scale. Built on the client from the consist snapshot. Pure.
 *
 * @param handles           the consist's handles (those of its active cab)
 * @param speedKmh          speed, km/h, never negative
 * @param motion            +1 rolling the way the driver's cab looks, −1 backwards, 0 standing
 * @param limitKmh          the train's top speed (its slowest wagon's), km/h; 0 = none declared
 * @param scaleKmh          the speedometer's full scale, km/h
 * @param independentBrake  true if a cab of the train has an independent brake
 * @param inControl         true if the driver's cab is the one these handles are set from
 */
public record DriverReadout(Handles handles, double speedKmh, int motion, double limitKmh,
        int scaleKmh, boolean independentBrake, boolean inControl) {

    /** Speedometer scale of a train that declares no top speed, km/h. */
    static final int DEFAULT_SCALE_KMH = 100;
    /** The scale is the top speed rounded up to this, km/h. */
    static final int SCALE_ROUND_KMH = 20;

    /**
     * The readout for a driver in cab {@code cabIndex} of the consist.
     *
     * @param v speed, blocks/tick, signed along the path (+ = increasing {@code s})
     */
    public static DriverReadout of(Handles handles, double v, ConsistComposition composition,
            int cabIndex) {
        boolean known = cabIndex >= 0 && cabIndex < composition.wagonCount();
        int facing = known && composition.slot(cabIndex).flipped() ? -1 : 1;
        int motion = Math.abs(v) < Consist.REVERSER_STOP_EPS ? 0 : (v > 0.0 ? facing : -facing);
        double limit = limitKmh(composition);
        boolean independent = false;
        for (ConsistComposition.Slot slot : composition.slots()) {
            independent |= slot.type().drivable() && slot.type().brakes().independentKn() > 0.0;
        }
        return new DriverReadout(handles, Math.abs(TrainPhysics.kmh(v)), motion, limit,
                scaleKmh(limit), independent, known && handles.activeCab() == cabIndex);
    }

    /** The train's top speed: its slowest wagon's (as the physics caps it), 0 if none declares one. */
    static double limitKmh(ConsistComposition composition) {
        double limit = Double.MAX_VALUE;
        for (ConsistComposition.Slot slot : composition.slots()) {
            double max = slot.type().maxSpeedKmh();
            if (max > 0.0) {
                limit = Math.min(limit, max);
            }
        }
        return limit == Double.MAX_VALUE ? 0.0 : limit;
    }

    /** The speedometer's scale: the top speed rounded up to {@link #SCALE_ROUND_KMH}. */
    static int scaleKmh(double limitKmh) {
        if (limitKmh <= 0.0) {
            return DEFAULT_SCALE_KMH;
        }
        return (int) Math.ceil(limitKmh / SCALE_ROUND_KMH - 1.0e-9) * SCALE_ROUND_KMH;
    }

    /** True if the train stands (by the reverser's rule). */
    public boolean standing() {
        return motion == 0;
    }

    /** True if the reverser can be thrown now: standing with the throttle shut. */
    public boolean reverserFree() {
        return standing() && handles.throttle() == 0;
    }

    /** True at or above the top speed. */
    public boolean atLimit() {
        return limitKmh > 0.0 && speedKmh >= limitKmh - 0.5;
    }

    /** Speed as a fraction of the scale, 0..1. */
    public float speedFraction() {
        return (float) Math.clamp(speedKmh / scaleKmh, 0.0, 1.0);
    }

    /** The top speed as a fraction of the scale, 0..1; 0 if none. */
    public float limitFraction() {
        return (float) Math.clamp(limitKmh / scaleKmh, 0.0, 1.0);
    }

    /** Speedometer tick spacing, km/h: 10 up to 60, 20 up to 160, 40 beyond. */
    public int tickStepKmh() {
        return scaleKmh <= 60 ? 10 : scaleKmh <= 160 ? 20 : 40;
    }

    /** A handle's position: notches 0..{@link Consist#NOTCHES}, the reverser −1..1. */
    public int handle(Consist.Handle handle) {
        return switch (handle) {
            case REVERSER -> handles.reverser();
            case THROTTLE -> handles.throttle();
            case TRAIN_BRAKE -> handles.trainBrake();
            case INDEPENDENT_BRAKE -> handles.indBrake();
        };
    }

    /** True if the driver can move this handle now (the reverser only when {@link #reverserFree}). */
    public boolean canMove(Consist.Handle handle) {
        return inControl && switch (handle) {
            case REVERSER -> reverserFree();
            case INDEPENDENT_BRAKE -> independentBrake;
            default -> true;
        };
    }
}
