package com.muzhik17.trainsmod.client;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.muzhik17.trainsmod.network.RiderLocal;

/**
 * Applies a consist's synced rider feet ({@code RiderSyncPayload} → this) to
 * {@link ClientWalk} so remote observers place a consist's walking riders at
 * their interior spot (SPEC v1.5-б). The local player is skipped by
 * {@link ClientWalk#putRemote} (their position is predicted), so this only ever
 * drives <i>other</i> players.
 *
 * <p>Per consist we remember the rider ids applied last packet; when one drops
 * out of the new packet (they dismounted, or the train sent its final empty
 * packet) their stale local feet are cleared. No interpolation buffer: the local
 * feet are in the wagon frame and vanilla's entity lerp smooths the rendered
 * world position.
 *
 * <p>A rider belongs to the consist that listed them last: when their wagon
 * changes consists (coupling, uncoupling — SPEC §6.12) the new consist's
 * packet claims them, and the old consist forgets them without clearing their
 * feet. The server sends every non-empty rider list of a tick before the
 * "last rider left" clears, so the claim always lands first.
 *
 * <p>Decoupled from the wire packet ({@link #apply} takes the plain
 * {@link RiderLocal} list, the network handler unwraps it) and free of any
 * Minecraft class, so the apply/cleanup core stays unit-testable and safe to
 * reference from common code.
 */
public final class ClientRiderSync {

    /** Remote rider ids applied last packet, per consist — to drop ones that left. */
    private static final Map<Integer, Set<Integer>> BY_CONSIST = new ConcurrentHashMap<>();
    /** Remote rider id → the consist that listed them last. */
    private static final Map<Integer, Integer> OWNER = new ConcurrentHashMap<>();

    private ClientRiderSync() {
    }

    public static void apply(int consistId, List<RiderLocal> riders) {
        Set<Integer> now = new HashSet<>();
        for (RiderLocal rider : riders) {
            if (ClientWalk.putRemote(rider.entityId(), rider.local())) {
                now.add(rider.entityId());
                Integer before = OWNER.put(rider.entityId(), consistId);
                if (before != null && before != consistId) {
                    release(before, rider.entityId()); // their wagon changed consists
                }
            }
        }
        Set<Integer> prev = now.isEmpty()
                ? BY_CONSIST.remove(consistId)
                : BY_CONSIST.put(consistId, now);
        if (prev != null) {
            for (Integer id : prev) {
                if (!now.contains(id)) {
                    ClientWalk.removeRemote(id);
                    OWNER.remove(id, consistId);
                }
            }
        }
    }

    /** Forget a rider another consist has claimed — without touching their feet. */
    private static void release(int consistId, int riderId) {
        Set<Integer> ids = BY_CONSIST.get(consistId);
        if (ids != null) {
            ids.remove(riderId);
            if (ids.isEmpty()) {
                BY_CONSIST.remove(consistId);
            }
        }
    }

    /** Consists currently holding remote riders (test hook: a coupled-away consist must not linger). */
    static Set<Integer> trackedConsists() {
        return Set.copyOf(BY_CONSIST.keySet());
    }

    /** Drop everything (logout / level change). */
    public static void clearAll() {
        BY_CONSIST.clear();
        OWNER.clear();
    }
}
