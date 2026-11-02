package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Doors (SPEC v1.5, IR-style), the pure half: an open doorway lets a body
 * through its own hull wall — not the opposite one — a closed one is wall; a
 * rider walks out through an open door and leans on a closed one; the
 * crosshair ray finds the leaf.
 * Geometry is the platzkart's: hull x∈[−1.7,1.7], door 1 on the +X side at
 * z∈[10.87,11.69], floor 1.81, top 3.81.
 */
class DoorPassageTest {

    private static final Vector3d MIN = new Vector3d(-1.7, 0.4, -12.6);
    private static final Vector3d MAX = new Vector3d(1.7, 4.7, 12.6);
    private static final double HX = 0.3, HY = 0.9, HZ = 0.3;
    private static final double EPS = 1.0e-6;

    private static final WagonType.Door DOOR1 =
            new WagonType.Door("door1", 1.47, 1.81, 10.87, 1.56, 3.81, 11.69);
    private static final WagonType.Door DOOR3 =
            new WagonType.Door("door3", -1.56, 1.81, -11.69, -1.47, 3.81, -10.87);
    private static final WagonType.Hull HULL = new WagonType.Hull(MIN.x, MIN.y, MIN.z, MAX.x, MAX.y, MAX.z);
    /** door1's opening, as WagonEntity.openPortals builds it. */
    private static final HullCollision.Portal PORTAL1 = HullCollision.Portal.of(DOOR1, HULL);
    /** A door in the front end wall (a Z wall), x∈[−0.4,0.4]. */
    private static final WagonType.Door END_DOOR =
            new WagonType.Door("end", -0.4, 1.81, 12.45, 0.4, 3.81, 12.6);

    private static final WagonType.Interior INTERIOR =
            new WagonType.Interior(-1.35, 1.81, -11.75, 1.35, 4.55, 11.75);

    private static Vector3d origin() {
        return new Vector3d(0.0, 0.0, 0.0);
    }

    // --- the door record ---

    @Test
    void sideDoorFacesOutAlongX() {
        assertEquals(0, DOOR1.axis());
        assertEquals(1, DOOR1.outward());
        assertEquals(-1, DOOR3.outward());
        assertEquals(10.87, DOOR1.spanMin(), EPS);
        assertEquals(11.69, DOOR1.spanMax(), EPS);
    }

    @Test
    void flippedWagonMirrorsDoorsAcrossBothAxes() {
        WagonType.Door flipped = DOOR1.inFrame(true);
        assertEquals(-1, flipped.outward());
        assertEquals(-11.69, flipped.spanMin(), EPS);
        assertEquals(-10.87, flipped.spanMax(), EPS);
        assertSame(DOOR1, DOOR1.inFrame(false));
    }

    // --- the hull opening ---

