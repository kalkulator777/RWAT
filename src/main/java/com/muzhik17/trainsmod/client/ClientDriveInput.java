package com.muzhik17.trainsmod.client;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.network.DriveInputPayload;
import com.muzhik17.trainsmod.stock.ConsistComposition;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Forwards the driver's handle input to the server while riding a cab (SPEC
 * §5.3): W/S move the throttle handle, D/A apply/release the train brake,
 * jump (space) is the reverser toggle — sent as an edge, the server throws it
 * only at a standstill. Sent every tick (including all-zero) so the server has
 * a continuous signal. Pure input → packet; no client prediction in v0 (SPEC
 * §2.5). Any cab wagon of the consist sends (SPEC §6.12); the server only
 * listens to the front-most manned one, and reads "forward" as where that
 * cab faces.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientDriveInput {

    /** Previous jump-key state, to send the reverser toggle as a single edge. */
    private static boolean jumpWasDown;

    private ClientDriveInput() {
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;
        if (player == null
                || !(player.getVehicle() instanceof WagonEntity wagon)
                || !isCab(wagon, player)) {
            // a walkable interior is driven by ClientWalkInput, not the throttle
            jumpWasDown = false;
            return;
        }
        int throttleDir = (mc.options.keyUp.isDown() ? 1 : 0)
                - (mc.options.keyDown.isDown() ? 1 : 0);
        int brakeDir = (mc.options.keyRight.isDown() ? 1 : 0)
                - (mc.options.keyLeft.isDown() ? 1 : 0);
        boolean jumpDown = mc.options.keyJump.isDown();
        boolean reverserToggle = jumpDown && !jumpWasDown;
        jumpWasDown = jumpDown;
        PacketDistributor.sendToServer(new DriveInputPayload(
                wagon.getConsistId(), throttleDir, brakeDir, reverserToggle));
    }

    /**
     * True if the keys drive here: a cab without a walkable interior, or a
     * walkable cab's driver's chair this player sits in (SPEC §9). Walking
     * about a cab, the keys walk (ClientWalkInput) and the levers take the
     * mouse (ClientCabInteract).
     */
    private static boolean isCab(WagonEntity wagon, LocalPlayer player) {
        ConsistComposition.Slot slot =
                ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex());
        return slot != null && slot.type().drivable()
                && (!slot.type().boardable() || wagon.isSeated(player));
    }
}
