package com.muzhik17.trainsmod.kinematics;

import org.joml.Vector3d;

/**
 * One wagon's fully resolved pose for a given moment (SPEC §2.3, Layer 2): the
 * body's world position and orientation, plus the pose of each bogie it rests
 * on. Bogies carry their own yaw/pitch (the local path tangent at their
 * {@code s}) so the renderer can articulate bogie meshes through curves
 * independently of the body chord (SPEC §5.2).
 */
public record WagonPose(Vector3d body, BogiePose front, BogiePose rear,
        float yaw, float pitch) {

    /**
     * A bogie's path sample point, the path tangent orientation there, and its
     * distance along the path {@code pathS} — the rolled distance the renderer
     * derives wheel spin from (angle = pathS / wheel radius).
     */
    public record BogiePose(Vector3d position, float yaw, float pitch, double pathS) {
    }
}
