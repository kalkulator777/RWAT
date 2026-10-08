package com.muzhik17.trainsmod.data;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.network.WagonTypesPayload;
import com.muzhik17.trainsmod.stock.WagonTypeParser;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypes;

import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.server.packs.resources.SimpleJsonResourceReloadListener;
import net.minecraft.util.profiling.ProfilerFiller;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.AddReloadListenerEvent;
import net.neoforged.neoforge.event.OnDatapackSyncEvent;
import net.neoforged.neoforge.network.PacketDistributor;

/**
 * Datapack loading of the stock registry (SPEC §5.5 step 5, §6): every
 * {@code data/<namespace>/wagon_types/*.json} — shipped by the content packs
 * in {@code rwat_packs/} — becomes a {@link WagonType} with id
 * {@code <namespace>:<filename>}: the file's location is its identity, the
 * body never states an id. The parsed set replaces the registry wholesale
 * (server reload = full reread, no stale leftovers) and is pushed to clients
 * on join and after {@code /reload} ({@link OnDatapackSyncEvent} fires for
 * exactly those two cases).
 *
 * <p>A malformed file is logged and skipped — one broken declaration must not
 * take down the rest of the pack, and unknown ids degrade to the placeholder
 * at the points of use anyway. An alias that collides with a real type id or
 * with another type's alias is dropped (logged): ids must stay unambiguous.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID)
public final class WagonTypeReloadListener extends SimpleJsonResourceReloadListener {

    private static final Gson GSON = new Gson();

    public WagonTypeReloadListener() {
        super(GSON, "wagon_types");
    }

    @Override
    protected void apply(Map<ResourceLocation, JsonElement> files,
            ResourceManager resourceManager, ProfilerFiller profiler) {
        Map<String, WagonType> types = new HashMap<>();
        Map<String, List<String>> declaredAliases = new HashMap<>();
        for (Map.Entry<ResourceLocation, JsonElement> entry : files.entrySet()) {
            String id = entry.getKey().toString();
            try {
                JsonObject json = entry.getValue().getAsJsonObject();
                types.put(id, WagonTypeParser.parse(id, json));
                declaredAliases.put(id, WagonTypeParser.aliases(json));
            } catch (RuntimeException exception) {
                RailsWheelsAndTrains.LOGGER.error("Skipping bad wagon type {}: {}",
                        id, exception.getMessage());
            }
        }
        Map<String, String> aliases = new HashMap<>();
        declaredAliases.forEach((id, oldIds) -> {
            for (String oldId : oldIds) {
                if (types.containsKey(oldId) || aliases.putIfAbsent(oldId, id) != null) {
                    RailsWheelsAndTrains.LOGGER.error(
                            "Wagon type {}: alias {} is already taken, ignoring it", id, oldId);
                }
            }
        });
        WagonTypes.load(types, aliases);
        RailsWheelsAndTrains.LOGGER.info("Loaded {} wagon type(s) ({} alias(es)) from packs",
                types.size(), aliases.size());
    }

    @SubscribeEvent
    static void onAddReloadListeners(AddReloadListenerEvent event) {
        event.addListener(new WagonTypeReloadListener());
    }

    /** Push the freshly loaded layer to the joining player (or everyone on /reload). */
    @SubscribeEvent
    static void onDatapackSync(OnDatapackSyncEvent event) {
        WagonTypesPayload payload = new WagonTypesPayload(WagonTypes.loadedTypes());
        if (event.getPlayer() != null) {
            PacketDistributor.sendToPlayer(event.getPlayer(), payload);
        } else {
            for (ServerPlayer player : event.getPlayerList().getPlayers()) {
                PacketDistributor.sendToPlayer(player, payload);
            }
        }
    }
}
