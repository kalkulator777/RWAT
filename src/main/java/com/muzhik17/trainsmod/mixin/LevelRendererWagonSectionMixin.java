package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import com.llamalad7.mixinextras.sugar.Local;
import com.muzhik17.trainsmod.client.render.WagonRenderer;
import com.muzhik17.trainsmod.consist.WagonEntity;

import net.minecraft.client.Camera;
import net.minecraft.client.renderer.LevelRenderer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.Entity;

/**
 * A car is drawn even where its centre's chunk section isn't built (SPEC
 * §2.4, client only). Vanilla draws an entity only if the render section at
 * its {@code blockPosition()} is compiled, and a section is compiled only
 * once it has been in view: riding a fast train at the rear end of a car,
 * looking back, the car's centre runs ahead into sections the player has
 * never looked at, and the car vanished round them (play-test, 2026-10-12).
 * For a car {@link WagonRenderer#testedSection} is asked too — none for the
 * train the player rides (always drawn, as vanilla always lets the vehicle
 * carrying the player past the frustum), the one at the car's point nearest
 * the camera for any other — and either section built draws the car, so it
 * never hides a car vanilla would draw. Other entities keep vanilla's.
 */
@Mixin(LevelRenderer.class)
public abstract class LevelRendererWagonSectionMixin {

    @WrapOperation(method = "renderLevel", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/client/renderer/LevelRenderer;isSectionCompiled(Lnet/minecraft/core/BlockPos;)Z"))
    private boolean rwat$wagonSection(LevelRenderer renderer, BlockPos pos, Operation<Boolean> original,
            @Local Entity entity, @Local(argsOnly = true) Camera camera) {
        if (entity instanceof WagonEntity wagon) {
            BlockPos tested = WagonRenderer.testedSection(wagon, camera.getPosition());
            return tested == null || original.call(renderer, tested) || original.call(renderer, pos);
        }
        return original.call(renderer, pos);
    }
}
