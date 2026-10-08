package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.InteractionHand;

/**
 * Client→server: the rail style picked in the rails item's screen (SPEC
 * §6.10), stored on the rails stack in {@code hand}. {@code ""} = the mod's
 * own rail. The server checks the hand really holds rails; it doesn't check
 * the style exists — styles are client resources, like liveries.
 */
public record SelectRailStylePayload(InteractionHand hand, String style) implements CustomPacketPayload {

    /** Longest accepted style id (a resource location — far below this in practice). */
    public static final int MAX_LENGTH = 256;

    public static final CustomPacketPayload.Type<SelectRailStylePayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "select_rail_style"));

    public static final StreamCodec<FriendlyByteBuf, SelectRailStylePayload> STREAM_CODEC =
            StreamCodec.of(SelectRailStylePayload::write, SelectRailStylePayload::read);

    private static void write(FriendlyByteBuf buf, SelectRailStylePayload payload) {
        buf.writeEnum(payload.hand);
        buf.writeUtf(payload.style, MAX_LENGTH);
    }

    private static SelectRailStylePayload read(FriendlyByteBuf buf) {
        return new SelectRailStylePayload(buf.readEnum(InteractionHand.class), buf.readUtf(MAX_LENGTH));
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
