package com.muzhik17.trainsmod.client.sound;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypes;

/**
 * Door sounds go by what the doors do, not by the bits of a mask a pack
 * reload re-indexed (D1): the new type and the re-indexed mask reach the
 * client a tick apart, in either order.
 */
class DoorChangesTest {

    private static WagonType car(String... doorIds) {
        List<WagonType.Door> doors = new ArrayList<>();
        for (int i = 0; i < doorIds.length; i++) {
            doors.add(new WagonType.Door(doorIds[i], 1.4, 1.0, i, 1.5, 3.0, i + 0.8));
        }
        return new WagonType("t:car", 20.0, new double[]{7.0, -7.0}, 40.0, 100.0, WagonType.Resistance.NONE,
                null, null, WagonType.Brakes.NONE, new WagonType.Interior(-1, 1, -9, 1, 4, 9), doors);
    }

    /** The ticks of the settling time pass with nothing moving. */
    private static void settle(DoorChanges doors, WagonType type, int generation, int mask) {
        for (int i = 0; i < DoorChanges.SETTLE_TICKS; i++) {
            assertEquals(0, doors.update(type, generation, mask));
        }
    }

    @Test
    void aDoorThatOpensOrClosesIsHeard_theFirstStateIsNot() {
        WagonType car = car("a", "b");
        DoorChanges doors = new DoorChanges();

        assertEquals(0, doors.update(car, 1, 0b01), "the state first seen is no event");
        assertEquals(0, doors.update(car, 1, 0b01));
        assertEquals(0b10, doors.update(car, 1, 0b11));
        assertEquals(0b01, doors.update(car, 1, 0b10));
    }

    /**
     * The reload turns the door list round; door a stays open. The server
     * re-indexes the mask (a: bit 0 → bit 1), the client gets the type first
     * and the mask a tick later: bit for bit that is a closes and b opens,
     * twice over. Nothing is heard; a door that moves afterwards is.
     */
    @Test
    void aReloadedTypeThenItsReindexedMask_soundNothing() {
        WagonType before = car("a", "b");
        WagonType after = car("b", "a");
        DoorChanges doors = new DoorChanges();
        doors.update(before, 1, 0b01);
        assertEquals(0b10, WagonTypes.openDoorsAfter(before, after, 0b01), "the server's re-indexing");

        assertEquals(0, doors.update(after, 2, 0b01), "the new type, the old mask");
        assertEquals(0, doors.update(after, 2, 0b10), "the mask re-indexed a tick later");
        settle(doors, after, 2, 0b10);

        assertEquals(0b01, doors.update(after, 2, 0b11), "then door b opens, and is heard");
    }

    /** The other order: the registry is reloaded and the mask re-indexed while the wagon still has the old type. */
    @Test
    void aReindexedMaskBeforeItsType_soundsNothing() {
        WagonType before = car("a", "b");
        WagonType after = car("b", "a");
        DoorChanges doors = new DoorChanges();
        doors.update(before, 1, 0b01);

        assertEquals(0, doors.update(before, 2, 0b10), "the registry moved: the mask is the reload's");
        assertEquals(0, doors.update(after, 2, 0b10));
        settle(doors, after, 2, 0b10);
        assertEquals(0b10, doors.update(after, 2, 0b00), "door a closes");
    }
}
