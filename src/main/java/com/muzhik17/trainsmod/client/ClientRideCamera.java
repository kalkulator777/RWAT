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
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientRideCamera {

    private ClientRideCamera() {
    }

    @SubscribeEvent
    static void onCameraAngles(ViewportEvent.ComputeCameraAngles event) {
        Entity viewer = Minecraft.getInstance().getCameraEntity();
        if (viewer == null || !(viewer.getVehicle() instanceof WagonEntity wagon)) {
            return;
        }
        double share = ClientConfig.cameraSway();
        if (share <= 0.0) {
            return;
        }
        Sway sway = ClientRide.sway(wagon.getId(), (float) event.getPartialTick());
        if (sway.equals(Sway.ZERO)) {
            return;
        }
        // the car's tilt as a small rotation vector in its pose frame: pitch
        // about +X (left), roll about +Z (forward); the view's yaw relative to
        // the car picks the parts along the view (roll) and across it (pitch)
        double relative = Math.toRadians(Mth.wrapDegrees(event.getYaw() - wagon.getYRot()));
        double roll = -sway.pitch() * Math.sin(relative) + sway.roll() * Math.cos(relative);
        double pitch = sway.pitch() * Math.cos(relative) + sway.roll() * Math.sin(relative);
        event.setRoll(event.getRoll() + (float) Math.toDegrees(roll * share));
        event.setPitch(event.getPitch() + (float) Math.toDegrees(pitch * share));
    }
}
