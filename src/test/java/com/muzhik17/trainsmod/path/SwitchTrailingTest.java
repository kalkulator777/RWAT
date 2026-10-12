package com.muzhik17.trainsmod.path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

/**
 * Trailing through switches (SPEC §2.2): a train running onto a switch from
 * one of its legs passes onto the stem whatever the switch is set to, and
 * leaves it set as it was; a train from the stem takes the leg the switch is
 * set to. The trains here re-walk their routes the way {@code Consist} does
 * ({@link Rider}: span under the train → {@link RailGraph#rewalk}) — the
 * consist itself pulls in the MC runtime, absent on the test classpath.
 *
 * <p>The regression: one visited set for both directions of a route walk cut
 * the route short in cycles — round a loop with a passing siding, a train
 * coming off the siding against a switch set for the main line ran into the
 * end of its route at that switch and stopped dead.
 */
class SwitchTrailingTest {

    private static final Vector3d X = new Vector3d(1, 0, 0);

    private static RailSegment seg(RailGraph graph, double ax, double az, Vector3d dirA,
            double bx, double bz, Vector3d dirB) {
        return graph.createSegment(new Vector3d(ax, 0, az), dirA, new Vector3d(bx, 0, bz), dirB);
    }

    /** Chord-aligned tangents (what straight markers produce). */
    private static RailSegment connect(RailGraph graph, double ax, double az, double bx, double bz) {
        Vector3d chord = new Vector3d(bx - ax, 0, bz - az);
        return graph.createSegment(new Vector3d(ax, 0, az), chord, new Vector3d(bx, 0, bz), chord);
    }

    private static int node(RailGraph graph, double x, double z) {
        return graph.nodeNear(new Vector3d(x, 0, z)).id();
    }

    /**
     * A consist as far as routing goes: a route, its head {@code s} and a
     * length behind it; re-walked whenever the legs under it change, like
     * {@code Consist.resolvePath}.
     */
    private static final class Rider {
        final RailGraph graph;
        final double length;
        List<RailGraph.RouteLeg> legs;
        RoutePath path;
        double s;
        List<RailGraph.RouteLeg> kept;
        /** Segments the head ran over, in order (no repeats in a row). */
        final List<Integer> headSegments = new ArrayList<>();

        Rider(RailGraph graph, RailSegment on, double fraction, double length, boolean backwards) {
            this.graph = graph;
            this.length = length;
            RailGraph.Walk walk = graph.walkAround(List.of(new RailGraph.RouteLeg(on.id(), false)));
            legs = walk.legs();
            double along = new HermiteSegmentPath(graph.hermite(on)).length() * fraction;
            s = graph.legS(legs, walk.keptStart(), along);
            if (backwards) {
                legs = RailGraph.inverted(legs);
                path = graph.buildRoutePath(legs);
                s = path.length() - s;
            } else {
                path = graph.buildRoutePath(legs);
            }
            s += length; // the head ahead of the starting point, the train behind it
            rewalk();
        }

        void rewalk() {
            RailGraph.Span span = RailGraph.span(legs, path, s - length - 0.05, s + 0.05);
            if (span.legs().equals(kept)) {
                return;
            }
            kept = span.legs();
            RailGraph.Rewalk rewalk = graph.rewalk(legs, path, span);
            if (rewalk != null) {
                Vector3d head = path.samplePosition(s);
                Vector3d rear = path.samplePosition(s - length);
                legs = rewalk.legs();
                path = graph.buildRoutePath(legs);
                s += rewalk.shift();
                assertEquals(0.0, head.distance(path.samplePosition(s)), 1.0e-6, "re-walk moved the head");
                assertEquals(0.0, rear.distance(path.samplePosition(s - length)), 1.0e-6,
                        "re-walk moved the rear");
            }
        }

        /** The segment under the head. */
        int headSegment() {
            return RailGraph.span(legs, path, s, s).legs().get(0).segmentId();
        }

        /**
         * Run {@code distance} at {@code v} per step (signed: −v backs up).
         * Returns false if the train ran into an end of its route.
         */
        boolean run(double distance, double v) {
            for (double done = 0.0; done < distance; done += Math.abs(v)) {
                rewalk();
                Vector3d before = path.samplePosition(s);
                s += v;
                if (!path.loop() && (s > path.length() || s - length < 0.0)) {
                    return false;
                }
                assertEquals(Math.abs(v), before.distance(path.samplePosition(s)), Math.abs(v) * 0.05 + 1.0e-6,
                        "the head moves smoothly");
                int segment = headSegment();
                if (headSegments.isEmpty() || headSegments.get(headSegments.size() - 1) != segment) {
                    headSegments.add(segment);
                }
            }
            return true;
        }

        /** Whether the end the train runs to is a real track end (no continuation in the graph). */
        boolean atRealEnd(boolean forward) {
            RailGraph.RouteLeg leg = forward ? legs.get(legs.size() - 1) : RailGraph.inverted(legs).get(legs.size() - 1);
            RailSegment segment = graph.segment(leg.segmentId());
            int end = leg.reversed() ? segment.nodeA() : segment.nodeB();
            return graph.continuation(segment, end) == null;
        }
    }

