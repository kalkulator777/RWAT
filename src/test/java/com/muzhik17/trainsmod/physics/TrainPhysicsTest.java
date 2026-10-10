package com.muzhik17.trainsmod.physics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.path.HermiteSegment;
import com.muzhik17.trainsmod.path.HermiteSegmentPath;
import com.muzhik17.trainsmod.path.TrackPath;
import com.muzhik17.trainsmod.physics.TrainPhysics.Controls;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

/** Longitudinal dynamics (SPEC §5.4). */
class TrainPhysicsTest {

    /** A ChME3-like test loco: 100 t, 1 MW, 200 kN, Davis, strong train brake. */
    private static final WagonType LOCO = new WagonType("test:loco", 18.0,
            new double[]{4.0, -4.0}, 100.0, 90.0,
            new WagonType.Resistance(2000.0, 100.0, 10.0),
            new WagonType.Traction(1000.0, 200.0),
            new WagonType.Cab(),
            new WagonType.Brakes(150.0, 80.0, 0.0, 0.0, 30.0), null);

    /** Unpowered heavy wagon: 80 t, braked, no cab. */
    private static final WagonType WAGON = new WagonType("test:wagon", 14.0,
            new double[]{3.5, -3.5}, 80.0, 120.0,
            new WagonType.Resistance(1600.0, 80.0, 8.0),
            null, null,
            new WagonType.Brakes(120.0, 0.0, 0.0, 0.0, 20.0), null);

    private static final ConsistComposition SOLO = new ConsistComposition(List.of(
            new ConsistComposition.Slot(LOCO, false)));

    private static TrackPath flat() {
        return new HermiteSegmentPath(HermiteSegment.straight(
                new Vector3d(0, 0, 0), new Vector3d(0, 0, 1000)));
    }

    /** Straight 10% climb (rises 100 over 1000 forward). */
    private static TrackPath climb() {
        return new HermiteSegmentPath(HermiteSegment.straight(
                new Vector3d(0, 0, 0), new Vector3d(0, 100, 1000)));
    }

    private static final Controls FULL_THROTTLE = new Controls(1, 1.0, 0.0, 0.0);
    private static final Controls COAST = new Controls(1, 0.0, 0.0, 0.0);
    private static final Controls FULL_BRAKE = new Controls(1, 0.0, 1.0, 0.0);

    @Test
    void fullThrottle_acceleratesFromRest() {
        double v = TrainPhysics.step(flat(), 100.0, 0.0, SOLO, FULL_THROTTLE);
        assertTrue(v > 0.0, "should break away from rest");
        double v2 = TrainPhysics.step(flat(), 100.0, v, SOLO, FULL_THROTTLE);
        assertTrue(v2 > v, "should keep accelerating");
    }

    @Test
    void coasting_resistanceBleedsSpeedOff_neverReverses() {
        double v = 0.25; // 5 m/s
        for (int i = 0; i < 20; i++) {
            double next = TrainPhysics.step(flat(), 100.0, v, SOLO, COAST);
            assertTrue(next < v, "resistance should slow the train");
            v = next;
        }
        for (int i = 0; i < 20000 && v != 0.0; i++) {
            v = TrainPhysics.step(flat(), 100.0, v, SOLO, COAST);
            assertTrue(v >= 0.0, "resistance must never push the train backwards");
        }
        assertEquals(0.0, v, "the train should coast to a stop eventually");
    }

    @Test
    void brake_stopsMuchFasterThanCoasting() {
        double v = 0.25;
        int ticks = 0;
        while (v > 0.0 && ticks < 10000) {
            v = TrainPhysics.step(flat(), 100.0, v, SOLO, FULL_BRAKE);
            ticks++;
        }
        assertEquals(0.0, v);
        assertTrue(ticks < 200, "full brake from 5 m/s should stop within 10 s, took " + ticks);
    }

    @Test
    void grade_unbrakedTrainRollsBackDownhill() {
        // standing mid-climb with everything released: gravity wins over static resistance
        double v = TrainPhysics.step(climb(), 500.0, 0.0, SOLO, COAST);
        assertTrue(v < 0.0, "should roll back down the 10% grade, got " + v);
    }

    @Test
    void grade_fullBrakeHoldsTheTrain() {
        double v = TrainPhysics.step(climb(), 500.0, 0.0, SOLO, FULL_BRAKE);
        assertEquals(0.0, v, "full train brake should hold on a 10% grade");
    }

    @Test
    void grade_climbIsSlowerThanFlat() {
        double flatV = 0.0;
        double climbV = 0.0;
        for (int i = 0; i < 200; i++) {
            flatV = TrainPhysics.step(flat(), 500.0, flatV, SOLO, FULL_THROTTLE);
            climbV = TrainPhysics.step(climb(), 500.0, climbV, SOLO, FULL_THROTTLE);
        }
        assertTrue(climbV < flatV, "the same loco should be slower on the grade");
        assertTrue(climbV > 0.0, "but a light loco should still make a 10% grade");
    }

