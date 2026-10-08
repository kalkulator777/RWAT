package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import com.llamalad7.mixinextras.sugar.Local;
import com.muzhik17.trainsmod.consist.WagonEntity;

import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;

/**
 * Sitting is decided per passenger in a wagon (SPEC §9, client only): in a
 * walkable cab the player in the driver's chair sits while everyone else on
 * board stands. Vanilla asks the vehicle alone ({@code shouldRiderSit()},
 * a NeoForge method without the passenger); this asks the wagon about the
 * entity being drawn. Other vehicles keep vanilla's answer.
 */
@Mixin(LivingEntityRenderer.class)
public abstract class LivingEntityRendererSeatMixin {

    @WrapOperation(
            method = "render(Lnet/minecraft/world/entity/LivingEntity;FFLcom/mojang/blaze3d/vertex/PoseStack;Lnet/minecraft/client/renderer/MultiBufferSource;I)V",
            at = @At(value = "INVOKE",
                    target = "Lnet/minecraft/world/entity/Entity;shouldRiderSit()Z"))
    private boolean rwat$sitPerPassenger(Entity vehicle, Operation<Boolean> original,
            @Local(argsOnly = true) LivingEntity entity) {
        if (vehicle instanceof WagonEntity wagon) {
            return wagon.shouldRiderSit(entity);
        }
        return original.call(vehicle);
    }
}
