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
 * <p>A stand is read only where its redstone is live ({@link Signals#live}):
 * where something else — a player nearby, a forced chunk — keeps its chunk
 * ticking. Reading a block holds its chunk loaded a tick longer (an unloaded
 * one it loads first), so a read every tick wherever the stand may be kept
 * the chunks of every stand of the dimension loaded for good. A stand not
 * read forgets its last power; once live again it takes the signal it finds
 * without a throw — as every stand does after a restart, since the last
 * power is not saved. Redstone where blocks don't tick doesn't change, so
 * no throw a player made is lost.
 *
 * @param <P> a stand's position
 */
public final class SwitchStandPoll<P> {

    /** How the poll reads the world. */
    public interface Signals<P> {

        /**
         * Whether the stand's redstone is live: its chunk ticks, and every
         * block its signal is read from is loaded — reading it then neither
         * loads a chunk nor keeps one that nothing else keeps.
         */
        boolean live(P stand);

        /** Whether a redstone signal reaches the stand (read only when {@link #live}). */
        boolean powered(P stand);
    }

    /** The last power read per stand, for the rising edge; absent = not read since it went live. */
    private final Map<P, Boolean> lastPowered = new HashMap<>();

    /**
     * One tick's poll of {@code stands} (stand → the node it throws): every
     * live stand is read, and one whose signal rose since the last read
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
            if (!signals.live(pos)) {
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
