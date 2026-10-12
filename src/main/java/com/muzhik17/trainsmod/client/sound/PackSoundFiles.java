package com.muzhik17.trainsmod.client.sound;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.mixin.SoundManagerFilesMixin;

import net.minecraft.client.Minecraft;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.server.packs.resources.ResourceManager;

/**
 * Lets the sound engine open the packs' train sounds (SPEC §10.3). It reads
 * Ogg files only through the sound manager's file index, which a resource
 * reload fills with {@code assets/<ns>/sounds/**.ogg} alone; a declaration
 * may name a file anywhere in its pack ({@code stock/sounds/…} in MVP). Such
 * a file played without an entry fails to load without a word in the log —
 * every train was silent. So after each reload the files the declarations
 * name are added to the index. Run from the wagon model reload, which
 * applies after the sound manager's (mod listeners follow vanilla's, and
 * each listener applies after the one before).
 */
public final class PackSoundFiles {

    private PackSoundFiles() {
    }

    /** Index every file the declared sound sets name; a file no pack has is logged. */
    public static void register(ResourceManager resources, Collection<SoundSet> sets) {
        Map<ResourceLocation, Resource> index =
                ((SoundManagerFilesMixin) Minecraft.getInstance().getSoundManager()).rwat$soundFiles();
        int added = 0;
        List<String> missing = new ArrayList<>();
        for (SoundSet set : sets) {
            for (String ref : set.files()) {
                ResourceLocation location = ResourceLocation.tryParse(ref);
                if (location == null || index.containsKey(location)) {
                    continue;
                }
                Optional<Resource> file = resources.getResource(location);
                if (file.isPresent()) {
                    index.put(location, file.get());
                    added++;
                } else if (!missing.contains(ref)) {
                    missing.add(ref);
                }
            }
        }
        RailsWheelsAndTrains.LOGGER.info("{} train sound file(s) from packs", added);
        if (!missing.isEmpty()) {
            RailsWheelsAndTrains.LOGGER.warn("Train sound files missing from the packs: {}", missing);
        }
    }
}
