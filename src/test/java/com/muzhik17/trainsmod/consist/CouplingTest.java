package com.muzhik17.trainsmod.consist;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.path.RailGraph;
import com.muzhik17.trainsmod.path.RailSegment;
import com.muzhik17.trainsmod.path.RoutePath;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Coupling on contact and uncoupling at a coupler (SPEC §6.12): the
 * same-track test, contact + hysteresis, merge ordering/turning, momentum, and
 * that the kept consist's wagons (and its client frame) don't move. Pure — the
 * graph, routes and compositions are the real ones, no MC classes.
 */
class CouplingTest {

    private static final double EPS = 1.0e-6;
    private static final double GAP = ConsistComposition.COUPLER_GAP;

    /** 20-block loco, 80 t, bogies ±7. */
    private static final WagonType LOCO = type("test:loco", 20.0, 7.0, 80.0);
    /** 14-block wagon, 20 t, asymmetric bogies (+4 / −5) so turning a wagon shows. */
    private static final WagonType CAR = new WagonType("test:car", 14.0, new double[] {4.0, -5.0},
            20.0, 100.0, WagonType.Resistance.NONE, null, null, WagonType.Brakes.NONE, null);

    private static WagonType type(String id, double length, double bogie, double massT) {
        return new WagonType(id, length, new double[] {bogie, -bogie}, massT, 100.0,
                WagonType.Resistance.NONE, null, null, WagonType.Brakes.NONE, null);
    }

    private static ConsistComposition comp(ConsistComposition.Slot... slots) {
        return new ConsistComposition(List.of(slots));
    }

    private static ConsistComposition.Slot slot(WagonType type, boolean flipped) {
        return new ConsistComposition.Slot(type, flipped);
    }

    private static RailSegment connect(RailGraph graph, Vector3d a, Vector3d b) {
        Vector3d chord = new Vector3d(b).sub(a);
        return graph.createSegment(a, chord, b, chord);
    }

    private static Coupling.Train train(RailGraph graph, List<RailGraph.RouteLeg> legs,
            ConsistComposition composition, double headS, double v) {
        return new Coupling.Train(legs, graph.buildRoutePath(legs), composition, headS, v);
    }

    /** Head s that puts a composition's front frame face at {@code frontEnd}. */
    private static double headForFront(ConsistComposition composition, double frontEnd) {
        return frontEnd - Coupling.frontEndS(composition, 0.0);
    }

    /** Head s that puts a composition's rear frame face at {@code rearEnd}. */
    private static double headForRear(ConsistComposition composition, double rearEnd) {
        return rearEnd - Coupling.rearEndS(composition, 0.0);
    }

    /** A straight 2-segment line along +X, 0..200. */
    private static RailGraph line() {
        RailGraph graph = new RailGraph();
        connect(graph, new Vector3d(0, 0, 0), new Vector3d(100, 0, 0));
        connect(graph, new Vector3d(100, 0, 0), new Vector3d(200, 0, 0));
        return graph;
    }

    private static List<RailGraph.RouteLeg> routeOf(RailGraph graph, int segmentId) {
        return graph.walkRoute(segmentId);
    }

    private static Vector3d at(RoutePath path, double s) {
        return path.samplePosition(s);
    }

    @Test
    void ownRouteMapsByIdentity() {
        RailGraph graph = line();
        List<RailGraph.RouteLeg> legs = routeOf(graph, 1);
        Coupling.Train t = train(graph, legs, comp(slot(LOCO, false)), 50.0, 0.0);

        Coupling.Placement p = Coupling.place(t, legs, t.path());

        assertNotNull(p);
        assertEquals(0.0, p.offset(), 0.0);
        assertEquals(1, p.dir());
    }

    @Test
    void sameTrackWalkedBackwards_mapsMirrored() {
        RailGraph graph = line();
        List<RailGraph.RouteLeg> legs = routeOf(graph, 1);
        List<RailGraph.RouteLeg> back = Coupling.inverted(legs);
        Coupling.Train t = train(graph, back, comp(slot(LOCO, false)), 120.0, 0.0);
        RoutePath forward = graph.buildRoutePath(legs);

        Coupling.Placement p = Coupling.place(t, legs, forward);

        assertNotNull(p);
        assertEquals(-1, p.dir());
        // the same world point either way
        double s = 113.0;
        assertEquals(0.0, at(t.path(), s).distance(at(forward, p.map(s))), EPS);
    }