    @Test
    void openDoorway_letsAGroundLevelPlayerWalkIn() {
        // standing on the ground (centre y 0.9) outside door 1, walking −X into it
        Vector3d center = new Vector3d(2.1, 0.9, 11.28);
        Vector3d move = new Vector3d(-0.3, 0.0, 0.0);
        Vector3d out = HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                center, HX, HY, HZ, move, List.of(PORTAL1));
        assertSame(move, out); // nothing in the way
    }

    @Test
    void closedDoor_isWall() {
        Vector3d center = new Vector3d(2.1, 0.9, 11.28);
        Vector3d move = new Vector3d(-0.3, 0.0, 0.0);
        Vector3d out = HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                center, HX, HY, HZ, move, List.of());
        assertEquals(-0.1, out.x, EPS); // box minX 1.8 stops at the 1.7 face
    }

    @Test
    void openDoorway_besideTheOpening_isStillWall() {
        // same approach a block down the side, clear of the door's span
        Vector3d center = new Vector3d(2.1, 0.9, 9.5);
        Vector3d move = new Vector3d(-0.3, 0.0, 0.0);
        Vector3d out = HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                center, HX, HY, HZ, move, List.of(PORTAL1));
        assertEquals(-0.1, out.x, EPS);
    }

    @Test
    void openDoorway_doesNotOpenTheRoof() {
        // above the door top: the portal doesn't reach up there
        Vector3d center = new Vector3d(2.1, 4.2, 11.28);
        Vector3d move = new Vector3d(-0.3, 0.0, 0.0);
        Vector3d out = HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                center, HX, HY, HZ, move, List.of(PORTAL1));
        assertEquals(-0.1, out.x, EPS);
    }

    @Test
    void portalAt_findsAPlayerStandingInTheDoorway() {
        assertSame(PORTAL1, HullCollision.portalAt(List.of(PORTAL1), origin(), 0.0f, 0.0f,
                new Vector3d(1.6, 0.9, 11.28)));
        assertNull(HullCollision.portalAt(List.of(PORTAL1), origin(), 0.0f, 0.0f,
                new Vector3d(1.6, 0.9, 5.0)));
    }

    // --- the door's own side only ---

    @Test
    void openDoorway_leavesTheOppositeWallSolid() {
        // door 1 (+X) open, a player outside the −X wall over the same span walking +X
        Vector3d center = new Vector3d(-2.1, 0.9, 11.28);
        Vector3d move = new Vector3d(0.3, 0.0, 0.0);
        Vector3d out = HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                center, HX, HY, HZ, move, List.of(PORTAL1));
        assertEquals(0.1, out.x, EPS); // box maxX −1.8 stops at the −1.7 face
    }

    @Test
    void portalAt_onlyOnTheDoorsSideAndNearItsWall() {
        // in the opposite doorway's place, and in the middle of the car, over door 1's span
        assertNull(HullCollision.portalAt(List.of(PORTAL1), origin(), 0.0f, 0.0f,
                new Vector3d(-1.6, 0.9, 11.28)));
        assertNull(HullCollision.portalAt(List.of(PORTAL1), origin(), 0.0f, 0.0f,
                new Vector3d(0.2, 0.9, 11.28)));
        // the step well: up to DEPTH in through the face still counts
        assertSame(PORTAL1, HullCollision.portalAt(List.of(PORTAL1), origin(), 0.0f, 0.0f,
                new Vector3d(1.7 - HullCollision.Portal.DEPTH + 0.05, 0.9, 11.28)));
    }

    @Test
    void portal_measuresFromItsWallFaceOutward() {
        assertEquals(1, PORTAL1.outward());
        assertEquals(0.4, PORTAL1.outside(2.1, 11.28), EPS);
        assertEquals(-0.1, PORTAL1.outside(1.6, 11.28), EPS);
        HullCollision.Portal portal3 = HullCollision.Portal.of(DOOR3, HULL);
        assertEquals(-1, portal3.outward());
        assertEquals(0.4, portal3.outside(-2.1, -11.28), EPS);
        assertEquals(-3.8, portal3.outside(2.1, -11.28), EPS);
    }

    @Test
    void flippedWagon_opensTheMirroredWall() {
        // door 1 on a car running turned round: the −X wall, at the rear
        HullCollision.Portal flipped = HullCollision.Portal.of(DOOR1.inFrame(true), HULL);
        Vector3d in = HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                new Vector3d(-2.1, 0.9, -11.28), HX, HY, HZ, new Vector3d(0.3, 0.0, 0.0),
                List.of(flipped));
        assertEquals(0.3, in.x, EPS);
        Vector3d wall = HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                new Vector3d(2.1, 0.9, -11.28), HX, HY, HZ, new Vector3d(-0.3, 0.0, 0.0),
                List.of(flipped));
        assertEquals(-0.1, wall.x, EPS);
    }

    @Test
    void endDoor_opensItsEndWallOnly() {
        HullCollision.Portal end = HullCollision.Portal.of(END_DOOR, HULL);
        assertEquals(2, end.axis());
        assertEquals(1, end.outward());
        // walking in through the front end, −Z
        Vector3d move = new Vector3d(0.0, 0.0, -0.3);
        assertSame(move, HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                new Vector3d(0.0, 0.9, 13.0), HX, HY, HZ, move, List.of(end)));
        // the rear end wall across the same x stays solid
        Vector3d rear = HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                new Vector3d(0.0, 0.9, -13.0), HX, HY, HZ, new Vector3d(0.0, 0.0, 0.3), List.of(end));
        assertEquals(0.1, rear.z, EPS); // box maxZ −12.7 stops at the −12.6 face
        // and a side wall is no end door's business
        Vector3d side = HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                new Vector3d(2.1, 0.9, 12.0), HX, HY, HZ, new Vector3d(-0.3, 0.0, 0.0), List.of(end));
        assertEquals(-0.1, side.x, EPS);
    }

    // --- walking out from inside ---

    /** yaw −90 looks along +X (vanilla: x' = −sin(yaw)). */
    private static final float FACING_PLUS_X = -90.0f;

    @Test
    void riderWalkingIntoAnOpenDoor_stepsOut() {
        Vector3d atWall = new Vector3d(INTERIOR.maxX() - RiderWalk.PLAYER_HALF_WIDTH, 1.81, 11.28);
        int door = RiderWalk.exitDoor(atWall, 1.0, 0.0, FACING_PLUS_X, 0.0f, INTERIOR,
                List.of(DOOR1, DOOR3), 0b01);
        assertEquals(0, door);
    }

    @Test
    void riderAgainstAClosedDoor_leansOnIt() {
        Vector3d atWall = new Vector3d(INTERIOR.maxX() - RiderWalk.PLAYER_HALF_WIDTH, 1.81, 11.28);
        assertEquals(-1, RiderWalk.exitDoor(atWall, 1.0, 0.0, FACING_PLUS_X, 0.0f, INTERIOR,
                List.of(DOOR1, DOOR3), 0b10)); // only door 3 open
        // and the walk step keeps them inside the wall
        Vector3d next = RiderWalk.step(atWall, 1.0, 0.0, FACING_PLUS_X, 0.0f, INTERIOR);
        assertEquals(INTERIOR.maxX() - RiderWalk.PLAYER_HALF_WIDTH, next.x, EPS);
    }

    @Test
    void riderPushingTheWallBesideAnOpenDoor_staysIn() {
        Vector3d atWall = new Vector3d(INTERIOR.maxX() - RiderWalk.PLAYER_HALF_WIDTH, 1.81, 9.0);
        assertEquals(-1, RiderWalk.exitDoor(atWall, 1.0, 0.0, FACING_PLUS_X, 0.0f, INTERIOR,
                List.of(DOOR1, DOOR3), 0b11));
    }

    @Test
    void riderWalkingAwayFromAnOpenDoor_staysIn() {
        Vector3d atWall = new Vector3d(INTERIOR.maxX() - RiderWalk.PLAYER_HALF_WIDTH, 1.81, 11.28);
        assertEquals(-1, RiderWalk.exitDoor(atWall, -1.0, 0.0, FACING_PLUS_X, 0.0f, INTERIOR,
                List.of(DOOR1, DOOR3), 0b11));
    }

    @Test
    void vestibuleDoorIsReachableFromInside() {
        // the interior reaches far enough into the vestibule that the rider's
        // centre can stand inside the door's span (minus the inset)
        Vector3d deep = INTERIOR.clampFeet(new Vector3d(1.0, 1.81, 20.0), RiderWalk.PLAYER_HALF_WIDTH);
        assertTrue(deep.z >= DOOR1.spanMin() + RiderWalk.DOOR_SPAN_INSET,
                "rider reaches z=" + deep.z);
    }

    // --- picking the leaf ---

    @Test
    void rayBox_hitsFromOutsideAndInside() {
        // from 2 blocks out along −X straight at door 1's leaf
        double t = HullCollision.rayBox(new Vector3d(3.5, 2.5, 11.28), new Vector3d(-1, 0, 0),
                DOOR1.minX(), DOOR1.minY(), DOOR1.minZ(), DOOR1.maxX(), DOOR1.maxY(), DOOR1.maxZ());
        assertEquals(3.5 - 1.56, t, EPS);
        // from inside the car looking out at it
        double inside = HullCollision.rayBox(new Vector3d(0.5, 2.5, 11.28), new Vector3d(1, 0, 0),
                DOOR1.minX(), DOOR1.minY(), DOOR1.minZ(), DOOR1.maxX(), DOOR1.maxY(), DOOR1.maxZ());
        assertEquals(0.97, inside, EPS);
        // looking the other way misses
        assertEquals(-1.0, HullCollision.rayBox(new Vector3d(3.5, 2.5, 11.28), new Vector3d(1, 0, 0),
                DOOR1.minX(), DOOR1.minY(), DOOR1.minZ(), DOOR1.maxX(), DOOR1.maxY(), DOOR1.maxZ()), EPS);
    }
}
