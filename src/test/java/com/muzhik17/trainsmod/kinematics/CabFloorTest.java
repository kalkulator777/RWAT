package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Walking a locomotive (SPEC §9.1): a floor of several zones — cab, hood
 * walkways, end platforms — joined by doors between zones, left by the corner
 * steps. The numbers are the ChME3 of the MVP recipe (model space).
 */
class CabFloorTest {

    private static final double FLOOR = 2.311;
    private static final double EPS = 1.0e-9;

    static final WagonType.Interior CHME3 = new WagonType.Interior(List.of(
            zone(-1.44, -5.5, 1.44, -4.45),      // cab, behind the desk
            zone(0.6, -5.25, 1.44, -3.625),      // cab aisle beside the desk, to door2
            zone(0.875, -3.44, 1.625, 8.312),    // long-hood walkway, +X
            zone(-1.625, -3.44, -0.875, 8.312),  // long-hood walkway, −X
            zone(-1.625, 7.438, 1.625, 8.312),   // front platform
            zone(0.875, -8.312, 1.625, -5.69),   // short-hood walkway, +X
            zone(-1.625, -8.312, -0.875, -5.69), // short-hood walkway, −X
            zone(-1.625, -8.312, 1.625, -7.438)  // rear platform
    ));

    static final List<WagonType.Door> DOORS = List.of(
            new WagonType.Door("door1", -1.5, 2.374, -5.688, -0.937, 4.382, -5.562, true, false),
            new WagonType.Door("door2", 0.938, 2.374, -3.562, 1.5, 4.382, -3.438, true, false),
            new WagonType.Door("step1", 1.56, 1.0, 7.6, 1.66, 3.0, 8.31, false, true));

    private static WagonType.Interior.Zone zone(double minX, double minZ, double maxX, double maxZ) {
        return new WagonType.Interior.Zone(minX, FLOOR, minZ, maxX, 5.0, maxZ);
    }

    /** Walk {@code ticks} steps with the player looking along +Z (yaw 0), car at yaw 0. */
    private static Vector3d walk(Vector3d from, double forward, double strafe, float yaw,
            int ticks, int openMask) {
        Vector3d pos = new Vector3d(from);
        for (int i = 0; i < ticks; i++) {
            pos = RiderWalk.step(pos, forward, strafe, yaw, 0.0f, CHME3, DOORS, openMask);
        }
        return pos;
    }

    @Test
    void closedInnerDoor_isWall() {
        // in the aisle, walking forward (+Z) into the front wall: door2 shut
        Vector3d inAisle = new Vector3d(1.1, FLOOR, -4.2);
        Vector3d end = walk(inAisle, 1.0, 0.0, 0.0f, 100, 0);
        assertEquals(-3.625 - RiderWalk.PLAYER_HALF_WIDTH, end.z, 1.0e-6);
    }

    @Test
    void openInnerDoor_leadsOntoTheWalkway() {
        // from the aisle straight ahead through door2: the walkway beyond isn't
        // in line with the doorway, the rider eases onto it
        Vector3d inAisle = new Vector3d(1.1, FLOOR, -4.2);
        int door2Open = 1 << 1;
        Vector3d out = walk(inAisle, 1.0, 0.0, 0.0f, 100, door2Open);
        assertTrue(out.z > 0.0, "walked well along the walkway, z = " + out.z);
        assertEquals(FLOOR, out.y, EPS);
    }

    @Test
    void walkwayJoinsThePlatform_andTheOtherWalkway() {
        // up the +X walkway to the front platform, across it, down the −X walkway
        Vector3d atFront = walk(new Vector3d(1.25, FLOOR, 0.0), 1.0, 0.0, 0.0f, 200, 0);
        assertEquals(8.312 - RiderWalk.PLAYER_HALF_WIDTH, atFront.z, 1.0e-6);
        // look −X (yaw 90) and walk across the platform
        Vector3d across = walk(atFront, 1.0, 0.0, 90.0f, 100, 0);
        assertEquals(-1.625 + RiderWalk.PLAYER_HALF_WIDTH, across.x, 1.0e-6);
        // and back along the −X walkway (look −Z, yaw 180)
        Vector3d back = walk(across, 1.0, 0.0, 180.0f, 60, 0);
        assertTrue(back.z < 2.0, "came back down the −X walkway, z = " + back.z);
        assertEquals(-1.25, back.x, 0.1);
    }

