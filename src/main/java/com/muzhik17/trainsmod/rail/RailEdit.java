package com.muzhik17.trainsmod.rail;

/**
 * What a click with the rails came to (SPEC §2.2): whether it changed the
 * graph — then the revision moves on and every player in the dimension
 * gets the graph ({@link #changesGraph}) — and how long the rails rest
 * after it ({@link #cooldownTicks}). A build or a repaint lays out the bed
 * of a whole structure, up to thousands of blocks, and asks the world about
 * every cell of it, whether it then changes the world or is refused; held
 * down, the use key repeats every 4 ticks. So the edits that got that far
 * put the rails on a cooldown — vanilla's item cooldown: the server doesn't
 * call the item meanwhile (nor opens the style picker on a click into the
 * air), the client greys the slot — and the cheap outcomes don't. Pure: no
 * Minecraft classes.
 */
public enum RailEdit {

    /**
     * Nothing to edit, found before any bed was laid out: no track under a
     * repaint, no marker or no second one in range, markers too close.
     */
    NOTHING,
    /** Built, or repainted in another style or bed: the graph changed. */
    DONE,
    /**
     * A repaint in the look the structure already has: its bed is laid out
     * again — holes closed, what is in the way cleared, as a repaint does
     * (SPEC §2.2) — but the graph is as it was: the track and its look.
     */
    RELAID,
    /**
     * Refused once the bed was laid out: something in the way can't go, the
     * player may not change a cell of it, or the graph refuses a segment.
     */
    REFUSED;

    /**
     * The cooldown after a heavy edit, ticks: one second — five repeats of a
     * held key, and less than it takes to set out the next pair of markers.
     */
    public static final int COOLDOWN_TICKS = 20;

    /** How long the rails rest after this edit, ticks; 0 = not at all. */
    public int cooldownTicks() {
        return switch (this) {
            case DONE, RELAID, REFUSED -> COOLDOWN_TICKS;
            case NOTHING -> 0;
        };
    }

    /**
     * Whether the edit changed the graph: then the revision moves on (the
     * consists re-walk their routes) and the graph goes to every player in
     * the dimension. Only a done edit does — re-laid bed is blocks, which
     * reach the players as blocks do.
     */
    public boolean changesGraph() {
        return this == DONE;
    }
}
