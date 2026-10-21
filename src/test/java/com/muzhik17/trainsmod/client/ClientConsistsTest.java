package com.muzhik17.trainsmod.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.BitSet;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.muzhik17.trainsmod.consist.Handles;
import com.muzhik17.trainsmod.kinematics.WagonPose;
import com.muzhik17.trainsmod.network.TrackPathSpec;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

/**
 * Snapshot playback through gaps in the stream (SPEC §2.1): a silent stream
 * is dropped after {@code STALE_DROP_TICKS} client ticks (Поправка 2), a
 * server hitch holds the train at the extrapolation cap instead of
 * saw-toothing, the resumed stream is caught up with, and a standing train's
 * keep-alives keep it. Drives the wire-free {@link ClientConsists#apply} core
 * and samples the poses on a straight line, so no Minecraft class is touched.
 */
class ClientConsistsTest {

    private static final int ID = 1;
    /** The car's entity id. */
    private static final int WAGON = 100;
    /** Running speed, blocks/tick. */
    private static final double V = 0.5;
    private static final double EPS = 1.0e-9;

    private static final WagonType CAR = new WagonType("test:car", 14.0, new double[] {5.0, -5.0},
            20.0, 100.0, WagonType.Resistance.NONE, null, null, WagonType.Brakes.NONE, null);
    private static final ConsistComposition ONE_CAR =
            new ConsistComposition(List.of(new ConsistComposition.Slot(CAR, false)));
    /** Long enough that every {@code s} the tests reach is on the line. */
    private static final TrackPathSpec LINE = new TrackPathSpec.Straight(0.0, 64.0, 0.0, 10000.0, 64.0, 0.0);

    @BeforeEach
    void reset() {
        ClientConsists.clearAll();
    }

    private static void snapshot(long gameTime, double s, double v, Handles handles) {
        ClientConsists.apply(ID, s, v, gameTime, LINE, ONE_CAR, 0, ID, 0.0, new int[] {WAGON},
                handles, new BitSet(), 0.0F, 0.0F, 0);
    }

    private static void snapshot(long gameTime, double s, double v) {
        snapshot(gameTime, s, v, Handles.REST);
    }

    /** The train running at {@link #V}: each tick a snapshot comes, then the client ticks. */
    private static void run(long fromGameTime, long toGameTime) {
        for (long t = fromGameTime; t <= toGameTime; t++) {
            snapshot(t, V * t, V);
            ClientConsists.tickAll();
        }
    }

    private static void ticks(int count) {
        for (int i = 0; i < count; i++) {
            ClientConsists.tickAll();
        }
    }

    /** The head {@code s} the car stands at this tick (its front bogie is the head). */
    private static double shownS() {
        WagonPose pose = ClientConsists.tickPose(ID, 0);
        assertNotNull(pose, "the consist should still be known");
        return pose.front().pathS();
    }

    private static double renderedS(float partialTick) {
        return ClientConsists.renderPose(ID, 0, partialTick).front().pathS();
    }

    @Test
    void aSilentStream_isDroppedWithItsWagons() {
        run(0, 20); // the last snapshot, and the tick it came in
        assertEquals(ID, ClientConsists.memberConsist(WAGON, -1));

        ticks(59);
        assertNotNull(ClientConsists.tickPose(ID, 0), "60 ticks of silence: a lagging stream keeps its state");

        ticks(1);
        assertNull(ClientConsists.tickPose(ID, 0), "61 ticks of silence: the untracked consist is dropped");
        assertNull(ClientConsists.composition(ID));
        assertEquals(-1, ClientConsists.memberConsist(WAGON, -1), "and its wagons forget it");
        assertEquals(-1, ClientConsists.entityIdAt(ID, 0));
    }

    @Test
    void aServerHitch_holdsTheTrainInsteadOfSawToothing() {
        run(0, 40);
        double last = shownS();
        for (int tick = 1; tick <= 55; tick++) {
            ClientConsists.tickAll();
            double now = shownS();
            assertTrue(now >= last - EPS, "silent tick " + tick + ": the train jumped back " + last + " → " + now);
            last = now;
        }
        assertEquals(V * (40 + 20), last, 1.0e-6,
                "it stands where extrapolation stopped, 20 ticks past the newest snapshot");
        assertEquals(last, renderedS(0.5F), 1.0e-6, "and is drawn standing there, not wobbling between ticks");
    }

    @Test
    void aStreamResumingWhereItStopped_isCaughtUpWithoutAJumpBack() {
        run(0, 40);
        ticks(45); // the server stood: no snapshots, and it skipped the time
        double last = shownS();
        for (long t = 41; t <= 120; t++) {
            snapshot(t, V * t, V);
            ClientConsists.tickAll();
            double now = shownS();
            assertTrue(now >= last - EPS, "snapshot " + t + ": the train jumped back " + last + " → " + now);
            last = now;
        }
        assertEquals(V * (120 - ClientConsists.INTERP_DELAY_TICKS), last, V * 0.25,
                "back to playing the delay behind the newest snapshot");
    }

    @Test
    void aCatchUpBurstFarAhead_snapsTheClockForward() {
        run(0, 40);
        ticks(45);
        double held = shownS();
        // the server catches up on the ticks it missed, a burst of snapshots
        for (long t = 41; t <= 63; t++) {
            snapshot(t, V * t, V);
        }
        ClientConsists.tickAll();
        assertTrue(shownS() >= held - EPS, "the stream reaching the held train plays on from there");
        for (long t = 64; t <= 85; t++) {
            snapshot(t, V * t, V);
        }
        ClientConsists.tickAll();
        assertEquals(V * (85 - ClientConsists.INTERP_DELAY_TICKS), shownS(), 1.0e-6,
                "a stream far ahead of the clock is snapped to");
    }

    @Test
    void aStandingTrainsKeepAlives_keepItForGood() {
        for (long t = 0; t <= 600; t++) {
            if (t % 10 == 0) {
                snapshot(t, 5.0, 0.0); // a frozen train: a snapshot every 10 ticks
            }
            ClientConsists.tickAll();
            assertEquals(5.0, shownS(), EPS, "tick " + t);
        }
        assertEquals(ID, ClientConsists.memberConsist(WAGON, -1));
    }

    @Test
    void lateAndDuplicateSnapshots_areIgnored() {
        snapshot(100, 10.0, 0.5);
        Handles moved = new Handles(1, 3, 0, 0, 0);
        snapshot(100, 99.0, 9.0, moved); // a copy via another tracked wagon
        snapshot(99, 50.0, 7.0, moved); // out of order
        assertEquals(0.5, ClientConsists.speed(ID), EPS);
        assertEquals(Handles.REST, ClientConsists.handles(ID));

        ClientConsists.tickAll();
        assertEquals(10.0, shownS(), EPS);
    }
}
