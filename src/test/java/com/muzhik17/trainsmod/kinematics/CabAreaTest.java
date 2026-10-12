package com.muzhik17.trainsmod.kinematics;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.stock.WagonType;

/**
 * The cab of a car and the doors into it (SPEC §9.2, the driver's key): read
 * off the floor, the doors and the chairs — the ChME3's cab ends at its doors
 * onto the walkways, an EMU head car's at its partition, the assistant's
 * chair off the floor belongs to the driver's cab, a double-ended loco has
 * two; the passengers' side doors the driver's panel works (SPEC §9.7).
 */
class CabAreaTest {

    private static final double FLOOR = 1.9;

    private static WagonType.Interior.Zone zone(double minX, double minZ, double maxX, double maxZ) {
        return new WagonType.Interior.Zone(minX, FLOOR, minZ, maxX, 4.0, maxZ);
    }

    private static WagonType type(WagonType.Interior floor, List<WagonType.Door> doors,
            List<WagonType.Seat> seats) {
        return new WagonType("test:cab", 20.0, new double[]{6.0, -6.0}, 50.0, 120.0,
                new WagonType.Resistance(1.0, 1.0, 1.0), null, seats == null ? null : new WagonType.Cab(seats),
                new WagonType.Brakes(100.0, 0.0, 0.0, 0.0, 0.0), floor, doors);
    }

    private static WagonType.Seat chair(double x, double z, float yaw) {
        return new WagonType.Seat(x, FLOOR + 0.55, z, yaw);
    }

    private static WagonType.Door side(String id, int out, double minZ, double maxZ, String group) {
        double x = out > 0 ? 1.6 : -1.7;
        return new WagonType.Door(id, x, FLOOR, minZ, x + 0.1, 4.0, maxZ, false, false, false, group);
    }

    /**
     * An EMU head car, simplified: the saloon z −9.5…4.9, the partition with
     * its door at z 4.9…5.1, the cab z 5.1…8 with the driver's chair; side
     * doors of the passengers in groups, a door of the cab's own, an
     * engine-room door without a group.
     */
    private static final WagonType EMU_HEAD = type(new WagonType.Interior(List.of(
                    zone(-1.3, -9.5, 1.3, 4.9), zone(-1.3, 5.1, 1.3, 8.0))),
            List.of(side("DrL", 1, 2.0, 3.0, "DrL"),
                    side("DrR", -1, 2.0, 3.0, "DrR"),
                    side("CabSide", 1, 6.0, 7.0, null),
                    new WagonType.Door("CabD", -0.4, FLOOR, 4.9, 0.4, 4.0, 5.1, true, false),
                    side("Engine", 1, -5.0, -4.0, null)),
            List.of(chair(-0.6, 7.0, 0.0F), chair(0.6, 7.0, 0.0F)));

    @Test
    void chme3_theCabEndsAtItsDoorsOntoTheWalkways() {
        WagonType chme3 = type(CabFloorTest.CHME3, CabFloorTest.DOORS,
                List.of(new WagonType.Seat(-1.062, 3.09, -4.654, 0.0F)));
        CabArea area = CabArea.of(chme3);
        assertEquals(1, area.cabs());
        assertEquals(0, area.cabAt(-1.0, -5.0), "behind the desk");
        assertEquals(0, area.cabAt(1.1, -4.0), "the aisle beside the desk");
        assertEquals(-1, area.cabAt(1.25, 0.0), "the walkway");
        assertEquals(-1, area.cabAt(0.0, 8.0), "the front platform");
        assertTrue(area.cabDoor(0), "door1 onto the short-hood walkway");
        assertTrue(area.cabDoor(1), "door2 onto the long-hood walkway");
        assertFalse(area.cabDoor(2), "the corner step has no leaf to lock");
    }

    @Test
    void emuHead_theSaloonIsNoCab_onlyTheCabsDoorsWantTheKey() {
        CabArea area = CabArea.of(EMU_HEAD);
        assertEquals(1, area.cabs());
        assertEquals(-1, area.cabAt(0.0, 0.0), "the saloon");
        assertEquals(0, area.cabAt(0.0, 6.5), "the cab");
        assertEquals(-1, area.cabAt(0.0, 5.0), "the doorway between them is neither");
        assertEquals(0b01100, area.cabDoors(), "the cab's side door and the partition door");
        assertEquals(0, area.cabOfChair(0));
        assertEquals(0, area.cabOfChair(1));
        assertSame(area, CabArea.of(EMU_HEAD), "made once per type");
    }

