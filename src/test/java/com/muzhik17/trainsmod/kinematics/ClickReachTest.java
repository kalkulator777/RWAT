package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.joml.Matrix4d;
import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/**
 * Clicks on a moving train (SPEC §9.3): the model the picking rays go
 * through is the one drawn, and the server measures reach to the car where
 * the player's client drew it, not where the server has it by now.
 */
class ClickReachTest {

    private static final double EPS = 1.0e-9;

    @Test
    void drawnBody_isThePose_withoutSway() {
        Vector3d body = new Vector3d(100.0, 64.0, -30.0);
        Vector3d local = new Vector3d(0.7, 2.4, -5.0);
        Vector3d viaMatrix = PoseMath.drawnBody(body, 37.0F, -2.0F, Sway.ZERO, false)
                .transformPosition(new Vector3d(local));
        Vector3d viaPose = PoseMath.localToWorld(body, 37.0F, -2.0F, local);
        assertEquals(0.0, viaMatrix.distance(viaPose), EPS);
    }

    @Test
    void drawnBody_swaysLikeTheRiders_andTurnsAFlippedModel() {
        Vector3d body = new Vector3d(-12.0, 70.0, 5.0);
        Sway sway = new Sway(0.03, 0.01, -0.02);
        Vector3d model = new Vector3d(0.7, 2.4, -5.0);
        Matrix4d drawn = PoseMath.drawnBody(body, 120.0F, 1.5F, sway, true);
        // a flipped model's point is the pose frame's (−x, y, −z); the body sways in the pose frame
        Vector3d expected = PoseMath.localToWorld(body, 120.0F, 1.5F,
                sway.apply(new Vector3d(-model.x, model.y, -model.z)));
        assertEquals(0.0, drawn.transformPosition(new Vector3d(model)).distance(expected), 1.0e-6);
    }

    @Test
    void standingTrain_plainBoxDistance() {
        // eye 2 beside a box spanning x −1.5…1.5: 0.5 away
        double d = ClickReach.distanceSq(2.0, 1.0, 0.0, 0.0, -1.5, 0.0, -10.0, 1.5, 4.0, 10.0);
        assertEquals(0.25, d, EPS);
    }

    @Test
    void movingTrain_theEyeSweptBack_reachesTheDoorItSaw() {
        // the door point at z = 0 of the car; the server has the car 8 blocks on
        // (+z), so the eye is 8 behind the door in the car's frame now — but
        // where the client drew it, the eye was level with it
        double now = ClickReach.distanceSq(3.0, 1.5, -8.0, 0.0, 0.0, 1.5, 0.0, 0.0, 1.5, 0.0);
        double swept = ClickReach.distanceSq(3.0, 1.5, -8.0, 9.0, 0.0, 1.5, 0.0, 0.0, 1.5, 0.0);
        assertEquals(73.0, now, EPS);
        assertEquals(9.0, swept, EPS);
    }

    @Test
    void sweep_goesOnlyOneWay() {
        // moving the other way the drawn car was ahead, not behind: no help from behind
        double d = ClickReach.distanceSq(3.0, 1.5, -8.0, -9.0, 0.0, 1.5, 0.0, 0.0, 1.5, 0.0);
        assertEquals(73.0, d, EPS);
    }

    @Test
    void lag_isPlaybackRoundTripAndAFewTicks() {
        assertEquals(2.0 + 2.0 + ClickReach.EXTRA_TICKS, ClickReach.lagTicks(2.0, 100), EPS);
        assertTrue(ClickReach.lagTicks(2.0, -1) >= 2.0 + ClickReach.EXTRA_TICKS); // unknown latency
    }
}
