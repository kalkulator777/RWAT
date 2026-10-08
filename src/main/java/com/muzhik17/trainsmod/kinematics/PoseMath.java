package com.muzhik17.trainsmod.kinematics;

import org.joml.Quaterniond;
import org.joml.Vector3d;

/**
 * Pure-math pose helpers shared by server and client (SPEC principle #4:
 * pure core, no MC imports). Layer 0 only needs tangent→rotation; the full
 * two-bogie body kinematics lands here in Layer 2; the local↔world transforms
 * (SPEC v1.5-б) carry a wagon-bound rider between the model's local frame and
 * the world.
 */
public final class PoseMath {

    private PoseMath() {
    }

    /**
     * The body's orientation as a quaternion, matching the renderer exactly:
     * {@code WagonRenderer} applies {@code Y(-yaw)} then {@code X(pitch)} to
     * model-space vertices, so a model-space vector maps to world by
     * {@code Ry(-yaw)·Rx(pitch)·v} (JOML post-multiplies, so the X rotation is
     * applied first, then Y — the same order the PoseStack produces).
     */
    private static Quaterniond bodyRotation(float yawDeg, float pitchDeg) {
        return new Quaterniond()
                .rotateY(Math.toRadians(-yawDeg))
                .rotateX(Math.toRadians(pitchDeg));
    }

    /**
     * Model-local point → world, given the body pose (SPEC v1.5-б): a rider's
     * local feet position becomes a world position, the body pose carrying them
     * along as the wagon moves. {@code +Z} is forward, {@code +Y} up — the
     * renderer's model frame.
     */
    public static Vector3d localToWorld(Vector3d body, float yawDeg, float pitchDeg,
            Vector3d local) {
        Vector3d out = bodyRotation(yawDeg, pitchDeg).transform(new Vector3d(local));
        return out.add(body);
    }

    /**
     * World point → model-local (the inverse of {@link #localToWorld}): used
     * when a player boards (their world feet become a local point) and when
     * resolving where in the interior a click landed.
     */
    public static Vector3d worldToLocal(Vector3d body, float yawDeg, float pitchDeg,
            Vector3d world) {
        Vector3d rel = new Vector3d(world).sub(body);
        return bodyRotation(yawDeg, pitchDeg).conjugate().transform(rel);
    }

    /**
     * Minecraft yaw in degrees for a travel direction: 0 = +Z, 90 = −X
     * (vanilla entity {@code yRot} convention).
     */
    public static float yawDegrees(Vector3d tangent) {
        return (float) Math.toDegrees(Math.atan2(-tangent.x, tangent.z));
    }

    /**
     * Minecraft pitch in degrees for a travel direction: positive = nose down
     * (vanilla entity {@code xRot} convention).
     */
    public static float pitchDegrees(Vector3d tangent) {
        double horizontal = Math.hypot(tangent.x, tangent.z);
        return (float) -Math.toDegrees(Math.atan2(tangent.y, horizontal));
    }
}
