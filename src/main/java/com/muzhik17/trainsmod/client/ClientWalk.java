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
 * <p>Deliberately free of client-only MC classes (like {@link ClientConsists})
 * so the common entity code can reference it without breaking a dedicated
 * server.
 */
public final class ClientWalk {

    private static final Map<Integer, Vector3d> LOCAL = new ConcurrentHashMap<>();

    /**
     * The local player's own passenger id while they walk a wagon, or -1. Their
     * entry is owned by {@link ClientWalkInput}'s prediction; the server's
     * {@code RiderSyncPayload} (which lists everyone, including them) must not
     * clobber it with a round-trip-stale value, or the view flip-flops between
     * predicted and stale each tick. {@link #putRemote}/{@link #removeRemote}
     * skip this id; only {@link #put} touches it.
     */
    private static volatile int localOwnedId = -1;

    private ClientWalk() {
    }

    /** Predicted local feet of the passenger entity, or null if not walking. */
    public static Vector3d get(int passengerId) {
        return LOCAL.get(passengerId);
    }

    public static void put(int passengerId, Vector3d local) {
        LOCAL.put(passengerId, new Vector3d(local));
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
     * Store a remote rider's synced local feet, skipping the locally-predicted
     * player. Returns true if it was stored (i.e. a genuine remote rider).
     */
    public static boolean putRemote(int passengerId, Vector3d local) {
        if (passengerId == localOwnedId) {
            return false;
        }
        LOCAL.put(passengerId, new Vector3d(local));
        return true;
    }

    /** Drop a remote rider's synced local feet (never the local player's prediction). */
    public static void removeRemote(int passengerId) {
        if (passengerId != localOwnedId) {
            LOCAL.remove(passengerId);
        }
    }

    /** Drop everything (logout / level change). */
    public static void clearAll() {
        LOCAL.clear();
        localOwnedId = -1;
    }
}
