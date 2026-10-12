package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import com.muzhik17.trainsmod.consist.WagonEntity;

import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;

/**
 * Suppresses vanilla's per-tick walk-animation update for a wagon-bound walking
 * rider (SPEC v1.5-б, client only). Such a rider's legs are driven from the
 * <b>local floor step</b> by {@code ClientRiderSteps} — the local player's from
 * its prediction, everyone else's from the synced feet (the train carries them
 * in world space, so vanilla's world-delta is a near-zero, jittery air-control
 * drift, and for an observed rider zero: nothing moved their legs, they
 * glided). Without this, {@code walkAnimation.update} runs twice a tick — vanilla
 * here and ours in {@code ClientTickEvent.Post} — and each call advances the
 * animation phase ({@code position += speed}); the render only interpolates the
 * last advance, so the surplus shows as a once-per-tick phase stutter. Cancelling
 * vanilla's call leaves ours as the single, smooth driver.
 *
 * <p>Scope is the boardable wagon ({@code !shouldRiderSit()}); the seated cab
 * driver and every other entity keep vanilla's animation untouched.
 */
@Mixin(LivingEntity.class)
public abstract class LivingEntityWalkAnimationMixin {

    @Inject(method = "updateWalkAnimation", at = @At("HEAD"), cancellable = true)
    private void rwat$skipWalkAnimationForRider(float partialTick, CallbackInfo ci) {
        if ((Object) this instanceof Player player
                && player.getVehicle() instanceof WagonEntity wagon
                && !wagon.shouldRiderSit()) {
            ci.cancel();
        }
    }
}
