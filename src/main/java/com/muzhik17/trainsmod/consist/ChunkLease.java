package com.muzhik17.trainsmod.consist;

/**
 * When a consist holds its chunks loaded (SPEC §2.1, decision 2026-10-12):
 * while someone drives it, and — under {@link Mode#MOVING} — while it runs
 * with nobody at the controls (rolled away, coasting, its driver logged out),
 * for at most {@link Policy#unmannedTicks}; after that, and once it stands
 * with nobody at the controls, it lets them go {@link Policy#lingerTicks}
 * later. One lease per consist, fed every tick. Pure, no MC imports — the
 * config adapter builds the {@link Policy}, {@code ConsistChunks} turns a
 * held lease into tickets.
 */
public final class ChunkLease {

    /** Which consists hold their chunks. */
    public enum Mode {
        /** None: a consist runs only where the world ticks anyway (the v0 rule). */
        OFF,
        /** Driven ones (a player at the controls). */
        DRIVEN,
        /** Driven ones and any on the move. */
        MOVING
    }

    /**
     * The server's chunk-loading policy.
     *
     * @param mode          which consists hold their chunks
     * @param lingerTicks   a consist stops holding them this long after it
     *                      last qualified (stood still with nobody at the controls)
     * @param unmannedTicks a consist running with nobody at the controls
     *                      holds them this long into the run; 0 = for as long
     *                      as it runs
     * @param maxChunks     most chunks one consist holds (its leading end and
     *                      the way ahead first)
     */
    public record Policy(Mode mode, int lingerTicks, int unmannedTicks, int maxChunks) {

        public static final Policy DEFAULT = new Policy(Mode.MOVING, 20 * 20, 300 * 20, 256);

        public Policy {
            lingerTicks = Math.max(0, lingerTicks);
            unmannedTicks = Math.max(0, unmannedTicks);
            maxChunks = Math.max(1, maxChunks);
        }
    }

    private static final long NEVER = Long.MIN_VALUE;

    /** Holding through this tick. */
    private long holdUntil = NEVER;
    /** Start of the current run with nobody at the controls, or {@link #NEVER}. */
    private long unmannedSince = NEVER;

    /**
     * This tick's state of the consist: is a driver at its controls, is it on
     * the move. Returns whether it holds its chunks now.
     */
    public boolean hold(Policy policy, long now, boolean driven, boolean moving) {
        if (policy.mode() == Mode.OFF) {
            holdUntil = NEVER;
            unmannedSince = NEVER;
            return false;
        }
        boolean active;
        if (driven) {
            active = true;
            unmannedSince = NEVER;
        } else if (moving && policy.mode() == Mode.MOVING) {
            if (unmannedSince == NEVER) {
                unmannedSince = now;
            }
            active = policy.unmannedTicks() == 0 || now - unmannedSince < policy.unmannedTicks();
        } else {
            active = false;
            unmannedSince = NEVER; // standing still ends a run; the next one starts afresh
        }
        if (active) {
            holdUntil = now + policy.lingerTicks();
        }
        return holdUntil != NEVER && now <= holdUntil;
    }
}
