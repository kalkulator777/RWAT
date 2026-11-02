package com.muzhik17.trainsmod.client.sound;

import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Which doors of one wagon opened or closed since the last tick, for their
 * sounds ({@link TrainSounds}). The open doors come as a mask over the
 * wagon type's door list (bit {@code i} = door {@code i}), so after a pack
 * reload that hands the wagon a type whose list is ordered otherwise (D1)
 * the same bits mean other doors. The server re-indexes the mask by door id
 * ({@code WagonTypes.openDoorsAfter}), but the new mask and the new type
 * reach the client apart: the type with the snapshot, the mask with the
 * entity data a tick later — or the other way round when a snapshot was
 * decoded before the types sync was applied. Compared bit by bit, each half
 * would sound doors nobody moved.
 *
 * <p>So a change of the wagon's type instance, or of the type registry's
 * generation, starts a short settling time in which the mask is taken as it
 * comes and nothing sounds. A door that really moves in that half second
 * goes unheard: rare, and harmless. The state first seen is no event either.
 *
 * <p>Plain Java, unit-tested.
 */
final class DoorChanges {

    /** Ticks after a type change in which a change of the mask is the reload's, not a door's. */
    static final int SETTLE_TICKS = 10;

    private boolean seen;
    private WagonType type;
    private int generation;
    private int mask;
    private int settling;

    /**
     * The doors that opened or closed since the last call, bit {@code i} =
     * door {@code i} of {@code type}; 0 if none, or none to sound.
     *
     * @param type       the wagon's type this tick (compared by instance)
     * @param generation the type registry's generation this tick
     * @param mask       the wagon's open doors this tick
     */
    int update(WagonType type, int generation, int mask) {
        if (!seen) {
            seen = true;
            this.type = type;
            this.generation = generation;
            this.mask = mask;
            return 0;
        }
        if (type != this.type || generation != this.generation) {
            this.type = type;
            this.generation = generation;
            settling = SETTLE_TICKS;
        }
        int changed = mask ^ this.mask;
        this.mask = mask;
        if (settling > 0) {
            settling--;
            return 0;
        }
        return changed;
    }
}
