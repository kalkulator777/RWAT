package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import com.muzhik17.trainsmod.client.render.RailRenderer;

import net.minecraft.client.multiplayer.ClientLevel;

/**
 * The other half of the rail relight signal (see
 * {@link ClientChunkCacheLightMixin}): light that arrives from the server —
 * chunk loads, light-update packets, chunk unloads — is queued into the
 * light engine and flagged through this method, with the section and its
 * neighbours (vanilla re-meshes the same 3×3×3). A rail tile swept before its
 * chunk's light arrived picks the real value up from here.
 */
@Mixin(ClientLevel.class)
public abstract class ClientLevelSectionDirtyMixin {

    @Inject(method = "setSectionDirtyWithNeighbors", at = @At("HEAD"))
    private void rwat$relightRails(int sectionX, int sectionY, int sectionZ, CallbackInfo ci) {
        for (int dx = -1; dx <= 1; dx++) {
            for (int dy = -1; dy <= 1; dy++) {
                for (int dz = -1; dz <= 1; dz++) {
                    RailRenderer.onSectionLightChanged(sectionX + dx, sectionY + dy, sectionZ + dz);
                }
            }
        }
    }
}
