package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Client→server walk input for a wagon-bound rider (SPEC v1.5-б): the player's
 * look-relative move ({@code forward}/{@code strafe}, vanilla impulse signs)
 * and look {@code yaw}, plus an {@code exit} edge (right-click) requesting
 * dismount. Sent every client tick while riding a boardable interior so the
 * server has a continuous signal; the server validates the sender actually
 * rides a boardable wagon and is authoritative over the resulting local
 * position (it clamps against the interior walls).
 */
public record WalkInputPayload(float forward, float strafe, float yaw, boolean exit)
        implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<WalkInputPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "walk_input"));

    public static final StreamCodec<FriendlyByteBuf, WalkInputPayload> STREAM_CODEC =
            StreamCodec.of(WalkInputPayload::write, WalkInputPayload::read);

    private static void write(FriendlyByteBuf buf, WalkInputPayload payload) {
        buf.writeFloat(payload.forward);
        buf.writeFloat(payload.strafe);
        buf.writeFloat(payload.yaw);
        buf.writeBoolean(payload.exit);
    }

    private static WalkInputPayload read(FriendlyByteBuf buf) {
        return new WalkInputPayload(buf.readFloat(), buf.readFloat(), buf.readFloat(),
                buf.readBoolean());
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
