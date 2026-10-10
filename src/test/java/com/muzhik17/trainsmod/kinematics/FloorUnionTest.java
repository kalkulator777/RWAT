package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Walking a floor that is the union of its zones (SPEC §9.8): zones that
 * touch are one floor, the way out through a door is where the floor ends,
 * and {@link FloorCheck} reads the floor the same way.
 */
class FloorUnionTest {

    private static final double FLOOR = 1.81;
    private static final double R = RiderWalk.PLAYER_HALF_WIDTH;

    private static WagonType.Interior.Zone zone(double minX, double minZ, double maxX, double maxZ) {
        return new WagonType.Interior.Zone(minX, FLOOR, minZ, maxX, 4.31, maxZ);
    }

    /** The platzkart's front gangway door (model space). */
    private static final WagonType.Door TRAP1 =
            new WagonType.Door("Trap1", -0.438, 1.936, 11.75, 0.438, 3.874, 12.044, false, false, true);

    private static Vector3d walk(Vector3d from, WagonType.Interior floor, List<WagonType.Door> doors,
            float yaw, int ticks) {
        Vector3d pos = new Vector3d(from);
        for (int i = 0; i < ticks; i++) {
            pos = RiderWalk.step(pos, 1.0, 0.0, yaw, 0.0f, floor, doors, 0);
        }
        return pos;
    }

    private static WagonType type(WagonType.Interior floor, List<WagonType.Door> doors) {
        return new WagonType("test:car", 25.0, new double[]{8.5, -8.5}, 50.0, 120.0,
                new WagonType.Resistance(1.0, 1.0, 1.0), null, null,
                new WagonType.Brakes(100.0, 0.0, 0.0, 0.0, 0.0), floor, doors);
    }

    @Test
    void zonesThatOnlyTouch_areWalkedAcross() {
        // a corridor up to a cross passage at z 9, no overlap: before §9.8 a wall
        WagonType.Interior floor = new WagonType.Interior(List.of(
                zone(0.0, 0.0, 1.0, 9.0), zone(0.0, 9.0, 10.0, 10.0)));
        Vector3d up = walk(new Vector3d(0.5, FLOOR, 2.0), floor, List.of(), 0.0f, 100);
        assertEquals(10.0 - R, up.z, 1.0e-6);
        // and turning into the passage (look −X... yaw −90 looks +X)
        Vector3d along = walk(up, floor, List.of(), -90.0f, 100);
        assertEquals(10.0 - R, along.x, 1.0e-6);
        assertTrue(FloorCheck.problems(type(floor, List.of())).isEmpty(),
                FloorCheck.problems(type(floor, List.of())).toString());
    }

    @Test
    void theAisleAlongTheBays_isWalkedAtAnEvenPace() {
        // the platzkart's aisle (0.65 wide) with bays opening off it: walking
        // it a little askew (yaw 5°, pushing into the bay side) slides along —
        // never pulled ahead into a bay's opening faster than walking (play-test)
        WagonType.Interior floor = new WagonType.Interior(List.of(
                zone(0.35, -10.78, 1.0, 9.25),
                zone(-0.7, -9.069, 1.0, -8.369), zone(-0.7, -7.318, 1.0, -6.618),
                zone(-0.7, -5.569, 1.0, -4.869), zone(-0.7, -3.819, 1.0, -3.119)));
        Vector3d pos = new Vector3d(0.675, FLOOR, -10.0);
        double forward = RiderWalk.WALK_SPEED * Math.cos(Math.toRadians(5.0));
        for (int i = 0; i < 100; i++) {
            Vector3d next = RiderWalk.step(pos, 1.0, 0.0, 5.0f, 0.0f, floor, List.of(), 0);
            double dz = next.z - pos.z;
            assertTrue(dz <= RiderWalk.WALK_SPEED + 0.01, "tick " + i + " jumped " + dz + " at z " + pos.z);
            assertTrue(dz >= forward - 1.0e-6, "tick " + i + " slowed to " + dz + " at z " + pos.z);
            pos = next;
        }
    }