    @Test
    void heavierConsist_acceleratesSlower() {
        ConsistComposition heavy = new ConsistComposition(List.of(
                new ConsistComposition.Slot(LOCO, false),
                new ConsistComposition.Slot(WAGON, false),
                new ConsistComposition.Slot(WAGON, false)));
        double solo = 0.0;
        double train = 0.0;
        for (int i = 0; i < 100; i++) {
            solo = TrainPhysics.step(flat(), 500.0, solo, SOLO, FULL_THROTTLE);
            train = TrainPhysics.step(flat(), 500.0, train, heavy, FULL_THROTTLE);
        }
        assertTrue(train < solo, "more mass, same power → slower acceleration");
    }

    @Test
    void maxSpeed_capsAtTheSlowestWagon() {
        double v = 0.0;
        for (int i = 0; i < 20000; i++) {
            v = TrainPhysics.step(flat(), 500.0, v, SOLO, FULL_THROTTLE);
        }
        double kmh = v * 20.0 * 3.6;
        assertTrue(kmh <= 90.0 + 1.0e-6, "must not exceed the type's 90 km/h, got " + kmh);
    }

    @Test
    void reverser_drivesBackwards() {
        Controls reverse = new Controls(-1, 1.0, 0.0, 0.0);
        double v = TrainPhysics.step(flat(), 500.0, 0.0, SOLO, reverse);
        assertTrue(v < 0.0, "reverser back + throttle should move toward −s");
    }

    @Test
    void brakedAtRest_tractionBelowHoldForceStaysPut() {
        // notch 1 of 8 against full train brake: must not creep
        Controls creep = new Controls(1, 0.125, 1.0, 0.0);
        double v = TrainPhysics.step(flat(), 500.0, 0.0, SOLO, creep);
        assertEquals(0.0, v, "low throttle against full brakes should not move");
    }
    // --- adhesion, governor, speed limit, handbrake, nose drag, tuning (SPEC §5.4, §5.6) ---

    /** A light powered car declaring far more effort than its wheels can grip (IR's EMU heads). */
    private static final WagonType ROCKET = new WagonType("test:rocket", 20.0,
            new double[]{6.0, -6.0}, 40.0, 130.0,
            new WagonType.Resistance(500.0, 10.0, 1.0),
            new WagonType.Traction(4000.0, 420.0), new WagonType.Cab(),
            new WagonType.Brakes(40.0, 20.0, 0.0, 0.0, 10.0), null);

    private static final Controls THROTTLE = new Controls(1, 1.0, 0.0, 0.0);

    private static double accelMs2(double v0, double v1) {
        return (v1 - v0) * TrainPhysics.TICKS_PER_SECOND * TrainPhysics.TICKS_PER_SECOND;
    }

    @Test
    void adhesion_capsTractionAtWhatTheWheelsGrip() {
        ConsistComposition rocket = new ConsistComposition(List.of(
                new ConsistComposition.Slot(ROCKET, false)));
        double v0 = 0.05;
        double v1 = TrainPhysics.step(flat(), 500.0, v0, rocket, THROTTLE, null, PhysicsTuning.REALISTIC);
        double grip = TrainPhysics.adhesion(v0 * 20.0) * TrainPhysics.G;
        assertTrue(accelMs2(v0, v1) <= grip + 1.0e-9,
                "no faster than mu*g = " + grip + ", got " + accelMs2(v0, v1));
        // the arcade profile lets the declared effort through
        double arcade = TrainPhysics.step(flat(), 500.0, v0, rocket, THROTTLE, null, PhysicsTuning.ARCADE);
        assertTrue(accelMs2(v0, arcade) > 2.0 * grip, "no adhesion limit in arcade");
    }

    @Test
    void adhesion_capsBrakingOnTheMove() {
        WagonType grabby = new WagonType("test:grabby", 14.0, new double[]{4.0, -4.0}, 20.0, 0.0,
                WagonType.Resistance.NONE, null, null,
                new WagonType.Brakes(1000.0, 0.0, 0.0, 0.0, 0.0), null);
        ConsistComposition one = new ConsistComposition(List.of(new ConsistComposition.Slot(grabby, false)));
        double v0 = 1.0; // 72 km/h
        double v1 = TrainPhysics.step(flat(), 500.0, v0, one, FULL_BRAKE, null, PhysicsTuning.REALISTIC);
        double grip = TrainPhysics.adhesion(v0 * 20.0) * TrainPhysics.G;
        assertEquals(grip, -accelMs2(v0, v1), 1.0e-6, "50 m/s^2 of shoes, but the wheels slide at mu*g");
    }

    @Test
    void governor_fadesTractionAtTheUnitsDesignSpeed() {
        WagonType loco = LOCO; // 90 km/h
        double maxMs = 90.0 / 3.6;
        assertEquals(1.0, TrainPhysics.governor(loco, 0.0, 1));
        assertEquals(1.0, TrainPhysics.governor(loco, maxMs * 0.9, 1));
        assertEquals(0.0, TrainPhysics.governor(loco, maxMs, 1), 1.0e-9);
        assertEquals(1.0, TrainPhysics.governor(loco, -maxMs, 1), "pulling against the motion is braking");
    }

