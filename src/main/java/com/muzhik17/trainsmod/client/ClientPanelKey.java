package com.muzhik17.trainsmod.client;

import org.lwjgl.glfw.GLFW;

import com.mojang.blaze3d.platform.InputConstants;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.gui.DriverPanelScreen;
import com.muzhik17.trainsmod.consist.WagonEntity;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;

/**
 * The driver's panel key (SPEC §8, §9.7; {@code L} by default): opens
 * {@link DriverPanelScreen} — instruments and lights — for the cab the player
 * is at the controls of. The mapping keeps its old name ({@code lights}), so
 * a rebound key stays rebound.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientPanelKey {

    public static final KeyMapping PANEL = new KeyMapping("key.railswheelsandtrains.lights",
            InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_L, "key.categories.railswheelsandtrains");

    private ClientPanelKey() {
    }

    /** Mod-bus registration (wired from the client mod class). */
    public static void register(RegisterKeyMappingsEvent event) {
        event.register(PANEL);
    }

    /**
     * At the start of the tick, before vanilla handles its keys: {@code L} is
     * vanilla's advancements key too, and vanilla's handler runs first — it
     * opened the advancements instead of the light menu (auto-scene
     * {@code panel}, 2026-10-10). At the controls the panel takes the press
     * and the advancements click on the same key is dropped (else it would
     * open once the panel closes); anywhere else {@code L} stays the
     * advancements key.
     */
    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Pre event) {
        Minecraft mc = Minecraft.getInstance();
        while (PANEL.consumeClick()) {
            WagonEntity cab = ClientDriverHud.cab(mc);
            if (cab != null && mc.screen == null) {
                mc.setScreen(new DriverPanelScreen(cab));
                KeyMapping advancements = mc.options.keyAdvancements;
                if (advancements.same(PANEL)) {
                    while (advancements.consumeClick()) {
                        // dropped: this press was the panel's
                    }
                }
            }
        }
    }
}
