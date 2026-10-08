package com.muzhik17.trainsmod.kinematics;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.stock.ConsistComposition;

/**
 * The two-bogie body model (SPEC §2.3, Layer 2): a wagon is a rigid body
 * resting on two bogies, each a point riding the path at its own distance.
 * The body does <b>not</b> move on its own — its position is the midpoint of
 * the two bogies and its orientation is the direction between them. From that
 * alone the body inscribes into curves (it follows the chord, not the arc) and
 * tilts on grades, for free.
 *
 * <p>Wagon spacing and per-wagon wheelbase come from the consist's typed
 * {@link ConsistComposition} (SPEC §5.5 step 3).
 *
 * <p>Pure math, no MC imports (SPEC principle #4) — drives both the server
 * wagon entities and the client render, so both produce identical poses.
 */
public final class ConsistKinematics {

    private ConsistKinematics() {
    }

    /**
     * Pose of wagon {@code wagonIndex} (0 = front) given the consist head
     * distance {@code headS}. Bogie distances are sampled on {@code path},
     * which clamps to the path ends; if both bogies clamp onto the same point
     * (the whole wagon ran off an end) the body direction falls back to the
     * path tangent there so the pose never becomes degenerate.
     */
    public static WagonPose wagonPose(TrackPath path, double headS, int wagonIndex,
            ConsistComposition composition) {
        double frontS = composition.frontBogieS(headS, wagonIndex);
        double rearS = composition.rearBogieS(headS, wagonIndex);

        Vector3d front = path.samplePosition(frontS);
        Vector3d rear = path.samplePosition(rearS);

        Vector3d body = new Vector3d(front).add(rear).mul(0.5);
        Vector3d axis = new Vector3d(front).sub(rear); // travel direction, front − rear
        if (axis.lengthSquared() < 1.0e-9) {
            axis = path.sampleTangent(Math.clamp(frontS, 0.0, path.length()));
        }

        // each bogie turns with the local path tangent at its own s, not the
        // body chord — that's what articulates bogie meshes through curves
        // (SPEC §5.2)
        Vector3d frontTangent = path.sampleTangent(frontS);
        Vector3d rearTangent = path.sampleTangent(rearS);

        return new WagonPose(body,
                new WagonPose.BogiePose(front,
                        PoseMath.yawDegrees(frontTangent), PoseMath.pitchDegrees(frontTangent), frontS),
                new WagonPose.BogiePose(rear,
                        PoseMath.yawDegrees(rearTangent), PoseMath.pitchDegrees(rearTangent), rearS),
                PoseMath.yawDegrees(axis), PoseMath.pitchDegrees(axis));
    }
}
