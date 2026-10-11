package com.muzhik17.trainsmod.client.sound;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.ClientConfig;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientDriveInput;
import com.muzhik17.trainsmod.client.ClientRide;
import com.muzhik17.trainsmod.client.render.model.StockModels;
import com.muzhik17.trainsmod.consist.Consist;
import com.muzhik17.trainsmod.consist.Handles;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.PoseMath;
import com.muzhik17.trainsmod.kinematics.WagonPose;
import com.muzhik17.trainsmod.stock.ConsistComposition;
import com.muzhik17.trainsmod.stock.WagonType;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterClientCommandsEvent;

/**
 * Trains you can hear (SPEC §10), worked out on each client from what it
 * already knows — nothing extra is synced but the driver's horn and whistle
 * keys. Every client tick, for the wagons in hearing:
 * <ul>
 * <li><b>wheels</b> — the rolling loop, pitch and volume by speed (stock with
 * no sound of its own rolls like a minecart);</li>
 * <li><b>rail joints</b> — each bogie knocks as it crosses one, where the
 * body jolts ({@link ClientRide#takeJoints});</li>
 * <li><b>engine</b> ({@code idle}) — runs while the train is manned or moving,
 * its pitch rising with the throttle; a lead-in and tail if declared (the
 * DR1's engine starts and stops);</li>
 * <li><b>doors</b> — each door's sound as it opens or closes (an iron door
 * if the pack gives none);</li>
 * <li><b>cab controls</b> — the notch of the throttle, brake and reverser in
 * the cab that drives;</li>
 * <li><b>horn and whistle</b> — from that cab, for as long as the driver holds the key.</li>
 * </ul>
 * Loops are kept for the nearest wagons only ({@link #MAX_WHEELS},
 * {@link #MAX_ENGINES}): the sound engine has a few hundred channels for the
 * whole game.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class TrainSounds {

    /** How far each kind of sound carries, blocks. */
    private static final int WHEELS_DISTANCE = 48;
    private static final int CLACK_DISTANCE = 40;
    private static final int ENGINE_DISTANCE = 64;
    private static final int HORN_DISTANCE = 192;
    private static final int BELL_DISTANCE = 128;
    private static final int DOOR_DISTANCE = 24;
    private static final int CONTROL_DISTANCE = 16;

    /** Rolling loops for at most this many of the nearest wagons. */
    private static final int MAX_WHEELS = 16;
    /** Engine loops for at most this many of the nearest wagons. */
    private static final int MAX_ENGINES = 8;

    /** Stock without a wheel sound of its own rolls like a minecart. */
    private static final SoundSet.Loop FALLBACK_WHEELS =
            new SoundSet.Loop(null, "minecraft:entity.minecart.riding", null, new float[] {0.6F, 1.1F},
                    new float[] {0.2F, 0.7F});
    private static final String DOOR_OPEN = "minecraft:block.iron_door.open";
    private static final String DOOR_CLOSE = "minecraft:block.iron_door.close";

    /** Default ranges when a declaration gives none: wheels by speed, engine by throttle. */
    private static final float[] WHEELS_PITCH = {0.7F, 1.3F};
    private static final float[] WHEELS_VOLUME = {0.25F, 1.0F};
    private static final float[] ENGINE_PITCH = {1.0F, 1.3F};
    private static final float[] ENGINE_VOLUME = {0.6F, 1.0F};

    /** Speed at the top of the wheels' range, km/h. */
    private static final double WHEELS_FULL_KMH = 100.0;
    /** Below this the wheels fade out, km/h. */
    private static final double WHEELS_FADE_KMH = 6.0;
    /** A train moving faster than this keeps its engine running, km/h. */
    private static final double ENGINE_MOVING_KMH = 0.5;
    /** How fast the engine follows the throttle: share of the way per tick (~3 s up, ~1.5 s down). */
    private static final float ENGINE_UP = 0.017F;
    private static final float ENGINE_DOWN = 0.035F;

    private static final class WagonAudio {
        String typeId;
        SoundSet sounds = SoundSet.NONE;
        LoopPlayer wheels;
        LoopPlayer engine;
        float throttle;
        int doorMask = -1;
    }

    private static final class ConsistAudio {
        Handles handles;
        LoopPlayer horn;
        LoopPlayer bell;
        String cabType;
        final Map<String, TrainSound> engaged = new HashMap<>();
    }

    private static final Map<Integer, WagonAudio> WAGONS = new HashMap<>();
    private static final Map<Integer, ConsistAudio> CONSISTS = new HashMap<>();
    private static long ticks;
    /** One-shots started since the last {@link #describe} (debug): joints, doors, controls. */
    private static int clacksPlayed;
    private static int doorsPlayed;
    private static int controlsPlayed;

    private TrainSounds() {
    }

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        ClientLevel level = mc.level;
        if (level == null) {
            clearAll();
            return;
        }
        if (mc.isPaused()) {
            return;
        }
        ticks++;
        Vec3 ear = mc.gameRenderer.getMainCamera().getPosition();

        List<WagonEntity> near = new ArrayList<>();
        for (Entity entity : level.entitiesForRendering()) {
            if (entity instanceof WagonEntity wagon && !wagon.isRemoved()
                    && wagon.distanceToSqr(ear) < (double) HORN_DISTANCE * HORN_DISTANCE) {
                near.add(wagon);
            }
        }
        near.sort((a, b) -> Double.compare(a.distanceToSqr(ear), b.distanceToSqr(ear)));

        // consists someone drives: their engines run even standing still
        Set<Integer> manned = new HashSet<>();
        for (WagonEntity wagon : near) {
            for (Entity passenger : wagon.getPassengers()) {
                if (passenger instanceof Player player && ClientDriveInput.atControls(wagon, player)) {
                    manned.add(wagon.getConsistId());
                }
            }
        }

        double volume = ClientConfig.trainVolume();
        int wheelsLeft = MAX_WHEELS;
        int enginesLeft = MAX_ENGINES;
        Set<Integer> heard = new HashSet<>();
        Map<Integer, WagonEntity> cabs = new HashMap<>();
        for (WagonEntity wagon : near) {
            int consistId = wagon.getConsistId();
            int index = wagon.getWagonIndex();
            ConsistComposition.Slot slot = ClientConsists.slot(consistId, index);
            if (slot == null) {
                continue;
            }
            heard.add(wagon.getId());
            WagonAudio audio = WAGONS.computeIfAbsent(wagon.getId(), id -> new WagonAudio());
            if (!slot.type().id().equals(audio.typeId)) {
                retype(audio, slot.type().id());
            }
            double kmh = Math.abs(ClientConsists.tickSpeed(consistId)) * 72.0; // blocks/tick → km/h
            double distance = Math.sqrt(wagon.distanceToSqr(ear));
            Handles handles = ClientConsists.handles(consistId);
            if (handles.activeCab() == index) {
                cabs.put(consistId, wagon);
            }

            boolean wheelsOn = kmh > 0.3 && distance < WHEELS_DISTANCE && wheelsLeft > 0;
            if (wheelsOn) {
                wheelsLeft--;
            }
            wheels(audio, wagon, wheelsOn, kmh, volume);

            boolean alive = manned.contains(consistId) || kmh > ENGINE_MOVING_KMH || handles.throttle() > 0;
            boolean engineOn = audio.engine != null && alive && distance < ENGINE_DISTANCE && enginesLeft > 0;
            if (engineOn) {
                enginesLeft--;
            }
            engine(audio, wagon, engineOn, handles, alive, volume);

            if (distance < CLACK_DISTANCE) {
                clacks(audio, wagon, kmh, volume);
            } else {
                ClientRide.takeJoints(wagon.getId()); // out of earshot: let them pass
            }
            doors(audio, wagon, slot.type(), distance, volume);
        }
        WAGONS.entrySet().removeIf(entry -> {
            if (heard.contains(entry.getKey())) {
                return false;
            }
            silence(entry.getValue());
            return true;
        });

        // the cab that drives: its controls, horn and whistle
        Set<Integer> cabsHeard = new HashSet<>();
        for (Map.Entry<Integer, WagonEntity> entry : cabs.entrySet()) {
            cabsHeard.add(entry.getKey());
            cab(entry.getKey(), entry.getValue(), ear, volume);
        }
        CONSISTS.entrySet().removeIf(entry -> {
            if (cabsHeard.contains(entry.getKey())) {
                return false;
            }
            silence(entry.getValue());
            return true;
        });
    }

    /** The wagon's type changed (first sight, a pack reload): new loops for its sounds. */
    private static void retype(WagonAudio audio, String typeId) {
        silence(audio);
        audio.typeId = typeId;
        audio.sounds = StockModels.sounds(typeId);
        SoundSet.Loop wheels = audio.sounds.wheels() != null ? audio.sounds.wheels() : FALLBACK_WHEELS;
        audio.wheels = new LoopPlayer(wheels, WHEELS_DISTANCE, false);
        audio.engine = audio.sounds.idle() != null
                ? new LoopPlayer(audio.sounds.idle(), ENGINE_DISTANCE, false) : null;
        audio.doorMask = -1;
    }

    private static void wheels(WagonAudio audio, WagonEntity wagon, boolean on, double kmh,
            double volume) {
        SoundSet.Loop loop = audio.wheels.loop();
        float f = (float) Math.min(kmh / WHEELS_FULL_KMH, 1.2);
        float fade = (float) Math.min(kmh / WHEELS_FADE_KMH, 1.0);
        float[] pitch = loop.pitch() != null ? loop.pitch() : WHEELS_PITCH;
        float[] level = loop.volume() != null ? loop.volume() : WHEELS_VOLUME;
        audio.wheels.update(on, ticks, wagon.getX(), wagon.getY() + 0.5, wagon.getZ(),
                (float) (lerp(level, Math.min(f, 1.0F)) * fade * volume), lerp(pitch, f));
    }

    private static void engine(WagonAudio audio, WagonEntity wagon, boolean on, Handles handles,
            boolean alive, double volume) {
        if (audio.engine == null) {
            return;
        }
        float target = alive ? handles.throttle() / (float) Consist.NOTCHES : 0.0F;
        float rate = target > audio.throttle ? ENGINE_UP : ENGINE_DOWN;
        audio.throttle += Math.clamp(target - audio.throttle, -rate, rate);
        SoundSet.Loop loop = audio.engine.loop();
        float[] pitch = loop.pitch() != null ? loop.pitch() : ENGINE_PITCH;
        float[] level = loop.volume() != null ? loop.volume() : ENGINE_VOLUME;
        if (!on && audio.engine.on() && alive) {
            audio.engine.kill(); // out of hearing / over budget: no shutdown sound
            return;
        }
        audio.engine.update(on, ticks, wagon.getX(), wagon.getY() + 2.0, wagon.getZ(),
                (float) (lerp(level, audio.throttle) * volume), lerp(pitch, audio.throttle));
    }

    /** Each bogie that crossed a rail joint this tick knocks, where it is. */
    private static void clacks(WagonAudio audio, WagonEntity wagon, double kmh, double volume) {
        int[] crossed = ClientRide.takeJoints(wagon.getId());
        if ((crossed[0] == 0 && crossed[1] == 0) || audio.sounds.clack() == null) {
            return;
        }
        WagonPose pose = ClientConsists.tickPose(wagon.getConsistId(), wagon.getWagonIndex());
        if (pose == null) {
            return;
        }
        float level = (float) (Math.clamp(0.25 + kmh / 80.0, 0.25, 1.0) * volume);
        float pitch = (float) (0.9 + 0.25 * Math.min(kmh / 120.0, 1.0));
        if (crossed[0] > 0) {
            oneShot(audio.sounds.clack(), CLACK_DISTANCE, pose.front().position(), level, pitch);
            clacksPlayed++;
        }
        if (crossed[1] > 0) {
            oneShot(audio.sounds.clack(), CLACK_DISTANCE, pose.rear().position(), level, pitch);
            clacksPlayed++;
        }
    }

    /** A door that opened or closed since the last tick sounds at its doorway. */
    private static void doors(WagonAudio audio, WagonEntity wagon, WagonType type, double distance,
            double volume) {
        int mask = wagon.doorMask();
        int changed = audio.doorMask < 0 ? 0 : mask ^ audio.doorMask;
        audio.doorMask = mask; // the state first seen is no event
        if (changed == 0 || distance > DOOR_DISTANCE) {
            return;
        }
        List<WagonType.Door> doors = wagon.framedDoors();
        for (int i = 0; i < doors.size() && i < 32; i++) {
            if ((changed & 1 << i) == 0) {
                continue;
            }
            WagonType.Door door = doors.get(i);
            boolean open = (mask & 1 << i) != 0;
            String ref = audio.sounds.doors().get(door.id().toLowerCase(Locale.ROOT));
            if (ref == null) {
                ref = open ? DOOR_OPEN : DOOR_CLOSE;
            }
            Vector3d centre = PoseMath.localToWorld(new Vector3d(wagon.getX(), wagon.getY(), wagon.getZ()),
                    wagon.getYRot(), wagon.getXRot(), new Vector3d((door.minX() + door.maxX()) * 0.5,
                            (door.minY() + door.maxY()) * 0.5, (door.minZ() + door.maxZ()) * 0.5));
            oneShot(ref, DOOR_DISTANCE, centre, (float) volume, 1.0F);
            doorsPlayed++;
        }
    }

    /** The cab that drives: a handle moved, the horn or whistle held. */
    private static void cab(int consistId, WagonEntity cab, Vec3 ear, double volume) {
        ConsistAudio audio = CONSISTS.computeIfAbsent(consistId, id -> new ConsistAudio());
        ConsistComposition.Slot slot = ClientConsists.slot(consistId, cab.getWagonIndex());
        String typeId = slot == null ? null : slot.type().id();
        SoundSet sounds = typeId == null ? SoundSet.NONE : StockModels.sounds(typeId);
        if (typeId != null && !typeId.equals(audio.cabType)) {
            silence(audio);
            audio.cabType = typeId;
            audio.horn = sounds.horn() != null ? new LoopPlayer(sounds.horn(), HORN_DISTANCE, true) : null;
            audio.bell = sounds.bell() != null ? new LoopPlayer(sounds.bell(), BELL_DISTANCE, true) : null;
        }

        // the driver's desk (the chair driven from), or the middle of the cab wagon
        WagonType.Seat seat = cab.deskSeat();
        Vector3d desk = PoseMath.localToWorld(new Vector3d(cab.getX(), cab.getY(), cab.getZ()),
                cab.getYRot(), cab.getXRot(),
                seat != null ? new Vector3d(seat.x(), seat.y(), seat.z()) : new Vector3d(0.0, 2.0, 0.0));
        Vector3d roof = PoseMath.localToWorld(new Vector3d(cab.getX(), cab.getY(), cab.getZ()),
                cab.getYRot(), cab.getXRot(), new Vector3d(0.0, 4.0, seat != null ? seat.z() : 0.0));

        Handles handles = ClientConsists.handles(consistId);
        Handles before = audio.handles;
        audio.handles = handles;
        if (before != null && ear.distanceToSqr(desk.x, desk.y, desk.z) < CONTROL_DISTANCE * CONTROL_DISTANCE) {
            control(audio, sounds, "THROTTLE_", null, before.throttle() != handles.throttle(), desk, volume);
            control(audio, sounds, "TRAIN_BRAKE_", null, before.trainBrake() != handles.trainBrake(),
                    desk, volume);
            control(audio, sounds, "INDEPENDENT_BRAKE_", "IND_BRAKE_",
                    before.indBrake() != handles.indBrake(), desk, volume);
            control(audio, sounds, "REVERSER_", null, before.reverser() != handles.reverser(), desk, volume);
        }

        int signals = ClientConsists.signals(consistId);
        if (audio.horn != null) {
            audio.horn.update((signals & Consist.HORN) != 0, ticks, roof.x, roof.y, roof.z,
                    (float) volume, 1.0F);
        }
        if (audio.bell != null) {
            audio.bell.update((signals & Consist.BELL) != 0, ticks, roof.x, roof.y, roof.z,
                    (float) volume, 1.0F);
        }
    }

    /**
     * A handle moved a notch: its control's {@code move}, and its
     * {@code engage} unless that is still sounding from the last move (the
     * brake valve's long hiss doesn't restart on every notch).
     */
    private static void control(ConsistAudio audio, SoundSet sounds, String kind, String alias,
            boolean moved, Vector3d at, double volume) {
        if (!moved) {
            return;
        }
        SoundSet.Control control = null;
        for (Map.Entry<String, SoundSet.Control> entry : sounds.controls().entrySet()) {
            if (entry.getKey().startsWith(kind) || (alias != null && entry.getKey().startsWith(alias))) {
                control = entry.getValue();
                break;
            }
        }
        if (control == null) {
            return;
        }
        if (control.move() != null) {
            oneShot(control.move(), CONTROL_DISTANCE, at, (float) volume, 1.0F);
            controlsPlayed++;
        }
        if (control.engage() != null) {
            TrainSound playing = audio.engaged.get(kind);
            if (playing == null || !Minecraft.getInstance().getSoundManager().isActive(playing)) {
                audio.engaged.put(kind, oneShot(control.engage(), CONTROL_DISTANCE, at, (float) volume, 1.0F));
                controlsPlayed++;
            }
        }
    }

    private static TrainSound oneShot(String ref, int distance, Vector3d at, float volume, float pitch) {
        TrainSound sound = TrainSound.of(ref, false, distance);
        if (sound != null) {
            sound.moveTo(at.x, at.y, at.z);
            sound.set(volume, pitch);
            Minecraft.getInstance().getSoundManager().play(sound);
        }
        return sound;
    }

    private static float lerp(float[] range, float t) {
        return range[0] + (range[1] - range[0]) * t;
    }

    private static void silence(WagonAudio audio) {
        if (audio.wheels != null) {
            audio.wheels.kill();
        }
        if (audio.engine != null) {
            audio.engine.kill();
        }
    }

    private static void silence(ConsistAudio audio) {
        if (audio.horn != null) {
            audio.horn.kill();
        }
        if (audio.bell != null) {
            audio.bell.kill();
        }
    }

    /**
     * What is sounding now (debug, {@code /rwatc sounds} and the scenes): the
     * loops by wagon and the one-shots played since the last call.
     */
    public static String describe() {
        StringBuilder out = new StringBuilder();
        int wheels = 0;
        int engines = 0;
        for (Map.Entry<Integer, WagonAudio> entry : WAGONS.entrySet()) {
            WagonAudio audio = entry.getValue();
            boolean rolling = audio.wheels != null && audio.wheels.on();
            boolean running = audio.engine != null && audio.engine.on();
            wheels += rolling ? 1 : 0;
            engines += running ? 1 : 0;
            if (rolling || running) {
                out.append(String.format(Locale.ROOT, " %s%s%s", audio.typeId,
                        rolling ? "[wheels]" : "", running ? "[engine " + Math.round(audio.throttle * 100) + "%]" : ""));
            }
        }
        for (ConsistAudio audio : CONSISTS.values()) {
            if (audio.horn != null && audio.horn.on()) {
                out.append(" HORN");
            }
            if (audio.bell != null && audio.bell.on()) {
                out.append(" WHISTLE");
            }
        }
        String line = String.format(Locale.ROOT, "%d wagons heard, %d rolling, %d engines; joints %d, doors %d, controls %d;%s",
                WAGONS.size(), wheels, engines, clacksPlayed, doorsPlayed, controlsPlayed, out);
        clacksPlayed = 0;
        doorsPlayed = 0;
        controlsPlayed = 0;
        return line;
    }

    @SubscribeEvent
    static void onRegisterCommands(RegisterClientCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("rwatc")
                .then(Commands.literal("sounds").executes(context -> {
                    String line = describe();
                    context.getSource().sendSuccess(() -> Component.literal(line), false);
                    return 1;
                })));
    }

    /** Drop everything (logout, resource reload). */
    public static void clearAll() {
        WAGONS.values().forEach(TrainSounds::silence);
        CONSISTS.values().forEach(TrainSounds::silence);
        WAGONS.clear();
        CONSISTS.clear();
        SoundInfo.clear();
    }
}