    @Test
    void headOnContact_couplesWithMomentumAndKeepsTheKeptWagonsStill() {
        RailGraph graph = line();
        List<RailGraph.RouteLeg> legs = routeOf(graph, 1);
        ConsistComposition locoC = comp(slot(LOCO, false));
        ConsistComposition carC = comp(slot(CAR, false));
        // loco runs +s at 0.1 b/t, front face at 90; the car stands with its rear face
        // half a block inside coupling reach (the loco ran into it during the tick)
        Coupling.Train loco = train(graph, legs, locoC, headForFront(locoC, 90.0), 0.1);
        Coupling.Train car = train(graph, legs, carC, headForRear(carC, 90.0 + GAP - 0.5), 0.0);

        Coupling.Merge merge = Coupling.tryCouple(loco, car);

        assertNotNull(merge, "touching and closing must couple");
        // the car is ahead (higher s): it leads the merged consist
        assertEquals(2, merge.composition().wagonCount());
        assertEquals(CAR, merge.composition().slot(0).type());
        assertEquals(LOCO, merge.composition().slot(1).type());
        assertEquals(List.of(new Coupling.Member(Coupling.Member.ABSORBED, 0, false),
                new Coupling.Member(Coupling.Member.KEPT, 0, false)), merge.members());
        // momentum: 80 t at 0.1 + 20 t at rest
        assertEquals(80.0 * 0.1 / 100.0, merge.v(), EPS);
        // the loco (kept) didn't move …
        assertEquals(locoC.bodyCenterS(loco.headS(), 0),
                merge.composition().bodyCenterS(merge.headS(), 1), EPS);
        // … the car snapped to exactly the coupler gap
        double locoFront = Coupling.frontEndS(locoC, loco.headS());
        double carRear = merge.composition().bodyCenterS(merge.headS(), 0) - CAR.length() * 0.5;
        assertEquals(GAP, carRear - locoFront, EPS);
        // old head values of the kept loco carry into the new frame by the shift
        for (double old : new double[] {loco.headS(), loco.headS() - 0.37}) {
            assertEquals(old, merge.composition().frontBogieS(old + merge.frameShift(), 1), EPS);
        }
        assertEquals(locoFront + GAP * 0.5, merge.contactS(), EPS);
    }

    @Test
    void notClosing_doesNotCouple() {
        RailGraph graph = line();
        List<RailGraph.RouteLeg> legs = routeOf(graph, 1);
        ConsistComposition locoC = comp(slot(LOCO, false));
        ConsistComposition carC = comp(slot(CAR, false));
        double head = headForFront(locoC, 90.0);
        double carHead = headForRear(carC, 90.0 + GAP - 0.5);

        // same speed, both moving
        assertNull(Coupling.tryCouple(train(graph, legs, locoC, head, 0.2),
                train(graph, legs, carC, carHead, 0.2)));
        // separating
        assertNull(Coupling.tryCouple(train(graph, legs, locoC, head, -0.1),
                train(graph, legs, carC, carHead, 0.0)));
        // closing, but too far apart yet
        double farCar = headForRear(carC, 90.0 + GAP + 0.2);
        assertNull(Coupling.tryCouple(train(graph, legs, locoC, head, 0.1),
                train(graph, legs, carC, farCar, 0.0)));
    }

    @Test
    void uncoupledHalvesStayApart_untilPushedTogether() {
        RailGraph graph = line();
        List<RailGraph.RouteLeg> legs = routeOf(graph, 1);
        ConsistComposition three = comp(slot(LOCO, false), slot(CAR, false), slot(CAR, true));
        double head = 120.0;
        Coupling.Split split = Coupling.split(three, head, 1);

        // right after uncoupling: exactly the coupler gap, equal speed → no re-coupling
        for (double v : new double[] {0.0, 0.3, -0.3}) {
            assertNull(Coupling.tryCouple(
                    train(graph, legs, split.front(), head, v),
                    train(graph, legs, split.rear(), split.rearHeadS(), v)),
                    "halves at the coupler gap with equal speed must not re-couple (v=" + v + ")");
        }
        // the loco backs onto the cars again → couples
        Coupling.Merge merge = Coupling.tryCouple(
                train(graph, legs, split.front(), head, -0.01),
                train(graph, legs, split.rear(), split.rearHeadS(), 0.0));
        assertNotNull(merge, "pushing them together again couples");
        assertEquals(three.slots(), merge.composition().slots());
        assertEquals(head, merge.headS(), EPS);
        assertEquals(0.0, merge.frameShift(), EPS);
    }

