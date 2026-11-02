package com.muzhik17.trainsmod.pack;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.network.PackManifestPayload;

import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.packs.PackType;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * The server's half of the pack check (roadmap R15, {@link PackManifest}):
 * a joining player is told the server's RWAT packs with their hashes, and the
 * client compares them with its own ({@code client.ClientPackCheck}). Nothing
 * comes back: a player with other packs is warned on their side, not kicked.
 *
 * <p>Not sent to the owner of an integrated server — singleplayer, or the
 * host of a LAN game: the client reads the very files the server does. LAN
 * guests have their own files and get it.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID)
public final class PackSyncEvents {

    private PackSyncEvents() {
    }

    /** A dedicated server hashes its packs as it starts, so the first player to join isn't the one to wait. */
    @SubscribeEvent
    static void onServerStarted(ServerStartedEvent event) {
        if (event.getServer().isDedicatedServer()) {
            RwatPacks.manifest(PackType.SERVER_DATA);
        }
    }

    @SubscribeEvent
    static void onPlayerLoggedIn(PlayerEvent.PlayerLoggedInEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer player)
                || player.server.isSingleplayerOwner(player.getGameProfile())) {
            return;
        }
        MinecraftServer server = player.server;
        RwatPacks.manifest(PackType.SERVER_DATA).thenAcceptAsync(packs -> {
            if (!packs.isEmpty() && !player.hasDisconnected()) {
                PacketDistributor.sendToPlayer(player, new PackManifestPayload(packs));
            }
        }, server).exceptionally(error -> {
            RailsWheelsAndTrains.LOGGER.error("Couldn't send the RWAT pack list to {}",
                    player.getGameProfile().getName(), error);
            return null;
        });
    }
}
