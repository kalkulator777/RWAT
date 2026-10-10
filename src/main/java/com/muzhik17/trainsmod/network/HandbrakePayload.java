package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Client→server request to set or release a wagon's handbrake (SPEC §5.3,
 * the crowbar on the wagon's body): the client picked the wagon under the
 * crosshair (network entity id). The server re-checks the crowbar in hand and
 * the reach before turning the wheel.
 */
public record HandbrakePayload(int wagonId) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<HandbrakePayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "handbrake"));

    public static final StreamCodec<FriendlyByteBuf, HandbrakePayload> STREAM_CODEC =
            StreamCodec.of(HandbrakePayload::write, HandbrakePayload::read);

    private static void write(FriendlyByteBuf buf, HandbrakePayload payload) {
        buf.writeVarInt(payload.wagonId);
    }

    private static HandbrakePayload read(FriendlyByteBuf buf) {
        return new HandbrakePayload(buf.readVarInt());
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
