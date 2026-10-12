package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/**
 * The server's check of a blow at a bogie (SPEC §6.11): the bogie must be
 * ahead along the look, within reach, and the look must pass near it.
 */
class BogieReachTest {

    private static final double REACH = 3.0;
    /** A player standing beside the track, eyes 1.62 up, the bogie's path point 2.5 away along +X. */
    private static final Vector3d EYE = new Vector3d(0.0, 1.62, 0.0);
    private static final Vector3d BOGIE = new Vector3d(2.5, 0.0, 0.0);

    @Test
    void lookingDownAtTheBogie_reachesIt() {
        Vector3d look = new Vector3d(BOGIE.x - EYE.x, BOGIE.y + 0.6 - EYE.y, 0.0);
        assertTrue(BogieReach.reaches(EYE, look, BOGIE, REACH, 0.0));
    }

    @Test
    void lookingAway_doesNot() {
        assertFalse(BogieReach.reaches(EYE, new Vector3d(-1.0, 0.0, 0.0), BOGIE, REACH, 0.0));
        // up at the sky over it
        assertFalse(BogieReach.reaches(EYE, new Vector3d(0.1, 1.0, 0.0), BOGIE, REACH, 0.0));
    }

    @Test
    void lookingAlongTheTrain_pastTheBogie_doesNot() {
        // the bogie far to the side of a look along +Z
        Vector3d far = new Vector3d(6.0, 0.0, 2.0);
        assertFalse(BogieReach.reaches(EYE, new Vector3d(0.0, -0.3, 1.0), far, REACH, 0.0));
    }

    @Test
    void tooFar_doesNot_unlessTheTrainRanOnFromWhereItWasSeen() {
        Vector3d far = new Vector3d(9.0, 0.0, 0.0);
        Vector3d look = new Vector3d(1.0, -0.15, 0.0);
        assertFalse(BogieReach.reaches(EYE, look, far, REACH, 0.0));
        // a train at speed is ahead of the client's view: the slack covers it
        assertTrue(BogieReach.reaches(EYE, look, far, REACH, 4.0));
    }

    @Test
    void noLook_neverReaches() {
        assertFalse(BogieReach.reaches(EYE, new Vector3d(), BOGIE, REACH, 10.0));
    }
}
