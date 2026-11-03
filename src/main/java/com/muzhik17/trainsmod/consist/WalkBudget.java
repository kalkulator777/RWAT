package com.muzhik17.trainsmod.consist;

/**
 * One walk step a server tick for a rider (SPEC v1.5-б): the server steps a
 * walking rider by each input their client sends, and a client sends one a
 * tick — a client sending more walked faster, as fast as it liked; walls
 * held, the pace didn't. Now each tick earns one step, and a step not taken
 * keeps for a few ticks ({@link #BURST}): the network bunches inputs — none
 * in one tick, two in the next — and an honest input is never dropped for
 * coming late, while over any stretch of ticks no client walks more steps
 * than the ticks it took plus {@link #BURST}. Pure; one per rider.
 */
public final class WalkBudget {

    /** The most steps a tick may take: its own and the ones the ticks just gone didn't. */
    public static final int BURST = 4;

    private boolean started;
    private long lastTick;
    private int steps;

    /**
     * Take a step in server tick {@code tick} (non-decreasing): true if the
     * rider has one to take — the input is stepped — false if the steps of
     * the ticks so far are used up.
     */
    public boolean take(long tick) {
        if (!started) {
            started = true;
            lastTick = tick;
            steps = 1; // a rider just aboard has this tick's step
        } else if (tick > lastTick) {
            steps = (int) Math.min(BURST, steps + (tick - lastTick));
            lastTick = tick;
        }
        if (steps <= 0) {
            return false;
        }
        steps--;
        return true;
    }
}
