package com.muzhik17.trainsmod.mixin;

import java.util.Map;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

import net.minecraft.client.sounds.SoundManager;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.resources.Resource;

/**
 * The sound manager's file index (SPEC §10.3, client only): the sound
 * engine opens Ogg files only through this map, which a resource reload
 * fills with {@code assets/<ns>/sounds/**.ogg} alone. A pack's train sounds
 * may sit anywhere in the pack ({@code stock/sounds/…} in MVP), so
 * {@code client.sound.PackSoundFiles} adds the declared ones after each
 * reload — without them every train sound failed to load, silently.
 */
@Mixin(SoundManager.class)
public interface SoundManagerFilesMixin {

    @Accessor("soundCache")
    Map<ResourceLocation, Resource> rwat$soundFiles();
}
