package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.path.BedClearing.Occupant;

/**
 * Clearing the way for the track bed (SPEC §2.2): what a build breaks, and
 * when it is refused before anything changes.
 */
class BedClearingTest {

    private static BedRaster.Cell cell(int x, int y) {
        return new BedRaster.Cell(x, y, 0);
    }

    /** A little world: cells → what they hold (EMPTY where unset). */
    private static final class World {
        final Map<BedRaster.Cell, Occupant> blocks = new HashMap<>();
        final Set<BedRaster.Cell> protectedCells = new LinkedHashSet<>();
        /** Cells asked whether they may be broken, in order. */
        final List<BedRaster.Cell> asked = new ArrayList<>();
        /** Cells asked whether a block may be placed there, in order. */
        final List<BedRaster.Cell> askedToPlace = new ArrayList<>();

        World with(BedRaster.Cell cell, Occupant what) {
            blocks.put(cell, what);
            return this;
        }

        BedClearing.Plan plan(Set<BedRaster.Cell> bed, Set<BedRaster.Cell> headroom) {
            return plan(bed, headroom, cells(), cells());
        }

        BedClearing.Plan plan(Set<BedRaster.Cell> bed, Set<BedRaster.Cell> headroom,
                Set<BedRaster.Cell> lifted, Set<BedRaster.Cell> laid) {
            return BedClearing.plan(bed, headroom,
                    c -> blocks.getOrDefault(c, Occupant.EMPTY),
                    new BedClearing.Changes(lifted, laid),
                    c -> {
                        asked.add(c);
                        return !protectedCells.contains(c);
                    },
                    c -> {
                        askedToPlace.add(c);
                        return !protectedCells.contains(c);
                    });
        }
    }

    private static Set<BedRaster.Cell> cells(BedRaster.Cell... cells) {
        return new LinkedHashSet<>(List.of(cells));
    }

    @Test
    void solidBlocksInTheBedAndItsHeadroomAreBrokenTheRestIsLeftToTheBed() {
        World world = new World()
                .with(cell(0, 64), Occupant.SOLID)      // a hill: stone where the bed goes
                .with(cell(1, 64), Occupant.SOFT)       // grass: the bed takes its place
                .with(cell(2, 64), Occupant.FLUID)      // water: the bed takes its place
                .with(cell(3, 64), Occupant.BED)        // another track's bed: re-laid
                .with(cell(0, 65), Occupant.SOLID)      // the rail heads reach into stone above
                .with(cell(1, 65), Occupant.SOFT)       // a flower above the bed: removed
                .with(cell(2, 65), Occupant.FLUID)      // water above stays (rails under water)
                .with(cell(3, 65), Occupant.BED);       // bed above (a track over this one): kept

        BedClearing.Plan plan = world.plan(
                cells(cell(0, 64), cell(1, 64), cell(2, 64), cell(3, 64), cell(4, 64)),
                cells(cell(0, 65), cell(1, 65), cell(2, 65), cell(3, 65), cell(4, 65)));

        assertFalse(plan.refused());
        assertEquals(List.of(cell(0, 64), cell(0, 65), cell(1, 65)), plan.removed());
        assertEquals(plan.removed(), world.asked, "protection is asked for exactly the cells broken");
    }

    @Test
    void aCellBothBedAndHeadroomIsBed() {
        World world = new World().with(cell(0, 65), Occupant.SOFT);
        BedClearing.Plan plan = world.plan(cells(cell(0, 65)), cells(cell(0, 65)));
        assertTrue(plan.removed().isEmpty(), "grass where the bed goes is simply replaced");
    }

    @Test
    void unbreakableBlocksAndContainersRefuseBeforeProtectionIsAsked() {
        for (Occupant hard : new Occupant[] {Occupant.UNBREAKABLE, Occupant.CONTAINER}) {
            for (boolean inHeadroom : new boolean[] {false, true}) {
                BedRaster.Cell obstacle = inHeadroom ? cell(1, 65) : cell(1, 64);
                World world = new World()
                        .with(cell(0, 64), Occupant.SOLID)
                        .with(obstacle, hard)
                        .with(cell(2, 64), hard); // a second one further on: the first is reported
                BedClearing.Plan plan = world.plan(cells(cell(0, 64), cell(1, 64), cell(2, 64)),
                        cells(cell(1, 65)));

                assertTrue(plan.refused(), hard + (inHeadroom ? " above the bed" : " in the bed"));
                BedRaster.Cell expected = inHeadroom ? cell(2, 64) : cell(1, 64);
                assertEquals(expected, plan.blocked().cell(), "the first in the bed's order");
                assertEquals(hard == Occupant.UNBREAKABLE ? BedClearing.Reason.UNBREAKABLE
                        : BedClearing.Reason.CONTAINER, plan.blocked().reason());
                assertTrue(plan.removed().isEmpty(), "nothing is broken");
                assertTrue(world.asked.isEmpty(), "no break events for a refused build");
            }
        }
    }

