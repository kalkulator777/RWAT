package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import com.muzhik17.trainsmod.consist.WagonEntity;

import net.minecraft.server.level.ServerEntity;
import net.minecraft.server.network.ServerGamePacketListenerImpl;

/**
 * No dismount teleport for a rider who has gone on into another car (SPEC
 * §9.5). When a player leaves an entity's passenger list, the entity's
 * tracker ({@code ServerEntity.sendChanges}, in a lambda) teleports them to
 * where the server put them — right for getting off onto the ground, where
 * the client then walks on its own. A gangway takes the rider off one wagon
 * and onto the next in the same tick: they ride again, the next car places
 * them, and the teleport only snapped the view (the server's position a tick
 * or two ahead of the client's train, the look a tick old).
 */
@Mixin(ServerEntity.class)
public abstract class ServerEntityPassengerMixin {

    @WrapOperation(method = "lambda$sendChanges$0",
            at = @At(value = "INVOKE",
                    target = "Lnet/minecraft/server/network/ServerGamePacketListenerImpl;teleport(DDDFF)V"))
    private static void rwat$keepCarriedRider(ServerGamePacketListenerImpl connection, double x, double y,
            double z, float yRot, float xRot, Operation<Void> original) {
        if (connection.player.getVehicle() instanceof WagonEntity) {
            return; // carried on into the next car: it places them
        }
        original.call(connection, x, y, z, yRot, xRot);
    }
}
