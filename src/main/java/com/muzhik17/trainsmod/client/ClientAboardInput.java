package com.muzhik17.trainsmod.client;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.AboardGuard;
import com.muzhik17.trainsmod.consist.WagonEntity;

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
 * Aboard a train, a left click doesn't reach the world (SPEC v1.5-б,
 * {@link AboardGuard} — which the server and the item/block hooks enforce):
 * here the click is dropped before vanilla starts on it, so the arm doesn't
 * swing at a block, no cracks show, nothing is predicted to break, and no
 * entity outside the train is attacked. A swing into the air stays.
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
        if (player == null || !(player.getVehicle() instanceof WagonEntity)) {
            return;
        }
        HitResult hit = mc.hitResult;
        boolean world = hit != null && (hit.getType() == HitResult.Type.BLOCK
                || hit instanceof EntityHitResult entityHit && !AboardGuard.ownTrain(player, entityHit.getEntity()));
        if (world) {
            event.setCanceled(true);
            event.setSwingHand(false);
            if (mc.gameMode != null && mc.gameMode.isDestroying()) {
                mc.gameMode.stopDestroyBlock(); // boarded while digging: let the block be
            }
        }
    }
}
