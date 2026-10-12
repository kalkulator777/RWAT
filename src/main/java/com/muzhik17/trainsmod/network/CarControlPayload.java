package com.muzhik17.trainsmod.network;

import java.util.ArrayList;
import java.util.List;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Client→server, from the "Train" page of the driver's panel (SPEC §9.7):
 * open or close the passengers' doors on one side, or switch the lights
 * inside, of one car ({@code wagonId}, its entity id) or of every car of the
 * train ({@code wagonId} −1, doors only). Left and right are the driver's —
 * the server reads them from the cab they drive from. The lights are the
 * car's own groups ({@code groups}: its model's cabin-lamp groups, which only
 * the client knows). The server checks the sender drives this train, at the
 * controls.
 */
public record CarControlPayload(int consistId, int wagonId, Target target, boolean on, List<String> groups)
        implements CustomPacketPayload {

    /** What is switched. */
    public enum Target {
        /** The passengers' doors on the driver's left. */
        DOORS_LEFT,
        /** … on the driver's right. */
        DOORS_RIGHT,
        /** The lights inside the car: {@code groups}. */
        LIGHTS
    }

    /** Most light groups one car's lights are made of, as sent. */
    public static final int MAX_GROUPS = 16;

    public static final CustomPacketPayload.Type<CarControlPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "car_control"));

    public static final StreamCodec<FriendlyByteBuf, CarControlPayload> STREAM_CODEC =
            StreamCodec.of(CarControlPayload::write, CarControlPayload::read);

    public CarControlPayload {
        groups = List.copyOf(groups);
    }

    private static void write(FriendlyByteBuf buf, CarControlPayload payload) {
        buf.writeVarInt(payload.consistId);
        buf.writeVarInt(payload.wagonId + 1); // -1 (every car) → 0
        buf.writeEnum(payload.target);
        buf.writeBoolean(payload.on);
        int count = Math.min(payload.groups.size(), MAX_GROUPS);
        buf.writeVarInt(count);
        for (int i = 0; i < count; i++) {
            buf.writeUtf(payload.groups.get(i), ControlGroupPayload.MAX_NAME);
        }
    }

    private static CarControlPayload read(FriendlyByteBuf buf) {
        int consistId = buf.readVarInt();
        int wagonId = buf.readVarInt() - 1;
        Target target = buf.readEnum(Target.class);
        boolean on = buf.readBoolean();
        int count = Math.min(buf.readVarInt(), MAX_GROUPS);
        List<String> groups = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            groups.add(buf.readUtf(ControlGroupPayload.MAX_NAME));
        }
        return new CarControlPayload(consistId, wagonId, target, on, groups);
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
