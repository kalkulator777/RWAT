package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/**
 * The hard hull collision math (SPEC v1.5-а): a moving OBB versus an entity,
 * resolved in the wagon's local frame. Hull here is a platzkart-ish box,
 * x∈[−1.7,1.7] y∈[0.4,4.7] z∈[−9,9], body at the origin.
 */
class HullCollisionTest {

    private static final Vector3d MIN = new Vector3d(-1.7, 0.4, -9.0);
    private static final Vector3d MAX = new Vector3d(1.7, 4.7, 9.0);
    private static final double EPS = 1.0e-6;

    // player-ish half extents
    private static final double HX = 0.3, HY = 0.9, HZ = 0.3;

    @Test
    void approachEndOn_axisAligned_stopsAtFace() {
        // entity just past the −Z end wall, walking +Z toward the car
        Vector3d center = new Vector3d(0.0, 1.0, -10.0); // box z∈[−10.3,−9.7]
        Vector3d move = new Vector3d(0.0, 0.0, 1.0);
        Vector3d out = HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                center, HX, HY, HZ, move);
        // maxZ −9.7 must reach the −9.0 face: allowed = 0.7
        assertEquals(0.7, out.z, EPS);
        assertEquals(0.0, out.x, EPS);
        assertEquals(0.0, out.y, EPS);
    }

    @Test
    void alreadyInside_movementUnchanged() {
        Vector3d center = new Vector3d(0.0, 1.0, 0.0); // deep inside
        Vector3d move = new Vector3d(0.0, 0.0, 1.0);
        Vector3d out = HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                center, HX, HY, HZ, move);
        // a swept clamp can't resolve existing penetration: pass through, same instance
        assertSame(move, out);
    }

    @Test
    void tangentialMove_notBlocked() {
        // alongside the car, sliding parallel to the side wall
        Vector3d center = new Vector3d(2.2, 1.0, 0.0); // box x∈[1.9,2.5], clear of maxX 1.7
        Vector3d move = new Vector3d(0.0, 0.0, 1.0);
        Vector3d out = HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                center, HX, HY, HZ, move);
        assertSame(move, out);
    }

    @Test
    void sideApproach_clampedAgainstWall() {
        // approaching the +X side wall from outside, moving −X
        Vector3d center = new Vector3d(2.2, 1.0, 0.0); // box minX 1.9
        Vector3d move = new Vector3d(-1.0, 0.0, 0.0);
        Vector3d out = HullCollision.clampMove(MIN, MAX, origin(), 0.0f, 0.0f,
                center, HX, HY, HZ, move);
        // minX 1.9 reaches the 1.7 face: allowed = −0.2
        assertEquals(-0.2, out.x, EPS);
    }

    @Test
    void yawedHull_clampsInWorldFrame() {
        // wagon turned 90°: its long axis now lies along world X, hull world
        // footprint x∈[−9,9] z∈[−1.7,1.7]. Entity off the +X end, moving −X.
        Vector3d center = new Vector3d(10.0, 1.0, 0.0); // box minX 9.7
        Vector3d move = new Vector3d(-1.0, 0.0, 0.0);
        Vector3d out = HullCollision.clampMove(MIN, MAX, origin(), 90.0f, 0.0f,
                center, HX, HY, HZ, move);
        // minX 9.7 must reach the world-X face at 9.0: allowed = −0.7
        assertEquals(-0.7, out.x, EPS);
        assertEquals(0.0, out.y, EPS);
        assertEquals(0.0, out.z, EPS);
    }

    @Test
    void shove_overlappingEntity_pushesOutNearestSide() {
        // entity overlapping the +X half of the car, shallower exit is +X
        Vector3d center = new Vector3d(1.4, 1.0, 0.0); // box x∈[1.1,1.7]
        Vector3d out = HullCollision.shove(MIN, MAX, origin(), 0.0f, 0.0f,
                center, HX, HY, HZ);
        assertTrue(out.x > 0.0, "should eject toward +X");
        assertEquals(0.0, out.y, EPS, "never vertical");
        assertEquals(0.0, out.z, EPS, "end walls are deeper than the side here");
        // minX 1.1 pushed to the 1.7 face → +0.6
        assertEquals(0.6, out.x, EPS);
    }

    @Test
    void shove_clearEntity_zero() {
        Vector3d center = new Vector3d(5.0, 1.0, 0.0); // well outside the side wall
        Vector3d out = HullCollision.shove(MIN, MAX, origin(), 0.0f, 0.0f,
                center, HX, HY, HZ);
        assertEquals(0.0, out.length(), EPS);
    }

    private static Vector3d origin() {
        return new Vector3d(0.0, 0.0, 0.0);
    }
}
