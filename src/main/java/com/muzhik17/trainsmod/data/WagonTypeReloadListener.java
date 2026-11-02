package com.muzhik17.trainsmod.data;

import java.io.IOException;
import java.io.Reader;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;
import com.muzhik17.trainsmod.network.WagonTypesPayload;
import com.muzhik17.trainsmod.pack.PackOrigin;
import com.muzhik17.trainsmod.pack.PackProblem;
import com.muzhik17.trainsmod.pack.PackReport;
import com.muzhik17.trainsmod.pack.PackReportView;
import com.muzhik17.trainsmod.pack.WagonTypeLoader;
import com.muzhik17.trainsmod.stock.WagonType;
import com.muzhik17.trainsmod.stock.WagonTypes;

import net.minecraft.resources.FileToIdConverter;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.server.packs.resources.SimplePreparableReloadListener;
import net.minecraft.util.GsonHelper;
import net.minecraft.util.profiling.ProfilerFiller;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.AddReloadListenerEvent;
import net.neoforged.neoforge.event.OnDatapackSyncEvent;
import net.neoforged.neoforge.event.server.ServerStoppedEvent;
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
 * <p>The files are read off thread and handed to {@link WagonTypeLoader}: a
 * file loads whole or not at all — a malformed one (bad JSON, a bad field,
 * impossible geometry, a broken alias list) is skipped, one broken
 * declaration must not take down the rest of the pack, and unknown ids
 * degrade to the placeholder at the points of use anyway. Aliases are
 * resolved in type id order; one claimed twice goes to the lower id, and an
 * alias that is a real type id is dropped. Every problem goes to the log
 * and to {@link PackReport#SERVER} ({@code /rwat packs}), replacing the
 * previous load's.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID)
public final class WagonTypeReloadListener extends SimplePreparableReloadListener<WagonTypeLoader.Result> {

    private static final FileToIdConverter FILES = FileToIdConverter.json("wagon_types");

    @Override
    protected WagonTypeLoader.Result prepare(ResourceManager resources, ProfilerFiller profiler) {
        List<WagonTypeLoader.Declaration> declarations = new ArrayList<>();
        List<PackProblem> unreadable = new ArrayList<>();
        for (Map.Entry<ResourceLocation, Resource> file : FILES.listMatchingResources(resources).entrySet()) {
            ResourceLocation id = FILES.fileToId(file.getKey());
            PackOrigin origin = new PackOrigin(file.getValue().sourcePackId(),
                    PackOrigin.file("data", file.getKey().getNamespace(), file.getKey().getPath()));
            try (Reader reader = file.getValue().openAsReader()) {
                declarations.add(new WagonTypeLoader.Declaration(id.toString(), origin, GsonHelper.parse(reader)));
            } catch (IOException | RuntimeException e) {
                unreadable.add(origin.error("wagon type " + id + " not loaded: not valid JSON ("
                        + PackReportView.reason(e) + ")"));
            }
        }
        WagonTypeLoader.Result loaded = WagonTypeLoader.load(declarations);
        unreadable.addAll(loaded.problems());
        return new WagonTypeLoader.Result(loaded.types(), loaded.aliases(), unreadable, loaded.loaded());
    }

    @Override
    protected void apply(WagonTypeLoader.Result loaded, ResourceManager resources, ProfilerFiller profiler) {
        PackReportView.log(loaded.problems());
        WagonTypes.load(loaded.types(), loaded.aliases());
        PackReport.SERVER.replace(PackReport.Source.WAGON_TYPES, loaded.loaded(), loaded.problems());
        RailsWheelsAndTrains.LOGGER.info("Loaded {} wagon type(s) ({} alias(es)) from packs",
                loaded.types().size(), loaded.aliases().size());
    }

    @SubscribeEvent
    static void onAddReloadListeners(AddReloadListenerEvent event) {
        event.addListener(new WagonTypeReloadListener());
    }

    /** Single player back at the title screen: the next server's sync is not this load coming back. */
    @SubscribeEvent
    static void onServerStopped(ServerStoppedEvent event) {
        WagonTypes.serverStopped();
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
