package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import com.llamalad7.mixinextras.sugar.Local;
import com.muzhik17.trainsmod.consist.WagonEntity;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.entity.Entity;

/**
 * No mount teleport for a rider a gangway carries on into the next car
 * (SPEC §9.5). Vanilla's {@code ServerPlayer.startRiding} sends the player
 * their position and look as the server has them; on a moving train that is
 * a tick or two ahead of the client's interpolated car, and the look a tick
 * old — the client snapped there and back, with no frame interpolation for
 * that tick ({@code xo = x}). The rider's client places itself on the car
 * ({@code RiderPlacePayload}); every other mount keeps vanilla's teleport.
 */
@Mixin(ServerPlayer.class)
public abstract class ServerPlayerMountMixin {

    @WrapOperation(method = "startRiding(Lnet/minecraft/world/entity/Entity;Z)Z",
            at = @At(value = "INVOKE",
                    target = "Lnet/minecraft/server/network/ServerGamePacketListenerImpl;teleport(DDDFF)V"))
    private void rwat$quietGangway(ServerGamePacketListenerImpl connection, double x, double y, double z,
            float yRot, float xRot, Operation<Void> original, @Local(argsOnly = true) Entity vehicle) {
        if (vehicle instanceof WagonEntity wagon && wagon.carryingOn()) {
            return;
        }
        original.call(connection, x, y, z, yRot, xRot);
    }
}
