package com.muzhik17.trainsmod.client.render;

import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.IntPredicate;

/**
 * The switch blades' throw (SPEC §2.2 v1): which switches' blades move, how
 * far each blade is open, and which switches the {@link RailRenderer} must
 * sweep anew in a frame. A switch whose selection changes remembers the
 * selection it had and the time of the change; its blades then ease from the
 * one setting to the other over {@link #DURATION_MS} (smoothstep) — all of a
 * throat's blades together, like blades on one tie bar. Only the moving
 * switches are swept again, and only while their blades are in a region
 * being drawn; every other switch keeps its tiles. Pure (no MC imports).
 */
final class BladeAnimator {

    /** Blade throw duration, ms. */
    static final long DURATION_MS = 500;

    /** Switch selection counters as currently displayed (the animations' reference). */
    private final Map<Integer, Integer> shown = new HashMap<>();
    /** Selection counters from before the latest change, per moving switch. */
    private final Map<Integer, Integer> previous = new HashMap<>();
    /** When each moving switch's throw started (ms). */
    private final Map<Integer, Long> start = new HashMap<>();

    /**
     * Take the switch selections of a newly arrived graph ({@code
     * selections}: node → counter, nodes missing count as 0). A switch whose
     * counter changed starts moving at {@code now} — except on the first
     * sync after login, which just adopts the state: no throw for switches
     * that were already set. Returns the switches that started moving.
     */
    Set<Integer> adopt(Map<Integer, Integer> selections, long now, boolean firstSync) {
        Map<Integer, Integer> current = new HashMap<>(selections);
        for (Integer node : shown.keySet()) {
            current.putIfAbsent(node, 0);
        }
        Set<Integer> thrown = new LinkedHashSet<>();
        for (Map.Entry<Integer, Integer> entry : current.entrySet()) {
            int was = shown.getOrDefault(entry.getKey(), 0);
            if (entry.getValue() != was && !firstSync) {
                previous.put(entry.getKey(), was);
                start.put(entry.getKey(), now);
                thrown.add(entry.getKey());
            }
        }
        shown.clear();
        current.values().removeIf(selection -> selection == 0);
        shown.putAll(current);
        return thrown;
    }

    /**
     * The switches whose blades must be swept anew this frame: each moving
     * one that is {@code drawn} (its blades lie in a region being drawn —
     * a throw out of sight needs no frames), and each whose throw has ended
     * since the last call, drawn or not, once more at rest; after that it
     * is still and needs nothing until its next throw.
     */
    Set<Integer> due(long now, IntPredicate drawn) {
        Set<Integer> due = new LinkedHashSet<>();
        for (Iterator<Map.Entry<Integer, Long>> it = start.entrySet().iterator(); it.hasNext(); ) {
            Map.Entry<Integer, Long> entry = it.next();
            int node = entry.getKey();
            if (now - entry.getValue() >= DURATION_MS) {
                it.remove();
                previous.remove(node);
                due.add(node);
            } else if (drawn.test(node)) {
                due.add(node);
            }
        }
        return due;
    }

    /** Whether the switch at {@code nodeId} is being thrown. */
    boolean moving(int nodeId) {
        return start.containsKey(nodeId);
    }

    /**
     * How far the blade of leg {@code legId} is open at {@code now}: 0
     * pressed against its stock rail (the route runs over its leg), 1 thrown
     * off it. {@code groupIds} are the legs of its throat (sorted), the
     * switch at {@code nodeId} set to {@code selection} — the leg it selects
     * is {@code groupIds[selection mod n]}.
     */
    double open(int nodeId, int legId, List<Integer> groupIds, int selection, long now) {
        Long started = start.get(nodeId);
        double progress = started == null ? 1.0 : Math.clamp((now - started) / (double) DURATION_MS, 0.0, 1.0);
        int was = previous.getOrDefault(nodeId, selection);
        double target = legId == groupIds.get(Math.floorMod(selection, groupIds.size())) ? 0.0 : 1.0;
        double from = legId == groupIds.get(Math.floorMod(was, groupIds.size())) ? 0.0 : 1.0;
        double eased = progress * progress * (3.0 - 2.0 * progress);
        return from + (target - from) * eased;
    }

    /** Forget every switch (a new level, a new connection). */
    void clear() {
        shown.clear();
        previous.clear();
        start.clear();
    }
}
