package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.path.HermiteSegment;
import com.muzhik17.trainsmod.path.HermiteSegmentPath;
import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

/** The two-bogie body model (SPEC §2.3, Layer 2) over a typed composition (§5.5 step 3). */
class ConsistKinematicsTest {

    private static final double EPS = 1.0e-6;

    private static TrackPath straight(Vector3d a, Vector3d b) {
        return new HermiteSegmentPath(HermiteSegment.straight(a, b));
    }

    /** Unpowered test type: symmetric bogies {@code wheelbase} apart on a {@code length} frame. */
    private static WagonType type(double length, double wheelbase) {
        return new WagonType("test:wagon", length,
                new double[]{wheelbase / 2.0, -wheelbase / 2.0},
                10.0, 100.0, WagonType.Resistance.NONE, null, null, WagonType.Brakes.NONE, null);
    }

    private static ConsistComposition single(double wheelbase) {
        return new ConsistComposition(List.of(
                new ConsistComposition.Slot(type(wheelbase + 2.0, wheelbase), false)));
    }

    @Test
    void straightPath_bodyIsBogieMidpoint_noRotation() {
        TrackPath path = straight(new Vector3d(0, 0, 0), new Vector3d(0, 0, 100));

        WagonPose pose = ConsistKinematics.wagonPose(path, 50.0, 0, single(4.0));

        // front bogie at s=50, rear at s=46 → body at s=48, dead centre on +Z
        assertEquals(0.0, pose.body().x, 1.0e-4);
        assertEquals(48.0, pose.body().z, 1.0e-4);
        assertEquals(0.0f, pose.yaw(), 1.0e-3f);
        assertEquals(0.0f, pose.pitch(), 1.0e-3f);
    }

    @Test
    void wagonSpacing_framesNoseToTailWithCouplerGap() {
        TrackPath path = straight(new Vector3d(0, 0, 0), new Vector3d(0, 0, 100));
        WagonType loco = type(18.0, 8.0);
        ConsistComposition two = new ConsistComposition(List.of(
                new ConsistComposition.Slot(loco, false),
                new ConsistComposition.Slot(loco, false)));

        WagonPose w0 = ConsistKinematics.wagonPose(path, 60.0, 0, two);
        WagonPose w1 = ConsistKinematics.wagonPose(path, 60.0, 1, two);

        // consecutive body centres are one frame length + the coupler gap apart
        assertEquals(loco.length() + ConsistComposition.COUPLER_GAP,
                w0.body().z - w1.body().z, 1.0e-4);
    }

    @Test
    void flippedWagon_negatesAsymmetricBogieOffsets() {
        // asymmetric bogies: +3 forward, −5 back from the body centre
        WagonType odd = new WagonType("test:odd", 12.0, new double[]{3.0, -5.0},
                10.0, 100.0, WagonType.Resistance.NONE, null, null, WagonType.Brakes.NONE, null);
        ConsistComposition normal = new ConsistComposition(List.of(
                new ConsistComposition.Slot(odd, false)));
        ConsistComposition flipped = new ConsistComposition(List.of(
                new ConsistComposition.Slot(odd, true)));

        // headS = front bogie of wagon 0 in both cases; the body centre shifts
        // because the leading bogie is a different one when flipped
        // normal: centre = 50 − 3 = 47, rear bogie = 47 + (−5) = 42
        assertEquals(47.0, normal.bodyCenterS(50.0, 0), EPS);
        assertEquals(42.0, normal.rearBogieS(50.0, 0), EPS);
        // flipped: leading offset = −(−5) = 5 → centre = 45; trailing = −3 → 42
        assertEquals(45.0, flipped.bodyCenterS(50.0, 0), EPS);
        assertEquals(42.0, flipped.rearBogieS(50.0, 0), EPS);
        // wheelbase (front−rear span) is the same either way
        assertEquals(normal.frontBogieS(50.0, 0) - normal.rearBogieS(50.0, 0),
                flipped.frontBogieS(50.0, 0) - flipped.rearBogieS(50.0, 0), EPS);
    }