    @Test
    void aBlockThePlayerMayNotBreakRefusesTheWholeBuild() {
        World world = new World()
                .with(cell(0, 64), Occupant.SOLID)
                .with(cell(1, 64), Occupant.SOLID)
                .with(cell(2, 64), Occupant.SOLID);
        world.protectedCells.add(cell(1, 64));

        BedClearing.Plan plan = world.plan(cells(cell(0, 64), cell(1, 64), cell(2, 64)), cells());

        assertTrue(plan.refused());
        assertEquals(new BedClearing.Blocked(cell(1, 64), BedClearing.Reason.PROTECTED), plan.blocked());
        assertTrue(plan.removed().isEmpty(), "not even the blocks before it");
        assertEquals(List.of(cell(0, 64), cell(1, 64)), world.asked, "asked in order, up to the refusal");
    }

    @Test
    void theLoadingGaugeIsClearedByTheSameRulesAndRefusesTheSame() {
        // a tunnel through a wooded hillside by a pond: stone and a tree go, the pond stays, a chest refuses
        World world = new World()
                .with(cell(0, 65), Occupant.SOLID)   // stone over the bed
                .with(cell(0, 66), Occupant.SOLID)   // a log
                .with(cell(0, 67), Occupant.SOLID)   // leaves (not replaceable)
                .with(cell(0, 68), Occupant.SOFT)    // a vine
                .with(cell(1, 65), Occupant.FLUID);  // the pond's edge: water stays, as a pickaxe leaves it
        Set<BedRaster.Cell> gauge = cells(cell(0, 65), cell(0, 66), cell(0, 67), cell(0, 68), cell(1, 65));

        BedClearing.Plan plan = world.plan(cells(cell(0, 64)), gauge);
        assertFalse(plan.refused());
        assertEquals(List.of(cell(0, 65), cell(0, 66), cell(0, 67), cell(0, 68)), plan.removed());

        world.with(cell(0, 69), Occupant.CONTAINER); // a chest in a cellar the tunnel runs into
        gauge.add(cell(0, 69));
        plan = world.plan(cells(cell(0, 64)), gauge);
        assertEquals(new BedClearing.Blocked(cell(0, 69), BedClearing.Reason.CONTAINER), plan.blocked(),
                "refused, not skipped: nothing is left standing inside the gauge unannounced");
    }

    @Test
    void bedLaidIntoAProtectedCellRefusesTheWholeBuildThoughNothingThereIsBroken() {
        // a track across someone's land: air and grass, nothing to break — the bed alone is the edit
        World world = new World()
                .with(cell(0, 64), Occupant.SOLID)  // a hill before it: would be broken
                .with(cell(2, 64), Occupant.SOFT);
        world.protectedCells.add(cell(2, 64));
        Set<BedRaster.Cell> bed = cells(cell(0, 64), cell(1, 64), cell(2, 64), cell(3, 64));

        BedClearing.Plan plan = world.plan(bed, cells(), cells(), bed);

        assertEquals(new BedClearing.Blocked(cell(2, 64), BedClearing.Reason.PROTECTED_BED), plan.blocked());
        assertTrue(plan.removed().isEmpty(), "not even the hill before it is broken");
        assertEquals(List.of(cell(0, 64)), world.asked, "the obstacle is asked to break");
        assertEquals(List.of(cell(1, 64), cell(2, 64)), world.askedToPlace,
                "the rest is asked to place, in order, up to the refusal");
    }

    @Test
    void bedTakenOutOfAProtectedCellRefusesTheWholeEdit() {
        // a demolition: the structure's bed reaches into someone's land at its far end
        World world = new World();
        world.protectedCells.add(cell(3, 64));
        BedClearing.Plan plan = world.plan(cells(), cells(),
                cells(cell(0, 64), cell(1, 64), cell(2, 64), cell(3, 64)), cells());

        assertEquals(new BedClearing.Blocked(cell(3, 64), BedClearing.Reason.PROTECTED_BED), plan.blocked());
        assertEquals(List.of(cell(0, 64), cell(1, 64), cell(2, 64), cell(3, 64)), world.asked);
        assertTrue(world.askedToPlace.isEmpty());
    }

    @Test
    void everyChangedCellIsAskedOnceAndOnlyWhenNothingRefusesOutright() {
        World world = new World()
                .with(cell(0, 64), Occupant.SOLID)   // broken, then the bed goes in
                .with(cell(1, 64), Occupant.BED);    // the structure's own bed, re-laid
        Set<BedRaster.Cell> bed = cells(cell(0, 64), cell(1, 64), cell(2, 64));

        BedClearing.Plan plan = world.plan(bed, cells(), cells(cell(1, 64)), bed);
        assertFalse(plan.refused());
        assertEquals(List.of(cell(0, 64), cell(1, 64)), world.asked,
                "the obstacle, then the bed taken out (or touched)");
        assertEquals(List.of(cell(2, 64)), world.askedToPlace,
                "only where bed merely comes in: a cell that may be broken is the player's to change");

        World walled = new World()
                .with(cell(0, 64), Occupant.UNBREAKABLE);
        BedClearing.Plan refused = walled.plan(bed, cells(), cells(cell(1, 64)), bed);
        assertEquals(BedClearing.Reason.UNBREAKABLE, refused.blocked().reason());
        assertTrue(walled.asked.isEmpty() && walled.askedToPlace.isEmpty(),
                "no events at all for a build bedrock refuses");
    }

    @Test
    void anEmptyWayNeedsNothing() {
        World world = new World();
        BedClearing.Plan plan = world.plan(cells(cell(0, 64)), cells(cell(0, 65)));
        assertFalse(plan.refused());
        assertTrue(plan.removed().isEmpty());
        assertTrue(world.asked.isEmpty());
    }
}