    @Test
    void fromTheVestibule_downTheSlantedAisle_aLittleAskew() {
        // the platzkart's front vestibule and the slanted aisle's steps behind
        // it (amendorf.json); walking back (−Z) a hair to +X, as from the
        // gangway: the step off the vestibule eases onto the aisle — before
        // the slack it stopped at the vestibule's edge, z 11.2 (play-test)
        WagonType.Interior floor = new WagonType.Interior(List.of(
                zone(-0.65, 6.78, 0.375, 7.55), zone(0.1, 8.45, 1.0, 9.7),
                zone(-0.12, 8.95, 0.78, 10.35), zone(-0.28, 9.6, 0.55, 11.75),
                zone(-1.45, 10.9, 1.45, 11.75), zone(0.35, -10.78, 1.0, 9.25)));
        Vector3d end = walk(new Vector3d(-0.04, FLOOR, 11.40), floor, List.of(), 181.0f, 40);
        assertTrue(end.z < 8.0, "walked down the aisle, z = " + end.z);
    }

    @Test
    void aGapBetweenZones_isAWall_andTheCheckSaysSo() {
        WagonType.Interior floor = new WagonType.Interior(List.of(
                zone(-1.0, 0.0, 1.0, 5.0), zone(-1.0, 5.05, 1.0, 10.0)));
        Vector3d end = walk(new Vector3d(0.0, FLOOR, 2.0), floor, List.of(), 0.0f, 100);
        assertEquals(5.0 - R, end.z, 1.0e-6);
        List<String> problems = FloorCheck.problems(type(floor, List.of()));
        assertEquals(1, problems.size(), problems.toString());
        assertTrue(problems.get(0).contains("[1]"), problems.get(0));
    }

    @Test
    void gangway_leadsOutWhereTheFloorEnds_notWhereAZoneDoes() {
        // the platzkart's slanted aisle by the front vestibule: an aisle zone
        // ending 0.35 short of the end wall, overlapping the vestibule. Before
        // §9.8 its face counted as the door's wall — the gangway took the
        // rider out of the aisle, a third of a block from the door
        WagonType.Interior floor = new WagonType.Interior(List.of(
                zone(-0.65, 9.5, 0.125, 11.4),     // aisle
                zone(-1.45, 10.87, 1.45, 11.75))); // vestibule
        List<WagonType.Door> doors = List.of(TRAP1);
        Vector3d inAisle = new Vector3d(-0.2, FLOOR, 11.1 - 0.01);
        assertEquals(-1, RiderWalk.exitDoor(inAisle, 1.0, 0.0, 0.0f, 0.0f, floor, doors, 1));
        Vector3d atDoor = new Vector3d(-0.2, FLOOR, 11.45 - 0.01);
        assertEquals(0, RiderWalk.exitDoor(atDoor, 1.0, 0.0, 0.0f, 0.0f, floor, doors, 1));
        assertTrue(FloorCheck.problems(type(floor, doors)).isEmpty(),
                FloorCheck.problems(type(floor, doors)).toString());
    }

    @Test
    void aDoorTheFloorDoesntEndAt_isReported() {
        // the floor stops a block short of the gangway door
        WagonType.Interior floor = new WagonType.Interior(List.of(zone(-1.45, -11.75, 1.45, 10.75)));
        List<String> problems = FloorCheck.problems(type(floor, List.of(TRAP1)));
        assertEquals(1, problems.size(), problems.toString());
        assertTrue(problems.get(0).contains("Trap1"), problems.get(0));
    }

    @Test
    void aNarrowZone_isFineJoined_andReportedAlone() {
        // a 0.4 strip along a wide floor widens it; on its own nobody fits in it
        WagonType.Interior joined = new WagonType.Interior(List.of(
                zone(-1.0, 0.0, 1.0, 5.0), zone(1.0, 0.0, 1.4, 5.0)));
        assertTrue(FloorCheck.problems(type(joined, List.of())).isEmpty());
        assertEquals(1.4 - R, joined.region(R).reach(0.0, 2.0, 0, 1), 1.0e-9);
        WagonType.Interior alone = new WagonType.Interior(List.of(
                zone(-1.0, 0.0, 1.0, 5.0), zone(1.2, 0.0, 1.6, 5.0)));
        List<String> problems = FloorCheck.problems(type(alone, List.of()));
        assertEquals(1, problems.size(), problems.toString());
        assertTrue(problems.get(0).startsWith("zone 1 holds no place"), problems.get(0));
    }
}
