package com.muzhik17.trainsmod.consist;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.player.Player;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.EntityMountEvent;
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

    @SubscribeEvent
    static void onLevelTickPost(LevelTickEvent.Post event) {
        if (event.getLevel() instanceof ServerLevel level) {
            ConsistManager.get(level).tick(level);
        }
    }

    /**
     * Block a walking rider's vanilla sneak-dismount (SPEC v1.5-б: they can't
     * just step off a moving car — only right-click out, or later through an
     * open door). Sanctioned exits set {@link WagonEntity#dismountAllowed()};
     * a removed wagon or a removed/dead rider always dismounts so nobody is
     * trapped. The seated cab driver isn't a walking rider, so they sneak out
     * as before.
     */
    @SubscribeEvent
    static void onMount(EntityMountEvent event) {
        if (!event.isDismounting()
                || !(event.getEntityBeingMounted() instanceof WagonEntity wagon)
                || !(event.getEntityMounting() instanceof Player player)) {
            return;
        }
        if (wagon.isWalkingRider(player) && !wagon.dismountAllowed()
                && !wagon.isRemoved() && !player.isRemoved()) {
            event.setCanceled(true);
        }
    }
}
