package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import com.muzhik17.trainsmod.client.ClientDriveInput;

import net.minecraft.client.KeyMapping;

/**
 * The driving keys (SPEC §9.7) sit on W, S, A, D and Space beside walking,
 * in a context that clashes only with itself. NeoForge's {@code same} still
 * ends with "same key, same mapping" whatever the contexts, so the Controls
 * screen marked both walking and driving red; for a driving key and a
 * mapping whose context doesn't conflict with it this answers "not the
 * same". Every other pair keeps NeoForge's answer.
 */
@Mixin(KeyMapping.class)
public abstract class KeyMappingDrivingMixin {

    @Inject(method = "same", at = @At("HEAD"), cancellable = true)
    private void rwat$drivingApart(KeyMapping other, CallbackInfoReturnable<Boolean> cir) {
        if (ClientDriveInput.apart((KeyMapping) (Object) this, other)) {
            cir.setReturnValue(false);
        }
    }
}
