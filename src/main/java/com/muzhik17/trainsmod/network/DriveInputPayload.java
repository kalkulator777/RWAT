package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Client→server driver handle input (SPEC §5.3): held key directions for the
 * throttle handle (W/S → +1/−1 by default), the train-brake handle (D apply /
 * A release) and the independent brake (no keys by default), plus a
 * reverser-toggle edge (Space; the server only throws it at a standstill) —
 * the driving keys of the Controls screen (SPEC §9.7). Sent every client tick
 * at the controls — including all-zero, so the server has a continuous
 * signal; the server validates the sender is that consist's driver (its
 * front-most manned cab). The held signal keys ride along as bits (SPEC §10:
 * {@code Consist.HORN}, {@code Consist.BELL}).
 */
public record DriveInputPayload(int consistId, int throttleDir, int brakeDir, int indBrakeDir,
        boolean reverserToggle, int signals) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<DriveInputPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "drive_input"));

    public static final StreamCodec<FriendlyByteBuf, DriveInputPayload> STREAM_CODEC =
            StreamCodec.of(DriveInputPayload::write, DriveInputPayload::read);

    private static void write(FriendlyByteBuf buf, DriveInputPayload payload) {
        buf.writeVarInt(payload.consistId);
        buf.writeByte(payload.throttleDir);
        buf.writeByte(payload.brakeDir);
        buf.writeByte(payload.indBrakeDir);
        buf.writeBoolean(payload.reverserToggle);
        buf.writeByte(payload.signals);
    }

    private static DriveInputPayload read(FriendlyByteBuf buf) {
        return new DriveInputPayload(buf.readVarInt(), buf.readByte(), buf.readByte(), buf.readByte(),
                buf.readBoolean(), buf.readUnsignedByte());
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
