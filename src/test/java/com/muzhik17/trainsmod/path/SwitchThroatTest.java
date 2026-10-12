package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

class SwitchThroatTest {

    private static final Vector3d X = new Vector3d(1, 0, 0);
    private static final Vector3d TOE = new Vector3d(0.5, 64, 0.5);

    /** A turnout: straight on along +X, diverging to a parallel track 4 blocks over (+Z). */
    private static RailGraph turnout() {
        RailGraph graph = new RailGraph();
        graph.createSegment(TOE, X, new Vector3d(16.5, 64, 0.5), X);
        graph.createSegment(TOE, X, new Vector3d(16.5, 64, 4.5), X);
        return graph;
    }

    private static SwitchThroat throat(RailGraph graph) {
        RailNode toe = graph.nodeNear(TOE);
        return SwitchThroat.of(graph, toe.id(), List.copyOf(toe.segments()));
    }

    @Test
    void eachLegsBladeIsTheRailTowardTheOtherLeg() {
        RailGraph graph = turnout();
        SwitchThroat throat = throat(graph);
        int straight = throat.legIds().get(0);
        int diverging = throat.legIds().get(1);

        // along +X the frame's right axis (local +z) is world −Z: the diverging
        // leg (+Z) is on the straight leg's −z side, and vice versa
        assertEquals(SwitchThroat.MINUS_Z, throat.bladeSides(straight));
        assertEquals(SwitchThroat.PLUS_Z, throat.bladeSides(diverging));
        assertEquals(SwitchThroat.BLADE_LENGTH, throat.bladeLength(straight), 1.0e-9);
    }

    @Test
    void aLegEndingAtTheNodeHasItsSidesMirrored() {
        RailGraph graph = new RailGraph();
        graph.createSegment(TOE, X, new Vector3d(16.5, 64, 0.5), X);
        // built from the far end: its frame runs toward the toe
        RailSegment reversed = graph.createSegment(new Vector3d(16.5, 64, 4.5), X, TOE, X);
        SwitchThroat throat = throat(graph);

        assertTrue(!throat.atStart(reversed.id()));
        assertEquals(SwitchThroat.MINUS_Z, throat.bladeSides(reversed.id()));
    }

    @Test
    void separationGrowsFromNothingAtTheNode() {
        RailGraph graph = turnout();
        SwitchThroat throat = throat(graph);
        int straight = throat.legIds().get(0);
        SwitchThroat.Separation gap = throat.separation(straight, SwitchThroat.MINUS_Z);

        assertEquals(0.0, gap.at(0.0), 1.0e-6);
        double previous = -1.0;
        for (double d = 0.25; d <= 3.0; d += 0.25) {
            assertTrue(gap.at(d) > previous, "diverging monotonically at " + d);
            previous = gap.at(d);
        }
        // a 16-block lead to a track 4 over: ~0.4 apart at the heel
        assertTrue(previous > 0.25 && previous < 0.6, "heel separation " + previous);
        // seen from the diverging leg, the same gap
        int diverging = throat.legIds().get(1);
        assertEquals(previous, throat.separation(diverging, SwitchThroat.PLUS_Z).at(3.0), 0.05);
        // nobody on the other side
        assertEquals(Double.POSITIVE_INFINITY, throat.separation(straight, SwitchThroat.PLUS_Z).at(1.0));
    }

    @Test
    void theStraightLegKeepsTheSleepers() {
        RailGraph graph = new RailGraph();
        RailSegment diverging = graph.createSegment(TOE, X, new Vector3d(16.5, 64, 4.5), X);
        RailSegment straight = graph.createSegment(TOE, X, new Vector3d(16.5, 64, 0.5), X);
        assertTrue(diverging.id() < straight.id());

        assertEquals(straight.id(), throat(graph).sleeperLeg());
    }

    @Test
    void aSymmetricYKeepsTheLowerIdsSleepers() {
        RailGraph graph = new RailGraph();
        RailSegment left = graph.createSegment(TOE, X, new Vector3d(16.5, 64, -3.5), X);
        graph.createSegment(TOE, X, new Vector3d(16.5, 64, 4.5), X);

        assertEquals(left.id(), throat(graph).sleeperLeg());
    }