    /** A plain switch: stem → toe, two legs with tracks beyond them. */
    private record Y(RailGraph graph, int toe, RailSegment stem, RailSegment straight, RailSegment diverging) {
    }

    private static Y buildY() {
        RailGraph graph = new RailGraph();
        RailSegment stem = seg(graph, -60, 0, X, 0, 0, X);
        RailSegment straight = seg(graph, 0, 0, X, 30, 0, X);
        RailSegment diverging = seg(graph, 0, 0, X, 30, 10, X);
        seg(graph, 30, 0, X, 90, 0, X);
        seg(graph, 30, 10, X, 90, 10, X);
        return new Y(graph, node(graph, 0, 0), stem, straight, diverging);
    }

    @Test
    void facingFollowsTheSwitchTrailingPassesOntoTheStemInEitherPosition() {
        for (int selection = 0; selection < 2; selection++) {
            Y y = buildY();
            y.graph().setSwitchSelection(y.toe(), selection);
            RailSegment set = selection == 0 ? y.straight() : y.diverging();

            // facing, from the stem: onto the leg the switch is set to
            Rider facing = new Rider(y.graph(), y.stem(), 0.2, 18.0, false);
            assertTrue(facing.run(60.0, 0.5), "facing move runs through");
            assertTrue(facing.headSegments.contains(set.id()), "facing move takes the set leg");

            // trailing, from either leg (backing out of it toward the toe)
            for (RailSegment leg : new RailSegment[] {y.straight(), y.diverging()}) {
                Rider trailing = new Rider(y.graph(), leg, 0.9, 18.0, true);
                assertTrue(trailing.run(50.0, 0.5),
                        "trailing from leg #" + leg.id() + " with the switch at " + selection + " runs through");
                assertEquals(y.stem().id(), trailing.headSegment(), "and ends up on the stem");
                assertEquals(selection, y.graph().switchSelection(y.toe()), "the switch stays as it was");
            }
        }
    }

    @Test
    void afterTrailingAgainstTheSwitchABackingTrainTakesTheSetLeg() {
        Y y = buildY();
        y.graph().setSwitchSelection(y.toe(), 0); // set for the straight leg
        Rider train = new Rider(y.graph(), y.diverging(), 0.9, 18.0, true);
        assertTrue(train.run(60.0, 0.5), "off the diverging leg onto the stem, against the switch");
        assertEquals(y.stem().id(), train.headSegment());
        // clear of the switch: backing up is a facing move, by the switch
        train.headSegments.clear();
        assertTrue(train.run(70.0, -0.5));
        assertTrue(train.headSegments.contains(y.straight().id()), "backs onto the leg the switch is set to");
        assertFalse(train.headSegments.contains(y.diverging().id()));
    }

    @Test
    void aSwitchThrownUnderATrainLeavesItOnItsLegs() {
        Y y = buildY();
        y.graph().setSwitchSelection(y.toe(), 1); // diverging
        // trailing off the diverging leg, stopped with the head on the stem and the rear still on the leg
        Rider train = new Rider(y.graph(), y.diverging(), 0.9, 18.0, true);
        while (train.headSegment() != y.stem().id() || !train.kept.contains(
                new RailGraph.RouteLeg(y.diverging().id(), true))) {
            assertTrue(train.run(0.5, 0.5));
        }
        y.graph().setSwitchSelection(y.toe(), 0); // thrown under the train
        RailGraph.Span span = RailGraph.span(train.legs, train.path, train.s - train.length, train.s);
        assertTrue(span.legs().contains(new RailGraph.RouteLeg(y.diverging().id(), true)));
        RailGraph.Rewalk rewalk = y.graph().rewalk(train.legs, train.path, span);
        List<RailGraph.RouteLeg> legs = rewalk == null ? train.legs : rewalk.legs();
        assertTrue(legs.contains(new RailGraph.RouteLeg(y.diverging().id(), true)),
                "the rear stays on the diverging leg it stands on");
        assertFalse(legs.contains(new RailGraph.RouteLeg(y.straight().id(), true)),
                "nothing under the train jumps to the straight leg");
    }

    /**
     * A loop with a passing siding: ring 1–2–5–6–7–8 through the main line
     * (A–D), siding 3–4 between the same switches A and D.
     */
    private record Oval(RailGraph graph, int a, int d, RailSegment main, RailSegment siding,
            List<RailSegment> all) {
    }

    private static Oval buildOval() {
        RailGraph graph = new RailGraph();
        List<RailSegment> all = new ArrayList<>();
        all.add(seg(graph, 0, 0, X, 10, 0, X));                // P0 → A
        RailSegment main = seg(graph, 10, 0, X, 30, 0, X);    // A → D, main line
        all.add(main);
        RailSegment siding = seg(graph, 10, 0, X, 20, -4, X); // A → Q, siding
        all.add(siding);
        all.add(seg(graph, 20, -4, X, 30, 0, X));              // Q → D
        all.add(seg(graph, 30, 0, X, 40, 0, X));               // D → P1
        all.add(connect(graph, 40, 0, 40, 40));
        all.add(connect(graph, 40, 40, 0, 40));
        all.add(connect(graph, 0, 40, 0, 0));                  // closes the ring
        return new Oval(graph, node(graph, 10, 0), node(graph, 30, 0), main, siding, all);
    }

