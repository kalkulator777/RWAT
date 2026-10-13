package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

class SwitchFrogTest {

    private static final Vector3d X = new Vector3d(1, 0, 0);
    private static final Vector3d TOE = new Vector3d(0.5, 64, 0.5);
    /** MVP's rail across: railhead 0.75–0.875, foot out to 0.906. */
    private static final SwitchThroat.Profile MVP = new SwitchThroat.Profile(0.75, 0.875, 0.906);

    /** A Y from the toe, straight on along +X and to a parallel track {@code aside} over in {@code ahead}. */
    private static SwitchThroat turnout(RailGraph graph, double ahead, double aside) {
        return turnout(graph, ahead, ahead, aside);
    }

    /** {@link #turnout(RailGraph, double, double)} with the straight leg {@code straight} long. */
    private static SwitchThroat turnout(RailGraph graph, double straight, double ahead, double aside) {
        graph.createSegment(TOE, X, new Vector3d(TOE.x + straight, 64, TOE.z), X);
        graph.createSegment(TOE, X, new Vector3d(TOE.x + ahead, 64, TOE.z + aside), X);
        RailNode toe = graph.nodeNear(TOE);
        return SwitchThroat.of(graph, toe.id(), List.copyOf(toe.segments()));
    }

    /** Both legs' frogs, the straight leg (the first) owning the nose. */
    private static SwitchFrog[] frogs(SwitchThroat throat) {
        int straight = throat.legIds().get(0);
        int diverging = throat.legIds().get(1);
        return new SwitchFrog[] {throat.frog(straight, MVP, MVP, true), throat.frog(diverging, MVP, MVP, false)};
    }

    @Test
    void theFrogSitsWhereTheInnerRailsGaugeFacesCross() {
        SwitchFrog[] frogs = frogs(turnout(new RailGraph(), 16.0, 4.0));
        SwitchFrog owner = frogs[0];
        SwitchFrog other = frogs[1];
        assertNotNull(owner);
        assertNotNull(other);
        // the legs are 2 × 0.75 apart there: ~6.7 blocks down a 16-long lead to a track 4 over
        assertTrue(owner.point() > 6.3 && owner.point() < 7.1, "point at " + owner.point());
        for (SwitchFrog frog : frogs) {
            assertTrue(frog.wingStart() < frog.throat() && frog.throat() < frog.point()
                    && frog.point() <= frog.noseStart() && frog.noseStart() < frog.pointEnd()
                    && frog.pointEnd() < frog.wingEnd(), "marks in order: " + frog);
            assertTrue(frog.start() > SwitchThroat.BLADE_LENGTH, "clear of the blades");
        }
        // the nose's owner starts the V at the point, the other leg's rail joins it further on
        assertEquals(owner.point(), owner.noseStart(), 1.0e-9);
        assertTrue(other.noseStart() > other.point() + 0.1);
    }

    @Test
    void theWingKeepsAFlangewayFromTheOtherGaugeLine() {
        SwitchFrog owner = frogs(turnout(new RailGraph(), 16.0, 4.0))[0];
        double[] out = new double[3];
        owner.wing(owner.throat(), out, 0);
        assertEquals(0.0, out[2], 1.0e-3, "no bend yet at the throat");
        owner.wing(owner.point(), out, 0);
        assertEquals(SwitchFrog.FLANGEWAY, out[2], 1.0e-3, "a flangeway out at the point");
        // all along: the wing's gauge face a flangeway off the other leg's gauge line
        for (double d = owner.throat(); d < owner.wingEnd() - SwitchFrog.WING_FLARE_LENGTH; d += 0.1) {
            owner.wing(d, out, 0);
            assertEquals(SwitchFrog.FLANGEWAY, MVP.gaugeFace() + out[2] - owner.at(owner.gauge(), d), 1.0e-3);
        }
        // shut at the end: floor and cut meet on the gauge face
        owner.wing(owner.wingEnd(), out, 0);
        assertEquals(MVP.gaugeFace(), out[0], 1.0e-9);
        assertEquals(MVP.gaugeFace(), out[1], 1.0e-9);
    }

