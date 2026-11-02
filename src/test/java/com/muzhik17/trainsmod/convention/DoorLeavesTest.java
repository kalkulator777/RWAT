package com.muzhik17.trainsmod.convention;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.stock.WagonType;

/** Which model objects are door leaves, and which door each is (SPEC §9.5). */
class DoorLeavesTest {

    private static String key(DoorLeaves leaves, String object) {
        ObjectRole leaf = leaves.leaf(object);
        return leaf == null ? null : leaf.control().key();
    }

    @Test
    void aDoorMovesByItsHingeMarkerOrSlide_elseItIsBody() {
        DoorLeaves leaves = DoorLeaves.of(List.of("DOOR_3_EXTERNAL", "DOOR_3_ROT_90", "DOOR_4_EXTERNAL",
                "DOOR_5_LEAF", "DOOR_5_TL_0.6_Z", "DOOR_3_HANDLE.001", "BODY"), List.of(), Set.of());
        assertEquals(Set.of("DOOR_3", "DOOR_5"), leaves.keys());
        assertEquals("DOOR_3", key(leaves, "DOOR_3_EXTERNAL"));
        assertEquals("DOOR_3", key(leaves, "DOOR_3_ROT_90"));
        assertEquals("DOOR_3", key(leaves, "DOOR_3_HANDLE.001")); // a copy suffix aside
        assertEquals("DOOR_5", key(leaves, "DOOR_5_LEAF"));
        assertNull(key(leaves, "DOOR_4_EXTERNAL")); // nothing moves DOOR_4: body
        assertNull(key(leaves, "BODY"));
        assertEquals(90.0F, leaves.leaf("DOOR_3_ROT_90").pivotDegrees());
    }

    /**
     * What the model draws otherwise is no leaf, and doesn't make its door move:
     * the loader and the example pack's test once each had a rule of their own,
     * and they parted on a bogie's door ("BOGEY_" or BOGEY_FRONT/BOGEY_REAR) and
     * on a coupler head.
     */
    @Test
    void hiddenSkippedBogieCouplerAndAnimatedObjectsAreNoLeaves() {
        List<String> objects = List.of("DOOR_1_ROT_90_HIDE", "DOOR_1", "CARGO_DOOR_2_ROT", "DOOR_2",
                "BOGEY_FRONT_DOOR_3_ROT", "DOOR_3", "COUPLED_FRONT_1_DOOR_4_TL_1_X", "DOOR_4", "DOOR_5_ROT",
                "DOOR_5_LEAF", "BOGEY_MIDDLE_DOOR_6_ROT_45");
        DoorLeaves leaves = DoorLeaves.of(objects, List.of("CARGO"), Set.of("DOOR_5_ROT"));
        // a bogie is BOGEY_FRONT… or BOGEY_REAR…: any other BOGEY_ object is drawn with the body
        assertEquals(Set.of("DOOR_6"), leaves.keys());
        for (String object : objects.subList(0, objects.size() - 1)) {
            assertNull(key(leaves, object), object);
        }
        assertEquals("DOOR_6", key(leaves, "BOGEY_MIDDLE_DOOR_6_ROT_45"));
    }

    /** A leaf is the door whose box, grown by 0.1, holds the centre of its drawn faces — told in the OBJ frame. */
    @Test
    void aLeafIsTheDoorWhoseBoxHoldsItsCentre() {
        // a side door at OBJ x -1..0 in the +z wall (model frame: x 1.4..1.5, z 0..1)
        WagonType.Door side = new WagonType.Door("door_1", 1.4, 1.3, 0.0, 1.5, 3.3, 1.0);
        WagonType.Door step = new WagonType.Door("step", 1.4, 1.3, 2.0, 1.5, 3.3, 3.0, false, true);
        WagonType type = new WagonType("test:coach", 12.0, new double[]{3.0, -3.0}, 20.0, 80.0,
                WagonType.Resistance.NONE, null, null, WagonType.Brakes.NONE, null, List.of(step, side));
        // the leaf: OBJ x -0.95..-0.05, y 0.9..2.8, z 1.42..1.48 → centre (0.5 model z, 1.45 model x)
        assertEquals(1, DoorLeaves.door(type, new double[]{-0.95, 0.9, 1.42}, new double[]{-0.05, 2.8, 1.48}));
        // a box beside the doorway (a fixed doorway has no leaf to take it)
        assertEquals(-1, DoorLeaves.door(type, new double[]{-2.95, 0.9, 1.42}, new double[]{-2.05, 2.8, 1.48}));
    }
}
