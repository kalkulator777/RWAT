package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import com.muzhik17.trainsmod.consist.WagonEntity;

import net.minecraft.world.entity.player.Player;

/**
 * Sneaking on a walkable car's floor is crouching, not getting off (SPEC
 * v1.5-б). Vanilla reads a held Shift as "wants to stop riding": the server's
 * {@code Player.rideTick} then tries to dismount — {@code ConsistEvents}
 * refuses it for a walking rider — and <b>clears the sneak flag</b>, every
 * tick, so the server's pose stayed standing and nobody else ever saw the
 * rider crouch (NeoForge's client {@code rideTick} drops the key the same
 * way). A walkable car's riders don't want off by Shift: they walk out of a
 * door, or Shift stands them up from a driver's chair. A cab without a
 * walkable floor (the vanilla seat) keeps vanilla's Shift-to-get-off.
 * Common: both sides read it.
 */
@Mixin(Player.class)
public abstract class PlayerWagonSneakMixin {

    @Inject(method = "wantsToStopRiding", at = @At("HEAD"), cancellable = true)
    private void rwat$sneakStaysAboard(CallbackInfoReturnable<Boolean> cir) {
        if (((Player) (Object) this).getVehicle() instanceof WagonEntity wagon && wagon.walkable()) {
            cir.setReturnValue(false);
        }
    }
}
