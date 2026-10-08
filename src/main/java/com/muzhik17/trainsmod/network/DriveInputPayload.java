package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Client→server driver handle input (SPEC §5.3): held key directions for the
 * throttle handle (W/S → +1/−1) and the train-brake handle (D apply / A
 * release), plus a reverser-toggle edge (jump key press; the server only
 * throws it at a standstill). Sent every client tick while riding the cab —
 * including all-zero, so the server has a continuous signal; the server
 * validates the sender is that consist's driver (its front-most manned cab).
 */
public record DriveInputPayload(int consistId, int throttleDir, int brakeDir,
        boolean reverserToggle) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<DriveInputPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "drive_input"));

    public static final StreamCodec<FriendlyByteBuf, DriveInputPayload> STREAM_CODEC =
            StreamCodec.of(DriveInputPayload::write, DriveInputPayload::read);

    private static void write(FriendlyByteBuf buf, DriveInputPayload payload) {
        buf.writeVarInt(payload.consistId);
        buf.writeByte(payload.throttleDir);
        buf.writeByte(payload.brakeDir);
        buf.writeBoolean(payload.reverserToggle);
    }

    private static DriveInputPayload read(FriendlyByteBuf buf) {
        return new DriveInputPayload(buf.readVarInt(), buf.readByte(), buf.readByte(),
                buf.readBoolean());
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
