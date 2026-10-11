package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Several driver's chairs (SPEC §9): the assistant's chair stands off the
 * floor beside the desk, so standing up walks the driver to beside it —
 * never through the wall behind it onto the vestibule floor, which is the
 * nearer floor; {@link FloorCheck} asks for a place to stand within reach of
 * every chair; the two cabs of a double-ended locomotive, each with its own
 * steps, are both walkable floor.
 */
class DriverChairTest {

    private static final double FLOOR = 1.85;
    private static final double R = RiderWalk.PLAYER_HALF_WIDTH;
    private static final double CUSHION = FLOOR + 0.53;

    private static WagonType.Interior.Zone zone(double minX, double minZ, double maxX, double maxZ) {
        return new WagonType.Interior.Zone(minX, FLOOR, minZ, maxX, 3.9, maxZ);
    }

    /**
     * The SR3's cab, simplified: 0.6 deep (z 9..9.6) up to x 0.4, the wall
     * behind it z 8.8..9, the vestibule behind that (z 7..8.8) running on
     * under the right-hand chair's back; the cab door in the wall at x ±0.3.
     */
    private static final WagonType.Interior CAB = new WagonType.Interior(List.of(
            zone(-1.5, 9.0, 0.4, 9.6), zone(-1.5, 7.0, 1.5, 8.8)));
    private static final WagonType.Door CAB_DOOR =
            new WagonType.Door("CabD", -0.3, FLOOR, 8.85, 0.3, 3.9, 8.95, true, false, false);
    private static final WagonType.Seat DRIVER = new WagonType.Seat(-1.2, CUSHION, 9.3, 0.0F);
    private static final WagonType.Seat ASSISTANT = new WagonType.Seat(1.2, CUSHION, 9.3, 0.0F);

    private static WagonType type(WagonType.Interior floor, List<WagonType.Door> doors, List<WagonType.Seat> seats) {
        return new WagonType("test:cab", 20.0, new double[]{6.0, -6.0}, 50.0, 120.0,
                new WagonType.Resistance(1.0, 1.0, 1.0), null, new WagonType.Cab(seats),
                new WagonType.Brakes(100.0, 0.0, 0.0, 0.0, 0.0), floor, doors);
    }

    @Test
    void standingUp_besideAChairOffTheFloor_staysInTheCab() {
        // the vestibule is the nearer floor: the old nearest-point rule put the driver there
        Vector3d nearest = CAB.clampFeet(new Vector3d(ASSISTANT.x(), ASSISTANT.y(), ASSISTANT.z()), R);
        assertTrue(nearest.z < 8.8, "nearest floor is behind the wall: " + nearest);
        // sat down from the cab's middle: back up at the cab's end, by the chair
        Vector3d up = RiderWalk.toward(new Vector3d(-0.5, FLOOR, 9.3), ASSISTANT.x(), ASSISTANT.z(),
                CAB, List.of(CAB_DOOR), 0);
        assertEquals(9.3, up.z, 1.0e-6);
        assertEquals(0.4 - R, up.x, 1.0e-6);
        assertEquals(FLOOR, up.y, 1.0e-9);
        // a chair over the floor: on the chair's spot, as before
        Vector3d driver = RiderWalk.toward(new Vector3d(-0.5, FLOOR, 9.3), DRIVER.x(), DRIVER.z(),
                CAB, List.of(CAB_DOOR), 0);
        assertEquals(DRIVER.x(), driver.x, 1.0e-6);
        assertEquals(DRIVER.z(), driver.z, 1.0e-6);
    }

    @Test
    void everyChair_needsAPlaceToStandWithinReach_atItsHeight() {
        assertTrue(FloorCheck.problems(type(CAB, List.of(CAB_DOOR), List.of(DRIVER, ASSISTANT))).isEmpty(),
                FloorCheck.problems(type(CAB, List.of(CAB_DOOR), List.of(DRIVER, ASSISTANT))).toString());
        WagonType.Seat far = new WagonType.Seat(1.2, CUSHION, 12.5, 180.0F);
        WagonType.Seat low = new WagonType.Seat(-1.2, FLOOR + 0.1, 9.3, 0.0F);
        List<String> problems = FloorCheck.problems(type(CAB, List.of(CAB_DOOR), List.of(DRIVER, far, low)));
        assertEquals(2, problems.size(), problems.toString());
        assertTrue(problems.get(0).startsWith("cab.seats[1]"), problems.get(0));
        assertTrue(problems.get(1).startsWith("cab.seats[2]"), problems.get(1));
    }

    @Test
    void theOtherEndsCab_withItsOwnSteps_isWalkableFloor() {
        // two cabs a hood apart, each walked into from its own steps
        WagonType.Interior cabs = new WagonType.Interior(List.of(zone(-1.5, 6.0, 1.5, 8.0), zone(-1.5, -8.0, 1.5, -6.0)));
        WagonType.Door front = new WagonType.Door("side1", 1.5, 1.2, 6.5, 1.6, 3.9, 7.5, false, true, false);
        WagonType.Door rear = new WagonType.Door("side4", 1.5, 1.2, -7.5, 1.6, 3.9, -6.5, false, true, false);
        List<WagonType.Seat> chairs = List.of(new WagonType.Seat(-0.8, CUSHION, 7.5, 0.0F),
                new WagonType.Seat(0.8, CUSHION, -7.5, 180.0F));
        assertTrue(FloorCheck.problems(type(cabs, List.of(front, rear), chairs)).isEmpty(),
                FloorCheck.problems(type(cabs, List.of(front, rear), chairs)).toString());
        // without the rear steps nobody gets into the rear cab
        List<String> problems = FloorCheck.problems(type(cabs, List.of(front), chairs));
        assertEquals(1, problems.size(), problems.toString());
        assertTrue(problems.get(0).startsWith("floor zones [1] can't be walked to"), problems.get(0));
    }
}