    @Test
    void runningRailsHaveAGaugeFaceGuardRailsAndDecksDont() {
        // the standard rail: foot 0.7275..0.8975 at 0.16..0.2, head 0.7675..0.8575 at 0.40625
        float[] across = {0.7275F, 0.8975F, 0.7905F, 0.8345F, 0.7675F, 0.8575F};
        float[] height = {0.16F, 0.2F, 0.33F, 0.33F, 0.40625F, 0.40625F};
        assertEquals(0.7675, SwitchThroat.gaugeFace(across, height), 1.0e-6);
        float[] negative = {-0.7275F, -0.8975F, -0.7675F, -0.8575F};
        assertEquals(0.7675, SwitchThroat.gaugeFace(negative, new float[] {0.16F, 0.2F, 0.40625F, 0.40625F}),
                1.0e-6);

        // MVP's bridge: an angle guard rail inside the gauge, top 0.375 at 0.438..0.5
        assertTrue(Double.isNaN(SwitchThroat.gaugeFace(new float[] {0.438F, 0.625F, 0.438F, 0.5F},
                new float[] {0.188F, 0.25F, 0.375F, 0.375F})));
        // MVP's level crossing: the road deck from 0.938 out to 4
        assertTrue(Double.isNaN(SwitchThroat.gaugeFace(new float[] {0.938F, 4.0F},
                new float[] {0.438F, 0.438F})));
        assertTrue(Double.isNaN(SwitchThroat.gaugeFace(new float[0], new float[0])));
    }

    @Test
    void theBladeIsPlanedToTheStockRailAndThrownInward() {
        double face = 0.7675;
        double edge = face - SwitchThroat.BLADE_CLEARANCE;
        // at the node the whole section — head, and foot on either side — meets in one edge
        for (double z : new double[] {0.7275, 0.7675, 0.8575, 0.8975}) {
            assertEquals(edge, SwitchThroat.bladeAcross(z, SwitchThroat.PLUS_Z, face, 0.0, 0.0), 1.0e-9);
            assertEquals(-edge, SwitchThroat.bladeAcross(-z, SwitchThroat.MINUS_Z, face, 0.0, 0.0), 1.0e-9);
        }
        // a little apart: the head is a sliver as wide as the gap, the foot half grown back
        assertEquals(face + 0.02 - SwitchThroat.BLADE_CLEARANCE,
                SwitchThroat.bladeAcross(0.8575, SwitchThroat.PLUS_Z, face, 0.02, 0.0), 1.0e-9);
        assertEquals(face - 0.02 - SwitchThroat.BLADE_CLEARANCE,
                SwitchThroat.bladeAcross(0.7275, SwitchThroat.PLUS_Z, face, 0.02, 0.0), 1.0e-9);
        // a guard rail inside the gauge in the same object is not drawn in
        assertEquals(0.5, SwitchThroat.bladeAcross(0.5, SwitchThroat.PLUS_Z, face, 0.0, 0.0), 1.0e-9);
        // once the legs have parted by more than a section, the full section
        assertEquals(0.8975, SwitchThroat.bladeAcross(0.8975, SwitchThroat.PLUS_Z, face, 0.3, 0.0), 1.0e-9);
        assertEquals(0.7275, SwitchThroat.bladeAcross(0.7275, SwitchThroat.PLUS_Z, face, 0.3, 0.0), 1.0e-9);
        // thrown: toward the track centre on either side
        assertEquals(0.8975 - 0.12, SwitchThroat.bladeAcross(0.8975, SwitchThroat.PLUS_Z, face, 0.3, 0.12),
                1.0e-9);
        assertEquals(-0.8975 + 0.12, SwitchThroat.bladeAcross(-0.8975, SwitchThroat.MINUS_Z, face, 0.3, 0.12),
                1.0e-9);
        assertEquals(1.0, SwitchThroat.fade(0.0, 3.0), 1.0e-9);
        assertEquals(0.5, SwitchThroat.fade(1.5, 3.0), 1.0e-9);
        assertEquals(0.0, SwitchThroat.fade(4.0, 3.0), 1.0e-9);
    }
}
