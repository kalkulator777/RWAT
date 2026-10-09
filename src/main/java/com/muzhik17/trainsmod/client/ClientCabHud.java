package com.muzhik17.trainsmod.client;

import java.util.List;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.neoforge.client.event.RegisterGuiLayersEvent;
import net.neoforged.neoforge.client.gui.VanillaGuiLayers;

/**
 * The cab control label under the crosshair (SPEC §9.3, IR's overlay): what
 * the hovered or held control does and its setting — "Контроллер / 5 / 8",
 * "Прожектор передний / вкл" — read from {@link ClientCabInteract#hudLines}.
 * Drawn just above the crosshair layer, so F1 and open screens hide it.
 */
public final class ClientCabHud {

    private static final ResourceLocation LAYER =
            ResourceLocation.fromNamespaceAndPath(RailsWheelsAndTrains.MODID, "cab_control");
    /** Gap below the crosshair centre, GUI pixels. */
    private static final int OFFSET = 12;
    private static final int LINE = 10;

    private ClientCabHud() {
    }

    /** Mod-bus registration (from {@code RailsWheelsAndTrainsClient}). */
    public static void register(RegisterGuiLayersEvent event) {
        event.registerAbove(VanillaGuiLayers.CROSSHAIR, LAYER, ClientCabHud::render);
    }

    private static void render(GuiGraphics graphics, DeltaTracker delta) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.options.hideGui || mc.screen != null) {
            return;
        }
        List<Component> lines = ClientCabInteract.hudLines();
        int x = graphics.guiWidth() / 2;
        int y = graphics.guiHeight() / 2 + OFFSET;
        for (Component line : lines) {
            graphics.drawCenteredString(mc.font, line, x, y, 0xFFFFFF);
            y += LINE;
        }
    }
}
