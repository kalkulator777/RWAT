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
 * over {@link #BLEND_TICKS}.
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
    /** The camera entity's age (ticks + partial) at the change of car. */
    private static double blendStart = Double.NEGATIVE_INFINITY;

    private ClientRideCamera() {
    }

    @SubscribeEvent
    static void onCameraAngles(ViewportEvent.ComputeCameraAngles event) {
        Entity viewer = Minecraft.getInstance().getCameraEntity();
        if (viewer == null || !(viewer.getVehicle() instanceof WagonEntity wagon)) {
            lastWagon = -1;
            return;
        }
        double share = ClientConfig.cameraSway();
        if (share <= 0.0) {
            lastWagon = -1;
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
        double now = viewer.tickCount + partialTick;
        if (wagon.getId() != lastWagon && lastWagon != -1) {
            // through a gangway into another car: start from the tilt shown last frame
            offsetRoll = lastRoll - roll;
            offsetPitch = lastPitch - pitch;
            blendStart = now;
        }
        double left = 1.0 - (now - blendStart) / BLEND_TICKS;
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
