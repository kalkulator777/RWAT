package com.muzhik17.trainsmod.consist;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * When a consist holds its chunks (SPEC §2.1, decision 2026-10-12): driven
 * always, on the move under {@code MOVING} for the unmanned limit of a run,
 * then {@code linger} more ticks; never under {@code OFF}; a parked consist
 * nobody touched never.
 */
class ChunkLeaseTest {

    private static final int LINGER = 100;
    private static final int UNMANNED = 1000;

    private static ChunkLease.Policy policy(ChunkLease.Mode mode) {
        return new ChunkLease.Policy(mode, LINGER, UNMANNED, 256);
    }

    @Test
    void parkedAndUntouched_neverHolds() {
        ChunkLease lease = new ChunkLease();
        for (long t = 0; t < 5000; t += 50) {
            assertFalse(lease.hold(policy(ChunkLease.Mode.MOVING), t, false, false), "t=" + t);
        }
    }

    @Test
    void off_neverHolds_evenDriven() {
        ChunkLease lease = new ChunkLease();
        assertFalse(lease.hold(policy(ChunkLease.Mode.OFF), 0, true, true));
        assertFalse(lease.hold(policy(ChunkLease.Mode.OFF), 1, false, true));
    }

    @Test
    void driven_holds_thenLingersAfterTheDriverLeaves() {
        for (ChunkLease.Mode mode : new ChunkLease.Mode[] {ChunkLease.Mode.DRIVEN, ChunkLease.Mode.MOVING}) {
            ChunkLease lease = new ChunkLease();
            ChunkLease.Policy policy = policy(mode);
            for (long t = 0; t <= 3000; t++) {
                assertTrue(lease.hold(policy, t, true, t > 100), mode + " driven at t=" + t);
            }
            // the driver steps out of a standing train at 3001
            assertTrue(lease.hold(policy, 3001, false, false));
            assertTrue(lease.hold(policy, 3000 + LINGER, false, false), mode + ": still lingering");
            assertFalse(lease.hold(policy, 3001 + LINGER, false, false), mode + ": let go");
        }
    }

    @Test
    void drivenMode_letsARunawayGoAfterTheLinger() {
        ChunkLease lease = new ChunkLease();
        ChunkLease.Policy policy = policy(ChunkLease.Mode.DRIVEN);
        assertTrue(lease.hold(policy, 0, true, true));
        // the driver left a moving train: under DRIVEN its motion holds nothing
        assertTrue(lease.hold(policy, LINGER, false, true));
        assertFalse(lease.hold(policy, LINGER + 1, false, true));
    }

    @Test
    void moving_holdsWithNobodyAtTheControls_forTheUnmannedLimit() {
        ChunkLease lease = new ChunkLease();
        ChunkLease.Policy policy = policy(ChunkLease.Mode.MOVING);
        // rolls away at 500 (bumped, released on a grade): a run starts
        assertFalse(lease.hold(policy, 499, false, false));
        for (long t = 500; t < 500 + UNMANNED; t++) {
            assertTrue(lease.hold(policy, t, false, true), "running unmanned at t=" + t);
        }
        // the limit is up: it lingers, then lets go though still running
        assertTrue(lease.hold(policy, 500 + UNMANNED + LINGER - 1, false, true));
        assertFalse(lease.hold(policy, 500 + UNMANNED + LINGER, false, true));
        // a driver boards: held again
        assertTrue(lease.hold(policy, 3000, true, true));
    }

    @Test
    void standingStill_endsARun_theNextGetsTheFullLimit() {
        ChunkLease lease = new ChunkLease();
        ChunkLease.Policy policy = policy(ChunkLease.Mode.MOVING);
        assertTrue(lease.hold(policy, 0, false, true));
        assertTrue(lease.hold(policy, UNMANNED - 10, false, true));
        assertTrue(lease.hold(policy, UNMANNED - 9, false, false)); // stopped: lingering
        // pushed off again before the linger ran out: a fresh run
        for (long t = UNMANNED; t < 2 * UNMANNED - 1; t++) {
            assertTrue(lease.hold(policy, t, false, true), "t=" + t);
        }
    }

    @Test
    void aDriverResetsTheUnmannedClock() {
        ChunkLease lease = new ChunkLease();
        ChunkLease.Policy policy = policy(ChunkLease.Mode.MOVING);
        assertTrue(lease.hold(policy, 0, false, true));
        assertTrue(lease.hold(policy, UNMANNED - 1, true, true)); // someone took the controls
        // stepped out again on the move: the run counts from here
        assertTrue(lease.hold(policy, UNMANNED, false, true));
        assertTrue(lease.hold(policy, 2 * UNMANNED - 1, false, true));
        assertTrue(lease.hold(policy, 2 * UNMANNED + LINGER - 1, false, true));
        assertFalse(lease.hold(policy, 2 * UNMANNED + LINGER, false, true));
    }

    @Test
    void unmannedZero_holdsForAsLongAsItRuns() {
        ChunkLease lease = new ChunkLease();
        ChunkLease.Policy policy = new ChunkLease.Policy(ChunkLease.Mode.MOVING, LINGER, 0, 256);
        for (long t = 0; t < 100_000; t += 97) {
            assertTrue(lease.hold(policy, t, false, true), "t=" + t);
        }
    }

    @Test
    void policy_clampsNonsense() {
        ChunkLease.Policy policy = new ChunkLease.Policy(ChunkLease.Mode.MOVING, -5, -1, 0);
        assertEquals(0, policy.lingerTicks());
        assertEquals(0, policy.unmannedTicks());
        assertEquals(1, policy.maxChunks());
    }
}
