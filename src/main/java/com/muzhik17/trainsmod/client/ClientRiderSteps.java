package com.muzhik17.trainsmod.client;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.joml.Quaterniond;
import org.joml.Vector3d;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.consist.WagonEntity;
import com.muzhik17.trainsmod.kinematics.PoseMath;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.player.Player;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;

/**
 * What a step along a car's floor looks and sounds like (SPEC v1.5-б, client
 * cosmetics): the train carries a walking rider in the world, so vanilla —
 * which reads walking from the world movement ({@code Entity.move}, never
 * called for a passenger, and {@code Player.rideTick}, which zeroes the view
 * bob) — sees a rider standing still. Here the <b>floor step</b> drives it
 * instead, as vanilla would drive it from a walk on the ground:
 * <ul>
 *   <li>the <b>legs</b> ({@code walkAnimation}, scaled like vanilla's
 *       {@code calculateEntityAnimation}) and the <b>body</b> turned toward
 *       the step — for the local player from its prediction, for everyone
 *       else from the synced feet ({@link ClientWalk}), so observers see a
 *       rider walk, not glide ({@code LivingEntityWalkAnimationMixin} keeps
 *       vanilla's own update out of the way);
 *   <li>the local player's <b>view bob</b> ({@code bob}, {@code walkDist} —
 *       vanilla's {@code bobView} draws it if the video setting "View
 *       Bobbing" is on);
 *   <li><b>footsteps</b> on the floor: a wooden step every 1/0.6 blocks, as
 *       vanilla spaces them; none crouched, like vanilla's sneak.
 * </ul>
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public final class ClientRiderSteps {

    /** Vanilla's walked-distance scale: {@code moveDist}/{@code walkDist} grow by 0.6 a block. */
    private static final float DIST_SCALE = 0.6F;
    /** Vanilla's step volume: the block sound's volume (1 for wood) × 0.15. */
    private static final float STEP_VOLUME = 0.15F;
    /** A step shorter than this doesn't turn the body (sliding along a wall, a creep's jitter). */
    private static final double TURN_MIN_STEP = 0.02;

    /** A rider's walked distance toward the next footstep, and (remote) their last feet. */
    private static final class Track {
        int wagonId = -1;
        Vector3d feet;
        float moveDist;
        float nextStep = 1.0F;
    }

    /** Remote walking riders by entity id. */
    private static final Map<Integer, Track> REMOTE = new HashMap<>();
    /** The local player's footsteps. */
    private static final Track LOCAL = new Track();
    /** The local player's view bob, kept here: {@code Player.rideTick} zeroes {@code bob} every tick. */
    private static float localBob;

    private ClientRiderSteps() {
    }

    /**
     * The local player stepped ({@code dx}, {@code dz}) along the floor of
     * {@code wagon} this tick (pose frame; from {@link ClientWalkInput},
     * after the entity tick).
     */
    static void localStep(LocalPlayer player, WagonEntity wagon, double dx, double dz, boolean crouched) {
        double dist = Math.hypot(dx, dz);
        if (dist > TURN_MIN_STEP) {
            faceMovement(player, dx, dz, wagon.getYRot());
        }
        animateLegs(player, dist);
        // the view bob, as Player.aiStep feeds it on the ground: toward the step
        // length (capped at 0.1), 0.4 of the way each tick; vanilla's own was
        // zeroed by rideTick this tick, so the old value is ours too
        player.oBob = localBob;
        localBob += (Math.min(0.1F, (float) dist) - localBob) * 0.4F;
        player.bob = localBob;
        player.walkDist += (float) dist * DIST_SCALE; // walkDistO was taken this tick (baseTick)
        footsteps(player, LOCAL, dist, crouched);
    }

    /** The local player no longer walks a car: their bob and step count start afresh next time. */
    static void resetLocal() {
        localBob = 0.0F;
        LOCAL.moveDist = 0.0F;
        LOCAL.nextStep = 1.0F;
    }

    /** Remote walking riders: read each one's step from their synced feet. */
    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) {
            REMOTE.clear();
            return;
        }
        Set<Integer> seen = new HashSet<>();
        for (AbstractClientPlayer player : mc.level.players()) {
            if (player == mc.player || !(player.getVehicle() instanceof WagonEntity wagon)
                    || !wagon.walkable() || wagon.isSeated(player)) {
                continue;
            }
            Vector3d feet = ClientWalk.on(player.getId(), wagon.getId());
            if (feet == null) {
                continue;
            }
            seen.add(player.getId());
            Track track = REMOTE.computeIfAbsent(player.getId(), id -> new Track());
            double dx = 0.0;
            double dz = 0.0;
            if (track.wagonId == wagon.getId() && track.feet != null) {
                dx = feet.x - track.feet.x;
                dz = feet.z - track.feet.z;
            }
            track.wagonId = wagon.getId();
            track.feet = new Vector3d(feet);
            double dist = Math.hypot(dx, dz);
            if (dist > TURN_MIN_STEP) {
                faceMovement(player, dx, dz, wagon.getYRot());
            }
            animateLegs(player, dist);
            footsteps(player, track, dist, player.isCrouching());
        }
        REMOTE.keySet().retainAll(seen);
    }

    /** The legs swing with the step, scaled like vanilla's {@code calculateEntityAnimation}. */
    private static void animateLegs(Player player, double dist) {
        player.walkAnimation.update(Math.min((float) dist * 4.0F, 1.0F), 0.4F);
    }

    /** A footstep each time the walked distance passes the next whole step (vanilla's spacing). */
    private static void footsteps(Player player, Track track, double dist, boolean crouched) {
        track.moveDist += (float) dist * DIST_SCALE;
        if (track.moveDist <= track.nextStep) {
            return;
        }
        track.nextStep = (int) track.moveDist + 1.0F;
        if (!crouched && !player.isSilent()) {
            player.level().playLocalSound(player.getX(), player.getY(), player.getZ(), SoundEvents.WOOD_STEP,
                    SoundSource.PLAYERS, STEP_VOLUME, 1.0F, false);
        }
    }

    /**
     * Ease the player's body toward the world-space direction of their floor
     * walk and keep the head within 50° of it — the same shape as vanilla's
     * {@code tickHeadTurn}/{@code getMaxHeadRotationRelativeToBody}, but fed the
     * local movement (which vanilla can't see, the rider being carried). The
     * world direction is the local step rotated out of the car's frame by its
     * yaw (the inverse of {@code RiderWalk}'s into-frame rotation).
     */
    static void faceMovement(Player player, double dx, double dz, float wagonYaw) {
        Vector3d worldDir = new Quaterniond()
                .rotateY(Math.toRadians(-wagonYaw))
                .transform(new Vector3d(dx, 0.0, dz));
        float targetYaw = PoseMath.yawDegrees(worldDir);
        float toward = Mth.wrapDegrees(targetYaw - player.yBodyRot);
        player.setYBodyRot(player.yBodyRot + toward * 0.5f);
        float headBody = Mth.wrapDegrees(player.getYRot() - player.yBodyRot);
        float max = 50.0f; // vanilla Player.getMaxHeadRotationRelativeToBody
        if (Math.abs(headBody) > max) {
            player.setYBodyRot(player.yBodyRot + (headBody - Math.signum(headBody) * max));
        }
    }
}
