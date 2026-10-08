package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import com.muzhik17.trainsmod.client.render.RailRenderer;

import net.minecraft.client.multiplayer.ClientChunkCache;
import net.minecraft.core.SectionPos;
import net.minecraft.world.level.LightLayer;

/**
 * Feeds client light changes to the rail renderer (SPEC §2.4, client only).
 * The rails bake world light into their vertices; this is the same signal
 * vanilla uses to re-mesh a chunk section: the client light engine reports
 * every section whose light changed (a torch placed, a block opening the
 * sky) from {@code runLightUpdates}, which runs inside {@code renderLevel}
 * before the rails draw — so the change shows in the same frame, instead of
 * waiting for a polling pass.
 */
@Mixin(ClientChunkCache.class)
public abstract class ClientChunkCacheLightMixin {

    @Inject(method = "onLightUpdate", at = @At("HEAD"))
    private void rwat$relightRails(LightLayer type, SectionPos pos, CallbackInfo ci) {
        RailRenderer.onSectionLightChanged(pos.x(), pos.y(), pos.z());
    }
}