    @Test
    void softLimit_lets_a_train_run_away_downhill_hardLimit_doesNot() {
        // an unbraked wagon with a 60 km/h design speed down a 10% grade
        WagonType car = new WagonType("test:car", 14.0, new double[]{4.0, -4.0}, 20.0, 60.0,
                new WagonType.Resistance(200.0, 10.0, 1.0), null, null, WagonType.Brakes.NONE, null);
        ConsistComposition one = new ConsistComposition(List.of(new ConsistComposition.Slot(car, false)));
        double soft = 0.0;
        double hard = 0.0;
        for (int i = 0; i < 20 * 120; i++) {
            soft = TrainPhysics.step(climb(), 500.0, soft, one, COAST, null, PhysicsTuning.REALISTIC);
            hard = TrainPhysics.step(climb(), 500.0, hard, one, COAST, null, PhysicsTuning.ARCADE);
        }
        assertTrue(-TrainPhysics.kmh(soft) > 60.0, "gravity doesn't read the plate: " + soft);
        assertEquals(60.0, -TrainPhysics.kmh(hard), 1.0e-6, "arcade caps at the design speed");
    }

    @Test
    void handbrake_holdsWhereStaticResistanceAloneDoesNot() {
        // a 2% grade: the train's a-term can't hold it, one handbrake on the loco can
        TrackPath grade = new HermiteSegmentPath(HermiteSegment.straight(
                new Vector3d(0, 0, 0), new Vector3d(0, 20, 1000)));
        assertTrue(TrainPhysics.step(grade, 500.0, 0.0, SOLO, COAST, null, PhysicsTuning.REALISTIC) < 0.0,
                "released, it rolls back");
        WagonType held = new WagonType("test:held", 18.0, new double[]{4.0, -4.0}, 100.0, 90.0,
                new WagonType.Resistance(2000.0, 100.0, 10.0), null, null,
                new WagonType.Brakes(0.0, 0.0, 0.0, 0.0, 40.0), null);
        ConsistComposition one = new ConsistComposition(List.of(new ConsistComposition.Slot(held, false)));
        assertEquals(0.0, TrainPhysics.step(grade, 500.0, 0.0, one, COAST, new boolean[]{true},
                PhysicsTuning.REALISTIC), "the handbrake holds");
        assertTrue(TrainPhysics.step(grade, 500.0, 0.0, one, COAST, new boolean[]{false},
                PhysicsTuning.REALISTIC) < 0.0, "released, it rolls");
    }

    @Test
    void noseDrag_isPaidByTheWagonLeadingTheWay() {
        WagonType nose = new WagonType("test:nose", 14.0, new double[]{4.0, -4.0}, 50.0, 0.0,
                new WagonType.Resistance(0.0, 0.0, 0.0, 50.0), null, null, WagonType.Brakes.NONE, null);
        WagonType plain = new WagonType("test:plain", 14.0, new double[]{4.0, -4.0}, 50.0, 0.0,
                WagonType.Resistance.NONE, null, null, WagonType.Brakes.NONE, null);
        ConsistComposition train = new ConsistComposition(List.of(
                new ConsistComposition.Slot(nose, false), new ConsistComposition.Slot(plain, false)));
        double forward = 1.0 - TrainPhysics.step(flat(), 500.0, 1.0, train, COAST);
        double backward = TrainPhysics.step(flat(), 500.0, -1.0, train, COAST) + 1.0;
        assertTrue(forward > 0.0, "nose first: it pushes the air");
        assertEquals(0.0, backward, 1.0e-12, "backing up, the plain car leads and has no nose drag");
    }

    @Test
    void tuning_brakeScaleStrengthensBraking() {
        PhysicsTuning doubled = new PhysicsTuning(1.0, 2.0, 1.0, 1.0, false, 1.0, false, false, 0.0);
        PhysicsTuning plainNoSlip = new PhysicsTuning(1.0, 1.0, 1.0, 1.0, false, 1.0, false, false, 0.0);
        double v0 = 0.25;
        double plain = v0 - TrainPhysics.step(flat(), 500.0, v0, SOLO, FULL_BRAKE, null, plainNoSlip);
        double strong = v0 - TrainPhysics.step(flat(), 500.0, v0, SOLO, FULL_BRAKE, null, doubled);
        assertTrue(strong > 1.8 * plain, "twice the brake force, about twice the deceleration");
    }

    @Test
    void adhesionCoefficient_followsCurtiusKniffler() {
        assertEquals(0.3315, TrainPhysics.adhesion(0.0), 1.0e-3);
        assertEquals(0.233, TrainPhysics.adhesion(60.0 / 3.6), 1.0e-3);
        assertEquals(0.207, TrainPhysics.adhesion(120.0 / 3.6), 1.0e-3);
    }
}
