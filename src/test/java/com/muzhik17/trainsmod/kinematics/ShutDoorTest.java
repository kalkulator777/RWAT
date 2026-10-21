package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.stock.WagonType;

/**
 * A shut door between zones is wall even where the zones on its two sides
 * touch or overlap in its doorway (SPEC §9.1, §9.8; audit M21): since
 * touching zones are one floor, the platzkart's compartment door
 * ({@code DoorKupe}) was walked through shut. Walking, the cab's extent
 * ({@link CabArea}) and the check ({@link FloorCheck}) all read it so.
 */
class ShutDoorTest {

    private static final double FLOOR = 1.81;
    private static final double R = RiderWalk.PLAYER_HALF_WIDTH;
    /** Looking along the car's +X. */
    private static final float PLUS_X = -90.0f;

    private static WagonType.Interior.Zone zone(double minX, double minZ, double maxX, double maxZ) {
        return new WagonType.Interior.Zone(minX, FLOOR, minZ, maxX, 4.31, maxZ);
    }

    private static WagonType.Door inner(String id, double minX, double minZ, double maxX, double maxZ) {
        return new WagonType.Door(id, minX, FLOOR, minZ, maxX, 3.9, maxZ, true, false);
    }

    private static Vector3d walk(Vector3d from, WagonType.Interior floor, List<WagonType.Door> doors,
            int openMask, float yaw, int ticks) {
        Vector3d pos = new Vector3d(from);
        for (int i = 0; i < ticks; i++) {
            pos = RiderWalk.step(pos, 1.0, 0.0, yaw, 0.0f, floor, doors, openMask);
        }
        return pos;
    }

    private static WagonType type(WagonType.Interior floor, List<WagonType.Door> doors,
            List<WagonType.Seat> seats) {
        return new WagonType("test:car", 25.0, new double[]{8.5, -8.5}, 50.0, 120.0,
                new WagonType.Resistance(1.0, 1.0, 1.0), null, seats == null ? null : new WagonType.Cab(seats),
                new WagonType.Brakes(100.0, 0.0, 0.0, 0.0, 0.0), floor, doors);
    }

    /** The platzkart's conductor's compartment and the aisle past it, as amendorf.json had them. */
    private static final WagonType.Interior PLATZKART = new WagonType.Interior(List.of(
            zone(0.35, -10.78, 1.0, 9.25),     // the aisle
            zone(-0.65, 6.78, 0.375, 7.55)));  // the compartment: 0.025 into the aisle
    private static final List<WagonType.Door> KUPE = List.of(inner("DoorKupe", 0.375, 6.875, 0.5, 7.5));

    @Test
    void shutCompartmentDoor_overlappingZones_isWall_openItLeadsIntoTheAisle() {
        Vector3d inCompartment = new Vector3d(-0.2, FLOOR, 7.15);
        Vector3d shut = walk(inCompartment, PLATZKART, KUPE, 0, PLUS_X, 40);
        assertTrue(shut.x <= 0.375 + 1.0e-9, "stopped at the shut leaf, x = " + shut.x);
        Vector3d open = walk(inCompartment, PLATZKART, KUPE, 1, PLUS_X, 40);
        assertTrue(open.x >= 1.0 - R - 0.05, "through the open door into the aisle, x = " + open.x);
        // and back from the aisle: the shut door is wall from that side too
        Vector3d back = walk(new Vector3d(0.675, FLOOR, 7.15), PLATZKART, KUPE, 0, -PLUS_X, 40);
        assertTrue(back.x >= 0.5 - 1.0e-9, "stopped at the shut leaf, x = " + back.x);
    }

    @Test
    void theAisle_isWalkedPastTheShutDoor() {
        // the aisle runs 0.125 into the leaf's wall: the shut door doesn't close it
        Vector3d end = walk(new Vector3d(0.675, FLOOR, 4.0), PLATZKART, KUPE, 0, 0.0f, 50);
        assertEquals(9.25 - R, end.z, 1.0e-6, "walked the aisle past the compartment");
        assertEquals(0.675, end.x, 1.0e-6);
    }

