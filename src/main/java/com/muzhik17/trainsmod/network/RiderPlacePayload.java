package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Server→client, to one player: "you now walk wagon {@code wagonId} at this
 * local spot" — sent when a gangway carries them into the next car (SPEC
 * §9.5). The player's own walk is predicted ({@code ClientWalkInput}) and the
 * prediction of a newly ridden wagon starts from the world position, but the
 * vanilla dismount from the car they left moved that; this gives the start
 * spot instead. It arrives before the passenger change itself (the entity
 * tracker sends that at the end of the server tick), so the client keeps it
 * until it rides that wagon ({@code ClientWalk.place}).
 */
public record RiderPlacePayload(int wagonId, double x, double y, double z) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<RiderPlacePayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "rider_place"));

    public static final StreamCodec<FriendlyByteBuf, RiderPlacePayload> STREAM_CODEC =
            StreamCodec.of(RiderPlacePayload::write, RiderPlacePayload::read);

    private static void write(FriendlyByteBuf buf, RiderPlacePayload payload) {
        buf.writeVarInt(payload.wagonId);
        buf.writeDouble(payload.x);
        buf.writeDouble(payload.y);
        buf.writeDouble(payload.z);
    }

    private static RiderPlacePayload read(FriendlyByteBuf buf) {
        return new RiderPlacePayload(buf.readVarInt(), buf.readDouble(), buf.readDouble(), buf.readDouble());
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
