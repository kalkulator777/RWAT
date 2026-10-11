package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Client→server: set a control group (SPEC §8–§9) — a cab switch flipped with
 * the mouse ({@link Scope#SWITCH}, {@link Scope#GLOBAL_SWITCH}: on wagon
 * {@code targetId}), or a light group switched from the driver's menu
 * ({@link Scope#PANEL}: on every wagon of consist {@code targetId}). The
 * server checks the sender may operate it: aboard (or within reach of) that
 * wagon / driving that train.
 */
public record ControlGroupPayload(int targetId, Scope scope, String group, float value)
        implements CustomPacketPayload {

    /** Where the group is set, and so who may set it. */
    public enum Scope {
        /** A switch on wagon {@code targetId}: that wagon's group. */
        SWITCH,
        /** A {@code GLOBAL} switch on wagon {@code targetId}: the group on its whole train, as IR does. */
        GLOBAL_SWITCH,
        /** The driver's menu of consist {@code targetId}: the group on its whole train, by its driver only. */
        PANEL
    }

    /** Longest group name accepted (the model's {@code CG_<name>} token). */
    public static final int MAX_NAME = 32;

    public static final CustomPacketPayload.Type<ControlGroupPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "control_group"));

    public static final StreamCodec<FriendlyByteBuf, ControlGroupPayload> STREAM_CODEC =
            StreamCodec.of(ControlGroupPayload::write, ControlGroupPayload::read);

    private static void write(FriendlyByteBuf buf, ControlGroupPayload payload) {
        buf.writeVarInt(payload.targetId);
        buf.writeEnum(payload.scope);
        buf.writeUtf(payload.group, MAX_NAME);
        buf.writeFloat(payload.value);
    }

    private static ControlGroupPayload read(FriendlyByteBuf buf) {
        return new ControlGroupPayload(buf.readVarInt(), buf.readEnum(Scope.class), buf.readUtf(MAX_NAME),
                buf.readFloat());
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
