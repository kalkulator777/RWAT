package com.muzhik17.trainsmod;

import com.muzhik17.trainsmod.physics.PhysicsTuning;

import net.neoforged.fml.ModContainer;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.ModConfigSpec;

/**
 * The mod's server settings — {@code config/railswheelsandtrains-server.toml},
 * overridden per world by a copy in {@code <world>/serverconfig/} (SPEC §5.6):
 * how the physics plays. One profile — realistic, standard,
 * arcade — or {@code custom}, the only one that reads the values of the
 * {@code [physics.custom]} section. The loader's config API stays in this one
 * adapter (SPEC §7.3); the physics only ever sees a {@link PhysicsTuning}.
 * {@code [rails]}: how far a rail marker reaches for its partner (SPEC §2.2).
 */
public final class ServerConfig {

    private static final ModConfigSpec.Builder BUILDER = new ModConfigSpec.Builder();

    static {
        BUILDER.push("physics");
    }

    private static final ModConfigSpec.EnumValue<PhysicsTuning.Profile> PROFILE = BUILDER
            .comment("How the trains play.",
                    " REALISTIC - real figures: brake early, set handbrakes by hand (crowbar), couple gently",
                    " STANDARD  - real physics with stronger, quicker brakes and handbrakes that set themselves",
                    " ARCADE    - quick and forgiving: no wheel slip, a train slows by itself, couples at any speed",
                    " CUSTOM    - the values of [physics.custom] below (ignored by every other profile)")
            .defineEnum("profile", PhysicsTuning.Profile.STANDARD);

    static {
        BUILDER.comment("Used only when profile = CUSTOM. Defaults are the STANDARD profile's.")
                .push("custom");
    }

    private static final PhysicsTuning BASE = PhysicsTuning.STANDARD;

    private static final ModConfigSpec.DoubleValue TRACTION_SCALE = BUILDER
            .comment("Multiplies every locomotive's tractive effort")
            .defineInRange("traction_scale", BASE.tractionScale(), 0.0, 10.0);
    private static final ModConfigSpec.DoubleValue BRAKE_SCALE = BUILDER
            .comment("Multiplies every brake force (train, loco and handbrakes)")
            .defineInRange("brake_scale", BASE.brakeScale(), 0.0, 10.0);
    private static final ModConfigSpec.DoubleValue RESISTANCE_SCALE = BUILDER
            .comment("Multiplies running resistance; above 1 a train slows by itself once the throttle closes")
            .defineInRange("resistance_scale", BASE.resistanceScale(), 0.0, 20.0);
    private static final ModConfigSpec.DoubleValue RESPONSE_SCALE = BUILDER
            .comment("Multiplies how long brakes and engines take to follow the handles; 0 = at once")
            .defineInRange("response_scale", BASE.responseScale(), 0.0, 10.0);
    private static final ModConfigSpec.BooleanValue ADHESION_LIMIT = BUILDER
            .comment("Wheels slip: no wagon pulls or brakes harder than its wheels grip the rail")
            .define("adhesion_limit", BASE.adhesionLimit());
    private static final ModConfigSpec.DoubleValue ADHESION_SCALE = BUILDER
            .comment("Multiplies the wheel-rail adhesion (1 = dry rail)")
            .defineInRange("adhesion_scale", BASE.adhesionScale(), 0.1, 5.0);
    private static final ModConfigSpec.BooleanValue AUTO_HANDBRAKE = BUILDER
            .comment("Handbrakes set themselves when a train stands with the throttle shut",
                    " and come off when the throttle opens; false = by hand only (crowbar)")
            .define("auto_handbrake", BASE.autoHandbrake());
    private static final ModConfigSpec.BooleanValue HARD_SPEED_LIMIT = BUILDER
            .comment("A train never exceeds its slowest wagon's design speed;",
                    " false = it can (downhill, pushed) - only locomotive governors limit traction")
            .define("hard_speed_limit", BASE.hardSpeedLimit());
    private static final ModConfigSpec.DoubleValue COUPLING_MAX_SPEED_KMH = BUILDER
            .comment("Trains running together faster than this (km/h) bump instead of coupling; 0 = couple at any speed")
            .defineInRange("coupling_max_speed_kmh", BASE.couplingMaxSpeedKmh(), 0.0, 400.0);

    static {
        BUILDER.pop(2);
        BUILDER.push("rails");
    }

    private static final ModConfigSpec.IntValue MAX_MARKER_DISTANCE = BUILDER
            .comment("How far a rail marker looks for the marker it connects to, in blocks - the longest",
                    " segment one click of the rails builds. A longer segment costs more to build: its",
                    " track bed is rasterized all along it, and every chunk it crosses is loaded")
            .defineInRange("max_marker_distance", 512, 16, 2048);

    static {
        BUILDER.pop();
    }

    private static final ModConfigSpec SPEC = BUILDER.build();

    private ServerConfig() {
    }

    /** Mod construction (from the common mod class). */
    static void register(ModContainer container) {
        container.registerConfig(ModConfig.Type.SERVER, SPEC);
    }

    /** The physics tuning in force; the standard profile until the world's config is loaded. */
    public static PhysicsTuning tuning() {
        if (!SPEC.isLoaded()) {
            return PhysicsTuning.STANDARD;
        }
        return PhysicsTuning.of(PROFILE.get(), new PhysicsTuning(
                TRACTION_SCALE.get(), BRAKE_SCALE.get(), RESISTANCE_SCALE.get(),
                RESPONSE_SCALE.get(), ADHESION_LIMIT.get(), ADHESION_SCALE.get(),
                AUTO_HANDBRAKE.get(), HARD_SPEED_LIMIT.get(), COUPLING_MAX_SPEED_KMH.get()));
    }

    /**
     * How far a rail marker looks for its partner, in blocks (SPEC §2.2) — the
     * default until the world's config is loaded.
     */
    public static int maxMarkerDistance() {
        return SPEC.isLoaded() ? MAX_MARKER_DISTANCE.get() : MAX_MARKER_DISTANCE.getDefault();
    }
}
