package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/**
 * A crouched rider keeps to the floor (SPEC v1.5-б, «Shift — край пола»): an
 * open hull door or a loco's step opening is the floor's edge, as a block edge
 * is to vanilla's sneak, so nobody steps off a moving train by accident; the
 * gangway into the next car still passes. Crouched, the step is a creep.
 * The platzkart's and the ChME3's numbers ({@link GangwayTest}, {@link CabFloorTest}).
 */
class SneakEdgeTest {

    private static final double FLOOR = 1.81;
    private static final int ALL_OPEN = ~0;
    /** yaw −90 looks along +X (vanilla: x' = −sin(yaw)). */
    private static final float FACING_PLUS_X = -90.0F;

    @Test
    void crouched_doesNotStepOutOfAnOpenSideDoor() {
        // in the front vestibule against the +X side, in Door1's span
        Vector3d atDoor = new Vector3d(1.35 - RiderWalk.PLAYER_HALF_WIDTH, FLOOR, 11.28);
        assertEquals(0, RiderWalk.exitDoor(atDoor, 1.0, 0.0, FACING_PLUS_X, 0.0F,
                GangwayTest.PLATZKART, GangwayTest.DOORS, ALL_OPEN, false));
        assertEquals(-1, RiderWalk.exitDoor(atDoor, 1.0, 0.0, FACING_PLUS_X, 0.0F,
                GangwayTest.PLATZKART, GangwayTest.DOORS, ALL_OPEN, true));
        // and the step holds them at the floor's edge, however long they push
        Vector3d pushed = atDoor;
        for (int i = 0; i < 40; i++) {
            pushed = RiderWalk.step(pushed, 1.0, 0.0, FACING_PLUS_X, 0.0F,
                    GangwayTest.PLATZKART, GangwayTest.DOORS, ALL_OPEN, true);
        }
        assertEquals(1.35 - RiderWalk.PLAYER_HALF_WIDTH, pushed.x, 1.0e-6);
        assertEquals(11.28, pushed.z, 1.0e-6);
    }

    @Test
    void crouched_doesNotStepOffThroughAFixedOpening() {
        // the ChME3's front platform at its corner step (an always-open opening)
        Vector3d atStep = new Vector3d(1.625 - RiderWalk.PLAYER_HALF_WIDTH, 2.311, 7.9);
        assertEquals(2, RiderWalk.exitDoor(atStep, 1.0, 0.0, FACING_PLUS_X, 0.0F,
                CabFloorTest.CHME3, CabFloorTest.DOORS, 0, false));
        assertEquals(-1, RiderWalk.exitDoor(atStep, 1.0, 0.0, FACING_PLUS_X, 0.0F,
                CabFloorTest.CHME3, CabFloorTest.DOORS, 0, true));
    }

    @Test
    void crouched_stillWalksThroughTheGangway() {
        Vector3d atEnd = new Vector3d(0.0, FLOOR, 11.45 - 0.01);
        assertEquals(4, RiderWalk.exitDoor(atEnd, 1.0, 0.0, 0.0F, 0.0F,
                GangwayTest.PLATZKART, GangwayTest.DOORS, ALL_OPEN, true));
    }

    @Test
    void onlyGangwayDoorsKeepTheRiderAboard() {
        assertTrue(RiderWalk.keepsAboard(GangwayTest.DOORS.get(4)));
        assertFalse(RiderWalk.keepsAboard(GangwayTest.DOORS.get(0)));
        assertFalse(RiderWalk.keepsAboard(CabFloorTest.DOORS.get(2)));
    }

    @Test
    void crouched_creepsAtTheSneakingPace() {
        Vector3d from = new Vector3d(0.0, FLOOR, 0.0);
        Vector3d walked = RiderWalk.step(from, 1.0, 0.0, 0.0F, 0.0F,
                GangwayTest.PLATZKART, GangwayTest.DOORS, 0, false);
        Vector3d crept = RiderWalk.step(from, 1.0, 0.0, 0.0F, 0.0F,
                GangwayTest.PLATZKART, GangwayTest.DOORS, 0, true);
        assertEquals(RiderWalk.WALK_SPEED, walked.z, 1.0e-9);
        assertEquals(RiderWalk.WALK_SPEED * RiderWalk.SNEAK_FACTOR, crept.z, 1.0e-9);
    }
}
