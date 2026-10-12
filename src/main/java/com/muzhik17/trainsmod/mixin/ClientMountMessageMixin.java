package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import com.llamalad7.mixinextras.sugar.Local;
import com.muzhik17.trainsmod.consist.WagonEntity;

import net.minecraft.client.GameNarrator;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;

/**
 * No "Press Shift to dismount" on a walkable car (SPEC v1.5-б, client only).
 * Vanilla shows it whenever the local player becomes a passenger; on a car
 * whose floor is walked Shift crouches and never gets you off — you walk out
 * of a door — and the line also covered the mod's own boarding hint (sent
 * just before) and came up at every gangway into the next car (SPEC §9.5).
 * Other vehicles, and a cab's vanilla seat, keep it.
 */
@Mixin(ClientPacketListener.class)
public abstract class ClientMountMessageMixin {

    @WrapOperation(method = "handleSetEntityPassengersPacket",
            at = @At(value = "INVOKE",
                    target = "Lnet/minecraft/client/gui/Gui;setOverlayMessage(Lnet/minecraft/network/chat/Component;Z)V"))
    private void rwat$noShiftHint(Gui gui, Component message, boolean animate, Operation<Void> original,
            @Local(ordinal = 0) Entity vehicle) {
        if (!(vehicle instanceof WagonEntity wagon && wagon.walkable())) {
            original.call(gui, message, animate);
        }
    }

    @WrapOperation(method = "handleSetEntityPassengersPacket",
            at = @At(value = "INVOKE",
                    target = "Lnet/minecraft/client/GameNarrator;sayNow(Lnet/minecraft/network/chat/Component;)V"))
    private void rwat$noShiftNarration(GameNarrator narrator, Component message, Operation<Void> original,
            @Local(ordinal = 0) Entity vehicle) {
        if (!(vehicle instanceof WagonEntity wagon && wagon.walkable())) {
            original.call(narrator, message);
        }
    }
}
