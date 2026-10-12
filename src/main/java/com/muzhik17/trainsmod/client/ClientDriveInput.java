package com.muzhik17.trainsmod.client;

import org.lwjgl.glfw.GLFW;

import com.mojang.blaze3d.platform.InputConstants;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.network.DriveInputPayload;
import com.muzhik17.trainsmod.network.HandbrakePayload;
import com.muzhik17.trainsmod.stock.ConsistComposition;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import net.neoforged.neoforge.client.settings.IKeyConflictContext;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Forwards the driver's handle input to the server while at the controls of
 * a cab (SPEC §5.3), from the mod's own driving keys in the Controls screen
 * (SPEC §9.7, 2026-10-12): throttle up/down (W/S), train brake apply/release
 * (D/A), the reverser (Space — sent as an edge, the server throws it only at
 * a standstill), and, unbound by default, the independent brake and this
 * wagon's handbrake. Sent every tick (including all-zero) so the server has a
 * continuous signal. Pure input → packet; no client prediction in v0 (SPEC
 * §2.5). Any cab wagon of the consist sends (SPEC §6.12); the server only
 * listens to the front-most manned one, and reads "forward" as where that
 * cab faces. The signal keys (SPEC §10) are held, not toggled: the horn
 * ({@code H}, тифон) and the whistle ({@code J}, свисток — IR's "bell") sound
 * for as long as they are down, on every client in hearing.
 *
 * <p>The driving keys share W, S, A, D and Space with walking: their {@link
 * #DRIVING} context is active only at the controls and clashes with nothing
 * but itself, so the Controls screen shows no conflict and a walk about the
 * cab still walks. At the controls the vanilla keys are down as well, but a
 * passenger of a wagon neither walks nor jumps; Shift still stands up.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientDriveInput {

    private static final String CATEGORY = "key.categories.railswheelsandtrains";

    /**
     * The driving keys' context: active at the controls with no screen open,
     * in conflict only with itself — not with walking on the same keys.
     */
    public static final IKeyConflictContext DRIVING = new IKeyConflictContext() {
        @Override
        public boolean isActive() {
            Minecraft mc = Minecraft.getInstance();
            return mc.screen == null && mc.player != null
                    && mc.player.getVehicle() instanceof WagonEntity wagon && atControls(wagon, mc.player);
        }

        @Override
        public boolean conflicts(IKeyConflictContext other) {
            return other == this;
        }
    };

    public static final KeyMapping THROTTLE_UP = driving("throttle_up", GLFW.GLFW_KEY_W);
    public static final KeyMapping THROTTLE_DOWN = driving("throttle_down", GLFW.GLFW_KEY_S);
    public static final KeyMapping BRAKE_APPLY = driving("brake_apply", GLFW.GLFW_KEY_D);
    public static final KeyMapping BRAKE_RELEASE = driving("brake_release", GLFW.GLFW_KEY_A);
    public static final KeyMapping REVERSER = driving("reverser", GLFW.GLFW_KEY_SPACE);
    public static final KeyMapping IND_BRAKE_APPLY = driving("independent_brake_apply", GLFW.GLFW_KEY_UNKNOWN);
    public static final KeyMapping IND_BRAKE_RELEASE = driving("independent_brake_release", GLFW.GLFW_KEY_UNKNOWN);
    public static final KeyMapping HANDBRAKE = driving("handbrake", GLFW.GLFW_KEY_UNKNOWN);

    private static final KeyMapping[] DRIVING_KEYS = {THROTTLE_UP, THROTTLE_DOWN, BRAKE_APPLY,
        BRAKE_RELEASE, REVERSER, IND_BRAKE_APPLY, IND_BRAKE_RELEASE, HANDBRAKE};

    public static final KeyMapping HORN = new KeyMapping("key.railswheelsandtrains.horn",
            InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_H, CATEGORY);
    public static final KeyMapping WHISTLE = new KeyMapping("key.railswheelsandtrains.whistle",
            InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_J, CATEGORY);

    /** Previous reverser and handbrake key states, to send each as a single edge. */
    private static boolean reverserWasDown;
    private static boolean handbrakeWasDown;

    private ClientDriveInput() {
    }

    private static KeyMapping driving(String name, int key) {
        return new KeyMapping("key.railswheelsandtrains." + name, DRIVING,
                InputConstants.Type.KEYSYM, key, CATEGORY);
    }

    /** Mod-bus registration (wired from the client mod class). */
    public static void register(RegisterKeyMappingsEvent event) {
        for (KeyMapping key : DRIVING_KEYS) {
            event.register(key);
        }
        event.register(HORN);
        event.register(WHISTLE);
    }

    /**
     * True if two mappings must not be shown as clashing: one is a driving
     * key and their contexts don't conflict. NeoForge's {@code
     * KeyMapping.same} still calls any two mappings on one key the same
     * whatever their contexts; a client mixin asks this first.
     */
    public static boolean apart(KeyMapping a, KeyMapping b) {
        IKeyConflictContext ca = a.getKeyConflictContext();
        IKeyConflictContext cb = b.getKeyConflictContext();
        return (ca == DRIVING || cb == DRIVING) && !ca.conflicts(cb) && !cb.conflicts(ca);
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;
        if (player == null
                || !(player.getVehicle() instanceof WagonEntity wagon)
                || !atControls(wagon, player)) {
            // a walkable interior is driven by ClientWalkInput, not the throttle.
            // A key let go away from the controls never reaches its mapping
            // (its context is off): let go of them all here, or it would be
            // held down the next time the player sits at the desk
            for (KeyMapping key : DRIVING_KEYS) {
                key.setDown(false);
            }
            reverserWasDown = false;
            handbrakeWasDown = false;
            return;
        }
        int throttleDir = (THROTTLE_UP.isDown() ? 1 : 0) - (THROTTLE_DOWN.isDown() ? 1 : 0);
        int brakeDir = (BRAKE_APPLY.isDown() ? 1 : 0) - (BRAKE_RELEASE.isDown() ? 1 : 0);
        int indBrakeDir = (IND_BRAKE_APPLY.isDown() ? 1 : 0) - (IND_BRAKE_RELEASE.isDown() ? 1 : 0);
        boolean reverserDown = REVERSER.isDown();
        boolean reverserToggle = reverserDown && !reverserWasDown;
        reverserWasDown = reverserDown;
        boolean handbrakeDown = HANDBRAKE.isDown();
        if (handbrakeDown && !handbrakeWasDown) {
            // this wagon's handbrake, as its wheel in the cab (SPEC §5.3)
            PacketDistributor.sendToServer(new HandbrakePayload(wagon.getId()));
        }
        handbrakeWasDown = handbrakeDown;
        int signals = (HORN.isDown() ? Consist.HORN : 0) | (WHISTLE.isDown() ? Consist.BELL : 0);
        PacketDistributor.sendToServer(new DriveInputPayload(
                wagon.getConsistId(), throttleDir, brakeDir, indBrakeDir, reverserToggle, signals));
    }

    /**
     * True if the player is at the controls of {@code wagon}, so the keys
     * drive: a cab without a walkable interior, or a walkable cab's driver's
     * chair this player sits in (SPEC §9). Walking about a cab, the keys walk
     * (ClientWalkInput) and the levers take the mouse (ClientCabInteract).
     * Decided by the chair, not by the kind of wagon: an EMU's head car is a
     * cab and a saloon at once, and only its chair is at the controls — the
     * driver's panel shows by the same rule (SPEC §9.7).
     */
    public static boolean atControls(WagonEntity wagon, Player player) {
        ConsistComposition.Slot slot =
                ClientConsists.slot(wagon.getConsistId(), wagon.getWagonIndex());
        return slot != null && slot.type().drivable()
                && (!slot.type().boardable() || wagon.isSeated(player));
    }

    /**
     * True if anyone this client sees sits at the controls of a cab of the
     * consist — then the levers are theirs, not those of a player standing
     * in a cab (SPEC §9.2; the server's {@code ConsistManager.driverOf}).
     */
    public static boolean anyoneAtControls(int consistId) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) {
            return false;
        }
        for (Entity entity : mc.level.entitiesForRendering()) {
            if (entity instanceof WagonEntity wagon && wagon.getConsistId() == consistId) {
                for (Entity passenger : wagon.getPassengers()) {
                    if (passenger instanceof Player player && atControls(wagon, player)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
}
