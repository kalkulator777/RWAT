package com.muzhik17.trainsmod.client;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.network.PackManifestPayload;
import com.muzhik17.trainsmod.pack.PackManifest;
import com.muzhik17.trainsmod.pack.PackReport;
import com.muzhik17.trainsmod.pack.RwatPacks;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.packs.PackType;

/**
 * The client's half of the pack check (roadmap R15, {@link PackManifest}):
 * the server's RWAT packs, as it sent them on join, against the packs this
 * client loaded as resource packs. A difference — a server pack missing here,
 * or here with other files — is one line in chat and the details in the log,
 * and a warning each in the client's pack report ({@code /rwatc packs},
 * {@link PackReport.Source#PACK_SYNC}, forgotten when the connection ends);
 * the game goes on (wagons without their model are boxes, SPEC §6.5).
 *
 * <p>Skipped on an integrated server's own client (singleplayer, LAN host):
 * the server reads this client's files. The server doesn't send it there
 * either; this is the second guard.
 */
public final class ClientPackCheck {

    /** Packs named in the chat line; the rest are counted. */
    private static final int NAMED_IN_CHAT = 3;

    private ClientPackCheck() {
    }

    public static void handle(PackManifestPayload payload) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.isLocalServer()) {
            return;
        }
        ClientPacketListener connection = minecraft.getConnection();
        List<PackManifest.Entry> server = payload.packs();
        RwatPacks.manifest(PackType.CLIENT_RESOURCES).whenCompleteAsync((local, error) -> {
            if (connection == null || minecraft.getConnection() != connection) {
                return; // left the server while the packs were hashed
            }
            if (error != null) {
                RailsWheelsAndTrains.LOGGER.error("RWAT pack check: couldn't hash this client's packs", error);
                return;
            }
            report(minecraft, server, local);
        }, minecraft);
    }

    private static void report(Minecraft minecraft, List<PackManifest.Entry> server,
            List<PackManifest.Entry> local) {
        List<PackManifest.Mismatch> mismatches = PackManifest.compare(server, local);
        PackReport.CLIENT.replace(PackReport.Source.PACK_SYNC, Map.of(), PackReport.packMismatches(mismatches));
        if (mismatches.isEmpty()) {
            RailsWheelsAndTrains.LOGGER.info("RWAT pack check: all {} server pack(s) are here as on the server",
                    server.size());
            return;
        }
        RailsWheelsAndTrains.LOGGER.warn("RWAT pack check: {} of the server's {} pack(s) differ from this client's; "
                + "wagons may lack models, rails their style, trains their sounds", mismatches.size(), server.size());
        for (PackManifest.Mismatch mismatch : mismatches) {
            RailsWheelsAndTrains.LOGGER.warn("RWAT pack check: {}", mismatch.describe());
        }
        RailsWheelsAndTrains.LOGGER.warn("RWAT pack check: the server has {}; this client has {}",
                list(server), local.isEmpty() ? "none" : list(local));
        minecraft.gui.getChat().addMessage(chatLine(mismatches));
    }

    /** "RWAT packs differ from the server's: A (not installed), B 1.2 (different files) and 2 more." */
    private static Component chatLine(List<PackManifest.Mismatch> mismatches) {
        MutableComponent packs = Component.empty();
        int named = Math.min(mismatches.size(), NAMED_IN_CHAT);
        for (int i = 0; i < named; i++) {
            PackManifest.Mismatch mismatch = mismatches.get(i);
            if (i > 0) {
                packs.append(", ");
            }
            packs.append(Component.translatable(mismatch.kind() == PackManifest.Kind.MISSING
                    ? "rwat.packsync.missing" : "rwat.packsync.different", mismatch.server().label()));
        }
        if (mismatches.size() > named) {
            packs.append(" ").append(Component.translatable("rwat.packsync.more", mismatches.size() - named));
        }
        return Component.translatable("rwat.packsync.mismatch", packs).withStyle(ChatFormatting.YELLOW);
    }

    private static String list(List<PackManifest.Entry> packs) {
        return packs.stream()
                .map(pack -> "'" + pack.label() + "' (" + pack.id() + ", " + pack.hash() + ")")
                .collect(Collectors.joining(", "));
    }
}
