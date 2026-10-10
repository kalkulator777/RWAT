package com.muzhik17.trainsmod.client;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.gui.DriverPanel;
import com.muzhik17.trainsmod.client.gui.DriverPanelScreen;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.Handles;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.convention.DriverReadout;

import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterGuiLayersEvent;
import net.neoforged.neoforge.client.gui.VanillaGuiLayers;

/**
 * The driver's instruments on the HUD (SPEC §9.7): {@link DriverPanel} in the
 * bottom right corner while the player is at the controls — in the driver's
 * chair, or in a cab without a walkable interior ({@link
 * ClientDriveInput#atControls}). Beside the hotbar when the screen is wide
 * enough, else above the status bars. Hidden with F1 and while the driver's
 * panel screen (which draws its own) is open; switched off in that screen
 * ({@link ClientConfig#driverHud}) — then a moved handle is reported on the
 * action bar instead.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientDriverHud {

    private static final ResourceLocation LAYER =
            ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "driver_panel");
    private static final int MARGIN = 4;
    /** Half the hotbar's width, GUI pixels. */
    private static final int HOTBAR_HALF = 91;
    /** How high the hotbar and the status bars over it reach, GUI pixels. */
    private static final int STATUS_BARS = 59;

    /** The handles last reported on the action bar (the HUD switched off), or null. */
    private static Handles reported;

    private ClientDriverHud() {
    }

    /** Mod-bus registration (from {@code RailsWheelsAndTrainsClient}). */
    public static void register(RegisterGuiLayersEvent event) {
        event.registerAbove(VanillaGuiLayers.HOTBAR, LAYER, ClientDriverHud::render);
    }

    /** The cab wagon the local player is at the controls of, or null. */
    public static WagonEntity cab(Minecraft mc) {
        return mc.player != null && mc.player.getVehicle() instanceof WagonEntity wagon
                && ClientDriveInput.atControls(wagon, mc.player) ? wagon : null;
    }

    private static void render(GuiGraphics graphics, DeltaTracker delta) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.options.hideGui || mc.screen instanceof DriverPanelScreen || !ClientConfig.driverHud()) {
            return;
        }
        WagonEntity wagon = cab(mc);
        DriverReadout readout = wagon == null ? null : DriverPanel.readout(wagon);
        if (readout == null) {
            return;
        }
        int width = graphics.guiWidth();
        int height = graphics.guiHeight();
        int x = width - DriverPanel.WIDTH - MARGIN;
        boolean besideHotbar = x >= width / 2 + HOTBAR_HALF + MARGIN;
        int y = height - DriverPanel.height(readout) - (besideHotbar ? MARGIN : STATUS_BARS + MARGIN);
        DriverPanel.draw(graphics, mc.font, x, y, readout, false, 0, 0);
    }

    /** With the HUD switched off, a moved handle shows on the action bar (the old feedback). */
    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        WagonEntity wagon = cab(mc);
        if (wagon == null || ClientConfig.driverHud()) {
            reported = null;
            return;
        }
        DriverReadout readout = DriverPanel.readout(wagon);
        if (readout == null) {
            return;
        }
        Handles handles = readout.handles();
        if (reported != null && !handles.equals(reported)) {
            mc.gui.setOverlayMessage(Component.translatable("message.railswheelsandtrains.controls_status",
                    Component.translatable("hud.railswheelsandtrains.reverser."
                            + (handles.reverser() > 0 ? "forward" : handles.reverser() < 0 ? "backward" : "neutral")),
                    handles.throttle(), Consist.NOTCHES, handles.trainBrake(), Consist.NOTCHES,
                    Math.round(readout.speedKmh())), false);
        }
        reported = handles;
    }
}
