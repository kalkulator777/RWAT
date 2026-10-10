package com.muzhik17.trainsmod.stock;

import java.util.List;

/**
 * The typed make-up of one consist (SPEC §5.5 step 3): an ordered list of
 * {@link Slot}s (wagon type + orientation), front first, replacing the old
 * uniform-pitch {@code ConsistGeometry}. Pure data, no MC imports — the same
 * composition is read on the server and (synced once per consist) on the
 * client, so both unroll identical wagon positions from the single head
 * {@code s}.
 *
 * <p>{@code headS} keeps its meaning: the path distance of the <b>front bogie
 * of wagon 0</b>. Bodies are placed nose-to-tail, {@link #COUPLER_GAP} apart
 * (frame to frame); each wagon's bogies sit at its body centre ± its type's
 * bogie offsets ({@code flipped} negates them).
 */
public record ConsistComposition(List<Slot> slots) {

    /**
     * Air between consecutive wagon frames, blocks: none — a type's length is
     * over couplers, so coupled wagons meet coupler to coupler (SPEC §6.12).
     * Was 1.0 until 2026-10-10: a block of daylight between every pair.
     */
    public static final double COUPLER_GAP = 0.0;

    /**
     * One wagon of the consist. {@code flipped} = the wagon faces backwards
     * relative to travel: its type-space forward is the path's backward, so
     * bogie offsets negate and the renderer turns the model 180°.
     * {@code livery} picks one of the model's paint schemes (SPEC §6.7);
     * {@code ""} = the base textures. Purely visual — the server carries it
     * without knowing which liveries a model has.
     */
    public record Slot(WagonType type, boolean flipped, String livery) {

        /** No livery: the base textures. */
        public static final String BASE_LIVERY = "";

        public Slot {
            livery = livery == null ? BASE_LIVERY : livery;
        }

        public Slot(WagonType type, boolean flipped) {
            this(type, flipped, BASE_LIVERY);
        }

        /** Offset of the leading (path-front) bogie from the body centre, +forward. */
        public double frontBogieOffset() {
            double[] offsets = type.bogieOffsets();
            return flipped ? -offsets[offsets.length - 1] : offsets[0];
        }

        /** Offset of the trailing (path-rear) bogie from the body centre. */
        public double rearBogieOffset() {
            double[] offsets = type.bogieOffsets();
            return flipped ? -offsets[0] : offsets[offsets.length - 1];
        }
    }

    public int wagonCount() {
        return slots.size();
    }

    public Slot slot(int wagonIndex) {
        return slots.get(wagonIndex);
    }

    /** Path distance of wagon {@code i}'s body centre, given the head. */
    public double bodyCenterS(double headS, int wagonIndex) {
        Slot first = slots.get(0);
        double center = headS - first.frontBogieOffset();
        for (int i = 1; i <= wagonIndex; i++) {
            center -= slots.get(i - 1).type().length() * 0.5
                    + COUPLER_GAP
                    + slots.get(i).type().length() * 0.5;
        }
        return center;
    }

    public double frontBogieS(double headS, int wagonIndex) {
        return bodyCenterS(headS, wagonIndex) + slots.get(wagonIndex).frontBogieOffset();
    }

    public double rearBogieS(double headS, int wagonIndex) {
        return bodyCenterS(headS, wagonIndex) + slots.get(wagonIndex).rearBogieOffset();
    }

    /**
     * Span from the head (front bogie of wagon 0) to the rear bogie of the last
     * wagon. Used to keep the whole train on the path when clamping the head.
     */
    public double totalLength() {
        int last = slots.size() - 1;
        return -(rearBogieS(0.0, last));
    }

    /** Total empty mass, tonnes (the physics step reads this; cargo later). */
    public double totalMassT() {
        double mass = 0.0;
        for (Slot slot : slots) {
            mass += slot.type().massT();
        }
        return mass;
    }
}
