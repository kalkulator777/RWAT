package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/**
 * Back aboard after logging in (SPEC v1.5-б): only if the spot the player
 * left is right by them — on it, or dropped through the floor to the track
 * while the car loaded; not if the train has gone on.
 */
class ReturnAboardTest {

    /** Feet on a platzkart's floor, 1.81 over the rail. */
    private static final Vector3d FEET = new Vector3d(100.65, 65.81, -40.0);

    @Test
    void onTheSpot_isBackAboard() {
        assertTrue(ReturnAboard.near(FEET, new Vector3d(FEET)));
    }

    @Test
    void droppedThroughTheFloorToTheTrack_isBackAboard() {
        assertTrue(ReturnAboard.near(FEET, new Vector3d(100.65, 64.0, -40.0)));
        assertTrue(ReturnAboard.near(FEET, new Vector3d(100.65, 63.0, -39.6)));
    }

    @Test
    void fallenFurther_orAbove_isNot() {
        assertFalse(ReturnAboard.near(FEET, new Vector3d(100.65, 62.5, -40.0)));
        assertFalse(ReturnAboard.near(FEET, new Vector3d(100.65, 66.5, -40.0)));
    }

    @Test
    void theTrainWentOn_isNot() {
        // the car moved 3 blocks along the track while the player was away
        assertFalse(ReturnAboard.near(new Vector3d(100.65, 65.81, -37.0), new Vector3d(FEET)));
    }
}
