package com.muzhik17.trainsmod.client.render.model;

import java.io.IOException;
import java.io.Reader;
import java.util.HashMap;
import java.util.Map;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.render.WagonRenderer;
import com.muzhik17.trainsmod.client.sound.PackSoundFiles;
import com.muzhik17.trainsmod.client.sound.TrainSounds;

import net.minecraft.resources.FileToIdConverter;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.server.packs.resources.SimplePreparableReloadListener;
import net.minecraft.util.GsonHelper;
import net.minecraft.util.profiling.ProfilerFiller;

/**
 * Reads the client half of the content packs (SPEC §6.3/§6.6): every
 * {@code assets/<ns>/wagon_models/<name>.json} declares the model of wagon
 * type {@code <ns>:<name>}. Only the small declarations are read here (off
 * thread, with the rest of the resource reload); the OBJs load lazily in
 * {@link StockModels}. A malformed declaration is logged and skipped — its
 * type renders as the placeholder box.
 *
 * <p>Applying swaps the registry and frees every baked buffer, so F3+T picks
 * up edited models and textures.
 */
public final class WagonModelReloadListener
        extends SimplePreparableReloadListener<Map<String, WagonModelDecl>> {

    private static final FileToIdConverter DECLARATIONS = FileToIdConverter.json("wagon_models");

    @Override
    protected Map<String, WagonModelDecl> prepare(ResourceManager resources, ProfilerFiller profiler) {
        Map<String, WagonModelDecl> decls = new HashMap<>();
        for (Map.Entry<ResourceLocation, Resource> file
                : DECLARATIONS.listMatchingResources(resources).entrySet()) {
            ResourceLocation id = DECLARATIONS.fileToId(file.getKey());
            try (Reader reader = file.getValue().openAsReader()) {
                decls.put(id.toString(), WagonModelDecl.parse(id.getNamespace(), GsonHelper.parse(reader)));
            } catch (IOException | RuntimeException e) {
                RailsWheelsAndTrains.LOGGER.error("Skipping bad wagon model {}: {}", id, e.getMessage());
            }
        }
        return decls;
    }

    @Override
    protected void apply(Map<String, WagonModelDecl> decls, ResourceManager resources,
            ProfilerFiller profiler) {
        StockModels.reset(decls);
        WagonRenderer.clearBaked();
        TrainSounds.clearAll(); // the packs' sounds may have changed (SPEC §10)
        // the sound engine opens only indexed files (SPEC §10.3); the sound manager re-indexed just before
        PackSoundFiles.register(resources, decls.values().stream().map(WagonModelDecl::sounds).toList());
    }
}