    @Test
    void split_keepsEveryWagonInPlace() {
        ConsistComposition three = comp(slot(LOCO, false), slot(CAR, true), slot(CAR, false));
        double head = 75.0;

        Coupling.Split split = Coupling.split(three, head, 1);

        assertEquals(1, split.front().wagonCount());
        assertEquals(2, split.rear().wagonCount());
        assertEquals(three.bodyCenterS(head, 0), split.front().bodyCenterS(head, 0), EPS);
        for (int i = 0; i < 2; i++) {
            assertEquals(three.bodyCenterS(head, i + 1),
                    split.rear().bodyCenterS(split.rearHeadS(), i), EPS);
            assertEquals(three.rearBogieS(head, i + 1),
                    split.rear().rearBogieS(split.rearHeadS(), i), EPS);
        }
        // the coupler that was cut sits midway between the two frames
        assertEquals(Coupling.rearEndS(split.front(), head) - GAP * 0.5,
                Coupling.couplerS(three, head, 0), EPS);
        assertEquals(Coupling.frontEndS(split.rear(), split.rearHeadS()) + GAP * 0.5,
                Coupling.couplerS(three, head, 0), EPS);
    }

    @Test
    void absorbedRunningAgainstTheRoute_joinsReversedAndTurned() {
        RailGraph graph = line();
        List<RailGraph.RouteLeg> legs = routeOf(graph, 1);
        List<RailGraph.RouteLeg> back = Coupling.inverted(legs);
        RoutePath forward = graph.buildRoutePath(legs);
        ConsistComposition locoC = comp(slot(LOCO, false));
        // two cars on the reversed route: car0 plain, car1 flipped
        ConsistComposition carsC = comp(slot(CAR, false), slot(CAR, true));
        double length = forward.length();
        // loco front face at 90 (forward frame); the cars ahead of it, running the other
        // way: their front face (back frame) 0.6 inside coupling reach, at forward
        // 90 + GAP − 0.6 = back length − that
        Coupling.Train loco = train(graph, legs, locoC, headForFront(locoC, 90.0), 0.0);
        Coupling.Train cars = train(graph, back, carsC,
                headForFront(carsC, length - (90.0 + GAP - 0.6)), 0.05);

        Coupling.Merge merge = Coupling.tryCouple(loco, cars);

        assertNotNull(merge);
        assertEquals(legs, merge.legs(), "the kept loco's own route, unchanged");
        // the cars head towards −s in the merged frame: they join reversed, each turned
        assertEquals(List.of(
                new Coupling.Member(Coupling.Member.ABSORBED, 1, true),
                new Coupling.Member(Coupling.Member.ABSORBED, 0, true),
                new Coupling.Member(Coupling.Member.KEPT, 0, false)), merge.members());
        assertFalse(merge.composition().slot(0).flipped(), "car1 was flipped, turned it isn't");
        assertTrue(merge.composition().slot(1).flipped(), "car0 wasn't flipped, turned it is");
        // the cars rolled towards the loco at 0.05 in their frame = −0.05 here
        assertEquals((40.0 * -0.05) / 120.0, merge.v(), EPS);
        // every car bogie lands where it was, up to the snap (0.6 back from the overlap)
        RoutePath mergedPath = graph.buildRoutePath(merge.legs());
        double snap = 0.6;
        for (int i = 0; i < 2; i++) {
            int merged = 1 - i;
            Vector3d before = at(cars.path(), carsC.frontBogieS(cars.headS(), i));
            // turned: the old front bogie is the merged rear one
            Vector3d after = at(mergedPath, merge.composition().rearBogieS(merge.headS(), merged));
            assertEquals(snap, before.distance(after), 1.0e-4, "car " + i + " moved only by the snap");
        }
    }

