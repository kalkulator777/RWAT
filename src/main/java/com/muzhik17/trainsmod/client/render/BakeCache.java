package com.muzhik17.trainsmod.client.render;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.BiPredicate;
import java.util.function.Consumer;
import java.util.function.Function;

/**
 * The bakes the wagon renderer draws from (SPEC §2.4), by key, in least
 * recently used order — the policy of {@link WagonRenderer}'s cache without
 * Minecraft, so that it can be tested. A bake is a whole model in GPU
 * buffers (~70k vertices, ~2.5 MB upload), so the policy is about never
 * baking the same thing twice in a row:
 *
 * <ul>
 *   <li><b>A frame's working set is never evicted.</b> Inserting never
 *       frees anything; between frames ({@link #nextFrame}) the least
 *       recently used entries the ending frame did not draw are freed down to
 *       the capacity. A frame that draws more combinations than the
 *       capacity keeps them all — the former LRU freed one on every insert,
 *       and past the capacity every lookup of a frame was a miss: all
 *       wagons re-baked every frame.</li>
 *   <li><b>Every bake is within the frame's budget</b>, a combination never
 *       seen before too. Over budget, the most recently used bake that may
 *       stand in for the wanted one ({@code standsIn}) is drawn instead
 *       (the same model and livery at another light: a light step a few
 *       frames late instead of a hitch); with none, nothing is drawn this
 *       frame (null) — the car shows up a frame or two later.</li>
 *   <li><b>A stand-in counts as used</b>: it moves up in the LRU order and is
 *       kept through the frame like anything else it draws.</li>
 * </ul>
 *
 * <p>Render thread only. Values are released ({@code release}) when evicted
 * or {@linkplain #clear cleared}.
 */
public final class BakeCache<K, V> {

    /** Running totals since the cache was made (none reset by {@link #clear}), and the size now. */
    public record Stats(long hits, long bakes, long standIns, long deferred, long evictions, int size) {

        /** The totals since {@code earlier}; the size is this one's. */
        public Stats since(Stats earlier) {
            return new Stats(hits - earlier.hits, bakes - earlier.bakes, standIns - earlier.standIns,
                    deferred - earlier.deferred, evictions - earlier.evictions, size);
        }
    }

    private static final class Entry<V> {
        final V value;
        /** The last frame that drew it. */
        long frame;

        Entry(V value, long frame) {
            this.value = value;
            this.frame = frame;
        }
    }

    private final int capacity;
    private final int bakesPerFrame;
    private final BiPredicate<K, K> standsIn;
    private final Consumer<V> release;
    /** Access order: eldest first. */
    private final LinkedHashMap<K, Entry<V>> entries = new LinkedHashMap<>(32, 0.75F, true);
    private long frame;
    private int bakesThisFrame;
    private long hits;
    private long bakes;
    private long standIns;
    private long deferred;
    private long evictions;

    /**
     * @param capacity      entries kept between frames (more while a frame draws more)
     * @param bakesPerFrame new bakes a frame may make
     * @param standsIn      whether a bake under the first key may be drawn for the second
     * @param release       frees an evicted value
     */
    public BakeCache(int capacity, int bakesPerFrame, BiPredicate<K, K> standsIn, Consumer<V> release) {
        if (capacity < 0 || bakesPerFrame < 1) {
            throw new IllegalArgumentException("capacity " + capacity + ", bakes per frame " + bakesPerFrame);
        }
        this.capacity = capacity;
        this.bakesPerFrame = bakesPerFrame;
        this.standsIn = standsIn;
        this.release = release;
    }

    /**
     * The bake under {@code key}: the cached one, a new one ({@code bake},
     * within the frame's budget), the most recently used bake standing in
     * for it, or null — nothing to draw this frame.
     */
    public V get(K key, Function<K, V> bake) {
        Entry<V> entry = entries.get(key); // moves it up the LRU order
        if (entry != null) {
            entry.frame = frame;
            hits++;
            return entry.value;
        }
        if (bakesThisFrame < bakesPerFrame) {
            bakesThisFrame++;
            bakes++;
            V value = bake.apply(key);
            entries.put(key, new Entry<>(value, frame));
            return value;
        }
        K standIn = null;
        for (K other : entries.keySet()) { // iterating doesn't reorder
            if (standsIn.test(other, key)) {
                standIn = other; // eldest first: the last match is the most recently used
            }
        }
        if (standIn == null) {
            deferred++;
            return null;
        }
        Entry<V> used = entries.get(standIn);
        used.frame = frame;
        standIns++;
        return used.value;
    }

    /**
     * The frame ended: free the least recently used entries it did not draw
     * while more than the capacity are kept, and open the next frame's
     * budget.
     */
    public void nextFrame() {
        var it = entries.entrySet().iterator();
        while (entries.size() > capacity && it.hasNext()) {
            Map.Entry<K, Entry<V>> eldest = it.next();
            if (eldest.getValue().frame == frame) {
                break; // from here on everything was drawn this frame
            }
            it.remove();
            release.accept(eldest.getValue().value);
            evictions++;
        }
        frame++;
        bakesThisFrame = 0;
    }

    /** Free every entry (logout, resource reload). */
    public void clear() {
        entries.values().forEach(entry -> release.accept(entry.value));
        entries.clear();
    }

    public int size() {
        return entries.size();
    }

    public Stats stats() {
        return new Stats(hits, bakes, standIns, deferred, evictions, entries.size());
    }
}