    @Test
    void walkway_isNarrow_hoodIsWall() {
        // on the +X walkway, pushing −X (into the hood) slides nowhere
        Vector3d start = new Vector3d(1.25, FLOOR, 2.0);
        Vector3d end = walk(start, 1.0, 0.0, 90.0f, 50, 0);
        assertEquals(0.875 + RiderWalk.PLAYER_HALF_WIDTH, end.x, 1.0e-6);
        assertEquals(2.0, end.z, 1.0e-6);
    }

    @Test
    void fixedOpening_letsTheRiderStepOff_withoutBeingOpened() {
        // on the front platform at the step, walking out +X (look +X = yaw −90)
        Vector3d atStep = new Vector3d(1.625 - RiderWalk.PLAYER_HALF_WIDTH, FLOOR, 7.9);
        int door = RiderWalk.exitDoor(atStep, 1.0, 0.0, -90.0f, 0.0f, CHME3, DOORS, 0);
        assertEquals(2, door);
        // further along the platform there is no step: the edge is a wall
        Vector3d noStep = new Vector3d(1.625 - RiderWalk.PLAYER_HALF_WIDTH, FLOOR, 2.0);
        assertEquals(-1, RiderWalk.exitDoor(noStep, 1.0, 0.0, -90.0f, 0.0f, CHME3, DOORS, 0));
    }

    @Test
    void innerDoor_neverLeadsOut() {
        Vector3d atDoor = new Vector3d(1.2, FLOOR, -3.625 - RiderWalk.PLAYER_HALF_WIDTH);
        assertEquals(-1, RiderWalk.exitDoor(atDoor, 1.0, 0.0, 0.0f, 0.0f, CHME3, DOORS, ~0));
    }

    @Test
    void flippedFloor_isTheModelTurnedAround() {
        WagonType.Interior flipped = CHME3.inFrame(true);
        // the cab sits at the rear of the model; turned, it is at the front of the pose frame
        Vector3d inCab = flipped.clampFeet(new Vector3d(0.0, 0.0, 5.0), RiderWalk.PLAYER_HALF_WIDTH);
        assertEquals(5.0, inCab.z, EPS);
        assertEquals(FLOOR, inCab.y, EPS);
        assertTrue(Double.isNaN(flipped.floorAt(0.0, -5.0, RiderWalk.PLAYER_HALF_WIDTH)),
                "mid-hood at −5 is no floor once turned");
        assertEquals(FLOOR, CHME3.floorAt(0.0, -5.0, RiderWalk.PLAYER_HALF_WIDTH), EPS);
    }

    @Test
    void boardingFromTheGround_landsOnTheNearestFloor() {
        // a player beside the front step, on the ground
        Vector3d feet = CHME3.clampFeet(new Vector3d(1.9, 0.0, 7.95), RiderWalk.PLAYER_HALF_WIDTH);
        assertEquals(1.625 - RiderWalk.PLAYER_HALF_WIDTH, feet.x, EPS);
        assertEquals(7.95, feet.z, EPS);
        assertEquals(FLOOR, feet.y, EPS);
    }

    @Test
    void throughTheDoor_alongTheWalkwayLine_intoTheCab() {
        // the in-game walk: down the walkway line (x 1.32) through the open
        // door, carrying on forward ends in the cab aisle, not stuck in the doorway
        Vector3d atDoor = new Vector3d(1.32, FLOOR, -3.14);
        Vector3d in = walk(atDoor, -1.0, 0.0, 0.0f, 40, 1 << 1);
        assertTrue(in.z < -4.5, "walked into the cab, z = " + in.z);
        assertTrue(in.x <= 1.44 - RiderWalk.PLAYER_HALF_WIDTH + EPS, "inside the aisle, x = " + in.x);
    }

    @Test
    void walls_stayWalls_evenForTheSidestep() {
        // in the cab aisle against the closed front wall: the walkway beyond is
        // 0.785 away — never reached by easing sideways
        Vector3d inAisle = new Vector3d(1.1, FLOOR, -3.925);
        Vector3d end = walk(inAisle, 1.0, 0.0, 0.0f, 50, 0);
        assertEquals(-3.925, end.z, 1.0e-6);
    }
}
