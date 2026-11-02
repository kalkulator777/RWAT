package com.muzhik17.trainsmod.rail;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.function.IntPredicate;

/**
 * The switch stands' redstone, polled every server tick (SPEC §2.2 v1): a
 * rising edge of the signal at a stand throws the switch of its node. The
 * world is read through {@link Signals}, so this imports no Minecraft class
 * and is tested as the core is.
 *
 * <p>A stand whose chunk is not loaded is not read at all: reading a block
 * of an unloaded chunk loads it, and a read every tick would keep it loaded
 * for good (and the whole network's stands with it). Its last power is
 * forgotten then; when the chunk is back, the stand takes the signal it
 * finds without a throw — as every stand does after a restart, since the
 * last power is not saved. A redstone line in an unloaded chunk doesn't
 * change, so nothing a player did is lost.
 *
 * @param <P> a stand's position
 */
public final class SwitchStandPoll<P> {

    /** How the poll reads the world. */
    public interface Signals<P> {

        /** Whether every block the stand's signal is read from is loaded — reading it then loads nothing. */
        boolean loaded(P stand);

        /** Whether a redstone signal reaches the stand (read only when {@link #loaded}). */
        boolean powered(P stand);
    }

    /** The last power read per stand, for the rising edge; absent = not read since the stand was loaded. */
    private final Map<P, Boolean> lastPowered = new HashMap<>();

    /**
     * One tick's poll of {@code stands} (stand → the node it throws): every
     * loaded stand is read, and one whose signal rose since the last read
     * throws its node. A stand whose node is no more in the graph
     * ({@code nodeExists} false — the junction was demolished) is taken out
     * of {@code stands} on the way.
     *
     * @return the stands whose signal rose, in the order of {@code stands}
     */
    public List<P> poll(Map<P, Integer> stands, IntPredicate nodeExists, Signals<P> signals) {
        List<P> risen = new ArrayList<>();
        for (Iterator<Map.Entry<P, Integer>> it = stands.entrySet().iterator(); it.hasNext(); ) {
            Map.Entry<P, Integer> stand = it.next();
            P pos = stand.getKey();
            if (!nodeExists.test(stand.getValue())) {
                it.remove();
                lastPowered.remove(pos);
                continue;
            }
            if (!signals.loaded(pos)) {
                lastPowered.remove(pos);
                continue;
            }
            boolean powered = signals.powered(pos);
            Boolean was = lastPowered.put(pos, powered);
            if (was != null && !was && powered) {
                risen.add(pos);
            }
        }
        return risen;
    }
}
