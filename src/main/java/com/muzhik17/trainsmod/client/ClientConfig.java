package com.muzhik17.trainsmod.client;

import net.neoforged.fml.ModContainer;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.ModConfigSpec;

/**
 * The mod's client settings ({@code config/railswheelsandtrains-client.toml}).
 * The loader's config API stays in this one adapter (SPEC §7.3).
 */
public final class ClientConfig {

    private static final ModConfigSpec.Builder BUILDER = new ModConfigSpec.Builder();

    private static final ModConfigSpec.BooleanValue DRIVER_HUD = BUILDER
            .comment("Show the driver's instruments (speed, reverser, throttle, brakes) on screen while at the controls")
            .define("driverHud", true);

    private static final ModConfigSpec SPEC = BUILDER.build();

    private ClientConfig() {
    }

    /** Mod construction (from the client mod class). */
    public static void register(ModContainer container) {
        container.registerConfig(ModConfig.Type.CLIENT, SPEC);
    }

    /** True if the driver's instruments are shown on the HUD (SPEC §9.7). */
    public static boolean driverHud() {
        return !SPEC.isLoaded() || DRIVER_HUD.get();
    }

    /** Show or hide the driver's instruments on the HUD, and save the choice. */
    public static void setDriverHud(boolean shown) {
        if (SPEC.isLoaded()) {
            DRIVER_HUD.set(shown);
            DRIVER_HUD.save();
        }
    }
}
