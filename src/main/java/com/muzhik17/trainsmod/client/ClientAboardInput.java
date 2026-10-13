package com.muzhik17.trainsmod.client;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.AboardGuard;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.HitResult;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.InputEvent;

/**
 * A left click doesn't reach across a train's walls (SPEC v1.5-б,
 * {@link AboardGuard} — which the server and the item/block hooks enforce):
 * here the click is dropped before vanilla starts on it. Aboard, the arm
 * doesn't swing at a block, no cracks show, nothing is predicted to break;
 * aboard or not, no entity on the other side is attacked — one outside from
 * a car, one in a car from outside. A swing into the air stays.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientAboardInput {

    private ClientAboardInput() {
    }

    @SubscribeEvent(priority = EventPriority.LOW)
    static void onAttack(InputEvent.InteractionKeyMappingTriggered event) {
        if (!event.isAttack()) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;
        HitResult hit = mc.hitResult;
        if (player == null || hit == null) {
            return;
        }
        boolean blocked = hit.getType() == HitResult.Type.BLOCK
                ? AboardGuard.aboard(player)
                : hit instanceof EntityHitResult entityHit && AboardGuard.isolated(player, entityHit.getEntity());
        if (blocked) {
            event.setCanceled(true);
            event.setSwingHand(false);
            if (mc.gameMode != null && mc.gameMode.isDestroying()) {
                mc.gameMode.stopDestroyBlock(); // boarded while digging: let the block be
            }
        }
    }
}
