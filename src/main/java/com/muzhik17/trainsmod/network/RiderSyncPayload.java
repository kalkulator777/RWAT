package com.muzhik17.trainsmod.network;

import java.util.ArrayList;
import java.util.List;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Server→client local feet of a consist's walking riders (SPEC v1.5-б). The
 * boarding player predicts their own local position ({@code ClientWalkInput}),
 * but <i>other</i> observers have nothing to place a remote rider with — their
 * {@code WagonEntity.positionRider} would fall back to the cab seat. This carries
 * each walking rider's authoritative local feet (keyed by the rider's network
 * entity id, identical across sides) so observers anchor them at their real
 * interior spot.
 *
 * <p>Sent only while a consist actually carries a walking rider (plus one empty
 * packet the tick the last one leaves, so clients clear their cache), so the
 * common rider-less train costs nothing. The position is in the wagon's
 * <b>local</b> frame, so the client pairs it with its own interpolated body pose
 * and vanilla's entity lerp smooths the result — no separate interpolation
 * buffer is needed (unlike {@code s}).
 */
public record RiderSyncPayload(int consistId, List<RiderLocal> riders) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<RiderSyncPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "rider_sync"));

    public static final StreamCodec<FriendlyByteBuf, RiderSyncPayload> STREAM_CODEC =
            StreamCodec.of(RiderSyncPayload::write, RiderSyncPayload::read);

    private static void write(FriendlyByteBuf buf, RiderSyncPayload payload) {
        buf.writeVarInt(payload.consistId);
        buf.writeVarInt(payload.riders.size());
        for (RiderLocal rider : payload.riders) {
            buf.writeVarInt(rider.entityId());
            buf.writeDouble(rider.x());
            buf.writeDouble(rider.y());
            buf.writeDouble(rider.z());
        }
    }

    private static RiderSyncPayload read(FriendlyByteBuf buf) {
        int consistId = buf.readVarInt();
        int count = buf.readVarInt();
        List<RiderLocal> riders = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            riders.add(new RiderLocal(buf.readVarInt(), buf.readDouble(), buf.readDouble(),
                    buf.readDouble()));
        }
        return new RiderSyncPayload(consistId, riders);
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
