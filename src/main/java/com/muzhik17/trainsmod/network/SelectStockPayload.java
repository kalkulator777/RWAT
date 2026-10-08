package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.InteractionHand;

/**
 * Client→server: the wagon type and livery picked in the rolling stock
 * item's screen (SPEC §6.11), stored on the stack in {@code hand}. The server
 * accepts only types its packs declare; the livery is client data and passes
 * through unchecked ({@code ""} = base textures).
 */
public record SelectStockPayload(InteractionHand hand, String typeId, String livery)
        implements CustomPacketPayload {

    /** Longest accepted id (a resource location — far below this in practice). */
    public static final int MAX_LENGTH = 256;

    public static final CustomPacketPayload.Type<SelectStockPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "select_stock"));

    public static final StreamCodec<FriendlyByteBuf, SelectStockPayload> STREAM_CODEC =
            StreamCodec.of(SelectStockPayload::write, SelectStockPayload::read);

    private static void write(FriendlyByteBuf buf, SelectStockPayload payload) {
        buf.writeEnum(payload.hand);
        buf.writeUtf(payload.typeId, MAX_LENGTH);
        buf.writeUtf(payload.livery, MAX_LENGTH);
    }

    private static SelectStockPayload read(FriendlyByteBuf buf) {
        return new SelectStockPayload(buf.readEnum(InteractionHand.class),
                buf.readUtf(MAX_LENGTH), buf.readUtf(MAX_LENGTH));
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
