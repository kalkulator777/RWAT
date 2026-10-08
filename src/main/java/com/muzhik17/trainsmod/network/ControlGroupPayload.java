package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Client→server: set a control group (SPEC §8–§9) — a cab switch flipped with
 * the mouse ({@code wholeTrain = false}: on wagon {@code targetId}), or a light
 * group switched from the driver's menu ({@code wholeTrain = true}: on every
 * wagon of consist {@code targetId}). The server checks the sender may
 * operate it: aboard (or within reach of) that wagon / driving that train.
 */
public record ControlGroupPayload(int targetId, boolean wholeTrain, String group, float value)
        implements CustomPacketPayload {

    /** Longest group name accepted (the model's {@code CG_<name>} token). */
    public static final int MAX_NAME = 32;

    public static final CustomPacketPayload.Type<ControlGroupPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "control_group"));

    public static final StreamCodec<FriendlyByteBuf, ControlGroupPayload> STREAM_CODEC =
            StreamCodec.of(ControlGroupPayload::write, ControlGroupPayload::read);

    private static void write(FriendlyByteBuf buf, ControlGroupPayload payload) {
        buf.writeVarInt(payload.targetId);
        buf.writeBoolean(payload.wholeTrain);
        buf.writeUtf(payload.group, MAX_NAME);
        buf.writeFloat(payload.value);
    }

    private static ControlGroupPayload read(FriendlyByteBuf buf) {
        return new ControlGroupPayload(buf.readVarInt(), buf.readBoolean(), buf.readUtf(MAX_NAME),
                buf.readFloat());
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
