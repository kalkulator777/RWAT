package com.muzhik17.trainsmod;

import com.muzhik17.trainsmod.consist.ChunkLease;
import com.muzhik17.trainsmod.physics.PhysicsTuning;

import net.neoforged.fml.ModContainer;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.ModConfigSpec;

/**
 * The mod's server settings — {@code config/railswheelsandtrains-server.toml},
 * overridden per world by a copy in {@code <world>/serverconfig/} (SPEC §5.6):
 * how the physics plays. One profile — realistic, standard,
 * arcade — or {@code custom}, the only one that reads the values of the
 * {@code [physics.custom]} section. And which trains keep the world loaded
 * around them ({@code [chunk_loading]}, SPEC §2.1). The loader's config API
 * stays in this one adapter (SPEC §7.3); the physics only ever sees a
 * {@link PhysicsTuning}, the consists a {@link ChunkLease.Policy}.
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

    static {
        BUILDER.comment("Which trains keep the world loaded around them (SPEC 2.1). Coupling never",
                        " depends on it: a train meets standing wagons wherever they are.")
                .push("chunk_loading");
    }

    private static final ChunkLease.Policy CHUNK_BASE = ChunkLease.Policy.DEFAULT;

    private static final ModConfigSpec.EnumValue<ChunkLease.Mode> CHUNK_MODE = BUILDER
            .comment("Which trains keep the chunks under their whole length and the way ahead loaded.",
                    " MOVING - driven trains and any train on the move (rolled away, coasting)",
                    " DRIVEN - only trains with a player at the controls",
                    " OFF    - none: a train runs only where the world ticks anyway (near players)")
            .defineEnum("mode", CHUNK_BASE.mode());
    private static final ModConfigSpec.IntValue CHUNK_LINGER_SECONDS = BUILDER
            .comment("A train left standing with nobody at the controls lets its chunks go after this many seconds")
            .defineInRange("linger_seconds", CHUNK_BASE.lingerTicks() / 20, 0, 3600);
    private static final ModConfigSpec.IntValue CHUNK_UNMANNED_SECONDS = BUILDER
            .comment("A train running with nobody at the controls keeps its chunks for at most this many",
                    " seconds of the run, then stands frozen until someone comes near; 0 = for as long as it runs")
            .defineInRange("unmanned_seconds", CHUNK_BASE.unmannedTicks() / 20, 0, 86400);
    private static final ModConfigSpec.IntValue CHUNK_MAX = BUILDER
            .comment("Most chunks one train keeps loaded (the way ahead and its leading end first)")
            .defineInRange("max_chunks", CHUNK_BASE.maxChunks(), 1, 4096);

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

    /** The chunk-loading policy in force (SPEC §2.1); the default one until the world's config is loaded. */
    public static ChunkLease.Policy chunkLoading() {
        if (!SPEC.isLoaded()) {
            return ChunkLease.Policy.DEFAULT;
        }
        return new ChunkLease.Policy(CHUNK_MODE.get(), CHUNK_LINGER_SECONDS.get() * 20,
                CHUNK_UNMANNED_SECONDS.get() * 20, CHUNK_MAX.get());
    }
}
