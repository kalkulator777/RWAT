package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import com.muzhik17.trainsmod.consist.WagonEntity;

import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.Pose;

/**
 * The local player crouches on a car's floor (SPEC v1.5-б, client only).
 * {@code LocalPlayer} answers {@code isCrouching} from its own flag, which
 * {@code aiStep} never sets for a passenger — so Shift lowered the camera
 * (the pose is {@code CROUCHING}: the eye height follows the pose) while the
 * body in the third-person view stood straight. A walking rider crouches by
 * the pose, as every other player is drawn ({@code Entity.isCrouching}); a
 * seated driver doesn't (Shift stands them up).
 */
@Mixin(LocalPlayer.class)
public abstract class LocalPlayerCrouchMixin {

    @Inject(method = "isCrouching", at = @At("HEAD"), cancellable = true)
    private void rwat$crouchOnTheFloor(CallbackInfoReturnable<Boolean> cir) {
        LocalPlayer self = (LocalPlayer) (Object) this;
        if (self.getVehicle() instanceof WagonEntity wagon && wagon.walkable() && !wagon.isSeated(self)) {
            cir.setReturnValue(self.hasPose(Pose.CROUCHING));
        }
    }
}
