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

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        while (PANEL.consumeClick()) {
            WagonEntity cab = ClientDriverHud.cab(mc);
            if (cab != null && mc.screen == null) {
                mc.setScreen(new DriverPanelScreen(cab));
            }
        }
    }
}
