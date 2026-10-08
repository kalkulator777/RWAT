package com.muzhik17.trainsmod.convention;

import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.Handles;

/**
 * Where a cab control stands and how far that turns it (SPEC §9.3), the way
 * IR's {@code Control.getValue}/{@code Readout.getValue} reckon it. Pure.
 *
 * <p>A control has a raw <b>position</b> 0..1 — a handle's travel, a switch's
 * control group, a gauge's reading scaled into its range — and a <b>value</b>
 * that drives its animation: {@code position + OFFSET}, mirrored by
 * {@code INVERT}, minus ½ for the reverser (the model is drawn in neutral).
 * Rotation = value × the pivot's degrees, slide = value × the {@code TL}
 * distance. A {@code HIDE} control shows only while its value isn't 1.
 */
public final class ControlValue {

    /** What the gauges read (SPEC §9.3). */
    public record Readings(double speedKmh, double maxSpeedKmh) {
    }

    private ControlValue() {
    }

    /** The handle a lever kind drives, or null for anything else. */
    public static Consist.Handle handle(ObjectRole.Kind kind) {
        return switch (kind) {
            case THROTTLE -> Consist.Handle.THROTTLE;
            case REVERSER -> Consist.Handle.REVERSER;
            case TRAIN_BRAKE -> Consist.Handle.TRAIN_BRAKE;
            case INDEPENDENT_BRAKE -> Consist.Handle.INDEPENDENT_BRAKE;
            default -> null;
        };
    }

    /**
     * Raw position 0..1.
     *
     * @param handles    the consist's handles
     * @param activeCab  true if this wagon is the cab that drives — the other
     *                   cabs' levers rest (the reverser in neutral)
     * @param groupValue the wagon's value of the control's group (switches, windows)
     */
    public static float position(ObjectRole.Control control, Handles handles, boolean activeCab,
            float groupValue, Readings readings) {
        Consist.Handle handle = handle(control.kind());
        if (handle != null) {
            return (activeCab ? handles : Handles.REST).travel(handle);
        }
        if (control.kind().gauge()) {
            float reading = reading(control.kind(), handles, readings);
            float span = control.rangeMax() - control.rangeMin();
            return span == 0.0F ? 0.0F
                    : Math.clamp((reading - control.rangeMin()) / span, 0.0F, 1.0F);
        }
        if (control.kind() == ObjectRole.Kind.THROTTLE_BRAKE) {
            return 0.5F; // combined handle: not on any MVP loco, drawn in neutral
        }
        return Math.clamp(groupValue, 0.0F, 1.0F);
    }

    /** The animation value at a raw position (IR {@code getValue}). */
    public static float value(ObjectRole.Control control, float position) {
        float pos = position + control.offset();
        float value = control.invert() ? 1.0F - pos : pos;
        boolean centred = control.kind() == ObjectRole.Kind.REVERSER
                || control.kind() == ObjectRole.Kind.THROTTLE_BRAKE;
        return centred ? value - 0.5F : value;
    }

    /** False for a {@code HIDE} control at value 1 (IR: shown while {@code getValue != 1}). */
    public static boolean visible(ObjectRole.Control control, float position) {
        return !control.hide() || value(control, position) != 1.0F;
    }

    private static float reading(ObjectRole.Kind kind, Handles handles, Readings readings) {
        float notches = Consist.NOTCHES;
        return switch (kind) {
            case GAUGE_SPEED -> (float) (Math.abs(readings.speedKmh())
                    / (readings.maxSpeedKmh() > 0.0 ? readings.maxSpeedKmh() : 200.0));
            case GAUGE_THROTTLE -> handles.throttle() / notches;
            case GAUGE_REVERSER -> (handles.reverser() + 1) * 0.5F;
            case GAUGE_TRAIN_BRAKE -> handles.trainBrake() / notches;
            case GAUGE_INDEPENDENT_BRAKE -> handles.indBrake() / notches;
            case BRAKE_PRESSURE -> Math.max(handles.trainBrake(), handles.indBrake()) / notches;
            default -> 0.0F;
        };
    }
}
