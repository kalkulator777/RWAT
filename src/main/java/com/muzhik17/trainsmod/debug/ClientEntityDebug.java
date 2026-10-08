package com.muzhik17.trainsmod.debug;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.WagonEntity;

import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.EntityJoinLevelEvent;
import net.neoforged.neoforge.event.entity.EntityLeaveLevelEvent;

/**
 * Client-side trace of wagon/player entity add+remove (debug, SPEC §2.4a).
 * The tracking bugs of 2026-06-12 look like pair/unpair flapping — the
 * "missing locomotive after /tp" and the "wagon shuttles back and forth ~10
 * times before vanishing" play-test reports. Vanilla spawns/removes entities
 * silently, so this logs every wagon and player join/leave on the client with
 * id and position: flapping shows up as JOIN/LEAVE pairs, and a wagon spawned
 * at a stale spot shows as a JOIN far from the consist's actual position.
 * Debug-only; remove (or gate) once the tracking work settles.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientEntityDebug {

    private ClientEntityDebug() {
    }

    @SubscribeEvent
    static void onJoin(EntityJoinLevelEvent event) {
        if (event.getLevel().isClientSide()) {
            log("JOIN", event.getEntity());
        }
    }

    @SubscribeEvent
    static void onLeave(EntityLeaveLevelEvent event) {
        if (event.getLevel().isClientSide()) {
            log("LEAVE", event.getEntity());
        }
    }

    private static void log(String what, Entity entity) {
        if (entity instanceof WagonEntity wagon) {
            RailsWheelsAndTrains.LOGGER.info(
                    "[track-debug] client {} wagon id={} consist#{}[{}] at [{} {} {}]",
                    what, wagon.getId(), wagon.getConsistId(), wagon.getWagonIndex(),
                    (int) wagon.getX(), (int) wagon.getY(), (int) wagon.getZ());
        } else if (entity instanceof Player player) {
            RailsWheelsAndTrains.LOGGER.info(
                    "[track-debug] client {} player {} id={} at [{} {} {}]",
                    what, player.getGameProfile().getName(), player.getId(),
                    (int) player.getX(), (int) player.getY(), (int) player.getZ());
        }
    }
}
