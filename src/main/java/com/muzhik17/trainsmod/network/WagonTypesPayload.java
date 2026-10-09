package com.muzhik17.trainsmod.network;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Server→client sync of the datapack-loaded wagon type layer (SPEC §5.5 step
 * 5), sent on join and after {@code /reload}. Consist snapshots carry type
 * <i>ids</i> only; the client needs the declarations themselves (length, bogie
 * offsets) to unroll wagon positions from the head {@code s}. Builtins ship in
 * the jar on both sides and are not sent.
 */
public record WagonTypesPayload(Map<String, WagonType> types) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<WagonTypesPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "wagon_types"));

    public static final StreamCodec<FriendlyByteBuf, WagonTypesPayload> STREAM_CODEC =
            StreamCodec.of(WagonTypesPayload::write, WagonTypesPayload::read);

    private static void write(FriendlyByteBuf buf, WagonTypesPayload payload) {
        buf.writeVarInt(payload.types.size());
        for (Map.Entry<String, WagonType> entry : payload.types.entrySet()) {
            buf.writeUtf(entry.getKey());
            writeType(buf, entry.getValue());
        }
    }

    private static WagonTypesPayload read(FriendlyByteBuf buf) {
        int count = buf.readVarInt();
        Map<String, WagonType> types = new HashMap<>(count);
        for (int i = 0; i < count; i++) {
            String id = buf.readUtf();
            types.put(id, readType(buf, id));
        }
        return new WagonTypesPayload(types);
    }

    private static void writeType(FriendlyByteBuf buf, WagonType type) {
        buf.writeDouble(type.length());
        buf.writeVarInt(type.bogieOffsets().length);
        for (double offset : type.bogieOffsets()) {
            buf.writeDouble(offset);
        }
        buf.writeDouble(type.massT());
        buf.writeDouble(type.maxSpeedKmh());
        buf.writeDouble(type.resistance().a());
        buf.writeDouble(type.resistance().b());
        buf.writeDouble(type.resistance().c());
        buf.writeBoolean(type.traction() != null);
        if (type.traction() != null) {
            buf.writeDouble(type.traction().powerKw());
            buf.writeDouble(type.traction().maxTractiveEffortKn());
        }
        buf.writeBoolean(type.cab() != null);
        if (type.cab() != null) {
            WagonType.Seat seat = type.cab().seat();
            buf.writeBoolean(seat != null);
            if (seat != null) {
                buf.writeDouble(seat.x());
                buf.writeDouble(seat.y());
                buf.writeDouble(seat.z());
                buf.writeFloat(seat.yaw());
            }
        }
        buf.writeDouble(type.brakes().trainKn());
        buf.writeDouble(type.brakes().independentKn());
        buf.writeDouble(type.brakes().dynamicKn());
        buf.writeDouble(type.brakes().dynamicFadeKmh());
        buf.writeDouble(type.brakes().parkingKn());
        buf.writeVarInt(type.interior() == null ? 0 : type.interior().zones().size());
        for (WagonType.Interior.Zone in : type.interior() == null
                ? List.<WagonType.Interior.Zone>of() : type.interior().zones()) {
            buf.writeDouble(in.minX());
            buf.writeDouble(in.minY());
            buf.writeDouble(in.minZ());
            buf.writeDouble(in.maxX());
            buf.writeDouble(in.maxY());
            buf.writeDouble(in.maxZ());
        }
        buf.writeVarInt(type.doors().size());
        for (WagonType.Door door : type.doors()) {
            buf.writeUtf(door.id());
            buf.writeDouble(door.minX());
            buf.writeDouble(door.minY());
            buf.writeDouble(door.minZ());
            buf.writeDouble(door.maxX());
            buf.writeDouble(door.maxY());
            buf.writeDouble(door.maxZ());
            buf.writeBoolean(door.inner());
            buf.writeBoolean(door.fixed());
            buf.writeBoolean(door.connecting());
            buf.writeUtf(door.group() != null ? door.group() : "");
        }
    }

    private static String group(String written) {
        return written.isEmpty() ? null : written;
    }

    private static WagonType readType(FriendlyByteBuf buf, String id) {
        double length = buf.readDouble();
        double[] bogies = new double[buf.readVarInt()];
        for (int i = 0; i < bogies.length; i++) {
            bogies[i] = buf.readDouble();
        }
        double massT = buf.readDouble();
        double maxSpeedKmh = buf.readDouble();
        WagonType.Resistance resistance = new WagonType.Resistance(
                buf.readDouble(), buf.readDouble(), buf.readDouble());
        WagonType.Traction traction = buf.readBoolean()
                ? new WagonType.Traction(buf.readDouble(), buf.readDouble())
                : null;
        WagonType.Cab cab = null;
        if (buf.readBoolean()) {
            cab = new WagonType.Cab(buf.readBoolean()
                    ? new WagonType.Seat(buf.readDouble(), buf.readDouble(), buf.readDouble(),
                            buf.readFloat())
                    : null);
        }
        WagonType.Brakes brakes = new WagonType.Brakes(
                buf.readDouble(), buf.readDouble(), buf.readDouble(),
                buf.readDouble(), buf.readDouble());
        int zoneCount = buf.readVarInt();
        List<WagonType.Interior.Zone> zones = new ArrayList<>(zoneCount);
        for (int i = 0; i < zoneCount; i++) {
            zones.add(new WagonType.Interior.Zone(buf.readDouble(), buf.readDouble(),
                    buf.readDouble(), buf.readDouble(), buf.readDouble(), buf.readDouble()));
        }
        WagonType.Interior interior = zones.isEmpty() ? null : new WagonType.Interior(zones);
        int doorCount = buf.readVarInt();
        List<WagonType.Door> doors = new ArrayList<>(doorCount);
        for (int i = 0; i < doorCount; i++) {
            doors.add(new WagonType.Door(buf.readUtf(), buf.readDouble(), buf.readDouble(),
                    buf.readDouble(), buf.readDouble(), buf.readDouble(), buf.readDouble(),
                    buf.readBoolean(), buf.readBoolean(), buf.readBoolean(), group(buf.readUtf())));
        }
        return new WagonType(id, length, bogies, massT, maxSpeedKmh,
                resistance, traction, cab, brakes, interior, doors);
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
