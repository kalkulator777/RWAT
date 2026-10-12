package com.muzhik17.trainsmod.client;

import net.neoforged.fml.ModContainer;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.client.gui.ConfigurationScreen;
import net.neoforged.neoforge.client.gui.IConfigScreenFactory;
import net.neoforged.neoforge.common.ModConfigSpec;

/**
 * The mod's client settings ({@code config/railswheelsandtrains-client.toml}),
 * also changed in game: Mods → Rails, Wheels And Trains → Config (the
 * loader's own config screen; names and tooltips from the lang files,
 * {@code railswheelsandtrains.configuration.<key>}). The loader's config API
 * stays in this one adapter (SPEC §7.3).
 */
public final class ClientConfig {

    private static final ModConfigSpec.Builder BUILDER = new ModConfigSpec.Builder();

    private static final ModConfigSpec.BooleanValue DRIVER_HUD = BUILDER
            .comment("Show the driver's instruments (speed, reverser, throttle, brakes) on screen while at the controls")
            .define("driverHud", true);

    private static final ModConfigSpec.DoubleValue SWAY = BUILDER
            .comment("How hard car bodies rock and jolt on the track (SPEC 10): 1 = as designed, 0 = never")
            .defineInRange("swayStrength", 1.0, 0.0, 3.0);

    private static final ModConfigSpec.DoubleValue CAMERA_SWAY = BUILDER
            .comment("How much of the car's rocking tilts your view while riding: 1 = all of it (the camera is part of the car), 0 = the view stays level")
            .defineInRange("cameraSway", 1.0, 0.0, 1.0);

    private static final ModConfigSpec.DoubleValue VOLUME = BUILDER
            .comment("Volume of trains (engines, wheels, horns, controls) on top of the 'Friendly Creatures' slider")
            .defineInRange("trainVolume", 1.0, 0.0, 2.0);

    /** The interior distance by default (SPEC §2.4): covers riding — a camera inside a car is at most ~13 from its centre. */
    private static final int INTERIOR_DISTANCE_DEFAULT = 32;
    private static final ModConfigSpec.IntValue INTERIOR_DISTANCE = BUILDER
            .comment("How near a car you must be, in blocks, to see its interior (seats, partitions, cab fittings) through the windows; 0 = always drawn")
            .defineInRange("interiorDrawDistance", INTERIOR_DISTANCE_DEFAULT, 0, 256);

    private static final ModConfigSpec SPEC = BUILDER.build();

    private ClientConfig() {
    }

    /** Mod construction (from the client mod class): the settings and the in-game screen for every config of the mod. */
    public static void register(ModContainer container) {
        container.registerConfig(ModConfig.Type.CLIENT, SPEC);
        container.registerExtensionPoint(IConfigScreenFactory.class, ConfigurationScreen::new);
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

    /** Car body rocking, 0..3 (SPEC §10). */
    public static double swayStrength() {
        return SPEC.isLoaded() ? SWAY.get() : 1.0;
    }

    /** Share of the car's rocking that tilts a rider's view, 0..1 (SPEC §10). */
    public static double cameraSway() {
        return SPEC.isLoaded() ? CAMERA_SWAY.get() : 1.0;
    }

    /** Train sound volume, 0..2 (SPEC §10). */
    public static double trainVolume() {
        return SPEC.isLoaded() ? VOLUME.get() : 1.0;
    }

    /** How near a car its interior is drawn, blocks; 0 = always (SPEC §2.4). */
    public static int interiorDrawDistance() {
        return SPEC.isLoaded() ? INTERIOR_DISTANCE.get() : INTERIOR_DISTANCE_DEFAULT;
    }
}
