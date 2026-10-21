package com.muzhik17.trainsmod.network;

import org.joml.Vector3d;

/**
 * One walking rider's local feet within their wagon (SPEC v1.5-б): the rider's
 * network entity id (identical across sides), the wagon's network entity id —
 * whose frame the feet are in (a rider's car may change under them: a
 * gangway, SPEC §9.5) — and the position in that wagon's model frame. The wire DTO of {@link RiderSyncPayload}, kept a plain record
 * with no Minecraft dependencies so the apply/cleanup core ({@code ClientRiderSync})
 * stays unit-testable.
 *
 * @param ack the number of the rider's last walk input the server took in on
 *            this wagon ({@code WalkInputPayload}) — the feet are after it —
 *            or {@link #NO_ACK}: the rider's own client compares its
 *            prediction after that input with them ({@code ClientWalkLog})
 */
public record RiderLocal(int entityId, int wagonId, double x, double y, double z, int ack) {

    /** No walk input of the rider taken in on this wagon yet. */
    public static final int NO_ACK = -1;

    /** Feet with no walk input acknowledged. */
    public RiderLocal(int entityId, int wagonId, double x, double y, double z) {
        this(entityId, wagonId, x, y, z, NO_ACK);
    }

    public Vector3d local() {
        return new Vector3d(x, y, z);
    }
}
