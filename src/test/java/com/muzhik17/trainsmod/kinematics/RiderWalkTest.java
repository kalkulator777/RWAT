package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.stock.WagonType;

/**
 * The local↔world transforms and the walk step (SPEC v1.5-б) — the math the
 * whole rider-in-local-coordinates feature rests on.
 */
class RiderWalkTest {

    private static final WagonType.Interior BOX =
            new WagonType.Interior(-1.35, 1.4, -11.0, 1.35, 4.2, 11.0);

    @Test
    void localToWorld_roundTripsThroughWorldToLocal() {
        Vector3d body = new Vector3d(100.0, 64.0, -50.0);
        float yaw = 37.0f;
        float pitch = -8.0f;
        Vector3d local = new Vector3d(0.7, 1.4, 5.0);

        Vector3d world = PoseMath.localToWorld(body, yaw, pitch, local);
        Vector3d back = PoseMath.worldToLocal(body, yaw, pitch, world);

        assertEquals(local.x, back.x, 1.0e-9);
        assertEquals(local.y, back.y, 1.0e-9);
        assertEquals(local.z, back.z, 1.0e-9);
    }

    @Test
    void localToWorld_identityPoseIsBodyPlusLocal() {
        Vector3d body = new Vector3d(10.0, 70.0, 20.0);
        Vector3d world = PoseMath.localToWorld(body, 0.0f, 0.0f, new Vector3d(1.0, 1.4, 3.0));
        // yaw 0 / pitch 0: model +Z forward maps straight onto world +Z
        assertEquals(11.0, world.x, 1.0e-9);
        assertEquals(71.4, world.y, 1.0e-9);
        assertEquals(23.0, world.z, 1.0e-9);
    }

    @Test
    void walk_forwardMovesAlongLocalZ_whenAlignedWithCar() {
        // player and car both face +Z (yaw 0); pressing forward walks the car's +Z
        Vector3d start = new Vector3d(0.0, BOX.floorY(), 0.0);
        Vector3d next = RiderWalk.step(start, 1.0, 0.0, 0.0f, 0.0f, BOX);

        assertEquals(0.0, next.x, 1.0e-9);
        assertEquals(BOX.floorY(), next.y, 1.0e-9);
        assertEquals(RiderWalk.WALK_SPEED, next.z, 1.0e-9);
    }

    @Test
    void walk_stepsStayInsideTheInteriorWalls() {
        // march hard into the front wall for many ticks; never leave the box
        Vector3d pos = new Vector3d(0.0, BOX.floorY(), 0.0);
        for (int i = 0; i < 500; i++) {
            pos = RiderWalk.step(pos, 1.0, 0.0, 0.0f, 0.0f, BOX);
        }
        assertTrue(pos.z <= BOX.maxZ() - RiderWalk.PLAYER_HALF_WIDTH + 1.0e-9,
                "rider walked through the front wall: " + pos.z);
        assertTrue(pos.z > 0.0, "rider should have advanced toward the front");
    }

    @Test
    void walk_theLookInTheCarsFrame_stepsAsTheWorldLookLessTheCar() {
        // what WalkInputPayload carries: the look relative to the car, the car at 0
        Vector3d start = new Vector3d(0.3, BOX.floorY(), 2.0);
        Vector3d world = RiderWalk.step(start, 1.0, 0.4, 37.0f, 12.0f, BOX);
        Vector3d relative = RiderWalk.step(start, 1.0, 0.4, 25.0f, 0.0f, BOX);
        assertEquals(world.x, relative.x, 1.0e-6);
        assertEquals(world.z, relative.z, 1.0e-6);
    }

    @Test
    void walk_twoYawsOfOneCar_driftApart() {
        // the play-test of 2026-10-14: client and server each turned the world
        // look into the car's frame by their own yaw of the car — on a curve the
        // drawn car is a few ticks (a degree or two) behind the server's
        Vector3d client = new Vector3d(0.0, BOX.floorY(), -10.0);
        Vector3d server = new Vector3d(client);
        for (int i = 0; i < 100; i++) {
            client = RiderWalk.step(client, 1.0, 0.0, 30.0f, 28.5f, BOX);
            server = RiderWalk.step(server, 1.0, 0.0, 30.0f, 30.0f, BOX);
        }
        assertTrue(client.distance(server) > 0.2, "no drift: " + client.distance(server));
    }

    @Test
    void walk_diagonalIsNotFasterThanStraight() {
        Vector3d start = new Vector3d(0.0, BOX.floorY(), 0.0);
        Vector3d next = RiderWalk.step(start, 1.0, 1.0, 0.0f, 0.0f, BOX);
        double dist = Math.hypot(next.x - start.x, next.z - start.z);
        assertEquals(RiderWalk.WALK_SPEED, dist, 1.0e-9);
    }
}
