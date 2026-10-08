package com.muzhik17.trainsmod.network;

import org.joml.Vector3d;

/**
 * One walking rider's local feet within their wagon (SPEC v1.5-б): the rider's
 * network entity id (identical across sides) and the position in the wagon's
 * model frame. The wire DTO of {@link RiderSyncPayload}, kept a plain record
 * with no Minecraft dependencies so the apply/cleanup core ({@code ClientRiderSync})
 * stays unit-testable.
 */
public record RiderLocal(int entityId, double x, double y, double z) {

    public Vector3d local() {
        return new Vector3d(x, y, z);
    }
}
