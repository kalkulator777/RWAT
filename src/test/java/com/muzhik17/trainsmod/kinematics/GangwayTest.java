package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Walking from car to car through the gangway (SPEC §9.5): an open
 * connecting door in an end wall is a way out of the car — into the next one,
 * through its connecting door facing back. The numbers are the MVP
 * platzkart's (model space): floor z ±11.75, end doors {@code DOOR_5/6}.
 */
class GangwayTest {

    private static final double FLOOR = 1.81;

    static final WagonType.Interior PLATZKART = new WagonType.Interior(List.of(
            new WagonType.Interior.Zone(-1.35, FLOOR, -11.75, 1.35, 4.55, 11.75)));

    /** Side doors 0–3 (vestibules), gangway doors 4 (front end) and 5 (rear end). */
    static final List<WagonType.Door> DOORS = List.of(
            new WagonType.Door("Door1", 1.362, 1.811, 10.875, 1.638, 3.811, 11.688),
            new WagonType.Door("Door2", -1.638, 1.811, 10.875, -1.362, 3.811, 11.688),
            new WagonType.Door("Door3", -1.638, 1.811, -11.688, -1.362, 3.811, -10.875),
            new WagonType.Door("Door4", 1.362, 1.811, -11.688, 1.638, 3.811, -10.875),
            new WagonType.Door("Trap1", -0.438, 1.936, 11.75, 0.438, 3.874, 12.044, false, false, true),
            new WagonType.Door("Trap2", -0.438, 1.936, -12.044, 0.438, 3.874, -11.75, false, false, true));

    private static final int FRONT_GANGWAY = 1 << 4;

    @Test
    void connectingDoor_isAnEndDoor_notAWayIn() {
        WagonType.Door front = DOORS.get(4);
        assertEquals(2, front.axis());
        assertEquals(1, front.outward());
        assertFalse(front.external());
        assertTrue(DOORS.get(0).external());
        // a car with gangway doors only is still boarded the old way
        WagonType onlyGangways = new WagonType("test:car", 25.0, new double[]{8.5, -8.5}, 50.0, 120.0,
                new WagonType.Resistance(1.0, 1.0, 1.0), null, null,
                new WagonType.Brakes(100.0, 0.0, 0.0, 0.0, 0.0), PLATZKART, DOORS.subList(4, 6));
        assertFalse(onlyGangways.doorsOnly());
    }

    @Test
    void openGangwayDoor_leadsOut_closedOneIsWall() {
        Vector3d atEnd = new Vector3d(0.0, FLOOR, 11.45 - 0.01);
        assertEquals(4, RiderWalk.exitDoor(atEnd, 1.0, 0.0, 0.0F, 0.0F, PLATZKART, DOORS, FRONT_GANGWAY));
        assertEquals(-1, RiderWalk.exitDoor(atEnd, 1.0, 0.0, 0.0F, 0.0F, PLATZKART, DOORS, 0));
        Vector3d stopped = atEnd;
        for (int i = 0; i < 20; i++) {
            stopped = RiderWalk.step(stopped, 1.0, 0.0, 0.0F, 0.0F, PLATZKART, DOORS, 0);
        }
        assertEquals(11.75 - RiderWalk.PLAYER_HALF_WIDTH, stopped.z, 1.0e-6);
    }

    @Test
    void besideTheGangwayDoor_isWall() {
        // at the end wall but across the car from the door's span: no way through
        Vector3d corner = new Vector3d(1.0, FLOOR, 11.44);
        assertEquals(-1, RiderWalk.exitDoor(corner, 1.0, 0.0, 0.0F, 0.0F, PLATZKART, DOORS, FRONT_GANGWAY));
    }

    @Test
    void arrival_isJustInsideTheFacingDoor_ofTheNextCar() {
        // walking forward out of a car's front end: into the next car through its rear end door
        RiderWalk.Arrival arrival = RiderWalk.gangwayArrival(DOORS, PLATZKART, 1, 0.05);
        assertNotNull(arrival);
        assertEquals(5, arrival.door());
        assertEquals(-11.75 + RiderWalk.PLAYER_HALF_WIDTH + 0.05, arrival.feet().z, 1.0e-6);
        assertEquals(0.05, arrival.feet().x, 1.0e-6);
        assertEquals(FLOOR, arrival.feet().y, 1.0e-9);
        // and back: in through its front end door
        RiderWalk.Arrival back = RiderWalk.gangwayArrival(DOORS, PLATZKART, -1, 0.0);
        assertNotNull(back);
        assertEquals(4, back.door());
        assertEquals(11.75 - RiderWalk.PLAYER_HALF_WIDTH - 0.05, back.feet().z, 1.0e-6);
    }

    @Test
    void arrival_keepsTheRiderWithinTheDoorSpan() {
        // came through a wide door off-centre; this car's door is narrower
        RiderWalk.Arrival arrival = RiderWalk.gangwayArrival(DOORS, PLATZKART, 1, 1.2);
        assertNotNull(arrival);
        assertEquals(0.438 - RiderWalk.PLAYER_HALF_WIDTH, arrival.feet().x, 1.0e-6);
    }

    @Test
    void arrival_inATurnedCar_usesItsOtherEnd() {
        // the next car runs turned: its front door (Trap1) is at its pose-frame rear
        List<WagonType.Door> turned = new ArrayList<>();
        for (WagonType.Door door : DOORS) {
            turned.add(door.inFrame(true));
        }
        RiderWalk.Arrival arrival = RiderWalk.gangwayArrival(turned, PLATZKART.inFrame(true), 1, 0.0);
        assertNotNull(arrival);
        assertEquals("Trap1", turned.get(arrival.door()).id());
        assertTrue(arrival.feet().z < -11.0);
    }

    @Test
    void noGangwayDoorFacingBack_noArrival() {
        assertNull(RiderWalk.gangwayArrival(DOORS.subList(0, 4), PLATZKART, 1, 0.0));
        // only a front gangway door: nothing faces a rider coming from behind
        assertNull(RiderWalk.gangwayArrival(DOORS.subList(0, 5), PLATZKART, 1, 0.0));
    }
}