    @Test
    void roundALoopWithAPassingSidingTrainsNeverRunOutOfRoute() {
        for (int selA = 0; selA < 2; selA++) {
            for (int selD = 0; selD < 2; selD++) {
                for (int start = 0; start < 8; start++) {
                    for (boolean backwards : new boolean[] {false, true}) {
                        Oval oval = buildOval();
                        oval.graph().setSwitchSelection(oval.a(), selA);
                        oval.graph().setSwitchSelection(oval.d(), selD);
                        Rider train = new Rider(oval.graph(), oval.all().get(start), 0.5, 18.0, backwards);
                        String what = "A=" + selA + " D=" + selD + " from #" + oval.all().get(start).id()
                                + (backwards ? " backwards" : "");
                        assertTrue(train.run(600.0, 0.7), what + ": three laps without a stop");
                        assertEquals(selA, oval.graph().switchSelection(oval.a()), what);
                        assertEquals(selD, oval.graph().switchSelection(oval.d()), what);
                    }
                }
            }
        }
    }

    @Test
    void offTheSidingAgainstASwitchSetForTheMainLine() {
        // the reported case: A sends trains into the siding, D is set for the main line
        Oval oval = buildOval();
        oval.graph().setSwitchSelection(oval.a(), 1);
        oval.graph().setSwitchSelection(oval.d(), 0);
        Rider train = new Rider(oval.graph(), oval.all().get(0), 0.5, 18.0, false);
        assertTrue(train.run(250.0, 0.7), "through A into the siding, off it through D, round again");
        assertTrue(train.headSegments.contains(oval.siding().id()), "facing at A: into the siding");
        assertFalse(train.headSegments.contains(oval.main().id()), "never on the main line");
        assertEquals(0, oval.graph().switchSelection(oval.d()), "D still set for the main line");
        assertNotNull(train.path);
        assertFalse(train.path.loop(), "the two directions disagree: an open route, re-walked as it goes");

        // backing up, D is a facing switch set for the main line: that way it goes
        train.headSegments.clear();
        assertTrue(train.run(250.0, -0.7));
        assertTrue(train.headSegments.contains(oval.main().id()), "backing through D onto the main line");
    }

    @Test
    void switchesAgreeingBothWaysMakeAClosedLoop() {
        Oval oval = buildOval();
        oval.graph().setSwitchSelection(oval.a(), 1);
        oval.graph().setSwitchSelection(oval.d(), 1);
        Rider train = new Rider(oval.graph(), oval.all().get(4), 0.5, 18.0, false);
        assertTrue(train.path.loop(), "round through the siding either way: a loop");
        List<RailGraph.RouteLeg> legs = train.legs;
        assertTrue(train.run(400.0, 0.7));
        assertTrue(train.path.loop());
        assertEquals(legs, train.legs, "the loop keeps its numbering lap after lap");
        assertTrue(train.s > train.path.length(), "s grows on round the loop");
    }

    @Test
    void aBalloonLoopRunsBackOutOverItsStem() {
        for (int selection = 0; selection < 2; selection++) {
            RailGraph graph = new RailGraph();
            RailSegment stem = seg(graph, -60, 0, X, 0, 0, X);
            seg(graph, 0, 0, X, 30, 15, X);
            seg(graph, 0, 0, X, 30, -15, X);
            seg(graph, 30, 15, X, 60, 0, new Vector3d(0, 0, 1));
            seg(graph, 60, 0, new Vector3d(0, 0, 1), 30, -15, X);
            graph.setSwitchSelection(node(graph, 0, 0), selection);

            Rider train = new Rider(graph, stem, 0.1, 18.0, false);
            List<RailGraph.RouteLeg> route = train.legs;
            assertEquals(new RailGraph.RouteLeg(stem.id(), true), route.get(route.size() - 1),
                    "the route runs round the balloon and back out over the stem");
            assertFalse(train.run(400.0, 0.7), "until the stem's far end");
            assertTrue(train.atRealEnd(true), "a real track end, not the switch");
            assertEquals(stem.id(), train.headSegment());
        }
    }

    @Test
    void aRouteRepeatingASegmentIsNoLoop() {
        Oval oval = buildOval();
        RailSegment first = oval.all().get(0);
        List<RailGraph.RouteLeg> walked = oval.graph().walkRoute(first.id());
        assertTrue(oval.graph().closesLoop(walked), "the ring as walked is a loop");
        List<RailGraph.RouteLeg> twice = new ArrayList<>(walked);
        twice.addAll(walked);
        assertFalse(oval.graph().closesLoop(twice), "twice round is no loop");
    }
}
