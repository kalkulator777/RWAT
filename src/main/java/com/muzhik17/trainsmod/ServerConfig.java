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
 * {@code [rails]}: how far a rail marker reaches for its partner (SPEC §2.2).
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

    /**
     * How far a rail marker looks for its partner, in blocks (SPEC §2.2) — the
     * default until the world's config is loaded.
     */
    public static int maxMarkerDistance() {
        return SPEC.isLoaded() ? MAX_MARKER_DISTANCE.get() : MAX_MARKER_DISTANCE.getDefault();
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
