package com.muzhik17.trainsmod.client;

import org.lwjgl.glfw.GLFW;

import com.mojang.blaze3d.platform.InputConstants;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.gui.TrainLightsScreen;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;

/**
 * The driver's light menu key (SPEC §8, {@code L} by default): opens
 * {@link TrainLightsScreen} for the train whose cab the player is in.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientLightsKey {

    public static final KeyMapping LIGHTS = new KeyMapping("key.railswheelsandtrains.lights",
            InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_L, "key.categories.railswheelsandtrains");

    private ClientLightsKey() {
    }

    /** Mod-bus registration (wired from the client mod class). */
    public static void register(RegisterKeyMappingsEvent event) {
        event.register(LIGHTS);
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        while (LIGHTS.consumeClick()) {
            if (mc.player != null && mc.screen == null
                    && mc.player.getVehicle() instanceof WagonEntity wagon) {
                WagonType type = wagon.typeNow();
                if (type != null && type.drivable()) {
                    mc.setScreen(new TrainLightsScreen(wagon.getConsistId()));
                }
            }
        }
    }
}
