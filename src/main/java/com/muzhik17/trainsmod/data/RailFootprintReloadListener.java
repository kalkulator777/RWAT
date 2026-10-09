package com.muzhik17.trainsmod.data;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
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
 * {@code <ns>:<name>}) and the OBJ it names, by the client loader's rules
 * ({@code obj} without a namespace is in the declaring pack's,
 * {@code tile_length} defaults to 1). They come from the server's data packs:
 * RWAT content packs and mod jars are registered as both resource and data
 * packs (SPEC §6.2), so the server's pack list holds the very files the
 * client's does — only their {@code assets/} half, which a data reload
 * ignores, is read here through the packs directly. A style found in no
 * data pack (a client-only resource pack) lays the standard rail's bed —
 * the client's fallback for a style it lacks.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID)
public final class RailFootprintReloadListener
        extends SimplePreparableReloadListener<Map<String, TileFootprint>> {

    private static final String FOLDER = "rail_models";
    private static final String EXTENSION = ".json";

    @Override
    protected Map<String, TileFootprint> prepare(ResourceManager resources, ProfilerFiller profiler) {
        List<PackResources> packs = resources.listPacks().toList(); // lowest priority first
        // declaration file → contents, a higher-priority pack's file replacing a lower one's
        Map<ResourceLocation, IoSupplier<InputStream>> declarations = new LinkedHashMap<>();
        for (PackResources pack : packs) {
            try {
                for (String namespace : pack.getNamespaces(PackType.CLIENT_RESOURCES)) {
                    pack.listResources(PackType.CLIENT_RESOURCES, namespace, FOLDER, (file, contents) -> {
                        if (file.getPath().endsWith(EXTENSION)) {
                            declarations.put(file, contents);
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
        for (Map.Entry<ResourceLocation, IoSupplier<InputStream>> declaration : declarations.entrySet()) {
            ResourceLocation file = declaration.getKey();
            String path = file.getPath();
            ResourceLocation id = file.withPath(
                    path.substring(FOLDER.length() + 1, path.length() - EXTENSION.length()));
            try (Reader reader = new InputStreamReader(declaration.getValue().get(), StandardCharsets.UTF_8)) {
                TileFootprint footprint = load(id, GsonHelper.parse(reader), packs);
                if (footprint != null) {
                    footprints.put(id.toString(), footprint);
                }
            } catch (IOException | RuntimeException e) {
                RailsWheelsAndTrains.LOGGER.error("Skipping rail model {} for the track bed: {}",
                        id, e.getMessage());
            }
        }
        RailsWheelsAndTrains.LOGGER.info("{} rail style(s) known to the track bed", footprints.size());
        return footprints;
    }

    @Override
    protected void apply(Map<String, TileFootprint> footprints, ResourceManager resources,
            ProfilerFiller profiler) {
        RailFootprints.load(footprints);
    }

    /** One style's tile from its declaration; null (logged) if it names no readable OBJ. */
    private static TileFootprint load(ResourceLocation id, JsonObject json, List<PackResources> packs)
            throws IOException {
        String objPath = GsonHelper.getAsString(json, "obj");
        ResourceLocation objLocation = ResourceLocation.tryParse(
                objPath.contains(":") ? objPath : id.getNamespace() + ":" + objPath);
        if (objLocation == null) {
            RailsWheelsAndTrains.LOGGER.error("{}: invalid rail model path {}", id, objPath);
            return null;
        }
        double tileLength = GsonHelper.getAsDouble(json, "tile_length", 1.0);
        if (!(tileLength > 0.0)) {
            RailsWheelsAndTrains.LOGGER.error("{}: tile_length must be positive", id);
            return null;
        }
        IoSupplier<InputStream> obj = topmost(packs, objLocation);
        if (obj == null) {
            RailsWheelsAndTrains.LOGGER.error("{}: rail model {} not found", id, objLocation);
            return null;
        }
        try (InputStream in = obj.get()) {
            return TileFootprint.fromObj(in, tileLength);
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
