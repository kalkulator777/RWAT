package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Client→server: a driver dragged a cab lever (SPEC §9) — put {@code handle}
 * ({@code Consist.Handle} ordinal) of the consist to {@code value} (a notch,
 * or −1..1 for the reverser). Sent when the dragged lever crosses a notch, not
 * every frame. The server checks the sender rides the wagon and that it is the
 * consist's controlling cab.
 */
public record CabLeverPayload(int wagonId, int handle, int value) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<CabLeverPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "cab_lever"));

    public static final StreamCodec<FriendlyByteBuf, CabLeverPayload> STREAM_CODEC =
            StreamCodec.of(CabLeverPayload::write, CabLeverPayload::read);

    private static void write(FriendlyByteBuf buf, CabLeverPayload payload) {
        buf.writeVarInt(payload.wagonId);
        buf.writeVarInt(payload.handle);
        buf.writeVarInt(payload.value + 1); // the reverser goes down to −1
    }

    private static CabLeverPayload read(FriendlyByteBuf buf) {
        return new CabLeverPayload(buf.readVarInt(), buf.readVarInt(), buf.readVarInt() - 1);
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
