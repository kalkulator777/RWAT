package com.muzhik17.trainsmod.path;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
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
 * <p>The bed itself is the player's edit too ({@link Changes}): every cell it
 * goes into or changes in needs the right to place there, every cell it
 * comes out of — and, for a demolition or a repaint, every cell of the
 * structure's own bed — the right to break there. One cell the player may
 * not change refuses the whole edit, wherever along the track it is.
 *
 * <p>Pure: the world is asked through {@link Occupant} and the may-break and
 * may-place predicates, so the rules are unit-tested without one.
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
        UNBREAKABLE, CONTAINER,
        /** An obstacle in the way the player may not break there. */
        PROTECTED,
        /** Bed the player may not lay, change or take out there. */
        PROTECTED_BED
    }

    /** The cell that refused the build, and why. */
    public record Blocked(BedRaster.Cell cell, Reason reason) {
    }

    /**
     * The bed cells an edit changes, besides what it clears: {@code lifted} —
     * bed taken out, and for a demolition or a repaint every cell of the
     * structure's own bed (touching a structure at all needs the right to
     * break wherever it lies); {@code laid} — cells the bed goes into or
     * changes in.
     */
    public record Changes(Collection<BedRaster.Cell> lifted, Collection<BedRaster.Cell> laid) {
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
     * build clears it (a cell in both counts as bed) — and check the bed's own
     * {@code changes}. Unbreakable blocks and containers refuse the build
     * before anyone is asked whether a cell may be changed. Then every cell
     * the edit changes is asked once, in order: {@code mayBreak} for each cell
     * to be emptied and then for each {@linkplain Changes#lifted lifted} one,
     * {@code mayPlace} for each cell the bed is {@linkplain Changes#laid laid}
     * in that wasn't asked to break already (a cell the right to break was
     * asked for is the player's to change). The first denial refuses the
     * build as protected — {@link Reason#PROTECTED} for an obstacle,
     * {@link Reason#PROTECTED_BED} for the bed.
     *
     * @param occupant what each cell holds now
     * @param mayBreak whether the builder may break that cell (protection)
     * @param mayPlace whether the builder may place a block in that cell (protection)
     */
    public static Plan plan(Collection<BedRaster.Cell> bed, Collection<BedRaster.Cell> above,
            Function<BedRaster.Cell, Occupant> occupant, Changes changes,
            Predicate<BedRaster.Cell> mayBreak, Predicate<BedRaster.Cell> mayPlace) {
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
        Set<BedRaster.Cell> asked = new HashSet<>();
        for (BedRaster.Cell cell : removed) {
            asked.add(cell);
            if (!mayBreak.test(cell)) {
                return new Plan(List.of(), new Blocked(cell, Reason.PROTECTED));
            }
        }
        for (BedRaster.Cell cell : changes.lifted()) {
            if (asked.add(cell) && !mayBreak.test(cell)) {
                return new Plan(List.of(), new Blocked(cell, Reason.PROTECTED_BED));
            }
        }
        for (BedRaster.Cell cell : changes.laid()) {
            if (asked.add(cell) && !mayPlace.test(cell)) {
                return new Plan(List.of(), new Blocked(cell, Reason.PROTECTED_BED));
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
