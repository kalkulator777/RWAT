package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import com.muzhik17.trainsmod.consist.WagonEntity;

import net.minecraft.client.player.LocalPlayer;
import net.minecraft.util.Mth;

/**
 * Aboard a wagon the view is the look, not the head (SPEC §9.2, client only).
 * For a passenger, vanilla's {@code LocalPlayer.getViewYRot} — the camera and
 * the crosshair ray — answers {@code LivingEntity}'s: the <b>head's</b> yaw,
 * copied from the look once a tick. A seated driver's drawn head stops 75°
 * off the desk ({@code WagonEntity.seatPose}), so the camera stopped there
 * too, and as the look went on past straight back the head flicked to the
 * other shoulder and the view spun (play-test 2026-10-14). Here the view is
 * {@code yRot}, lerped per frame like the vanilla entity's: the mouse turns
 * it at once ({@code Entity.turn} moves {@code yRotO} too), the car's own turn
 * is carried smoothly ({@code ClientWalkInput}), and only the drawn head stops.
 */
@Mixin(LocalPlayer.class)
public abstract class LocalPlayerWagonViewMixin {

    @Inject(method = "getViewYRot", at = @At("HEAD"), cancellable = true)
    private void rwat$viewIsTheLook(float partialTick, CallbackInfoReturnable<Float> cir) {
        LocalPlayer self = (LocalPlayer) (Object) this;
        if (self.getVehicle() instanceof WagonEntity) {
            cir.setReturnValue(partialTick == 1.0F ? self.getYRot() : Mth.lerp(partialTick, self.yRotO, self.getYRot()));
        }
    }
}
