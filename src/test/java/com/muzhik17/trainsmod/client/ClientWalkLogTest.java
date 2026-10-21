package com.muzhik17.trainsmod.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.joml.Vector3d;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.network.RiderLocal;

/**
 * The walk inputs on their way to the server (SPEC v1.5-б, audit M16): the
 * server's feet are checked against the prediction after the input they are
 * after, whatever the round trip — a lagging rider who stops isn't pulled
 * back to where they stood a round trip ago (the 10-still-ticks check took
 * any round trip over half a second for a drift), a real drift is put right
 * without losing the steps still on their way.
 */
class ClientWalkLogTest {

    private static final double SPEED = 0.12;
    private static final double FLOOR = 1.81;

    /** Walking along +Z up to a wall at z 5: the step both sides run. */
    private static final ClientWalkLog.Replay STEP = (from, input) ->
            new Vector3d(from.x, from.y, Math.min(5.0, from.z + input.forward() * SPEED));

    /** One sync from the server: its feet and the input they are after. */
    private record Sync(Vector3d feet, int ack) {
    }

    /**
     * A rider walking {@code walkTicks} then standing, with {@code lag} ticks
     * each way between client and server; the server drops input {@code
     * dropped} (−1: none). Returns the client's feet every tick.
     */
    private static List<Vector3d> ride(int lag, int walkTicks, int ticks, int dropped) {
        ClientWalkLog log = new ClientWalkLog();
        List<ClientWalkLog.Input> toServer = new ArrayList<>();   // input i sent at tick i
        List<Sync> toClient = new ArrayList<>();                  // sync made at server tick t
        Vector3d client = new Vector3d(0.0, FLOOR, 0.0);
        Vector3d server = new Vector3d(client);
        int ack = RiderLocal.NO_ACK;
        List<Vector3d> seen = new ArrayList<>();
        for (int t = 0; t < ticks; t++) {
            // the server takes in what was sent lag ticks ago, then syncs
            if (t - lag >= 0) {
                ClientWalkLog.Input input = toServer.get(t - lag);
                if (input.seq() != dropped) {
                    server = STEP.step(server, input);
                }
                ack = input.seq();
            }
            toClient.add(new Sync(new Vector3d(server), ack));
            // the client gets the sync made lag ticks ago, then walks a tick
            if (t - lag >= 0) {
                Sync sync = toClient.get(t - lag);
                Vector3d fixed = log.acknowledged(sync.feet(), sync.ack(), STEP);
                if (fixed != null) {
                    client = fixed;
                }
            }
            float forward = t < walkTicks ? 1.0f : 0.0f;
            ClientWalkLog.Input input = new ClientWalkLog.Input(t, forward, 0.0f, 0.0f, false);
            client = STEP.step(client, input);
            assertEquals(t, log.sent(forward, 0.0f, 0.0f, false, client));
            toServer.add(input);
            seen.add(new Vector3d(client));
        }
        assertEquals(server.z, client.z, 1.0e-9, "client and server end where the server has them");
        return seen;
    }

    @Test
    void aLaggingRiderWhoStops_staysWhereTheyStopped() {
        // a round trip of 1.5 s: the server is 30 ticks behind the prediction
        List<Vector3d> seen = ride(15, 20, 120, -1);
        for (int t = 1; t < seen.size(); t++) {
            assertTrue(seen.get(t).z >= seen.get(t - 1).z - 1.0e-12,
                    "pulled back at tick " + t + ": " + seen.get(t - 1).z + " -> " + seen.get(t).z);
        }
        assertEquals(20 * SPEED, seen.get(seen.size() - 1).z, 1.0e-9);
    }

    @Test
    void aDrift_isPutRight_keepingTheStepsStillOnTheirWay() {
        // the server drops input 3: once it says so, the prediction is a step
        // behind where it was — not back at the feet of a round trip ago
        List<Vector3d> seen = ride(10, 40, 100, 3);
        int corrected = 3 + 2 * 10; // input 3's sync reaches the client a round trip after it was sent
        assertEquals(corrected * SPEED, seen.get(corrected - 1).z, 1.0e-9, "before the server's word");
        assertEquals(corrected * SPEED, seen.get(corrected).z, 1.0e-9, "a step lost, the tick's step made");
        assertEquals(39 * SPEED, seen.get(seen.size() - 1).z, 1.0e-9);
    }

    @Test
    void theSameInputAcknowledgedTwice_withTheFeetMoved_isPutRightAgain() {
        // the server moved the feet without an input (a driver stood up there)
        ClientWalkLog log = new ClientWalkLog();
        log.sent(1.0f, 0.0f, 0.0f, false, new Vector3d(0.0, FLOOR, 0.12));
        log.sent(1.0f, 0.0f, 0.0f, false, new Vector3d(0.0, FLOOR, 0.24));
        assertNull(log.acknowledged(new Vector3d(0.0, FLOOR, 0.12), 0, STEP), "agreed");
        Vector3d fixed = log.acknowledged(new Vector3d(1.0, FLOOR, 2.0), 0, STEP);
        assertNotNull(fixed);
        assertEquals(1.0, fixed.x, 1.0e-9);
        assertEquals(2.12, fixed.z, 1.0e-9, "and input 1, still on its way, walked again from there");
        assertNull(log.acknowledged(new Vector3d(1.0, FLOOR, 2.12), 1, STEP), "agreed since");
    }

    @Test
    void noInputOfThisCarAcknowledged_comparesNothing() {
        ClientWalkLog log = new ClientWalkLog();
        log.sent(1.0f, 0.0f, 0.0f, false, new Vector3d(0.0, FLOOR, 0.12));
        log.clear(); // a gangway: onto the next car
        int first = log.sent(1.0f, 0.0f, 0.0f, false, new Vector3d(0.0, FLOOR, -11.0));
        assertEquals(1, first, "the numbers go on");
        Vector3d elsewhere = new Vector3d(5.0, FLOOR, 5.0);
        assertNull(log.acknowledged(elsewhere, RiderLocal.NO_ACK, STEP), "nothing taken in on this car yet");
        assertNull(log.acknowledged(elsewhere, 0, STEP), "an input of the last car");
        assertEquals(1, log.pending());
    }

    @Test
    void aCarTurnedRound_turnsThePredictionsWithIt() {
        ClientWalkLog log = new ClientWalkLog();
        log.sent(1.0f, 0.0f, 0.0f, false, new Vector3d(0.3, FLOOR, 2.0));
        log.mirror();
        assertNull(log.acknowledged(new Vector3d(-0.3, FLOOR, -2.0), 0, STEP));
    }

    @Test
    void inputsNeverAcknowledged_areForgottenPastTheCap() {
        ClientWalkLog log = new ClientWalkLog();
        for (int i = 0; i < ClientWalkLog.MAX_PENDING + 50; i++) {
            log.sent(0.0f, 0.0f, 0.0f, false, new Vector3d());
        }
        assertEquals(ClientWalkLog.MAX_PENDING, log.pending());
        assertNull(log.acknowledged(new Vector3d(1.0, 0.0, 0.0), 10, STEP), "forgotten: nothing to compare");
    }
}
