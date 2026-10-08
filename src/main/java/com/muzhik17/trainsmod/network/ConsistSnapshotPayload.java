package com.muzhik17.trainsmod.network;

import java.util.ArrayList;
import java.util.List;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.Handles;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonTypes;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Server→client consist state snapshot, sent every tick (SPEC §2.1, 0.2):
 * head {@code s}, speed {@code v}, server {@code gameTime} (snapshots are not
 * interpolatable without a timestamp), the {@link TrackPathSpec} and the typed
 * {@link ConsistComposition} (type ids, flipped flags and liveries — the client resolves
 * them against its own stock registry). Spec and composition ride along every
 * tick like the path spec always has; thinning both to send-once is a later
 * optimisation, together with snapshot rate thinning.
 *
 * <p>Coupling (SPEC §6.12) adds the <b>frame</b> — a counter bumped
 * whenever the meaning of {@code s} changes (merge, re-anchoring), with the
 * shift that carries old {@code s} values into it, or, on a consist's first
 * snapshot after a split, the parent consist whose buffer it continues
 * ({@code frameFrom} ≠ own id) — and the wagons' network entity ids in index
 * order ({@code -1} = not loaded), so the client switches wagon membership in
 * the same packet as the composition.
 *
 * <p>Cab levers (SPEC §9) add the driver's {@link Handles} and which cab
 * drives, so every client moves the same levers in step with the train.
 */
public record ConsistSnapshotPayload(int consistId, double s, double v, long gameTime,
        TrackPathSpec pathSpec, ConsistComposition composition,
        int frame, int frameFrom, double frameShift, int[] wagonEntityIds, Handles handles)
        implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<ConsistSnapshotPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "consist_snapshot"));

    public static final StreamCodec<FriendlyByteBuf, ConsistSnapshotPayload> STREAM_CODEC =
            StreamCodec.of(ConsistSnapshotPayload::write, ConsistSnapshotPayload::read);

    public static ConsistSnapshotPayload of(Consist consist, long gameTime, int[] wagonEntityIds) {
        return new ConsistSnapshotPayload(consist.id(), consist.s(), consist.speed(), gameTime,
                consist.pathSpec(), consist.composition(),
                consist.frame(), consist.frameFrom(), consist.frameShift(), wagonEntityIds,
                new Handles(consist.handle(Consist.Handle.REVERSER),
                        consist.handle(Consist.Handle.THROTTLE),
                        consist.handle(Consist.Handle.TRAIN_BRAKE),
                        consist.handle(Consist.Handle.INDEPENDENT_BRAKE),
                        activeCabIndex(consist)));
    }

    /**
     * Index of the cab whose levers show the handles: the one that drives or
     * last drove; before any cab has, the first cab of the consist (a parked
     * train's handles are still somewhere). −1 if the consist has no cab.
     */
    private static int activeCabIndex(Consist consist) {
        int active = consist.wagonIds().indexOf(consist.activeCab());
        if (active >= 0) {
            return active;
        }
        ConsistComposition composition = consist.composition();
        for (int i = 0; i < composition.wagonCount(); i++) {
            if (composition.slot(i).type().drivable()) {
                return i;
            }
        }
        return -1;
    }

    private static void write(FriendlyByteBuf buf, ConsistSnapshotPayload payload) {
        buf.writeVarInt(payload.consistId);
        buf.writeDouble(payload.s);
        buf.writeDouble(payload.v);
        buf.writeVarLong(payload.gameTime);
        TrackPathSpec.write(buf, payload.pathSpec);
        buf.writeVarInt(payload.composition.wagonCount());
        for (ConsistComposition.Slot slot : payload.composition.slots()) {
            buf.writeUtf(slot.type().id());
            buf.writeBoolean(slot.flipped());
            buf.writeUtf(slot.livery());
        }
        buf.writeVarInt(payload.frame);
        buf.writeVarInt(payload.frameFrom);
        buf.writeDouble(payload.frameShift);
        buf.writeVarInt(payload.wagonEntityIds.length);
        for (int entityId : payload.wagonEntityIds) {
            buf.writeVarInt(entityId + 1); // -1 (not loaded) → 0
        }
        buf.writeVarInt(payload.handles.pack());
        buf.writeVarInt(payload.handles.activeCab() + 1); // -1 (none) → 0
    }

    private static ConsistSnapshotPayload read(FriendlyByteBuf buf) {
        int consistId = buf.readVarInt();
        double s = buf.readDouble();
        double v = buf.readDouble();
        long gameTime = buf.readVarLong();
        TrackPathSpec spec = TrackPathSpec.read(buf);
        int count = buf.readVarInt();
        List<ConsistComposition.Slot> slots = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            String typeId = buf.readUtf();
            boolean flipped = buf.readBoolean();
            String livery = buf.readUtf();
            // unknown id (types not synced yet / registry mismatch) → placeholder
            // with the same id, so the consist still unrolls and renders (SPEC §6.5)
            slots.add(new ConsistComposition.Slot(WagonTypes.resolve(typeId), flipped, livery));
        }
        int frame = buf.readVarInt();
        int frameFrom = buf.readVarInt();
        double frameShift = buf.readDouble();
        int[] wagonEntityIds = new int[buf.readVarInt()];
        for (int i = 0; i < wagonEntityIds.length; i++) {
            wagonEntityIds[i] = buf.readVarInt() - 1;
        }
        int packedHandles = buf.readVarInt();
        Handles handles = Handles.unpack(packedHandles, buf.readVarInt() - 1);
        return new ConsistSnapshotPayload(consistId, s, v, gameTime, spec,
                new ConsistComposition(slots), frame, frameFrom, frameShift, wagonEntityIds,
                handles);
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