    @Test
    void doorOfACabDoorsGroup_wantsTheKeyToo() {
        // the ER2's CabD pair: the partition door and the one into the cab open together
        WagonType er2 = type(new WagonType.Interior(List.of(
                        zone(-1.3, -9.5, 1.3, 4.9), zone(-0.6, 5.1, 0.6, 6.0), zone(-1.3, 6.2, 1.3, 8.0))),
                List.of(new WagonType.Door("CabD", -0.4, FLOOR, 4.9, 0.4, 4.0, 5.1, true, false, false, "CabD"),
                        new WagonType.Door("CabD_2", -0.4, FLOOR, 6.0, 0.4, 4.0, 6.2, true, false, false, "CabD")),
                List.of(chair(-0.6, 7.0, 0.0F)));
        CabArea area = CabArea.of(er2);
        assertEquals(-1, area.cabAt(0.0, 5.5), "the little vestibule between the doors");
        assertTrue(area.cabDoor(1), "into the cab");
        assertTrue(area.cabDoor(0), "opens with the door into the cab");
    }

    @Test
    void assistantsChairOffTheFloor_belongsToTheDriversCab() {
        // the SR3: the floor nearest the assistant's chair is the vestibule behind the cab's wall
        WagonType sr3 = type(new WagonType.Interior(List.of(zone(-1.5, 9.0, 0.4, 9.6), zone(-1.5, 7.0, 1.5, 8.8))),
                List.of(new WagonType.Door("CabD", -0.3, FLOOR, 8.85, 0.3, 4.0, 8.95, true, false)),
                List.of(chair(-1.2, 9.3, 0.0F), chair(1.2, 9.3, 0.0F)));
        CabArea area = CabArea.of(sr3);
        assertEquals(1, area.cabs());
        assertEquals(0, area.cabOfChair(1));
        assertEquals(-1, area.cabAt(0.0, 8.0), "the vestibule is no cab");
        assertTrue(area.cabDoor(0));
    }

    @Test
    void doubleEndedLoco_hasTwoCabs_eachItsNearestChair() {
        WagonType loco = type(new WagonType.Interior(List.of(
                        zone(-1.3, 6.0, 1.3, 8.0), zone(-1.3, -8.0, 1.3, -6.0), zone(-0.5, -5.8, 0.5, 5.8))),
                List.of(new WagonType.Door("Front", -0.4, FLOOR, 5.8, 0.4, 4.0, 6.0, true, false),
                        new WagonType.Door("Rear", -0.4, FLOOR, -6.0, 0.4, 4.0, -5.8, true, false)),
                List.of(chair(-0.8, 7.5, 0.0F), chair(0.8, 7.5, 0.0F),
                        chair(0.8, -7.5, 180.0F), chair(-0.8, -7.5, 180.0F)));
        CabArea area = CabArea.of(loco);
        assertEquals(2, area.cabs());
        assertEquals(0, area.cabAt(0.0, 7.0));
        assertEquals(1, area.cabAt(0.0, -7.0));
        assertEquals(-1, area.cabAt(0.0, 0.0), "the engine room");
        assertEquals(2, area.nearestChair(1, 0.7, -7.0));
        assertEquals(0, area.nearestChair(0, -0.5, 7.0));
        assertEquals(-1, area.nearestChair(-1, 0.0, 0.0));
    }

    @Test
    void facing_asTheDriverSeesIt() {
        assertEquals(1, CabArea.facing(false, null));
        assertEquals(-1, CabArea.facing(true, null));
        assertEquals(-1, CabArea.facing(false, chair(0.0, 0.0, 180.0F)));
        assertEquals(1, CabArea.facing(true, chair(0.0, 0.0, 180.0F)));
        assertEquals(1, CabArea.facing(false, chair(0.0, 0.0, 90.0F)), "a chair square to the side looks ahead");
    }

    @Test
    void carWithoutAWalkableCab_hasNone() {
        assertSame(CabArea.NONE, CabArea.of(null));
        WagonType bareLoco = new WagonType("test:loco", 15.0, new double[]{4.0, -4.0}, 80.0, 100.0,
                new WagonType.Resistance(1.0, 1.0, 1.0), null, new WagonType.Cab(),
                new WagonType.Brakes(100.0, 0.0, 0.0, 0.0, 0.0), null);
        CabArea area = CabArea.of(bareLoco);
        assertEquals(0, area.cabs());
        assertEquals(-1, area.cabAt(0.0, 0.0));
        assertFalse(area.cabDoor(0));
    }
}