    @Test
    void theNoseStartsInAPointAndEndsAsPlainRails() {
        SwitchFrog[] frogs = frogs(turnout(new RailGraph(), 16.0, 4.0));
        double[] out = new double[3];
        for (SwitchFrog frog : frogs) {
            frog.point(frog.noseStart(), out, 0);
            assertEquals(MVP.gaugeFace(), out[0], 1.0e-3, "floor at the gauge face: a point");
            assertEquals(MVP.gaugeFace(), out[1], 1.0e-3, "cut at the gauge face: a point");
            frog.point(frog.pointEnd(), out, 0);
            assertTrue(out[1] >= MVP.outer() - 1.0e-6, "nothing cut at the end");
            assertTrue(out[0] <= MVP.gaugeFace() - 0.1, "the foot fully back");
        }
        // in between, the owner's rail is cut along the other's gauge line, then its own head's outer face
        SwitchFrog owner = frogs[0];
        double mid = (owner.point() + owner.pointEnd()) / 2.0;
        owner.point(mid, out, 0);
        assertTrue(out[1] > MVP.gaugeFace() && out[1] <= MVP.outer());
    }

    @Test
    void theTwoPointRailsMeetOnOneLine() {
        RailGraph graph = new RailGraph();
        SwitchThroat throat = turnout(graph, 16.0, 4.0);
        SwitchFrog[] frogs = frogs(throat);
        HermiteSegmentPath straight = new HermiteSegmentPath(graph.hermite(graph.segment(throat.legIds().get(0))));
        HermiteSegmentPath diverging = new HermiteSegmentPath(graph.hermite(graph.segment(throat.legIds().get(1))));
        double[] out = new double[3];
        // where the other leg's railhead joins the V, its gauge face (a point: cut = gauge face)
        // lies on the owner's railhead outer face — the line the owner's rail is cut along
        SwitchFrog other = frogs[1];
        other.point(other.noseStart(), out, 0);
        Vector3d joint = across(diverging, other.noseStart(), other.side(), out[1]);
        assertEquals(MVP.headOuter(), lateral(straight, frogs[0].side(), joint), 2.0e-3);
        // and the theoretical point is one place seen from either leg
        Vector3d fromStraight = across(straight, frogs[0].point(), frogs[0].side(), MVP.gaugeFace());
        Vector3d fromDiverging = across(diverging, frogs[1].point(), frogs[1].side(), MVP.gaugeFace());
        assertEquals(0.0, fromStraight.distance(fromDiverging), 5.0e-3);
    }

    @Test
    void gentleAndSharpSwitchesHaveFrogsLegsThatNeverPartDont() {
        SwitchFrog gentle = frogs(turnout(new RailGraph(), 32.0, 4.0))[0];
        assertNotNull(gentle);
        assertTrue(gentle.point() > 12.5 && gentle.point() < 14.0, "gentle: point at " + gentle.point());
        // an N-crossover's sharp diagonal off a through track: 4 over in 8
        SwitchFrog[] sharp = frogs(turnout(new RailGraph(), 20.0, 8.0, 4.0));
        assertNotNull(sharp[0]);
        assertNotNull(sharp[1]);
        assertTrue(sharp[0].point() > 3.0 && sharp[0].point() < 3.8, "sharp: point at " + sharp[0].point());
        assertTrue(sharp[0].start() > 1.5, "room for a blade before it");
        // legs only 1.6 apart at the end (closer, the ends snap into one node): the rails meet, never clear
        assertNull(frogs(turnout(new RailGraph(), 16.0, 1.6))[0]);
        // the rails would meet only past the end of a short leg: no frog drawn
        assertNull(frogs(turnout(new RailGraph(), 4.0, 1.7))[0]);
    }

    /** The point {@code u} across a path's frame toward {@code side}, {@code d} into it. */
    private static Vector3d across(TrackPath path, double d, int side, double u) {
        double[] frame = new double[TrackSweep.FRAME_STRIDE];
        TrackSweep.frame(path, d, frame, 0);
        double sign = side == SwitchThroat.PLUS_Z ? 1.0 : -1.0;
        return new Vector3d(frame[0] + frame[6] * sign * u, frame[1] + frame[7] * sign * u,
                frame[2] + frame[8] * sign * u);
    }

    /** How far {@code point} lies across a path toward {@code side}, at the path's nearest point. */
    private static double lateral(TrackPath path, int side, Vector3d point) {
        double best = 0.0;
        double bestAlong = Double.MAX_VALUE;
        double[] frame = new double[TrackSweep.FRAME_STRIDE];
        for (double d = 0.0; d <= path.length(); d += 0.0005) {
            TrackSweep.frame(path, d, frame, 0);
            double along = Math.abs((point.x - frame[0]) * frame[3] + (point.y - frame[1]) * frame[4]
                    + (point.z - frame[2]) * frame[5]);
            if (along < bestAlong) {
                bestAlong = along;
                best = (point.x - frame[0]) * frame[6] + (point.y - frame[1]) * frame[7]
                        + (point.z - frame[2]) * frame[8];
            }
        }
        return (side == SwitchThroat.PLUS_Z ? 1.0 : -1.0) * best;
    }
}
