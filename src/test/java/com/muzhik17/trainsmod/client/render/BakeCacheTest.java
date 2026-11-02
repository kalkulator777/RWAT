package com.muzhik17.trainsmod.client.render;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * The wagon renderer's bake cache policy (H11): a frame drawing more
 * combinations than the capacity must not re-bake them every frame, every
 * bake is within the frame's budget, a stand-in counts as used.
 */
class BakeCacheTest {

    /** A bake key: model {@code family} (model and livery) at {@code light}. */
    private record Key(String family, int light) {
    }

    private final List<String> baked = new ArrayList<>();
    private final List<String> released = new ArrayList<>();

    private BakeCache<Key, String> cache(int capacity, int bakesPerFrame) {
        return new BakeCache<>(capacity, bakesPerFrame, (have, want) -> have.family().equals(want.family()),
                released::add);
    }

    private String get(BakeCache<Key, String> cache, String family, int light) {
        return cache.get(new Key(family, light), key -> {
            String value = key.family() + "@" + key.light();
            baked.add(value);
            return value;
        });
    }

    /** Thirty wagons of thirty models in view, drawn in the same order every frame, a capacity of 24. */
    @Test
    void aFrameDrawingPastTheCapacityStopsBakingOnceEverythingIsBaked() {
        BakeCache<Key, String> cache = cache(24, 1);
        for (int frame = 0; frame < 40; frame++) {
            for (int car = 0; car < 30; car++) {
                get(cache, "model" + car, 15);
            }
            cache.nextFrame();
        }
        assertEquals(30, baked.size(), "each combination baked once: " + baked.size() + " bakes");
        BakeCache.Stats before = cache.stats();
        for (int frame = 0; frame < 10; frame++) {
            for (int car = 0; car < 30; car++) {
                assertNotNull(get(cache, "model" + car, 15));
            }
            cache.nextFrame();
        }
        BakeCache.Stats steady = cache.stats().since(before);
        assertEquals(0, steady.bakes(), "no bakes once settled");
        assertEquals(300, steady.hits());
        assertEquals(30, cache.size(), "the frame's working set is kept past the capacity");
        assertTrue(released.isEmpty(), "nothing a frame draws is freed: " + released);
    }

    @Test
    void theBudgetHoldsForCombinationsNeverSeenBefore() {
        BakeCache<Key, String> cache = cache(24, 1);
        int drawn = 0;
        for (int car = 0; car < 5; car++) {
            if (get(cache, "model" + car, 15) != null) {
                drawn++;
            }
        }
        assertEquals(1, baked.size(), "one bake a frame, a first sight too");
        assertEquals(1, drawn, "the rest have nothing to draw this frame");
        assertEquals(4, cache.stats().deferred());
        for (int frame = 0; frame < 4; frame++) {
            cache.nextFrame();
            for (int car = 0; car < 5; car++) {
                get(cache, "model" + car, 15);
            }
        }
        assertEquals(5, baked.size(), "a frame each: all baked after five frames");
    }

    @Test
    void overBudgetTheLatestBakeOfTheSameModelStandsIn() {
        BakeCache<Key, String> cache = cache(24, 1);
        get(cache, "chme3", 15);
        cache.nextFrame();
        get(cache, "chme3", 14);
        cache.nextFrame();
        get(cache, "m62", 15); // takes the frame's budget
        assertEquals("chme3@14", get(cache, "chme3", 13), "the most recently drawn light stands in");
        assertNull(get(cache, "tem2", 15), "no bake of that model: nothing");
        assertEquals(1, cache.stats().standIns());
        cache.nextFrame();
        assertEquals("chme3@13", get(cache, "chme3", 13), "baked next frame");
    }

    /** The stand-in moves up the LRU order and lives through the frame that drew it. */
    @Test
    void aStandInCountsAsUsed() {
        BakeCache<Key, String> cache = cache(2, 1);
        get(cache, "a", 15);
        cache.nextFrame();
        get(cache, "b", 15);
        cache.nextFrame();
        get(cache, "c", 15);                     // the frame's bake
        assertEquals("a@15", get(cache, "a", 7)); // stands in, drawn this frame
        cache.nextFrame();                        // three kept, capacity two: the least recently used goes
        assertEquals(List.of("b@15"), released, "b went, not the stand-in drawn after it");
        get(cache, "d", 15);                      // the next frame's bake
        assertEquals("a@15", get(cache, "a", 7), "still standing in a frame on");
    }

    @Test
    void entriesNoFrameDrawsAreFreedPastTheCapacityLeastRecentlyUsedFirst() {
        BakeCache<Key, String> cache = cache(2, 4);
        get(cache, "a", 15);
        get(cache, "b", 15);
        get(cache, "c", 15);
        get(cache, "d", 15);
        cache.nextFrame();
        assertTrue(released.isEmpty(), "all four drawn in the frame that ended");
        get(cache, "c", 15);
        get(cache, "a", 15);
        cache.nextFrame();
        assertEquals(List.of("b@15", "d@15"), released);
        assertEquals(2, cache.size());
        assertEquals(2, cache.stats().evictions());
    }

    @Test
    void clearFreesEverything() {
        BakeCache<Key, String> cache = cache(24, 4);
        get(cache, "a", 15);
        get(cache, "b", 15);
        cache.clear();
        assertEquals(List.of("a@15", "b@15"), released);
        assertEquals(0, cache.size());
        assertEquals("a@15", get(cache, "a", 15), "baked anew");
        assertEquals(3, baked.size());
    }
}
