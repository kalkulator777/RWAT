package com.muzhik17.trainsmod.client.render.model;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.sound.SoundSet;
import com.muzhik17.trainsmod.pack.ModelCheck;
import com.muzhik17.trainsmod.pack.PackOrigin;
import com.muzhik17.trainsmod.pack.PackProblem;

import net.minecraft.Util;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.resources.ResourceManager;

/**
 * Client-side stock model registry (SPEC §6.6): wagon type id → its
 * {@link StockModel}, as declared by the content packs'
 * {@code assets/<ns>/wagon_models/} ({@link WagonModelReloadListener} hands
 * the declarations over on every resource reload).
 *
 * <p>Models load <b>lazily</b>, on the first frame a type is on screen, in a
 * background thread: the packs' OBJs add up to tens of megabytes of text, and
 * parsing every one at startup would cost seconds of loading and hundreds of
 * megabytes of heap for stock the player may never see. Until a model is
 * ready the wagon isn't drawn (a fraction of a second, once per type).
 * {@link #checkFiles} reads every declared model's files at once, on
 * demand ({@code /rwatc packs validate}), so a pack author needn't drive
 * past every wagon to find a broken one.
 */
public final class StockModels {

    /**
     * One resource-reload generation: the declarations and the models loaded
     * against them. Replaced wholesale on reload, so a load still in flight
     * from the old generation completes into a map nobody reads any more.
     */
    private record Generation(Map<String, WagonModelDecl> decls, Map<String, PackOrigin> origins,
            Map<String, CompletableFuture<StockModel>> models) {
    }

    /**
     * What {@link #checkFiles} found.
     *
     * @param checked  pack → models whose files were checked
     * @param problems what is wrong with them
     */
    public record FileCheck(Map<String, Integer> checked, List<PackProblem> problems) {
    }

    private static volatile Generation current =
            new Generation(Map.of(), Map.of(), new ConcurrentHashMap<>());

    private StockModels() {
    }

    /**
     * Model for a wagon type id: null while it is still loading (draw nothing
     * this frame), {@link StockModel#empty()} if no pack declares one or it
     * failed to load (draw the placeholder box). Never blocks.
     */
    public static StockModel model(String typeId) {
        Generation generation = current;
        CompletableFuture<StockModel> loading = generation.models.get(typeId);
        if (loading == null) {
            WagonModelDecl decl = generation.decls.get(typeId);
            if (decl == null) {
                return StockModel.empty();
            }
            loading = generation.models.computeIfAbsent(typeId, id -> load(id, decl));
        }
        return loading.getNow(null);
    }

    /** The liveries a pack declares for a wagon type's model, sorted; empty if none (or no model). */
    public static List<String> liveries(String typeId) {
        WagonModelDecl decl = current.decls.get(typeId);
        return decl == null ? List.of() : decl.liveries().keySet().stream().sorted().toList();
    }

    /** The sounds a pack declares for a wagon type (SPEC §10); {@link SoundSet#NONE} if none. */
    public static SoundSet sounds(String typeId) {
        WagonModelDecl decl = current.decls.get(typeId);
        return decl == null ? SoundSet.NONE : decl.sounds();
    }

    /** How hard each declared type's body rocks (SPEC §10.2): type id → factor, the types not at 1. */
    public static Map<String, Double> sway() {
        Map<String, Double> sway = new HashMap<>();
        current.decls.forEach((typeId, decl) -> {
            if (decl.sway() != 1.0) {
                sway.put(typeId, decl.sway());
            }
        });
        return sway;
    }

    /**
     * Where each declared model came from: type id → its pack and file. A new
     * map on every reload, so its identity tells a reload happened.
     */
    public static Map<String, PackOrigin> origins() {
        return current.origins;
    }

    /** How many models the packs declare. */
    public static int declared() {
        return current.decls.size();
    }

    /**
     * Swap in a reload's declarations; models load again on demand from the
     * reloaded packs (render thread — callers also drop the baked buffers).
     *
     * @param origins type id → the pack and file that declared its model
     */
    static void reset(Map<String, WagonModelDecl> decls, Map<String, PackOrigin> origins) {
        // a fresh map even when empty (Map.copyOf would hand back the same empty one): origins() identity
        current = new Generation(Map.copyOf(decls), Collections.unmodifiableMap(new HashMap<>(origins)),
                new ConcurrentHashMap<>());
        RailsWheelsAndTrains.LOGGER.info("{} stock model(s) declared by packs", decls.size());
    }

    /**
     * Load every declared model now, bypassing the lazy loading — in the
     * background, one model at a time, nothing kept: its files checked
     * ({@link ModelCheck}) and, if they pass, the model built as the
     * renderer would build it, so whatever passes here loads in game.
     * Completes with null if the packs reloaded meanwhile (the check was of
     * files no longer declared).
     */
    public static CompletableFuture<FileCheck> checkFiles() {
        Generation generation = current;
        ResourceManager resources = Minecraft.getInstance().getResourceManager();
        IrStockModel.ResourceAccess access = access(resources);
        ModelCheck.Files files = new ModelCheck.Files() {
            @Override
            public boolean valid(String location) {
                return ResourceLocation.tryParse(location) != null;
            }

            @Override
            public boolean exists(String location) {
                ResourceLocation parsed = ResourceLocation.tryParse(location);
                return parsed != null && resources.getResource(parsed).isPresent();
            }

            @Override
            public InputStream open(String location) throws IOException {
                return resources.open(ResourceLocation.parse(location));
            }
        };
        return CompletableFuture.supplyAsync(() -> {
            Map<String, Integer> checked = new TreeMap<>();
            List<PackProblem> problems = new ArrayList<>();
            new TreeMap<>(generation.decls).forEach((typeId, decl) -> {
                PackOrigin origin = generation.origins.getOrDefault(typeId,
                        new PackOrigin("?", "wagon_models/" + typeId));
                List<PackProblem> found = ModelCheck.check(decl, origin, files);
                problems.addAll(found);
                if (found.stream().noneMatch(PackProblem::isError)) {
                    try {
                        IrStockModel.load(typeId, decl, access);
                    } catch (RuntimeException e) {
                        problems.add(origin.error("model " + decl.obj() + " fails to build: " + e));
                    }
                }
                checked.merge(origin.pack(), 1, Integer::sum);
            });
            return current == generation ? new FileCheck(checked, problems) : null;
        }, Util.backgroundExecutor());
    }

    private static CompletableFuture<StockModel> load(String typeId, WagonModelDecl decl) {
        IrStockModel.ResourceAccess access = access(Minecraft.getInstance().getResourceManager());
        return CompletableFuture
                .supplyAsync(() -> IrStockModel.load(typeId, decl, access), Util.backgroundExecutor())
                .exceptionally(e -> {
                    // a broken asset must not take the render thread down with it
                    RailsWheelsAndTrains.LOGGER.error("Failed to load the model of " + typeId, e);
                    return StockModel.empty();
                });
    }

    /** The pack files as the model loader reads them. */
    private static IrStockModel.ResourceAccess access(ResourceManager resources) {
        return new IrStockModel.ResourceAccess() {
            @Override
            public InputStream open(ResourceLocation location) throws IOException {
                return resources.open(location);
            }

            @Override
            public boolean exists(ResourceLocation location) {
                return resources.getResource(location).isPresent();
            }
        };
    }
}
