package com.muzhik17.trainsmod.convention;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.Handles;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

/** The driver's panel readout (SPEC §9.7). */
class DriverReadoutTest {

    private static WagonType type(String id, double maxKmh, WagonType.Cab cab, double independentKn) {
        return new WagonType(id, 14.0, new double[]{4.0, -4.0}, 60.0, maxKmh,
                new WagonType.Resistance(1000.0, 50.0, 5.0), null, cab,
                new WagonType.Brakes(100.0, independentKn, 0.0, 0.0, 10.0), null);
    }

    private static final WagonType LOCO = type("test:loco", 95.0, new WagonType.Cab(), 60.0);
    private static final WagonType COACH = type("test:coach", 120.0, null, 0.0);

    /** km/h as blocks/tick (20 ticks/s, 1 block = 1 m). */
    private static double blocksPerTick(double kmh) {
        return kmh / 72.0;
    }

    private static ConsistComposition train(ConsistComposition.Slot... slots) {
        return new ConsistComposition(List.of(slots));
    }

    @Test
    void speed_isKmhWithoutSign() {
        ConsistComposition c = train(new ConsistComposition.Slot(LOCO, false));
        assertEquals(36.0, DriverReadout.of(Handles.REST, 0.5, c, 0).speedKmh(), 1.0e-9);
        assertEquals(36.0, DriverReadout.of(Handles.REST, -0.5, c, 0).speedKmh(), 1.0e-9);
    }

    @Test
    void motion_isSeenFromTheDriversCab() {
        // the second loco runs flipped: it looks towards −s
        ConsistComposition c = train(new ConsistComposition.Slot(LOCO, false),
                new ConsistComposition.Slot(LOCO, true));
        assertEquals(1, DriverReadout.of(Handles.REST, 0.2, c, 0).motion());
        assertEquals(-1, DriverReadout.of(Handles.REST, 0.2, c, 1).motion());
        assertEquals(1, DriverReadout.of(Handles.REST, -0.2, c, 1).motion());
        assertEquals(0, DriverReadout.of(Handles.REST, Consist.REVERSER_STOP_EPS / 2.0, c, 1).motion());
    }

    @Test
    void scale_isTheSlowestWagonsTopSpeed_roundedUp() {
        ConsistComposition c = train(new ConsistComposition.Slot(LOCO, false),
                new ConsistComposition.Slot(COACH, false));
        DriverReadout r = DriverReadout.of(Handles.REST, 0.0, c, 0);
        assertEquals(95.0, r.limitKmh());
        assertEquals(100, r.scaleKmh());
        assertEquals(0.95F, r.limitFraction(), 1.0e-6F);
        assertEquals(120, DriverReadout.scaleKmh(120.0));
        assertEquals(140, DriverReadout.scaleKmh(130.0));
        assertEquals(DriverReadout.DEFAULT_SCALE_KMH, DriverReadout.scaleKmh(0.0));
        assertEquals(20, r.tickStepKmh());
    }

    @Test
    void atLimit_andSpeedFraction() {
        ConsistComposition c = train(new ConsistComposition.Slot(LOCO, false));
        DriverReadout top = DriverReadout.of(Handles.REST, blocksPerTick(95.0), c, 0);
        assertTrue(top.atLimit());
        assertEquals(0.95F, top.speedFraction(), 1.0e-6F);
        assertFalse(DriverReadout.of(Handles.REST, blocksPerTick(60.0), c, 0).atLimit());
    }

    @Test
    void inControl_onlyInTheActiveCab() {
        ConsistComposition c = train(new ConsistComposition.Slot(LOCO, false),
                new ConsistComposition.Slot(LOCO, true));
        Handles fromFirst = new Handles(1, 3, 0, 0, 0);
        assertTrue(DriverReadout.of(fromFirst, 0.0, c, 0).inControl());
        DriverReadout second = DriverReadout.of(fromFirst, 0.0, c, 1);
        assertFalse(second.inControl());
        assertFalse(second.canMove(Consist.Handle.THROTTLE));
    }

    @Test
    void reverser_movesOnlyStandingWithTheThrottleShut() {
        ConsistComposition c = train(new ConsistComposition.Slot(LOCO, false));
        assertTrue(DriverReadout.of(new Handles(1, 0, 2, 0, 0), 0.0, c, 0)
                .canMove(Consist.Handle.REVERSER));
        assertFalse(DriverReadout.of(new Handles(1, 1, 0, 0, 0), 0.0, c, 0)
                .canMove(Consist.Handle.REVERSER));
        assertFalse(DriverReadout.of(new Handles(1, 0, 0, 0, 0), 0.1, c, 0)
                .canMove(Consist.Handle.REVERSER));
    }

    @Test
    void independentBrake_onlyIfACabHasOne() {
        WagonType bare = type("test:bare", 80.0, new WagonType.Cab(), 0.0);
        assertFalse(DriverReadout.of(new Handles(1, 0, 0, 0, 0), 0.0,
                train(new ConsistComposition.Slot(bare, false)), 0).canMove(Consist.Handle.INDEPENDENT_BRAKE));
        assertTrue(DriverReadout.of(new Handles(1, 0, 0, 0, 0), 0.0,
                train(new ConsistComposition.Slot(LOCO, false)), 0).canMove(Consist.Handle.INDEPENDENT_BRAKE));
    }
    /** The panel's pressure bars: the brake in effect; without one, the handle's own fraction. */
    @Test
    void brakePressure_inEffectOrTheHandle() {
        ConsistComposition c = new ConsistComposition(java.util.List.of(
                new ConsistComposition.Slot(type("test:loco", 95.0, new WagonType.Cab(), 80.0), false)));
        Handles handles = new Handles(1, 0, 4, 8, 0);
        DriverReadout lagging = DriverReadout.of(handles, 0.0, c, 0, 0, 0.1F, 0.9F);
        assertEquals(0.1F, lagging.pressure(Consist.Handle.TRAIN_BRAKE));
        assertEquals(0.9F, lagging.pressure(Consist.Handle.INDEPENDENT_BRAKE));
        assertEquals(0.0F, lagging.pressure(Consist.Handle.THROTTLE));
        DriverReadout handleOnly = DriverReadout.of(handles, 0.0, c, 0);
        assertEquals(0.5F, handleOnly.pressure(Consist.Handle.TRAIN_BRAKE));
        assertEquals(1.0F, handleOnly.pressure(Consist.Handle.INDEPENDENT_BRAKE));
    }
}
