package com.muzhik17.trainsmod;

import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientCabHud;
import com.muzhik17.trainsmod.client.ClientConfig;
import com.muzhik17.trainsmod.client.ClientDriveInput;
import com.muzhik17.trainsmod.client.ClientDriverHud;
import com.muzhik17.trainsmod.client.ClientPanelKey;
import com.muzhik17.trainsmod.client.ClientRailGraph;
import com.muzhik17.trainsmod.client.ClientRide;
import com.muzhik17.trainsmod.client.ClientRiderSync;
import com.muzhik17.trainsmod.client.ClientWalk;
import com.muzhik17.trainsmod.client.render.RailRenderer;
import com.muzhik17.trainsmod.client.render.WagonRenderer;
import com.muzhik17.trainsmod.client.render.model.RailModelReloadListener;
import com.muzhik17.trainsmod.client.render.model.WagonModelReloadListener;

import net.minecraft.client.Minecraft;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;
import net.neoforged.neoforge.client.event.RegisterClientReloadListenersEvent;

/**
 * Client-only mod entry point. Never loaded on a dedicated server, so accessing
 * client-side classes from here (and from anything it touches) is safe.
 *
 * <p>Mod-bus listeners are wired in the constructor; the
 * {@link EventBusSubscriber} annotation handles game-bus events.
 */
@Mod(value = RailsWheelsAndTrains.MODID, dist = Dist.CLIENT)
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID, value = Dist.CLIENT)
public class RailsWheelsAndTrainsClient {

    public RailsWheelsAndTrainsClient(ModContainer container, IEventBus modEventBus) {
        modEventBus.addListener(RailsWheelsAndTrainsClient::onClientSetup);
        modEventBus.addListener(RailsWheelsAndTrainsClient::onRegisterRenderers);
        modEventBus.addListener(RailsWheelsAndTrainsClient::onRegisterReloadListeners);
        modEventBus.addListener(ClientPanelKey::register);
        modEventBus.addListener(ClientDriveInput::register);
        modEventBus.addListener(ClientCabHud::register);
        modEventBus.addListener(ClientDriverHud::register);
        ClientConfig.register(container);
    }

    static void onClientSetup(FMLClientSetupEvent event) {
        RailsWheelsAndTrains.LOGGER.info("Rails, Wheels & Trains: client setup");
    }

    static void onRegisterRenderers(EntityRenderersEvent.RegisterRenderers event) {
        event.registerEntityRenderer(RailsWheelsAndTrains.WAGON_ENTITY.get(), WagonRenderer::new);
    }

    /** Stock model declarations and rail styles from the content packs (SPEC §6.6, §6.10), re-read on F3+T. */
    static void onRegisterReloadListeners(RegisterClientReloadListenersEvent event) {
        event.registerReloadListener(new WagonModelReloadListener());
        event.registerReloadListener(new RailModelReloadListener());
    }

    /**
     * Advance the consist playback clocks before entities tick off them.
     *
     * <p>Frozen while paused: the singleplayer pause stops the integrated
     * server (no new snapshots, gameTime stands still) but client ticks keep
     * firing — an advancing clock would extrapolate the train forward until
     * the drift hits the snap threshold and yanks it back, in a loop. The
     * same under {@code /tick freeze}: the consists stand with the world,
     * and run on a tick per tick of {@code /tick step}.
     */
    @SubscribeEvent
    static void onClientTickPre(ClientTickEvent.Pre event) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.isPaused() || mc.level != null && !mc.level.tickRateManager().runsNormally()) {
            return;
        }
        ClientConsists.tickAll();
        ClientRide.tickAll();
    }

    /** Snapshot buffers and the graph copy are per-connection state; drop them when leaving. */
    @SubscribeEvent
    static void onLoggingOut(ClientPlayerNetworkEvent.LoggingOut event) {
        ClientConsists.clearAll();
        ClientWalk.clearAll();
        ClientRiderSync.clearAll();
        ClientRide.clearAll();
        ClientRailGraph.clear();
        RailRenderer.clear();
        WagonRenderer.clearBaked();
    }
}
