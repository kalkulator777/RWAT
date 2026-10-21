package com.muzhik17.trainsmod.consist;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.GameType;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.EntityMountEvent;
import net.neoforged.neoforge.event.entity.EntityTeleportEvent;
import net.neoforged.neoforge.event.entity.EntityTravelToDimensionEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.tick.LevelTickEvent;

/**
 * Game-bus glue for consists: drives {@link ConsistManager#tick} from the
 * server level tick, and guards walking riders against stepping off a moving
 * wagon (SPEC v1.5-б).
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID)
public final class ConsistEvents {

    private ConsistEvents() {
    }

    /**
     * Consists run with the world: not while {@code /tick freeze} holds it
     * (the event still fires), a tick per tick of {@code /tick step}.
     */
    @SubscribeEvent
    static void onLevelTickPost(LevelTickEvent.Post event) {
        if (event.getLevel() instanceof ServerLevel level && level.tickRateManager().runsNormally()) {
            ConsistManager.get(level).tick(level);
        }
    }

    /**
     * Block a walking rider's vanilla sneak-dismount (SPEC v1.5-б: they can't
     * just step off a moving car — only right-click out, or later through an
     * open door). Sanctioned exits set {@link WagonEntity#dismountAllowed()};
     * a removed wagon or a removed/dead rider always dismounts so nobody is
     * trapped. The seated cab driver isn't a walking rider, so they sneak out
     * as before. (Shift no longer even asks on a walkable car — it crouches,
     * {@code PlayerWagonSneakMixin}; this stays the guard for every other way
     * a dismount is tried.) A player logging out gets off too: the car stays
     * in its train ({@link WagonEntity#hasExactlyOnePlayerPassenger}), and
     * the logout takes them off it ({@code PlayerList.remove} → {@code
     * unRide}) once they are marked disconnected, but before they are removed
     * — refused, the car would keep a player gone from the world aboard.
     * What carries a rider elsewhere — a teleport, another dimension,
     * spectating, another vehicle — lets them off first by a sanctioned exit
     * ({@link #letOff}); Shift at an open door stays as it is.
     */
    @SubscribeEvent
    static void onMount(EntityMountEvent event) {
        if (!event.isDismounting()
                || !(event.getEntityBeingMounted() instanceof WagonEntity wagon)
                || !(event.getEntityMounting() instanceof Player player)) {
            return;
        }
        boolean leavingTheGame = player instanceof ServerPlayer serverPlayer && serverPlayer.hasDisconnected();
        if (wagon.isWalkingRider(player) && !wagon.dismountAllowed() && !leavingTheGame
                && !wagon.isRemoved() && !player.isRemoved()) {
            event.setCanceled(true);
        }
    }

    /**
     * Mounting something else ({@code /ride}, another mod's seat) lets a
     * rider off the wagon first: vanilla's {@code startRiding} tries to get
     * them off the old vehicle, the guard refuses, and it seats them on the
     * new one anyway — the wagon kept a ghost passenger. Lowest priority: a
     * mount another listener refuses leaves them aboard.
     */
    @SubscribeEvent(priority = EventPriority.LOWEST)
    static void onMountOther(EntityMountEvent event) {
        if (event.isMounting() && event.getEntityMounting().getVehicle() instanceof WagonEntity wagon
                && event.getEntityBeingMounted() != wagon) {
            letOff(event.getEntityMounting());
        }
    }

    /**
     * A teleport someone announces lets a rider off first ({@code /tp},
     * {@code /spreadplayers}, a mod's): before the teleport, so one another
     * listener cancels leaves them aboard. The unannounced ones are caught
     * where vanilla dismounts for them ({@code ServerPlayerTeleportMixin}).
     * Not a pearl thrown aboard — no way out but the doors, the player stays
     * (SPEC v1.5-б, checked in game 2026-10-13) — nor, alike, a chorus fruit
     * eaten aboard.
     */
    @SubscribeEvent(priority = EventPriority.LOWEST)
    static void onTeleport(EntityTeleportEvent event) {
        if (!(event instanceof EntityTeleportEvent.EnderPearl)
                && !(event instanceof EntityTeleportEvent.ChorusFruit)) {
            letOff(event.getEntity());
        }
    }

    /**
     * Into another dimension a rider goes off the wagon first, never its
     * passenger from another level (vanilla's own way there doesn't always
     * get them off, and where it tries, the guard refuses). Travel within the
     * level — a pearl's landing comes this way — is no change.
     */
    @SubscribeEvent(priority = EventPriority.LOWEST)
    static void onTravelToDimension(EntityTravelToDimensionEvent event) {
        if (event.getDimension() != event.getEntity().level().dimension()) {
            letOff(event.getEntity());
        }
    }

    /** Spectating, a rider is off the wagon, where they stood (vanilla's dismount there the guard refuses). */
    @SubscribeEvent(priority = EventPriority.LOWEST)
    static void onGameModeChange(PlayerEvent.PlayerChangeGameModeEvent event) {
        if (event.getNewGameMode() == GameType.SPECTATOR) {
            letOff(event.getEntity());
        }
    }

    /**
     * Let a player off the wagon they ride where they stand (server), by a
     * sanctioned exit ({@link WagonEntity#releaseRider}): something is about
     * to carry them elsewhere. Anything else is left alone.
     */
    public static void letOff(Entity entity) {
        if (entity instanceof ServerPlayer player && player.getVehicle() instanceof WagonEntity wagon) {
            wagon.releaseRider(player);
        }
    }
}
