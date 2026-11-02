package com.muzhik17.trainsmod.client.render.model;

import java.io.IOException;
import java.io.Reader;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import com.muzhik17.trainsmod.client.ClientRide;
import com.muzhik17.trainsmod.client.render.WagonRenderer;
import com.muzhik17.trainsmod.client.sound.PackSoundFiles;
import com.muzhik17.trainsmod.client.sound.TrainSounds;
import com.muzhik17.trainsmod.pack.PackOrigin;
import com.muzhik17.trainsmod.pack.PackProblem;
import com.muzhik17.trainsmod.pack.PackReport;
import com.muzhik17.trainsmod.pack.PackReportView;

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
 * {@link StockModels}. A malformed declaration is skipped — its type renders
 * as the placeholder box; what a declaration says that means nothing (an
 * unknown key) and the Ogg files it names that no pack has are reported too.
 * Every problem goes to the log and to {@link PackReport#CLIENT}
 * ({@code /rwatc packs}), replacing the previous reload's; the model files'
 * check ({@code /rwatc packs validate}) is dropped, its files may have
 * changed.
 *
 * <p>Applying swaps the registry and frees every baked buffer, so F3+T picks
 * up edited models and textures.
 */
public final class WagonModelReloadListener
        extends SimplePreparableReloadListener<WagonModelReloadListener.Prepared> {

    private static final FileToIdConverter DECLARATIONS = FileToIdConverter.json("wagon_models");

    /** A reload's declarations, where each came from, and what was wrong with them. */
    record Prepared(Map<String, WagonModelDecl> decls, Map<String, PackOrigin> origins,
            List<PackProblem> problems, Map<String, Integer> loaded) {
    }

    @Override
    protected Prepared prepare(ResourceManager resources, ProfilerFiller profiler) {
        Map<String, WagonModelDecl> decls = new HashMap<>();
        Map<String, PackOrigin> origins = new HashMap<>();
        List<PackProblem> problems = new ArrayList<>();
        Map<String, Integer> loaded = new TreeMap<>();
        for (Map.Entry<ResourceLocation, Resource> file
                : DECLARATIONS.listMatchingResources(resources).entrySet()) {
            ResourceLocation id = DECLARATIONS.fileToId(file.getKey());
            PackOrigin origin = new PackOrigin(file.getValue().sourcePackId(),
                    PackOrigin.file("assets", file.getKey().getNamespace(), file.getKey().getPath()));
            List<String> warnings = new ArrayList<>();
            WagonModelDecl decl;
            try (Reader reader = file.getValue().openAsReader()) {
                decl = WagonModelDecl.parse(id.getNamespace(), GsonHelper.parse(reader), warnings::add);
            } catch (IOException | RuntimeException e) {
                problems.add(origin.error("wagon model " + id + " not loaded: " + PackReportView.reason(e)));
                continue;
            }
            decls.put(id.toString(), decl);
            origins.put(id.toString(), origin);
            loaded.merge(origin.pack(), 1, Integer::sum);
            warnings.forEach(warning -> problems.add(origin.warning(warning)));
            // an Ogg file no pack has plays as silence (SPEC §10.3): name it here, by its declaration
            for (String ref : decl.sounds().files()) {
                ResourceLocation location = ResourceLocation.tryParse(ref);
                if (location == null) {
                    problems.add(origin.error("sound '" + ref + "' is not a valid resource location"));
                } else if (resources.getResource(location).isEmpty()) {
                    problems.add(origin.error("sound file " + ref + " not found"));
                }
            }
        }
        return new Prepared(decls, origins, problems, loaded);
    }

    @Override
    protected void apply(Prepared prepared, ResourceManager resources, ProfilerFiller profiler) {
        PackReportView.log(prepared.problems());
        StockModels.reset(prepared.decls(), prepared.origins());
        PackReport.CLIENT.replace(PackReport.Source.WAGON_MODELS, prepared.loaded(), prepared.problems());
        PackReport.CLIENT.clear(PackReport.Source.MODEL_FILES);
        ClientRide.typeSway(StockModels.sway()); // per-type rocking (SPEC §10.2)
        WagonRenderer.clearBaked();
        TrainSounds.clearAll(); // the packs' sounds may have changed (SPEC §10)
        // the sound engine opens only indexed files (SPEC §10.3); the sound manager re-indexed just before
        PackSoundFiles.register(resources,
                prepared.decls().values().stream().map(WagonModelDecl::sounds).toList());
    }
}
