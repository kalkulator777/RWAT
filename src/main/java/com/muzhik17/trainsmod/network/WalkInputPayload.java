package com.muzhik17.trainsmod.network;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Client→server walk input for a wagon-bound rider (SPEC v1.5-б): the player's
 * look-relative move ({@code forward}/{@code strafe}, vanilla impulse signs)
 * and the look's yaw <b>relative to the car</b> as the client drew it
 * ({@code relativeYaw}: the player's yaw less the car's), whether they are
 * crouched ({@code sneak}: a creep that keeps to the floor), plus an
 * {@code exit} edge (right-click) requesting
 * dismount. Sent every client tick while riding a boardable interior so the
 * server has a continuous signal; the server validates the sender actually
 * rides a boardable wagon and is authoritative over the resulting local
 * position (it clamps against the interior walls).
 *
 * <p>{@code seq} numbers the client's walk inputs: the server says with each
 * rider sync which one its feet are after ({@code RiderSyncPayload}), and
 * the client puts its prediction right against them there ({@code
 * ClientWalkLog}) — whatever the round trip.
 *
 * <p>{@code wagonId} is the wagon the client walks — its prediction's frame.
 * The server drops input meant for another wagon than the one the player
 * rides there: right after a gangway carried them on (SPEC §9.5) the client
 * still walks the last car until the passenger change reaches it, and those
 * steps, read in the next car's frame, would put the server ahead of the
 * client's prediction for good.
 *
 * <p>The yaw is the car's-frame one so that the server steps exactly the
 * client's step: with the world yaw, each side turned it into the car's frame
 * by its own yaw of the car — the client's drawn a few ticks behind the
 * server's, so on a curve every step went a little elsewhere on each side
 * and the feet drifted apart for good: the server had the rider out of reach
 * of the door they clicked, away from the doorway they walked out of
 * (play-test 2026-10-14).
 */
public record WalkInputPayload(int wagonId, int seq, float forward, float strafe, float relativeYaw,
        boolean sneak, boolean exit) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<WalkInputPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "walk_input"));

    public static final StreamCodec<FriendlyByteBuf, WalkInputPayload> STREAM_CODEC =
            StreamCodec.of(WalkInputPayload::write, WalkInputPayload::read);

    private static void write(FriendlyByteBuf buf, WalkInputPayload payload) {
        buf.writeVarInt(payload.wagonId);
        buf.writeVarInt(payload.seq);
        buf.writeFloat(payload.forward);
        buf.writeFloat(payload.strafe);
        buf.writeFloat(payload.relativeYaw);
        buf.writeBoolean(payload.sneak);
        buf.writeBoolean(payload.exit);
    }

    private static WalkInputPayload read(FriendlyByteBuf buf) {
        return new WalkInputPayload(buf.readVarInt(), buf.readVarInt(), buf.readFloat(), buf.readFloat(),
                buf.readFloat(), buf.readBoolean(), buf.readBoolean());
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
