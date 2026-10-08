package com.muzhik17.trainsmod.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;
import java.util.Set;

import org.joml.Vector3d;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.network.RiderLocal;

/**
 * The observer-sync apply/cleanup (SPEC v1.5-б): remote riders land in
 * {@link ClientWalk}, the locally-predicted player is never overwritten, and a
 * rider that drops out of the packet is cleared. Drives the wire-free
 * {@link ClientRiderSync#apply} core, so no Minecraft class is touched (unit
 * tests run without the MC classpath).
 */
class ClientRiderSyncTest {

    @BeforeEach
    void reset() {
        ClientWalk.clearAll();
        ClientRiderSync.clearAll();
    }

    @Test
    void appliesRemoteRiderToClientWalk() {
        ClientRiderSync.apply(1, List.of(new RiderLocal(42, 0.5, 1.81, 3.0)));

        assertNotNull(ClientWalk.get(42), "remote rider's feet should be stored");
        assertEquals(0.5, ClientWalk.get(42).x, 1.0e-9);
        assertEquals(3.0, ClientWalk.get(42).z, 1.0e-9);
    }

    @Test
    void skipsLocallyPredictedPlayer() {
        ClientWalk.setLocalOwner(7);
        ClientRiderSync.apply(1, List.of(new RiderLocal(7, 9.0, 9.0, 9.0)));

        assertNull(ClientWalk.get(7), "the local player's prediction must not be clobbered");
    }

    @Test
    void clearsRiderThatLeavesThePacket() {
        ClientRiderSync.apply(1, List.of(new RiderLocal(42, 0.0, 1.81, 1.0)));
        // the last rider left → server sends one empty packet for this consist
        ClientRiderSync.apply(1, List.of());

        assertNull(ClientWalk.get(42), "a departed rider's feet should be cleared");
    }

    @Test
    void keepsRemainingRidersWhenOneLeaves() {
        ClientRiderSync.apply(1, List.of(
                new RiderLocal(42, 0.0, 1.81, 1.0),
                new RiderLocal(43, 0.0, 1.81, -1.0)));
        // only 42 remains aboard
        ClientRiderSync.apply(1, List.of(new RiderLocal(42, 0.0, 1.81, 2.0)));

        assertNull(ClientWalk.get(43), "the rider who left should be cleared");
        assertNotNull(ClientWalk.get(42), "the rider still aboard should stay");
        assertEquals(2.0, ClientWalk.get(42).z, 1.0e-9, "and track their latest feet");
    }

    @Test
    void doesNotClearLocalPlayerWhenTheyDropFromTheList() {
        ClientWalk.setLocalOwner(7);
        ClientWalk.put(7, new Vector3d(0.1, 1.81, 0.2)); // their own prediction
        // a packet listing only a different rider must not evict the local player
        ClientRiderSync.apply(1, List.of(new RiderLocal(8, 0.0, 1.81, 0.0)));
        ClientRiderSync.apply(1, List.of()); // everyone "left" per the packet

        assertNotNull(ClientWalk.get(7), "local prediction survives remote-driven cleanup");
        assertNull(ClientWalk.get(8), "the remote rider is cleared");
    }

    @Test
    void differentConsistsCleanUpIndependently() {
        ClientRiderSync.apply(1, List.of(new RiderLocal(42, 0.0, 1.81, 1.0)));
        ClientRiderSync.apply(2, List.of(new RiderLocal(43, 0.0, 1.81, 1.0)));
        // consist 1 empties; consist 2 must be untouched
        ClientRiderSync.apply(1, List.of());

        assertNull(ClientWalk.get(42), "consist 1's rider is cleared");
        assertNotNull(ClientWalk.get(43), "consist 2's rider is unaffected");
    }

    @Test
    void riderFollowsTheirWagonIntoTheCoupledConsist() {
        // consist 1 (with rider 42 aboard) is absorbed by consist 2 — it never sends again
        ClientRiderSync.apply(1, List.of(new RiderLocal(42, 0.0, 1.81, 1.0)));
        ClientRiderSync.apply(2, List.of(
                new RiderLocal(42, 0.0, 1.81, 1.5),
                new RiderLocal(43, 0.0, 1.81, -1.0)));

        assertEquals(Set.of(2), ClientRiderSync.trackedConsists(),
                "the absorbed consist's rider list must not linger");
        assertEquals(1.5, ClientWalk.get(42).z, 1.0e-9, "the rider is now consist 2's");
        // and leaving consist 2 still clears them
        ClientRiderSync.apply(2, List.of(new RiderLocal(43, 0.0, 1.81, -1.0)));
        assertNull(ClientWalk.get(42));
    }

    @Test
    void uncoupledRiderSurvivesTheOldConsistsFinalEmptyPacket() {
        ClientRiderSync.apply(1, List.of(new RiderLocal(42, 0.0, 1.81, 1.0)));
        // split: the new rear consist 2 claims the rider first (the server sends
        // non-empty lists before the "last rider left" clears) …
        ClientRiderSync.apply(2, List.of(new RiderLocal(42, 0.0, 1.81, 1.0)));
        // … then consist 1, now rider-less, sends its final empty packet
        ClientRiderSync.apply(1, List.of());

        assertNotNull(ClientWalk.get(42), "the rider rode off with the uncoupled half");
        assertEquals(Set.of(2), ClientRiderSync.trackedConsists());
    }

    @Test
    void oldConsistKeepsItsOtherRidersWhenOneIsClaimed() {
        ClientRiderSync.apply(1, List.of(
                new RiderLocal(42, 0.0, 1.81, 1.0),
                new RiderLocal(43, 0.0, 1.81, -1.0)));
        ClientRiderSync.apply(2, List.of(new RiderLocal(43, 0.0, 1.81, -1.0)));
        ClientRiderSync.apply(1, List.of(new RiderLocal(42, 0.0, 1.81, 1.0)));

        assertNotNull(ClientWalk.get(42), "still aboard consist 1");
        assertNotNull(ClientWalk.get(43), "moved to consist 2, not cleared by consist 1");
        assertEquals(Set.of(1, 2), ClientRiderSync.trackedConsists());
    }
}