    @Test
    void climb_givesNoseUpPitch() {
        // 45° climb in the Y/Z plane: travel direction (0, +, +)
        TrackPath path = straight(new Vector3d(0, 0, 0), new Vector3d(0, 10, 10));

        WagonPose pose = ConsistKinematics.wagonPose(path, path.length() * 0.5, 0, single(4.0));

        // nose up is negative xRot in MC; a 45° grade → ~ −45°
        assertTrue(pose.pitch() < 0.0f, "climbing should pitch the nose up (negative)");
        assertEquals(-45.0f, pose.pitch(), 0.5f);
    }

    @Test
    void curve_bodyInscribesInsideTheArc() {
        // a curve that swings from heading +Z to heading +X
        HermiteSegment seg = new HermiteSegment(
                new Vector3d(0, 0, 0), new Vector3d(0, 0, 20),
                new Vector3d(10, 0, 10), new Vector3d(20, 0, 0));
        TrackPath path = new HermiteSegmentPath(seg);
        double wheelbase = 8.0;

        double headS = path.length() * 0.5;
        WagonPose pose = ConsistKinematics.wagonPose(path, headS, 0, single(wheelbase));

        // the on-rail point at the body's mid distance bulges outward; the body
        // (chord midpoint of the two bogies) cuts the corner and sits off it
        Vector3d arcMid = path.samplePosition(headS - wheelbase * 0.5);
        double cut = pose.body().distance(arcMid);
        assertTrue(cut > 0.1, "body should cut the corner, was " + cut);
    }

    @Test
    void curve_bogiesArticulateWithLocalTangent() {
        // same swing curve as above: heading turns from +Z to +X (yaw 0 → −90)
        HermiteSegment seg = new HermiteSegment(
                new Vector3d(0, 0, 0), new Vector3d(0, 0, 20),
                new Vector3d(10, 0, 10), new Vector3d(20, 0, 0));
        TrackPath path = new HermiteSegmentPath(seg);

        WagonPose pose = ConsistKinematics.wagonPose(path, path.length() * 0.5, 0, single(8.0));

        // each bogie turns with the tangent at its own s (SPEC §5.2): on a
        // curve the two yaws differ, and the body chord yaw lies between them
        float front = pose.front().yaw();
        float rear = pose.rear().yaw();
        assertTrue(Math.abs(front - rear) > 1.0f,
                "bogies should yaw differently on a curve: " + front + " vs " + rear);
        assertTrue((pose.yaw() - front) * (pose.yaw() - rear) < 0.0f,
                "body yaw should lie between the bogie yaws");
    }

    @Test
    void straightPath_bogiePosesMatchPathSamples() {
        TrackPath path = straight(new Vector3d(0, 0, 0), new Vector3d(0, 0, 100));

        WagonPose pose = ConsistKinematics.wagonPose(path, 50.0, 0, single(4.0));

        assertEquals(50.0, pose.front().position().z, 1.0e-4);
        assertEquals(46.0, pose.rear().position().z, 1.0e-4);
        assertEquals(0.0f, pose.front().yaw(), 1.0e-3f);
        assertEquals(0.0f, pose.rear().pitch(), 1.0e-3f);
    }

    @Test
    void runningOffTheEnd_clampsWithoutDegenerating() {
        TrackPath path = straight(new Vector3d(0, 0, 0), new Vector3d(0, 0, 100));

        // head far past the end: both bogies clamp to the same end point
        WagonPose pose = ConsistKinematics.wagonPose(path, 1000.0, 0, single(4.0));

        assertEquals(100.0, pose.body().z, 1.0e-4);
        // direction falls back to the path tangent (+Z), never NaN
        assertTrue(Float.isFinite(pose.yaw()) && Float.isFinite(pose.pitch()));
        assertEquals(0.0f, pose.yaw(), 1.0e-3f);
        assertTrue(Math.abs(pose.body().x) < EPS);
    }
}
