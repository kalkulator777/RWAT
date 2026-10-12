package com.muzhik17.trainsmod.client;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.joml.Vector3d;

/**
 * Client-side predicted local feet positions of wagon-bound riders (SPEC
 * v1.5-б), keyed by passenger entity id. The client predicts the local player's
 * walk each tick ({@link ClientWalkInput}) and stores it here; the common
 * {@code WagonEntity.positionRider} reads it to place the passenger at
 * {@code bodyPose × local}, so the rider stays glued to the moving interior
 * without waiting on a server round-trip. In singleplayer the prediction equals
 * the server's authoritative step (same pure {@code RiderWalk} math), so there
 * is nothing to reconcile.
 *
 * <p>Feet are kept <b>with the wagon whose frame they are in</b>
 * ({@link #on}): a gangway carries a rider into the next car (SPEC §9.5),
 * and for the tick between the passenger change and the next prediction the
 * old car's feet, read in the new car's frame, put the rider a car length
 * away — the camera flew down the car and back (the gangway "jolt").
 *
 * <p>Deliberately free of client-only MC classes (like {@link ClientConsists})
 * so the common entity code can reference it without breaking a dedicated
 * server.
 */
public final class ClientWalk {

    /** Local feet and the entity id of the wagon whose frame they are in (−1: not known). */
    private record Feet(int wagonId, Vector3d local) {
    }

    private static final Map<Integer, Feet> LOCAL = new ConcurrentHashMap<>();

    /**
     * The local player's own passenger id while they walk a wagon, or -1. Their
     * entry is owned by {@link ClientWalkInput}'s prediction; the server's
     * {@code RiderSyncPayload} (which lists everyone, including them) must not
     * clobber it with a round-trip-stale value, or the view flip-flops between
     * predicted and stale each tick. {@link #putRemote}/{@link #removeRemote}
     * skip this id; only {@link #put} touches it.
     */
    private static volatile int localOwnedId = -1;

    /**
     * A server-given start spot on a wagon the local player is about to ride
     * (a gangway, SPEC §9.5): that wagon's entity id and the local feet, or
     * -1/null. Kept until {@link ClientWalkInput} sees the player aboard.
     */
    private static volatile int placedWagon = -1;
    private static volatile Vector3d placedLocal;

    private ClientWalk() {
    }

    /** Predicted local feet of the passenger entity (on whichever wagon), or null if not walking. */
    public static Vector3d get(int passengerId) {
        Feet feet = LOCAL.get(passengerId);
        return feet == null ? null : feet.local();
    }

    /**
     * The passenger's local feet on wagon {@code wagonId}, or null if the
     * feet known are another wagon's (or none): where to place them on it.
     * For the local player, a start spot the server gave on that wagon
     * ({@link #place}) wins — it is where a gangway put them, while their
     * last prediction is still the car they left.
     */
    public static Vector3d on(int passengerId, int wagonId) {
        Vector3d placed = placedLocal;
        if (passengerId == localOwnedId && placedWagon == wagonId && placed != null) {
            return placed;
        }
        Feet feet = LOCAL.get(passengerId);
        return feet != null && (feet.wagonId() == wagonId || feet.wagonId() < 0) ? feet.local() : null;
    }

    /** The passenger's predicted feet, in the frame of wagon {@code wagonId}. */
    public static void put(int passengerId, int wagonId, Vector3d local) {
        LOCAL.put(passengerId, new Feet(wagonId, new Vector3d(local)));
    }

    /** The passenger's feet, the wagon not known (−1: taken to be the one they ride). */
    public static void put(int passengerId, Vector3d local) {
        put(passengerId, -1, local);
    }

    public static void remove(int passengerId) {
        LOCAL.remove(passengerId);
    }

    /** Mark the locally-predicted player so the server sync won't overwrite them. */
    public static void setLocalOwner(int passengerId) {
        localOwnedId = passengerId;
    }

    /** Release the local-owner mark (player left the wagon). */
    public static void clearLocalOwner() {
        localOwnedId = -1;
    }

    /**
     * Store a remote rider's synced local feet on wagon {@code wagonId},
     * skipping the locally-predicted player. Returns true if it was stored
     * (i.e. a genuine remote rider).
     */
    public static boolean putRemote(int passengerId, int wagonId, Vector3d local) {
        if (passengerId == localOwnedId) {
            return false;
        }
        put(passengerId, wagonId, local);
        return true;
    }

    /** Drop a remote rider's synced local feet (never the local player's prediction). */
    public static void removeRemote(int passengerId) {
        if (passengerId != localOwnedId) {
            LOCAL.remove(passengerId);
        }
    }

    /** The server's start spot for the local player on wagon {@code wagonId} ({@code RiderPlacePayload}). */
    public static void place(int wagonId, Vector3d local) {
        placedLocal = new Vector3d(local);
        placedWagon = wagonId;
    }

    /**
     * Take the start spot given for wagon {@code wagonId}, or null if none.
     * A spot for another wagon is kept: the passenger change that carries
     * the player there may come a tick after the spot.
     */
    public static Vector3d takePlacement(int wagonId) {
        if (placedWagon != wagonId) {
            return null;
        }
        Vector3d local = placedLocal;
        placedWagon = -1;
        placedLocal = null;
        return local;
    }

    /** Drop everything (logout / level change). */
    public static void clearAll() {
        LOCAL.clear();
        localOwnedId = -1;
        placedWagon = -1;
        placedLocal = null;
    }
}
