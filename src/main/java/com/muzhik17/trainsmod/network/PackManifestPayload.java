package com.muzhik17.trainsmod.network;

import java.util.ArrayList;
import java.util.List;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.pack.PackManifest;

import io.netty.handler.codec.DecoderException;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * Server→client: the server's RWAT packs with their content hashes, sent to
 * a joining player (roadmap R15; {@code pack.PackSyncEvents}). The client
 * compares them with its own packs and warns the player of a difference
 * ({@code client.ClientPackCheck}).
 *
 * <p>Bounded both ways: the server cuts the strings and the list to the
 * limits of {@link PackManifest} before writing, the client refuses more
 * than those when reading (a longer string fails {@code readUtf}) and drops
 * an entry whose hash isn't one.
 */
public record PackManifestPayload(List<PackManifest.Entry> packs) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<PackManifestPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "pack_manifest"));

    public static final StreamCodec<FriendlyByteBuf, PackManifestPayload> STREAM_CODEC =
            StreamCodec.of(PackManifestPayload::write, PackManifestPayload::read);

    public PackManifestPayload {
        packs = List.copyOf(packs.size() > PackManifest.MAX_PACKS
                ? packs.subList(0, PackManifest.MAX_PACKS) : packs);
    }

    private static void write(FriendlyByteBuf buf, PackManifestPayload payload) {
        buf.writeVarInt(payload.packs.size());
        for (PackManifest.Entry pack : payload.packs) {
            PackManifest.Entry clipped = pack.clipped();
            buf.writeUtf(clipped.id(), PackManifest.MAX_ID_LENGTH);
            buf.writeUtf(clipped.name(), PackManifest.MAX_NAME_LENGTH);
            buf.writeUtf(clipped.version(), PackManifest.MAX_VERSION_LENGTH);
            buf.writeUtf(clipped.hash(), PackManifest.HASH_LENGTH);
        }
    }

    private static PackManifestPayload read(FriendlyByteBuf buf) {
        int count = buf.readVarInt();
        if (count < 0 || count > PackManifest.MAX_PACKS) {
            throw new DecoderException("RWAT pack list of " + count + " packs, at most "
                    + PackManifest.MAX_PACKS + " expected");
        }
        List<PackManifest.Entry> packs = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            String id = buf.readUtf(PackManifest.MAX_ID_LENGTH);
            String name = buf.readUtf(PackManifest.MAX_NAME_LENGTH);
            String version = buf.readUtf(PackManifest.MAX_VERSION_LENGTH);
            String hash = buf.readUtf(PackManifest.HASH_LENGTH);
            if (PackManifest.validHash(hash)) {
                packs.add(new PackManifest.Entry(id, name, version, hash));
            }
        }
        return new PackManifestPayload(packs);
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