    /** trunk node(0) → (−40); straight leg node(0) → (+20); diverging leg node(0) → (20, 0, 18). */
    private record Switch(RailGraph graph, RailSegment trunk, RailSegment straight, RailSegment diverge) {
    }

    private static Switch buildSwitch() {
        RailGraph graph = new RailGraph();
        RailSegment trunk = connect(graph, new Vector3d(0, 0, 0), new Vector3d(-40, 0, 0));
        RailSegment straight = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 0));
        RailSegment diverge = connect(graph, new Vector3d(0, 0, 0), new Vector3d(20, 0, 18));
        return new Switch(graph, trunk, straight, diverge);
    }

    /** Own-route s of the point {@code d} blocks from the toe (the origin) along a leg of {@code legs}. */
    private static double fromToe(RailGraph graph, List<RailGraph.RouteLeg> legs, int segmentId,
            double d) {
        RoutePath path = graph.buildRoutePath(legs);
        for (int i = 0; i < legs.size(); i++) {
            if (legs.get(i).segmentId() == segmentId) {
                double start = path.partStartS(i);
                boolean toeAtStart = path.samplePosition(start).length() < 1.0e-6;
                return toeAtStart ? start + d : start + path.partLength(i) - d;
            }
        }
        throw new AssertionError("segment not on route");
    }

    /**
     * A one-car train on {@code legs} whose toe-side frame face is {@code d}
     * off the toe on {@code segmentId}, running towards the toe at {@code speed}.
     */
    private static Coupling.Train nearToe(Switch sw, List<RailGraph.RouteLeg> legs, int segmentId,
            double d, ConsistComposition c, double speed) {
        double face = fromToe(sw.graph(), legs, segmentId, d);
        RoutePath path = sw.graph().buildRoutePath(legs);
        // toe on the low-s side of the face → the face is the car's rear, and the toe is at −s
        boolean toeBelow = path.samplePosition(face - 0.5).length()
                < path.samplePosition(face).length();
        double head = toeBelow ? headForRear(c, face) : headForFront(c, face);
        return train(sw.graph(), legs, c, head, toeBelow ? -speed : speed);
    }

    @Test
    void switchSetAgainstTheOtherConsist_doesNotCouple() {
        Switch sw = buildSwitch(); // selection 0: the straight leg
        ConsistComposition carC = comp(slot(CAR, false));
        List<RailGraph.RouteLeg> onStraight = routeOf(sw.graph(), sw.straight().id());
        List<RailGraph.RouteLeg> onDiverge = routeOf(sw.graph(), sw.diverge().id());
        assertFalse(onStraight.contains(new RailGraph.RouteLeg(sw.diverge().id(), false))
                || onStraight.contains(new RailGraph.RouteLeg(sw.diverge().id(), true)));
        // a car on each leg, toe-side faces 0.6 off the toe (world-close), closing fast
        Coupling.Train t1 = nearToe(sw, onStraight, sw.straight().id(), 0.6, carC, 0.2);
        Coupling.Train t2 = nearToe(sw, onDiverge, sw.diverge().id(), 0.6, carC, 0.2);
        assertTrue(t1.path().samplePosition(Coupling.rearEndS(carC, t1.headS())).distance(
                t2.path().samplePosition(Coupling.rearEndS(carC, t2.headS())))
                        < GAP + Coupling.CONTACT_SLACK,
                "the two faces are close in the world");

        // no route holds both: different tracks
        assertNull(Coupling.tryCouple(t1, t2));
        assertNull(Coupling.tryCouple(t2, t1));
    }

    @Test
    void parallelTracks_doNotCouple() {
        RailGraph graph = new RailGraph();
        RailSegment one = connect(graph, new Vector3d(0, 0, 0), new Vector3d(100, 0, 0));
        RailSegment two = connect(graph, new Vector3d(0, 0, 1.5 + 0.01), new Vector3d(100, 0, 1.51));
        ConsistComposition carC = comp(slot(CAR, false));
        // side by side, overlapping lengthwise, closing
        Coupling.Train t1 = train(graph, routeOf(graph, one.id()), carC, headForFront(carC, 50.0), 0.1);
        Coupling.Train t2 = train(graph, routeOf(graph, two.id()), carC, headForRear(carC, 50.5), 0.0);

        assertNull(Coupling.tryCouple(t1, t2));
    }

    @Test
    void keptRunningAgainstTheOtherRoute_usesItInvertedAndKeepsItsDirection() {
        Switch sw = buildSwitch();
        // kept loco on the trunk: its route runs straight leg → toe → trunk
        List<RailGraph.RouteLeg> kRoute = routeOf(sw.graph(), sw.trunk().id());
        // a car on the diverging leg: its route runs trunk → toe → diverging leg,
        // the trunk the other way round, and doesn't contain the loco's straight leg
        List<RailGraph.RouteLeg> cRoute = routeOf(sw.graph(), sw.diverge().id());
        ConsistComposition locoC = comp(slot(LOCO, false));
        ConsistComposition carC = comp(slot(CAR, false));
        // loco on the trunk: front face at the far end side, rear face 0.5 off the toe
        double kRear = fromToe(sw.graph(), kRoute, sw.trunk().id(), 0.5);
        Coupling.Train loco = train(sw.graph(), kRoute, locoC, headForRear(locoC, kRear), -0.1);
        // car by the diverging leg, its toe-side face 0.2 inside coupling reach of the
        // loco: GAP − 0.7 off the toe (a negative distance is past the toe, on the trunk)
        double cFace = fromToe(sw.graph(), cRoute, sw.diverge().id(), GAP - 0.7);
        Coupling.Train car = train(sw.graph(), cRoute, carC, headForRear(carC, cFace), 0.0);
        assertTrue(car.path().partCount() == 2 && cRoute.get(1).segmentId() == sw.diverge().id());

        Coupling.Merge merge = Coupling.tryCouple(loco, car);

        assertNotNull(merge, "coupled over the car's route");
        assertEquals(Coupling.inverted(cRoute), merge.legs(), "inverted so the loco keeps +s");
        assertEquals(LOCO, merge.composition().slot(0).type(), "the loco leads");
        assertTrue(merge.composition().slot(1).flipped(), "the car runs against the merged route");
        assertEquals(-0.1 * 80.0 / 100.0, merge.v(), EPS);
        // the loco stays put, and its old frame carries over by the shift
        RoutePath mergedPath = sw.graph().buildRoutePath(merge.legs());
        for (double old : new double[] {loco.headS(), loco.headS() + 0.4}) {
            assertEquals(0.0, at(loco.path(), old).distance(at(mergedPath, old + merge.frameShift())),
                    1.0e-6);
        }
        assertEquals(0.0, at(loco.path(), locoC.bodyCenterS(loco.headS(), 0)).distance(
                at(mergedPath, merge.composition().bodyCenterS(merge.headS(), 0))), 1.0e-6);
    }

    @Test
    void contactAcrossTheSeamOfALoop() {
        RailGraph graph = new RailGraph();
        RailSegment first = connect(graph, new Vector3d(0, 0, 0), new Vector3d(40, 0, 0));
        connect(graph, new Vector3d(40, 0, 0), new Vector3d(40, 0, 40));
        connect(graph, new Vector3d(40, 0, 40), new Vector3d(0, 0, 40));
        connect(graph, new Vector3d(0, 0, 40), new Vector3d(0, 0, 0));
        List<RailGraph.RouteLeg> legs = routeOf(graph, first.id());
        RoutePath path = graph.buildRoutePath(legs);
        assertTrue(path.loop());
        double length = path.length();
        ConsistComposition locoC = comp(slot(LOCO, false));
        ConsistComposition carC = comp(slot(CAR, false));
        // car's rear face 0.4 past the seam; the loco's front face 0.4 inside coupling
        // reach of it, written one lap on (s grows freely on loops)
        Coupling.Train loco = train(graph, legs, locoC,
                headForFront(locoC, 2 * length + 0.4 - (GAP - 0.4)), 0.1);
        Coupling.Train car = train(graph, legs, carC, headForRear(carC, 0.4), 0.0);

        Coupling.Merge merge = Coupling.tryCouple(loco, car);

        assertNotNull(merge, "the gap is measured the near way round the loop");
        assertEquals(CAR, merge.composition().slot(0).type());
        assertEquals(0.0, at(path, locoC.bodyCenterS(loco.headS(), 0)).distance(
                at(path, merge.composition().bodyCenterS(merge.headS(), 1))), 1.0e-6);
        assertEquals(loco.headS(), merge.composition().frontBogieS(
                loco.headS() + merge.frameShift(), 1), EPS);
    }

    @Test
    void sameLoopWalkedFromAnotherSegment_placesModuloTheLap() {
        RailGraph graph = new RailGraph();
        RailSegment first = connect(graph, new Vector3d(0, 0, 0), new Vector3d(40, 0, 0));
        RailSegment second = connect(graph, new Vector3d(40, 0, 0), new Vector3d(40, 0, 40));
        connect(graph, new Vector3d(40, 0, 40), new Vector3d(0, 0, 40));
        connect(graph, new Vector3d(0, 0, 40), new Vector3d(0, 0, 0));
        List<RailGraph.RouteLeg> fromFirst = routeOf(graph, first.id());
        List<RailGraph.RouteLeg> fromSecond = routeOf(graph, second.id());
        RoutePath pathFirst = graph.buildRoutePath(fromFirst);
        RoutePath pathSecond = graph.buildRoutePath(fromSecond);
        assertTrue(pathFirst.loop() && pathSecond.loop());
        assertFalse(fromFirst.equals(fromSecond), "a rotated leg list");
        ConsistComposition locoC = comp(slot(LOCO, false));
        ConsistComposition carC = comp(slot(CAR, false));
        // the loco straddles the first route's seam
        Coupling.Train loco = train(graph, fromFirst, locoC, headForFront(locoC, 8.0), 0.1);
        Coupling.Placement p = Coupling.place(loco, fromSecond, pathSecond);
        assertNotNull(p, "a loop walked from elsewhere is the same track");
        for (double s : new double[] {loco.headS(), Coupling.rearEndS(locoC, loco.headS())}) {
            assertEquals(0.0, at(pathFirst, s).distance(at(pathSecond, p.map(s))), 1.0e-6);
        }
        // a car ahead of the loco, on the other walk of the loop: couples
        double carRearFirst = 8.0 + GAP - 0.5;
        Coupling.Train car = train(graph, fromSecond, carC,
                headForRear(carC, p.map(carRearFirst)), 0.0);
        Coupling.Merge merge = Coupling.tryCouple(loco, car);
        assertNotNull(merge);
        assertEquals(CAR, merge.composition().slot(0).type());
        assertEquals(0.0, at(pathFirst, locoC.bodyCenterS(loco.headS(), 0)).distance(
                at(graph.buildRoutePath(merge.legs()),
                        merge.composition().bodyCenterS(merge.headS(), 1))), 1.0e-6);
    }

    @Test
    void negativeCouplerOffsets_coupleWithTheFramesOverlapping() {
        RailGraph graph = line();
        List<RailGraph.RouteLeg> legs = routeOf(graph, 1);
        // couplers 0.15 inside each frame end, as in the MVP pack
        WagonType inset = new WagonType("test:inset", 14.0, new double[] {5.0, -5.0}, 20.0, 100.0,
                WagonType.Resistance.NONE, null, null, WagonType.Brakes.NONE, null, List.of(),
                new WagonType.Couplers(-0.15, -0.15));
        ConsistComposition c = comp(slot(inset, false));
        double frontFrame = 90.0;
        Coupling.Train pusher = train(graph, legs, c, headForFront(c, frontFrame - 0.15), 0.1);
        // the other car's frame starts 0.2 short of the pusher's frame end: no contact yet …
        Coupling.Train apart = train(graph, legs, c, headForRear(c, frontFrame + 0.2 + 0.15), 0.0);
        assertNull(Coupling.tryCouple(pusher, apart));
        // … frames overlapping by 0.35 put the couplers 0.05 into each other: coupled
        Coupling.Train touching = train(graph, legs, c, headForRear(c, frontFrame - 0.35 + 0.15), 0.0);
        Coupling.Merge merge = Coupling.tryCouple(pusher, touching);
        assertNotNull(merge);
        // snapped coupler to coupler: the frames overlap by both offsets
        double pusherFrontFrame = merge.composition().bodyCenterS(merge.headS(), 1) + 7.0;
        double otherRearFrame = merge.composition().bodyCenterS(merge.headS(), 0) - 7.0;
        assertEquals(0.3, pusherFrontFrame - otherRearFrame, EPS);
    }

    @Test
    void tooDeepAnOverlap_isNoContact() {
        RailGraph graph = line();
        List<RailGraph.RouteLeg> legs = routeOf(graph, 1);
        ConsistComposition locoC = comp(slot(LOCO, false));
        ConsistComposition carC = comp(slot(CAR, false));
        // put on top of each other: 10 blocks of overlap
        Coupling.Train loco = train(graph, legs, locoC, headForFront(locoC, 90.0), 0.1);
        Coupling.Train car = train(graph, legs, carC, headForRear(carC, 80.0), 0.0);

        assertNull(Coupling.tryCouple(loco, car));
    }
    // --- bumps (SPEC §6.12: the profile's coupling speed) ---

    @Test
    void fastRunIn_bumpsWithMomentumAndSeparates() {
        RailGraph graph = line();
        List<RailGraph.RouteLeg> legs = routeOf(graph, 1);
        ConsistComposition locoC = comp(slot(LOCO, false));
        ConsistComposition carC = comp(slot(CAR, false));
        // the loco (80 t) at 0.5 b/t (36 km/h) ran 0.3 into a standing car (20 t)
        Coupling.Train loco = train(graph, legs, locoC, headForFront(locoC, 90.0), 0.5);
        Coupling.Train car = train(graph, legs, carC, headForRear(carC, 90.0 + GAP - 0.3), 0.0);

        Coupling.Contact contact = Coupling.contact(loco, car, 0.2);

        Coupling.Bump bump = assertInstanceOf(Coupling.Bump.class, contact, "too fast to couple");
        assertEquals(0.5, bump.closing(), EPS);
        assertEquals(80.0 * 0.5, 80.0 * bump.keptV() + 20.0 * bump.absorbedV(), EPS, "momentum kept");
        assertTrue(bump.absorbedV() > bump.keptV(), "they spring apart");
        assertEquals(Coupling.RESTITUTION * 0.5, bump.absorbedV() - bump.keptV(), EPS,
                "parting at the restitution of the closing speed");
        // the overlap undone, the light car moving most
        assertEquals(-0.3 * 0.2, bump.keptShift(), EPS);
        assertEquals(0.3 * 0.8, bump.absorbedShift(), EPS);
    }

    @Test
    void gentleRunIn_underTheLimit_couples() {
        RailGraph graph = line();
        List<RailGraph.RouteLeg> legs = routeOf(graph, 1);
        ConsistComposition locoC = comp(slot(LOCO, false));
        ConsistComposition carC = comp(slot(CAR, false));
        Coupling.Train loco = train(graph, legs, locoC, headForFront(locoC, 90.0), 0.1);
        Coupling.Train car = train(graph, legs, carC, headForRear(carC, 90.0 + GAP - 0.05), 0.0);

        assertInstanceOf(Coupling.Merge.class, Coupling.contact(loco, car, 0.2));
    }

    @Test
    void bump_inTheOtherConsistsOwnFrame() {
        RailGraph graph = line();
        List<RailGraph.RouteLeg> legs = routeOf(graph, 1);
        List<RailGraph.RouteLeg> back = Coupling.inverted(legs);
        double length = graph.buildRoutePath(legs).length();
        ConsistComposition locoC = comp(slot(LOCO, false));
        ConsistComposition carC = comp(slot(CAR, false));
        // the car runs its own (reversed) route into the standing loco at 0.5
        Coupling.Train loco = train(graph, legs, locoC, headForFront(locoC, 90.0), 0.0);
        Coupling.Train car = train(graph, back, carC,
                headForFront(carC, length - (90.0 + GAP - 0.2)), 0.5);

        Coupling.Bump bump = assertInstanceOf(Coupling.Bump.class, Coupling.contact(loco, car, 0.2));
        // forward frame: the car came at −0.5; momentum 20·(−0.5)
        assertEquals(20.0 * -0.5, 80.0 * bump.keptV() + 20.0 * -bump.absorbedV(), EPS);
        assertTrue(bump.keptV() < 0.0, "the loco is shoved back");
        assertTrue(bump.absorbedV() < 0.5 && bump.absorbedV() < 0.0, "the car bounces off, backwards in its frame");
        assertTrue(bump.absorbedShift() < 0.0, "pushed back along its own route");
    }

    // --- a row of standing wagons (SPEC §2.1, 2026-10-12: contact on the track, loaded or not) ---

    @Test
    void aLongRowOfStandingWagons_isTakenUpWagonByWagon() {
        // 1500 blocks of straight track, far past any view distance
        RailGraph graph = new RailGraph();
        for (int i = 0; i < 15; i++) {
            connect(graph, new Vector3d(i * 100.0, 0, 0), new Vector3d((i + 1) * 100.0, 0, 0));
        }
        List<RailGraph.RouteLeg> legs = routeOf(graph, 1);
        ConsistComposition locoC = comp(slot(LOCO, false));
        ConsistComposition carC = comp(slot(CAR, false));
        double couplingMax = 15.0 / 3.6 / 20.0; // the standard profile's 15 km/h, blocks/tick
        // 60 cars standing 2 blocks apart, the first 3 blocks ahead of the loco; none ever coupled
        int rowLength = 60;
        Coupling.Train[] row = new Coupling.Train[rowLength];
        for (int k = 0; k < rowLength; k++) {
            row[k] = train(graph, legs, carC, headForRear(carC, 33.0 + k * (CAR.length() + 2.0)), 0.0);
        }
        for (int k = 0; k + 1 < rowLength; k++) {
            assertNull(Coupling.contact(row[k], row[k + 1], couplingMax), "standing cars don't couple");
        }
        // the loco runs in at 0.2 b/t (14 km/h, just under the limit)
        Coupling.Train train = train(graph, legs, locoC, headForFront(locoC, 30.0), 0.2);
        double locoCentre = locoC.bodyCenterS(train.headS(), 0);

        int taken = 0;
        for (int tick = 0; tick < 100_000 && taken < rowLength; tick++) {
            train = new Coupling.Train(train.legs(), train.path(), train.composition(),
                    train.headS() + train.v(), train.v());
            locoCentre += train.v();
            Coupling.Contact contact = Coupling.contact(train, row[taken], couplingMax);
            if (contact == null) {
                continue;
            }
            Coupling.Merge merge = assertInstanceOf(Coupling.Merge.class, contact, "car " + taken);
            train = new Coupling.Train(merge.legs(), graph.buildRoutePath(merge.legs()),
                    merge.composition(), merge.headS(), merge.v());
            taken++;
            // the loco (last, the cars ahead of it) didn't move in the merge
            assertEquals(locoCentre, merge.composition().bodyCenterS(merge.headS(), taken), EPS);
        }

        assertEquals(rowLength, taken, "every car of the row coupled, the farthest too");
        assertEquals(rowLength + 1, train.composition().wagonCount());
        assertEquals(LOCO, train.composition().slot(rowLength).type());
        // momentum: 80 t at 0.2 shared with 60 × 20 t
        assertEquals(80.0 * 0.2 / (80.0 + rowLength * 20.0), train.v(), EPS);
    }

    @Test
    void veryFastRunIn_deeperThanTheStaticOverlap_isStillCaught() {
        RailGraph graph = line();
        List<RailGraph.RouteLeg> legs = routeOf(graph, 1);
        ConsistComposition locoC = comp(slot(LOCO, false));
        ConsistComposition carC = comp(slot(CAR, false));
        // 6 b/t closing (a head-on of two 216 km/h trains) ran 5 blocks in within one tick
        Coupling.Train loco = train(graph, legs, locoC, headForFront(locoC, 90.0), 6.0);
        Coupling.Train car = train(graph, legs, carC, headForRear(carC, 90.0 + GAP - 5.0), 0.0);

        assertNotNull(Coupling.contact(loco, car, 0.2), "no tunnelling at speed");
    }
}
