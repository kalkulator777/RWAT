package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import com.muzhik17.trainsmod.consist.ConsistEvents;

import net.minecraft.server.level.ServerPlayer;

/**
 * A teleport lets a wagon's rider off first (SPEC v1.5-б). Vanilla's {@code
 * ServerPlayer.teleportTo} starts with {@code stopRiding}, which the dismount
 * guard ({@code ConsistEvents.onMount}) refuses a walking rider: the car
 * pulled them straight back — {@code /tp}, a mod's homes or waystones, which
 * announce nothing ({@code EntityTeleportEvent}) — or, into another dimension,
 * kept them as its passenger. Every teleport through vanilla's two {@code
 * teleportTo(ServerLevel, …)} gets them off by a sanctioned exit here. A pearl
 * or a chorus fruit used aboard moves the player another way: they stay.
 */
@Mixin(ServerPlayer.class)
public abstract class ServerPlayerTeleportMixin {

    @Inject(method = "teleportTo(Lnet/minecraft/server/level/ServerLevel;DDDLjava/util/Set;FF)Z",
            at = @At("HEAD"))
    private void rwat$offBeforeRelativeTeleport(CallbackInfoReturnable<Boolean> cir) {
        ConsistEvents.letOff((ServerPlayer) (Object) this);
    }

    @Inject(method = "teleportTo(Lnet/minecraft/server/level/ServerLevel;DDDFF)V", at = @At("HEAD"))
    private void rwat$offBeforeTeleport(CallbackInfo ci) {
        ConsistEvents.letOff((ServerPlayer) (Object) this);
    }
}
