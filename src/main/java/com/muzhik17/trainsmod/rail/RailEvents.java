package com.muzhik17.trainsmod.rail;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.network.RailGraphSyncPayload;

import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.tick.LevelTickEvent;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Sends the full rail graph to players on login, dimension change and
 * respawn (edits are synced by {@link RailNetwork} itself), and polls the
 * switch stands for redstone every server tick (SPEC §2.2 v1).
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID)
public final class RailEvents {

    private RailEvents() {
    }

    @SubscribeEvent
    static void onLevelTickPost(LevelTickEvent.Post event) {
        if (event.getLevel() instanceof ServerLevel level) {
            RailNetwork.get(level).tickSwitches(level);
        }
    }

    @SubscribeEvent
    static void onPlayerLoggedIn(PlayerEvent.PlayerLoggedInEvent event) {
        sendGraph(event.getEntity() instanceof ServerPlayer player ? player : null);
    }

    @SubscribeEvent
    static void onPlayerChangedDimension(PlayerEvent.PlayerChangedDimensionEvent event) {
        sendGraph(event.getEntity() instanceof ServerPlayer player ? player : null);
    }

    /**
     * Respawning may land in another dimension without a dimension-change
     * event — dying in the Nether with the bed in the overworld, leaving the
     * End through its exit portal ({@code PlayerList.respawn}). Respawning
     * in the same dimension just sends the same graph again.
     */
    @SubscribeEvent
    static void onPlayerRespawn(PlayerEvent.PlayerRespawnEvent event) {
        sendGraph(event.getEntity() instanceof ServerPlayer player ? player : null);
    }

    private static void sendGraph(ServerPlayer player) {
        if (player != null && player.level() instanceof ServerLevel level) {
            PacketDistributor.sendToPlayer(player, RailGraphSyncPayload.of(RailNetwork.get(level)));
        }
    }
}
