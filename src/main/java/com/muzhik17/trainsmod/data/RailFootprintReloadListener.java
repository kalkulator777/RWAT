package com.muzhik17.trainsmod.data;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.pack.PackOrigin;
import com.muzhik17.trainsmod.pack.PackProblem;
import com.muzhik17.trainsmod.pack.PackReport;
import com.muzhik17.trainsmod.pack.PackReportView;
import com.muzhik17.trainsmod.pack.RailStyleDecl;
import com.muzhik17.trainsmod.path.TileFootprint;
import com.muzhik17.trainsmod.rail.RailFootprints;

import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.PackResources;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.resources.IoSupplier;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.server.packs.resources.SimplePreparableReloadListener;
import net.minecraft.util.GsonHelper;
import net.minecraft.util.profiling.ProfilerFiller;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.AddReloadListenerEvent;

/**
 * Loads the rail styles' tiles for the track bed (SPEC §2.2, §6.10) into
 * {@link RailFootprints}. The bed must cover exactly what the client draws, so
 * the server reads the client's own files: every
 * {@code assets/<ns>/rail_models/<name>.json} declaration (style
 * {@code <ns>:<name>}) and the OBJ it names, read by {@link RailStyleDecl}
 * — the very reading the client draws by. They come from the server's data
 * packs: RWAT content packs and mod jars are registered as both resource and
 * data packs (SPEC §6.2), so the server's pack list holds the very files the
 * client's does — only their {@code assets/} half, which a data reload
 * ignores, is read here through the packs directly. A style found in no
 * data pack (a client-only resource pack), or one whose declaration or OBJ
 * fails, lays the standard rail's bed — the client's fallback for a style
 * it lacks. What fails goes to the log and to {@link PackReport#SERVER}.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID)
public final class RailFootprintReloadListener
        extends SimplePreparableReloadListener<RailFootprintReloadListener.Prepared> {

    private static final String FOLDER = "rail_models";
    private static final String EXTENSION = ".json";

    /** A reload's tiles and what was wrong with the declarations. */
    record Prepared(Map<String, TileFootprint> footprints, List<PackProblem> problems,
            Map<String, Integer> loaded) {
    }

    /** A declaration file's contents and the pack it came from. */
    private record Declared(IoSupplier<InputStream> contents, String pack) {
    }

    @Override
    protected Prepared prepare(ResourceManager resources, ProfilerFiller profiler) {
        List<PackResources> packs = resources.listPacks().toList(); // lowest priority first
        // declaration file → contents, a higher-priority pack's file replacing a lower one's
        Map<ResourceLocation, Declared> declarations = new LinkedHashMap<>();
        for (PackResources pack : packs) {
            try {
                for (String namespace : pack.getNamespaces(PackType.CLIENT_RESOURCES)) {
                    pack.listResources(PackType.CLIENT_RESOURCES, namespace, FOLDER, (file, contents) -> {
                        if (file.getPath().endsWith(EXTENSION)) {
                            declarations.put(file, new Declared(contents, pack.packId()));
                        }
                    });
                }
            } catch (RuntimeException e) {
                // a pack that can't list its assets half just lays no styles — never fail the reload
                RailsWheelsAndTrains.LOGGER.warn("Can't list rail models of pack {}: {}",
                        pack.packId(), e.toString());
            }
        }
        Map<String, TileFootprint> footprints = new HashMap<>();
        List<PackProblem> problems = new ArrayList<>();
        Map<String, Integer> loaded = new TreeMap<>();
        for (Map.Entry<ResourceLocation, Declared> declaration : declarations.entrySet()) {
            ResourceLocation file = declaration.getKey();
            String path = file.getPath();
            ResourceLocation id = file.withPath(
                    path.substring(FOLDER.length() + 1, path.length() - EXTENSION.length()));
            PackOrigin origin = new PackOrigin(declaration.getValue().pack(),
                    PackOrigin.file("assets", file.getNamespace(), path));
            List<String> warnings = new ArrayList<>();
            try (Reader reader = new InputStreamReader(declaration.getValue().contents().get(),
                    StandardCharsets.UTF_8)) {
                RailStyleDecl decl = RailStyleDecl.parse(id.getNamespace(), GsonHelper.parse(reader), warnings::add);
                footprints.put(id.toString(), load(decl, packs));
                loaded.merge(origin.pack(), 1, Integer::sum);
            } catch (IOException | RuntimeException e) {
                problems.add(origin.error("rail style " + id + " lays the standard rail's bed: " + PackReportView.reason(e)));
            }
            warnings.forEach(warning -> problems.add(origin.warning(warning)));
        }
        RailsWheelsAndTrains.LOGGER.info("{} rail style(s) known to the track bed", footprints.size());
        return new Prepared(footprints, problems, loaded);
    }

    @Override
    protected void apply(Prepared prepared, ResourceManager resources, ProfilerFiller profiler) {
        PackReportView.log(prepared.problems());
        RailFootprints.load(prepared.footprints());
        PackReport.SERVER.replace(PackReport.Source.TRACK_BEDS, prepared.loaded(), prepared.problems());
    }

    /**
     * One style's tile from its declaration.
     *
     * @throws IOException      if the OBJ can't be read
     * @throws RuntimeException if its path is invalid or no data pack has it
     */
    private static TileFootprint load(RailStyleDecl decl, List<PackResources> packs) throws IOException {
        ResourceLocation objLocation = ResourceLocation.tryParse(decl.obj());
        if (objLocation == null) {
            throw new IllegalArgumentException("'obj' = '" + decl.obj() + "' is not a valid resource location");
        }
        IoSupplier<InputStream> obj = topmost(packs, objLocation);
        if (obj == null) {
            throw new IllegalArgumentException("rail model " + objLocation + " not found");
        }
        try (InputStream in = obj.get()) {
            return TileFootprint.fromObj(in, decl.tileLength());
        }
    }

    /** A client resource from the highest-priority pack that has it, or null. */
    private static IoSupplier<InputStream> topmost(List<PackResources> packs, ResourceLocation location) {
        for (int i = packs.size() - 1; i >= 0; i--) {
            IoSupplier<InputStream> found = packs.get(i).getResource(PackType.CLIENT_RESOURCES, location);
            if (found != null) {
                return found;
            }
        }
        return null;
    }

    @SubscribeEvent
    static void onAddReloadListeners(AddReloadListenerEvent event) {
        event.addListener(new RailFootprintReloadListener());
    }
}
