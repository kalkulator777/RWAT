package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Client→server request to open or close a wagon door (SPEC v1.5, doors): the
 * client picked the door leaf under the crosshair on right-click and names the
 * wagon (network entity id) and the door's index in the type's door list. The
 * server re-checks reach before toggling — the client only says which door.
 */
public record DoorTogglePayload(int wagonId, int door) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<DoorTogglePayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "door_toggle"));

    public static final StreamCodec<FriendlyByteBuf, DoorTogglePayload> STREAM_CODEC =
            StreamCodec.of(DoorTogglePayload::write, DoorTogglePayload::read);

    private static void write(FriendlyByteBuf buf, DoorTogglePayload payload) {
        buf.writeVarInt(payload.wagonId);
        buf.writeVarInt(payload.door);
    }

    private static DoorTogglePayload read(FriendlyByteBuf buf) {
        return new DoorTogglePayload(buf.readVarInt(), buf.readVarInt());
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
