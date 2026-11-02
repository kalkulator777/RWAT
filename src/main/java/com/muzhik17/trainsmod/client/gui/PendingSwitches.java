package com.muzhik17.trainsmod.client.gui;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Predicate;

/**
 * Switches clicked on the driver's panel (SPEC §9.7) that the wagons'
 * synced state hasn't caught up with yet: meanwhile the lamp shows the way
 * the click switched it. A switch is forgotten once the synced state agrees,
 * or after {@link #TIMEOUT_TICKS} — the server refused the click (not the
 * train's driver) or somebody switched it back — so a lamp never sticks to a
 * click that didn't take.
 */
final class PendingSwitches {

    /** How long a click may wait for the synced state, ticks: a slow round trip, not a refusal. */
    static final int TIMEOUT_TICKS = 40;

    private record Wish(boolean on, int since) {
    }

    private final Map<String, Wish> wishes = new HashMap<>();

    /** {@code key} switched on (or off) at tick {@code now}. */
    void put(String key, boolean on, int now) {
        wishes.put(key, new Wish(on, now));
    }

    /** The way {@code key} was switched while the synced state hasn't caught up, or null. */
    Boolean get(String key) {
        Wish wish = wishes.get(key);
        return wish == null ? null : wish.on();
    }

    /**
     * At tick {@code now}: forget the switches the synced state ({@code on})
     * agrees with, and the ones that waited too long.
     */
    void settle(Predicate<String> on, int now) {
        wishes.entrySet().removeIf(entry -> entry.getValue().on() == on.test(entry.getKey())
                || now - entry.getValue().since() >= TIMEOUT_TICKS);
    }

    /** Forget the switches of keys no longer shown (a coupling or a cut changed the groups). */
    void retain(Collection<String> keys) {
        wishes.keySet().retainAll(keys);
    }
}
