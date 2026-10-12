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
 * Also who may drive ({@code [access]}, SPEC §9.2): the cabs open to anyone,
 * or only to a player with the driver's key. The server's settings reach
 * its clients, which predict the same.
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
    }

    /** Who may get into a cab and work it (SPEC §9.2). */
    public enum CabAccess {
        /** Anyone. */
        OPEN,
        /** A player carrying the driver's key; operators and creative players need none. */
        KEY
    }

    static {
        BUILDER.push("access");
    }

    private static final ModConfigSpec.EnumValue<CabAccess> CAB_ACCESS = BUILDER
            .comment("Who may open the doors into a cab, sit in a driver's chair and work a cab's controls.",
                    " OPEN - anyone, as in single player",
                    " KEY  - only a player carrying a driver's key (anywhere in the inventory);",
                    "        operators (permission level 2+) and creative players need none")
            .defineEnum("cab_access", CabAccess.OPEN);

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

    /**
     * True if the cabs want the driver's key (SPEC §9.2); open until the
     * world's config is loaded. Read on both sides: a client has the
     * server's settings once it has joined.
     */
    public static boolean cabsLocked() {
        return SPEC.isLoaded() && CAB_ACCESS.get() == CabAccess.KEY;
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
}
