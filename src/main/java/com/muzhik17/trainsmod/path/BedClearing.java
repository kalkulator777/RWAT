package com.muzhik17.trainsmod.path;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * Clearing the way for a track bed (SPEC §2.2): which blocks a build breaks,
 * and when it is refused instead. The bed goes under every piece of the rail
 * model ({@link BedRaster}); whatever stands in a bed cell is broken — like a
 * pickaxe would, but without drops in any game mode (a free drill, by the
 * user's decision) — and so is whatever stands in the {@linkplain
 * BedRaster.Raster#headroom headroom} above the bed, where the rail heads
 * reach, and — when a build clears it — in the {@linkplain BedRaster#gauge
 * loading gauge} over the track: above the bed both follow the same rules.
 * Blocks that can't be broken (hardness below zero — bedrock,
 * barriers) or that hold contents (a block entity — chests, furnaces, signs)
 * refuse the whole build, as does a block the player may not break there
 * (region protection, spawn protection). The refusal comes before anything
 * changes.
 *
 * <p>Pure: the world is asked through {@link Occupant} and a may-break
 * predicate, so the rules are unit-tested without one.
 */
public final class BedClearing {

    /** What a cell the track needs holds, as far as clearing it goes. */
    public enum Occupant {
        /** Air: nothing to do. */
        EMPTY,
        /** Track bed (of this track or another): re-laid by the bed, never broken. */
        BED,
        /** A fluid: the bed takes its place; above the bed it stays (rails under water). */
        FLUID,
        /** Replaceable (grass, flowers, snow): the bed takes its place; above the bed it is removed. */
        SOFT,
        /** An ordinary block: broken, no drops. */
        SOLID,
        /** Can't be broken (hardness below zero): the build is refused. */
        UNBREAKABLE,
        /** Holds contents (a block entity): the build is refused. */
        CONTAINER
    }

    /** Why a build was refused. */
    public enum Reason {
        UNBREAKABLE, CONTAINER, PROTECTED
    }

    /** The cell that refused the build, and why. */
    public record Blocked(BedRaster.Cell cell, Reason reason) {
    }

    /**
     * What clearing the way does: {@code removed} — the cells emptied before
     * the bed goes down (obstacles in the bed and above it, plants above
     * it), in the order given; or {@code blocked}, the first cell
     * that refuses the build (then nothing is to be removed).
     */
    public record Plan(List<BedRaster.Cell> removed, Blocked blocked) {

        public boolean refused() {
            return blocked != null;
        }
    }

    private BedClearing() {
    }

    /**
     * Plan clearing the way for {@code bed} cells and the cells {@code above}
     * them that must be clear — the headroom, and the loading gauge when a
     * build clears it (a cell in both counts as bed). Unbreakable blocks and containers refuse
     * the build before anyone is asked whether a block may be broken; then
     * {@code mayBreak} is asked for each cell to be emptied, in order, and the
     * first it denies refuses the build as protected.
     *
     * @param occupant what each cell holds now
     * @param mayBreak whether the builder may break that cell (protection)
     */
    public static Plan plan(Collection<BedRaster.Cell> bed, Collection<BedRaster.Cell> above,
            Function<BedRaster.Cell, Occupant> occupant, Predicate<BedRaster.Cell> mayBreak) {
        List<BedRaster.Cell> removed = new ArrayList<>();
        for (BedRaster.Cell cell : bed) {
            Occupant what = occupant.apply(cell);
            Reason refusal = refusal(what);
            if (refusal != null) {
                return new Plan(List.of(), new Blocked(cell, refusal));
            }
            if (what == Occupant.SOLID) {
                removed.add(cell);
            }
        }
        for (BedRaster.Cell cell : above) {
            if (bed.contains(cell)) {
                continue;
            }
            Occupant what = occupant.apply(cell);
            Reason refusal = refusal(what);
            if (refusal != null) {
                return new Plan(List.of(), new Blocked(cell, refusal));
            }
            if (what == Occupant.SOLID || what == Occupant.SOFT) {
                removed.add(cell);
            }
        }
        for (BedRaster.Cell cell : removed) {
            if (!mayBreak.test(cell)) {
                return new Plan(List.of(), new Blocked(cell, Reason.PROTECTED));
            }
        }
        return new Plan(List.copyOf(removed), null);
    }

    private static Reason refusal(Occupant what) {
        return switch (what) {
            case UNBREAKABLE -> Reason.UNBREAKABLE;
            case CONTAINER -> Reason.CONTAINER;
            default -> null;
        };
    }
}
