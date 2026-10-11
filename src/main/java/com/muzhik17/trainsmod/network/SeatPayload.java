package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Client→server: a walking rider sits down in one of the cab's driver's
 * chairs (right-click on it; {@code seat} = its index in {@code cab.seats})
 * or the seated driver stands up (sneak; {@code seat} unused) — SPEC §9.
 * The wagon checks the rider is aboard, near the chair and that it is free.
 */
public record SeatPayload(int wagonId, boolean sit, int seat) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<SeatPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "seat"));

    public static final StreamCodec<FriendlyByteBuf, SeatPayload> STREAM_CODEC =
            StreamCodec.of(SeatPayload::write, SeatPayload::read);

    private static void write(FriendlyByteBuf buf, SeatPayload payload) {
        buf.writeVarInt(payload.wagonId);
        buf.writeBoolean(payload.sit);
        buf.writeVarInt(payload.seat + 1); // -1 (standing up) → 0
    }

    private static SeatPayload read(FriendlyByteBuf buf) {
        return new SeatPayload(buf.readVarInt(), buf.readBoolean(), buf.readVarInt() - 1);
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
