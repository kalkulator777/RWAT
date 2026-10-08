package com.muzhik17.trainsmod.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import com.muzhik17.trainsmod.client.render.CabinLight;
import com.muzhik17.trainsmod.consist.WagonEntity;

import net.minecraft.client.renderer.LightTexture;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.world.entity.Entity;

/**
 * Riders of a wagon take the light of its cabin lamps (SPEC §8, client only):
 * the block light an entity is drawn with becomes at least what the lit lamps
 * give at its chest. The first-person hand reads the same method (through
 * {@code EntityRenderDispatcher.getPackedLightCoords}), so it is lit too.
 */
@Mixin(EntityRenderer.class)
public abstract class EntityRendererCabinLightMixin {

    @Inject(method = "getPackedLightCoords", at = @At("RETURN"), cancellable = true)
    private void rwat$cabinLight(Entity entity, float partialTick, CallbackInfoReturnable<Integer> cir) {
        if (entity.getVehicle() instanceof WagonEntity wagon) {
            int lamp = CabinLight.levelAt(wagon, entity, partialTick);
            int packed = cir.getReturnValueI();
            if (lamp > LightTexture.block(packed)) {
                cir.setReturnValue(LightTexture.pack(lamp, LightTexture.sky(packed)));
            }
        }
    }
}
