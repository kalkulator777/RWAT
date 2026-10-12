package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Client→server: the player struck a bogie of wagon {@code wagonId} — the one
 * ahead along the path ({@code front}, the pose's front bogie) or behind
 * (SPEC §6.11: a wagon is broken by its bogies, like a minecart by its body).
 * The wagon entity's own pick box is a small cube at the body centre, so the
 * client aims at the bogie itself ({@code ClientBogieHit}); the server checks
 * the blow can be there and takes it as an attack on the wagon.
 */
public record WagonStrikePayload(int wagonId, boolean front) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<WagonStrikePayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "wagon_strike"));

    public static final StreamCodec<FriendlyByteBuf, WagonStrikePayload> STREAM_CODEC =
            StreamCodec.of(WagonStrikePayload::write, WagonStrikePayload::read);

    private static void write(FriendlyByteBuf buf, WagonStrikePayload payload) {
        buf.writeVarInt(payload.wagonId);
        buf.writeBoolean(payload.front);
    }

    private static WagonStrikePayload read(FriendlyByteBuf buf) {
        return new WagonStrikePayload(buf.readVarInt(), buf.readBoolean());
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
