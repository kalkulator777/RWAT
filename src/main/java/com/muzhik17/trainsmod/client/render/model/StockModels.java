package com.muzhik17.trainsmod.client.render.model;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.client.sound.SoundSet;

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
 */
public final class StockModels {

    /**
     * One resource-reload generation: the declarations and the models loaded
     * against them. Replaced wholesale on reload, so a load still in flight
     * from the old generation completes into a map nobody reads any more.
     */
    private record Generation(Map<String, WagonModelDecl> decls,
            Map<String, CompletableFuture<StockModel>> models) {
    }

    private static volatile Generation current = new Generation(Map.of(), new ConcurrentHashMap<>());

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

    /**
     * Swap in a reload's declarations; models load again on demand from the
     * reloaded packs (render thread — callers also drop the baked buffers).
     */
    static void reset(Map<String, WagonModelDecl> decls) {
        current = new Generation(Map.copyOf(decls), new ConcurrentHashMap<>());
        RailsWheelsAndTrains.LOGGER.info("{} stock model(s) declared by packs", decls.size());
    }

    private static CompletableFuture<StockModel> load(String typeId, WagonModelDecl decl) {
        ResourceManager resources = Minecraft.getInstance().getResourceManager();
        IrStockModel.ResourceAccess access = new IrStockModel.ResourceAccess() {
            @Override
            public InputStream open(ResourceLocation location) throws IOException {
                return resources.open(location);
            }

            @Override
            public boolean exists(ResourceLocation location) {
                return resources.getResource(location).isPresent();
            }
        };
        return CompletableFuture
                .supplyAsync(() -> IrStockModel.load(typeId, decl, access), Util.backgroundExecutor())
                .exceptionally(e -> {
                    // a broken asset must not take the render thread down with it
                    RailsWheelsAndTrains.LOGGER.error("Failed to load the model of " + typeId, e);
                    return StockModel.empty();
                });
    }
}
