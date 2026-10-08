package com.muzhik17.trainsmod.consist;

/**
 * The driver's handles as clients see them (SPEC §9): what the cab levers
 * and gauges of the active cab show. Rides every consist snapshot — a few
 * bytes — so a lever moves on every client in step with the train.
 *
 * @param reverser  −1 reverse, 0 neutral, +1 forward
 * @param throttle  0..{@link Consist#NOTCHES}
 * @param trainBrake 0..{@link Consist#NOTCHES}
 * @param indBrake  0..{@link Consist#NOTCHES}
 * @param activeCab index in the consist of the cab that drives (or last
 *                  drove); −1 = none. Only that cab's levers move.
 */
public record Handles(int reverser, int throttle, int trainBrake, int indBrake, int activeCab) {

    public static final Handles REST = new Handles(0, 0, 0, 0, -1);

    /** The handle values in one int (the active cab travels separately). */
    public int pack() {
        return (reverser + 1) | throttle << 2 | trainBrake << 6 | indBrake << 10;
    }

    public static Handles unpack(int packed, int activeCab) {
        return new Handles((packed & 3) - 1, packed >> 2 & 15, packed >> 6 & 15,
                packed >> 10 & 15, activeCab);
    }

    /** A handle as a 0..1 lever travel, the way IR maps controls (reverser: 0 back … ½ neutral … 1 forward). */
    public float travel(Consist.Handle handle) {
        return switch (handle) {
            case REVERSER -> (reverser + 1) * 0.5F;
            case THROTTLE -> throttle / (float) Consist.NOTCHES;
            case TRAIN_BRAKE -> trainBrake / (float) Consist.NOTCHES;
            case INDEPENDENT_BRAKE -> indBrake / (float) Consist.NOTCHES;
        };
    }

    /** The handle position a 0..1 lever travel lands on (nearest notch / reverser step). */
    public static int fromTravel(Consist.Handle handle, float travel) {
        float t = Math.clamp(travel, 0.0F, 1.0F);
        return handle == Consist.Handle.REVERSER
                ? Math.round(t * 2.0F) - 1
                : Math.round(t * Consist.NOTCHES);
    }
}
