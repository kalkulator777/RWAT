package com.muzhik17.trainsmod.physics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.StockDefaults;
import com.muzhik17.trainsmod.stock.WagonType;

/** The handles' lag (SPEC §5.3), the profiles (SPEC §5.6) and the auto handbrakes. */
class ControlResponseTest {

    private static WagonType car(StockDefaults.BrakeSystem system) {
        return new WagonType("test:car", 14.0, new double[]{4.0, -4.0}, 40.0, 0.0,
                StockDefaults.resistance(40.0), null, null,
                StockDefaults.brakes(system, 40.0, false), null);
    }

    private static int ticksTo(double fraction, double upS) {
        double effort = 0.0;
        int ticks = 0;
        while (effort < fraction && ticks < 10_000) {
            effort = ControlResponse.approach(effort, 1.0, upS, upS);
            ticks++;
        }
        return ticks;
    }

    @Test
    void approach_reachesNinetyFivePercentInTheGivenTime() {
        int ticks = ticksTo(0.95, 4.0);
        assertEquals(80, ticks, 2, "4 s = 80 ticks to 95%");
    }

    @Test
    void approach_instantWithoutTimeOrState() {
        assertEquals(1.0, ControlResponse.approach(0.0, 1.0, 0.0, 0.0), "no time: at once");
        assertEquals(0.5, ControlResponse.approach(Double.NaN, 0.5, 4.0, 4.0), "no state yet: at once");
        assertEquals(0.25, ControlResponse.approach(0.25, 0.25, 4.0, 4.0), "at the target it stays");
    }

    @Test
    void approach_usesTheDownTimeWhenFalling() {
        double up = ControlResponse.approach(0.0, 1.0, 10.0, 1.0);
        double down = 1.0 - ControlResponse.approach(1.0, 0.0, 10.0, 1.0);
        assertTrue(down > 5.0 * up, "falling with the short time: " + down + " vs " + up);
    }

    @Test
    void response_theSlowestWagonSetsTheTrain() {
        ConsistComposition passenger = new ConsistComposition(List.of(
                new ConsistComposition.Slot(car(StockDefaults.BrakeSystem.PASSENGER), false)));
        ConsistComposition mixed = new ConsistComposition(List.of(
                new ConsistComposition.Slot(car(StockDefaults.BrakeSystem.PASSENGER), false),
                new ConsistComposition.Slot(car(StockDefaults.BrakeSystem.FREIGHT), false)));
        assertEquals(StockDefaults.BrakeSystem.PASSENGER.applyS(),
                ControlResponse.of(passenger, 1.0).brakeApplyS());
        assertEquals(StockDefaults.BrakeSystem.FREIGHT.applyS(),
                ControlResponse.of(mixed, 1.0).brakeApplyS(), "one freight car brakes the train like freight");
        assertEquals(0.0, ControlResponse.of(mixed, 0.0).brakeApplyS(), "response scale 0: instant");
        assertEquals(StockDefaults.BrakeSystem.FREIGHT.applyS() * 0.5,
                ControlResponse.of(mixed, 0.5).brakeApplyS(), 1.0e-12);
    }

    @Test
    void profiles_customOnlyForCustom() {
        PhysicsTuning mine = new PhysicsTuning(2.0, 3.0, 4.0, 0.0, false, 1.0, true, true, 5.0);
        assertEquals(PhysicsTuning.STANDARD, PhysicsTuning.of(PhysicsTuning.Profile.STANDARD, mine));
        assertEquals(PhysicsTuning.REALISTIC, PhysicsTuning.of(PhysicsTuning.Profile.REALISTIC, mine));
        assertEquals(PhysicsTuning.ARCADE, PhysicsTuning.of(PhysicsTuning.Profile.ARCADE, mine));
        assertEquals(mine, PhysicsTuning.of(PhysicsTuning.Profile.CUSTOM, mine));
    }

    @Test
    void couplingSpeed_zeroMeansAnySpeed() {
        assertEquals(Double.POSITIVE_INFINITY, PhysicsTuning.ARCADE.couplingMaxClosing());
        double tenKmh = PhysicsTuning.REALISTIC.couplingMaxClosing();
        assertEquals(10.0, TrainPhysics.kmh(tenKmh), 1.0e-9);
    }

    @Test
    void autoHandbrake_offWithThrottleOnStandingShut() {
        assertEquals(Boolean.FALSE, AutoHandbrake.target(1, 1, 0.0), "throttle open: off");
        assertEquals(Boolean.TRUE, AutoHandbrake.target(0, 1, 0.0), "standing, shut: on");
        assertNull(AutoHandbrake.target(0, 1, 0.5), "coasting: left alone");
        assertNull(AutoHandbrake.target(3, 0, 0.0), "notched up in neutral: no pull, left alone");
    }
}
