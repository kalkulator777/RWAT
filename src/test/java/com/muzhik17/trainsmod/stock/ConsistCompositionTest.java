package com.muzhik17.trainsmod.stock;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * Where a consist stands when its wagons' types are reloaded under it (D1):
 * the middle of the train stays, and the train stays on an open path.
 */
class ConsistCompositionTest {

    private static final double EPS = 1.0e-9;

    private static WagonType car(String id, double length, double front, double rear,
            WagonType.Couplers couplers) {
        return new WagonType(id, length, new double[]{front, rear}, 40.0, 100.0, WagonType.Resistance.NONE,
                null, null, WagonType.Brakes.NONE, null, List.of(), couplers);
    }

    private static WagonType car(String id, double length, double bogie) {
        return car(id, length, bogie, -bogie, WagonType.Couplers.AT_ENDS);
    }

    private static ConsistComposition of(WagonType... types) {
        return new ConsistComposition(java.util.Arrays.stream(types)
                .map(type -> new ConsistComposition.Slot(type, false)).toList());
    }

    private static double frontEnd(ConsistComposition c, double head) {
        return c.bodyCenterS(head, 0) + c.slot(0).frontCouplerReach();
    }

    private static double rearEnd(ConsistComposition c, double head) {
        int last = c.wagonCount() - 1;
        return c.bodyCenterS(head, last) - c.slot(last).rearCouplerReach();
    }

    /** One car grown longer: its body stays where it stood, both ends reach out alike. */
    @Test
    void aLongerCarKeepsItsBodyWhereItStood() {
        ConsistComposition before = of(car("a:coach", 20.0, 7.0));
        ConsistComposition after = of(car("a:coach", 24.0, 9.0));
        double head = after.headKeepingMiddle(before, 100.0);
        assertEquals(before.bodyCenterS(100.0, 0), after.bodyCenterS(head, 0), EPS);
        assertEquals(frontEnd(before, 100.0) + 2.0, frontEnd(after, head), EPS);
        assertEquals(rearEnd(before, 100.0) - 2.0, rearEnd(after, head), EPS);
    }

    /** Only the bogies moved: the body doesn't — the head (a bogie) does. */
    @Test
    void movedBogiesLeaveTheBody() {
        ConsistComposition before = of(car("a:coach", 20.0, 7.0));
        ConsistComposition after = of(car("a:coach", 20.0, 8.0));
        double head = after.headKeepingMiddle(before, 100.0);
        assertEquals(101.0, head, EPS);
        assertEquals(before.bodyCenterS(100.0, 0), after.bodyCenterS(head, 0), EPS);
    }

    /** A turned car with uneven bogies and couplers: the middle between its coupler points stays. */
    @Test
    void theMiddleBetweenTheCouplersStays_turnedAndUneven() {
        WagonType was = car("a:loco", 18.0, 6.0, -5.0, new WagonType.Couplers(-0.1, -0.3));
        WagonType now = car("a:loco", 19.0, 6.5, -4.0, new WagonType.Couplers(0.0, -0.5));
        ConsistComposition before = new ConsistComposition(List.of(new ConsistComposition.Slot(was, true)));
        ConsistComposition after = new ConsistComposition(List.of(new ConsistComposition.Slot(now, true)));
        double head = after.headKeepingMiddle(before, 50.0);
        assertEquals(frontEnd(before, 50.0) + rearEnd(before, 50.0), frontEnd(after, head) + rearEnd(after, head),
                EPS);
    }

    /** A train: the whole change splits between its two ends, no wagon moves more than half of it. */
    @Test
    void aTrainKeepsItsMiddle() {
        WagonType loco = car("a:loco", 18.0, 5.0);
        ConsistComposition before = of(loco, car("a:coach", 25.0, 8.5), car("a:coach", 25.0, 8.5));
        WagonType coach = car("a:coach", 27.0, 9.5);
        ConsistComposition after = of(loco, coach, coach);
        double head = after.headKeepingMiddle(before, 300.0);
        assertEquals(frontEnd(before, 300.0) + 2.0, frontEnd(after, head), EPS);
        assertEquals(rearEnd(before, 300.0) - 2.0, rearEnd(after, head), EPS);
        // the loco only moves up as far as the coaches grew in front of the middle
        assertEquals(before.bodyCenterS(300.0, 0) + 2.0, after.bodyCenterS(head, 0), EPS);
    }

    @Test
    void theSameMakeUpStandsStill() {
        ConsistComposition train = of(car("a:loco", 18.0, 5.0), car("a:coach", 25.0, 8.5));
        assertEquals(123.456, train.headKeepingMiddle(train, 123.456), 0.0);
    }

    /** Held on an open path as a running train is: the head at the end, the last bogie at the start. */
    @Test
    void theTrainStaysOnAnOpenPath() {
        ConsistComposition train = of(car("a:loco", 18.0, 5.0), car("a:coach", 25.0, 8.5));
        double span = train.totalLength();
        assertEquals(span, train.headOnPath(span - 3.0, 200.0), EPS, "the rear bogie off the start");
        assertEquals(200.0, train.headOnPath(203.0, 200.0), EPS, "the head off the end");
        assertEquals(120.0, train.headOnPath(120.0, 200.0), EPS);
        assertEquals(30.0, train.headOnPath(10.0, 30.0), EPS, "a train longer than its path: head at the end");
    }
}
