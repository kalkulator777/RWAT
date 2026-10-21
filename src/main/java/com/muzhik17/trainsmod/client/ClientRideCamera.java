package com.muzhik17.trainsmod.client;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.Sway;

import net.minecraft.client.Minecraft;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.Entity;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.ViewportEvent;

/**
 * A rider's view rocks with the car (SPEC §10). Riders are already placed on
 * the swaying body ({@code WagonEntity.positionRider}), which moves the eye;
 * this adds the turn: the body's roll and pitch, seen from where the player
 * looks — looking ahead, the car's roll is the view's roll; looking out of a
 * side window, it tips the view up and down. Scaled by the client setting
 * {@code cameraSway} (0 keeps the view level).
 *
 * <p>Two cars rock each on its own, so walking through a gangway into the
 * next one (SPEC §9.5) changed the tilt at once — on a moving train a
 * visible tip of the horizon. The old car's tilt is eased into the new car's
 * over {@link #BLEND_TICKS}, on a clock of this class's own. (The camera
 * entity's age, the clock before, starts over with every new player entity —
 * a respawn, another dimension: a blend begun at the old player's age then
 * ran for minutes, its ease far outside 0..1, and the view spun.) Off a car,
 * the blend is dropped.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientRideCamera {

    /** How long the view takes to go over from one car's tilt to the next one's, ticks. */
    private static final double BLEND_TICKS = 10.0;

    /** The wagon whose tilt the view took last frame, −1 if none. */
    private static int lastWagon = -1;
    /** The tilt added last frame, degrees. */
    private static double lastRoll;
    private static double lastPitch;
    /** The old car's tilt less the new one's at the change, degrees, eased out from {@link #blendStart}. */
    private static double offsetRoll;
    private static double offsetPitch;
    /** {@link #ticks} (+ partial) at the change of car. */
    private static double blendStart = Double.NEGATIVE_INFINITY;
    /** Client ticks while the game runs: the blend's clock, never reset. */
    private static long ticks;

    private ClientRideCamera() {
    }

    /** No car's tilt to ease out of (off a car; logout, another level). */
    public static void clear() {
        lastWagon = -1;
        lastRoll = 0.0;
        lastPitch = 0.0;
        offsetRoll = 0.0;
        offsetPitch = 0.0;
        blendStart = Double.NEGATIVE_INFINITY;
    }

    /** The clock stands while paused, as the entities do. */
    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        if (!Minecraft.getInstance().isPaused()) {
            ticks++;
        }
    }

    @SubscribeEvent
    static void onCameraAngles(ViewportEvent.ComputeCameraAngles event) {
        Entity viewer = Minecraft.getInstance().getCameraEntity();
        if (viewer == null || !(viewer.getVehicle() instanceof WagonEntity wagon)) {
            clear();
            return;
        }
        double share = ClientConfig.cameraSway();
        if (share <= 0.0) {
            clear();
            return;
        }
        float partialTick = (float) event.getPartialTick();
        Sway sway = ClientRide.sway(wagon.getId(), partialTick);
        // the car's tilt as a small rotation vector in its pose frame: pitch
        // about +X (left), roll about +Z (forward); the view's yaw relative to
        // the car picks the parts along the view (roll) and across it (pitch)
        double relative = Math.toRadians(Mth.wrapDegrees(event.getYaw() - wagon.getYRot()));
        double roll = Math.toDegrees((-sway.pitch() * Math.sin(relative) + sway.roll() * Math.cos(relative)) * share);
        double pitch = Math.toDegrees((sway.pitch() * Math.cos(relative) + sway.roll() * Math.sin(relative)) * share);
        double now = ticks + partialTick;
        if (wagon.getId() != lastWagon && lastWagon != -1) {
            // through a gangway into another car: start from the tilt shown last frame
            offsetRoll = lastRoll - roll;
            offsetPitch = lastPitch - pitch;
            blendStart = now;
        }
        double left = Mth.clamp(1.0 - (now - blendStart) / BLEND_TICKS, 0.0, 1.0);
        if (left > 0.0) {
            double ease = left * left * (3.0 - 2.0 * left); // smoothstep: no kink at either end
            roll += offsetRoll * ease;
            pitch += offsetPitch * ease;
        }
        lastWagon = wagon.getId();
        lastRoll = roll;
        lastPitch = pitch;
        if (roll != 0.0 || pitch != 0.0) {
            event.setRoll(event.getRoll() + (float) roll);
            event.setPitch(event.getPitch() + (float) pitch);
        }
    }
}
