package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Client→server request to uncouple at a coupler (SPEC §6.12, the
 * crowbar): the client picked the coupler under the crosshair and names a
 * wagon (network entity id) and which of its ends — {@code front} = the
 * coupler towards wagon {@code index − 1}, else towards {@code index + 1}.
 * Naming the wagon, not a consist index, stays valid if the consist was
 * renumbered by a coupling in flight. The server re-checks the player holds
 * the crowbar and is within reach of that coupler before cutting.
 */
public record UncouplePayload(int wagonId, boolean front) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<UncouplePayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "uncouple"));

    public static final StreamCodec<FriendlyByteBuf, UncouplePayload> STREAM_CODEC =
            StreamCodec.of(UncouplePayload::write, UncouplePayload::read);

    private static void write(FriendlyByteBuf buf, UncouplePayload payload) {
        buf.writeVarInt(payload.wagonId);
        buf.writeBoolean(payload.front);
    }

    private static UncouplePayload read(FriendlyByteBuf buf) {
        return new UncouplePayload(buf.readVarInt(), buf.readBoolean());
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
