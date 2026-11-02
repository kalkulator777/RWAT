package com.muzhik17.trainsmod.rail;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RailSegment;

/**
 * The rails' answer to a held use key (SPEC §2.2): a repaint in the look the
 * structure already has re-lays its bed but leaves the graph — no revision,
 * nothing sent — and every edit that lays out a bed, done, re-laid or
 * refused, rests the rails, the cheap answers not.
 */
class RailEditTest {

    private static final Vector3d X = new Vector3d(1, 0, 0);
    private static final RailSegment.Look STONE = new RailSegment.Look("", "stone");
    private static final RailSegment.Look PACK_RAIL = new RailSegment.Look("mvp:rail", "");

    /** A switch's two legs, one click's structure, in {@code look}. */
    private static List<RailSegment> structure(RailSegment.Look look) {
        RailGraph graph = new RailGraph();
        RailSegment main = graph.createSegment(new Vector3d(0.5, 64, 0.5), X, new Vector3d(20.5, 64, 0.5), X);
        RailSegment branch = graph.createSegment(new Vector3d(0.5, 64, 0.5), X, new Vector3d(20.5, 64, 4.5), X);
        int group = graph.newGroupId();
        for (RailSegment leg : List.of(main, branch)) {
            graph.setSegmentGroup(leg.id(), group);
            graph.setSegmentLook(leg.id(), look);
        }
        return graph.structureOf(graph.segment(main.id()));
    }

    @Test
    void aRepaintInTheLookTheStructureHasIsARelay() {
        List<RailSegment> legs = structure(STONE);
        assertEquals(2, legs.size());
        assertTrue(STONE.ofAll(legs));
        assertTrue(new RailSegment.Look(null, "stone").ofAll(legs), "null reads as the default style, as stored");
        assertTrue(RailSegment.Look.DEFAULT.ofAll(structure(RailSegment.Look.DEFAULT)));
    }

    @Test
    void anotherStyleOrBedIsARepaint() {
        List<RailSegment> legs = structure(STONE);
        assertFalse(PACK_RAIL.ofAll(legs), "style and bed differ");
        assertFalse(new RailSegment.Look("", "").ofAll(legs), "the bed differs");
        assertFalse(new RailSegment.Look("mvp:rail", "stone").ofAll(legs), "the style differs");
    }

    @Test
    void oneSegmentInAnotherLookIsARepaintOfTheWholeStructure() {
        RailGraph graph = new RailGraph();
        RailSegment a = graph.createSegment(new Vector3d(0.5, 64, 0.5), X, new Vector3d(20.5, 64, 0.5), X);
        RailSegment b = graph.createSegment(new Vector3d(0.5, 64, 0.5), X, new Vector3d(20.5, 64, 4.5), X);
        graph.setSegmentLook(a.id(), STONE);
        graph.setSegmentLook(b.id(), PACK_RAIL);
        assertFalse(STONE.ofAll(List.of(graph.segment(a.id()), graph.segment(b.id()))));
    }

    @Test
    void theHeavyEditsRestTheRailsAndTheCheapOnesDont() {
        assertEquals(RailEdit.COOLDOWN_TICKS, RailEdit.DONE.cooldownTicks());
        assertEquals(RailEdit.COOLDOWN_TICKS, RailEdit.RELAID.cooldownTicks(),
                "the bed was laid out all the same, and a held Shift+use would repeat it");
        assertEquals(RailEdit.COOLDOWN_TICKS, RailEdit.REFUSED.cooldownTicks(),
                "a refused build laid its bed out too, and a held key would repeat it");
        assertEquals(0, RailEdit.NOTHING.cooldownTicks(), "nothing was laid out");
        // a held use key repeats every 4 ticks (Minecraft.rightClickDelay): the rest must outlast it
        assertTrue(RailEdit.COOLDOWN_TICKS > 4);
    }

    @Test
    void onlyADoneEditMovesTheRevisionOnAndSendsTheGraph() {
        assertTrue(RailEdit.DONE.changesGraph(), "built, or another style or bed: the clients must draw it");
        assertFalse(RailEdit.RELAID.changesGraph(), "the same track in the same look: bed blocks only");
        assertFalse(RailEdit.REFUSED.changesGraph(), "nothing changed");
        assertFalse(RailEdit.NOTHING.changesGraph());
    }
}