    @Test
    void shutDoorBetweenZonesThatOnlyTouch_isWall() {
        // two rooms meeting at x 0 through a doorway zone; the door, thinner than a step, in it
        WagonType.Interior floor = new WagonType.Interior(List.of(
                zone(-3.0, 0.0, -0.4, 3.0), zone(-0.4, 1.0, 0.4, 2.0), zone(0.4, 0.0, 3.0, 3.0)));
        List<WagonType.Door> doors = List.of(inner("door", -0.02, 1.0, 0.02, 2.0));
        Vector3d from = new Vector3d(-1.5, FLOOR, 1.5);
        Vector3d shut = walk(from, floor, doors, 0, PLUS_X, 60);
        assertTrue(shut.x <= -0.02 + 1.0e-9, "no step through the shut door, x = " + shut.x);
        Vector3d open = walk(from, floor, doors, 1, PLUS_X, 60);
        assertEquals(3.0 - R, open.x, 1.0e-6);
        // nor a sidestep round its edge: walking askew along the shut leaf
        Vector3d askew = walk(new Vector3d(-0.1, FLOOR, 1.5), floor, doors, 0, -60.0f, 60);
        assertTrue(askew.x <= -0.02 + 1.0e-9, "slid along the shut leaf, x = " + askew.x);
    }

    @Test
    void aDoorShutOnARiderInItsDoorway_putsThemOnOneSide() {
        Vector3d inDoorway = new Vector3d(0.43, FLOOR, 7.15);
        Vector3d next = RiderWalk.step(inDoorway, 0.0, 0.0, 0.0f, 0.0f, PLATZKART, KUPE, 0);
        assertTrue(next.x <= 0.375 + 1.0e-9 || next.x >= 0.5 - 1.0e-9, "out of the leaf, x = " + next.x);
    }

    @Test
    void theCabEndsAtItsShutDoor_whereItsFloorTouchesTheSaloon() {
        // an EMU head: the saloon to z 4.9, the cab from 5.1, a doorway zone through the partition
        WagonType head = type(new WagonType.Interior(List.of(
                        zone(-1.3, -9.5, 1.3, 4.9), zone(-0.5, 4.8, 0.5, 5.2), zone(-1.3, 5.1, 1.3, 8.0))),
                List.of(inner("CabD", -0.4, 4.9, 0.4, 5.1)),
                List.of(new WagonType.Seat(-0.6, FLOOR + 0.55, 7.0, 0.0F)));
        CabArea area = CabArea.of(head);
        assertEquals(0, area.cabAt(0.0, 6.5), "the cab");
        assertEquals(-1, area.cabAt(0.0, 0.0), "the saloon is no cab");
        assertTrue(area.cabDoor(0), "the partition door wants the key");
    }

    @Test
    void check_reportsTheFloorRunningThroughAShutDoor_notOnceTheZonesPart() {
        List<String> problems = FloorCheck.problems(type(PLATZKART, KUPE, null));
        assertEquals(1, problems.size(), problems.toString());
        assertTrue(problems.get(0).contains("DoorKupe") && problems.get(0).contains("runs through"),
                problems.get(0));
        // the compartment ending short of the aisle: the zones part, the door joins them
        WagonType.Interior parted = new WagonType.Interior(List.of(
                zone(0.35, -10.78, 1.0, 9.25), zone(-0.65, 6.78, 0.34, 7.55)));
        assertTrue(FloorCheck.problems(type(parted, KUPE, null)).isEmpty(),
                FloorCheck.problems(type(parted, KUPE, null)).toString());
    }

    @Test
    void check_reportsADoorTheFloorRunsRound() {
        // a partition door with the rooms meeting beside it, all across the car
        WagonType.Interior floor = new WagonType.Interior(List.of(
                zone(-1.3, 0.0, 1.3, 5.0), zone(-1.3, 5.0, 1.3, 9.0)));
        List<String> problems = FloorCheck.problems(type(floor, List.of(inner("door", -0.4, 4.95, 0.4, 5.05)),
                null));
        assertTrue(problems.stream().anyMatch(p -> p.contains("'door'") && p.contains("one floor without it")),
                problems.toString());
    }
}
