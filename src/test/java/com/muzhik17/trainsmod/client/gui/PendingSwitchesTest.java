package com.muzhik17.trainsmod.client.gui;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

/** The driver's panel's light clicks waiting for the sync (SPEC §9.7, audit M31). */
class PendingSwitchesTest {

    private final PendingSwitches pending = new PendingSwitches();
    private final Set<String> lit = new HashSet<>();

    @Test
    void aClick_showsUntilTheSyncAgrees() {
        pending.put("HL", true, 0);
        pending.settle(lit::contains, 1);
        assertEquals(Boolean.TRUE, pending.get("HL")); // the server hasn't answered yet
        lit.add("HL");
        pending.settle(lit::contains, 3);
        assertNull(pending.get("HL")); // the lamp reads the synced state again
    }

    @Test
    void aRefusedClick_givesWayAfterTheTimeout() {
        // not the train's driver: the server never switches it, the lamp mustn't stay lit
        pending.put("HL", true, 10);
        pending.settle(lit::contains, 10 + PendingSwitches.TIMEOUT_TICKS - 1);
        assertEquals(Boolean.TRUE, pending.get("HL"));
        pending.settle(lit::contains, 10 + PendingSwitches.TIMEOUT_TICKS);
        assertNull(pending.get("HL"));
    }

    @Test
    void switchedOffElsewhere_theLampFollowsOnceTheClickIsSettled() {
        // switched on here, the sync agrees; then the cab's own switch puts it off: no stale "on"
        pending.put("TL", true, 0);
        lit.add("TL");
        pending.settle(lit::contains, 2);
        lit.remove("TL");
        pending.settle(lit::contains, 3);
        assertNull(pending.get("TL"));
    }

    @Test
    void aSwitchOff_waitsForEveryWagonToGoDark() {
        lit.add("IL");
        pending.put("IL", false, 0);
        pending.settle(lit::contains, 1);
        assertEquals(Boolean.FALSE, pending.get("IL"));
        lit.remove("IL");
        pending.settle(lit::contains, 2);
        assertNull(pending.get("IL"));
    }

    @Test
    void groupsGone_areForgotten() {
        pending.put("HL", true, 0);
        pending.put("TL", true, 0);
        pending.retain(List.of("TL"));
        assertNull(pending.get("HL"));
        assertEquals(Boolean.TRUE, pending.get("TL"));
    }
}
