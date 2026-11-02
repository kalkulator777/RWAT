package com.muzhik17.trainsmod.rail;

/**
 * What a click with the rails came to, as far as the rails' cooldown goes
 * (SPEC §2.2). A build or a repaint lays out the bed of a whole structure,
 * up to thousands of blocks, and asks the world about every cell of it —
 * whether it then changes the world or is refused. Held down, the use key
 * repeats every 4 ticks; so the edits that got that far put the rails on a
 * cooldown ({@link #cooldownTicks}, vanilla's item cooldown: the server
 * doesn't call the item meanwhile, the client greys the slot), and the
 * cheap outcomes don't. Pure: no Minecraft classes.
 */
public enum RailEdit {

    /**
     * Nothing to edit, found before any bed was laid out: no track under a
     * repaint, no marker or no second one in range, markers too close.
     */
    NOTHING,
    /** A repaint of a structure that already looks so: nothing laid out, changed or sent. */
    UNCHANGED,
    /** Built, or repainted. */
    DONE,
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
            case DONE, REFUSED -> COOLDOWN_TICKS;
            case NOTHING, UNCHANGED -> 0;
        };
    }
}
