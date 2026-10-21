package com.muzhik17.trainsmod;

import com.muzhik17.trainsmod.client.ClientBogieHit;
import com.muzhik17.trainsmod.client.ClientConsists;
import com.muzhik17.trainsmod.client.ClientCabHud;
import com.muzhik17.trainsmod.client.ClientCabInteract;
import com.muzhik17.trainsmod.client.ClientConfig;
import com.muzhik17.trainsmod.client.ClientCouplerInteract;
import com.muzhik17.trainsmod.client.ClientDoorInteract;
import com.muzhik17.trainsmod.client.ClientDriveInput;
import com.muzhik17.trainsmod.client.ClientDriverHud;
import com.muzhik17.trainsmod.client.ClientPanelKey;
import com.muzhik17.trainsmod.client.ClientRailGraph;
import com.muzhik17.trainsmod.client.ClientRide;
import com.muzhik17.trainsmod.client.ClientRideCamera;
import com.muzhik17.trainsmod.client.ClientRiderSync;
import com.muzhik17.trainsmod.client.ClientWagonRay;
import com.muzhik17.trainsmod.client.ClientWalk;
import com.muzhik17.trainsmod.client.render.RailRenderer;
import com.muzhik17.trainsmod.client.render.WagonRenderer;
import com.muzhik17.trainsmod.client.render.model.RailModelReloadListener;
import com.muzhik17.trainsmod.client.render.model.WagonModelReloadListener;
import com.muzhik17.trainsmod.client.sound.TrainSounds;

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
import net.neoforged.neoforge.event.level.LevelEvent;

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
        modEventBus.addListener(TrainSounds::onSoundEngineLoad);
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
     * firing — an advancing clock would run the train on by extrapolation,
     * and the silence would drop the consists' states (STALE_DROP_TICKS):
     * trains blinking out until their next snapshot. The same under
     * {@code /tick freeze}, where the server's gameTime stands too.
     */
    @SubscribeEvent
    static void onClientTickPre(ClientTickEvent.Pre event) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.isPaused()
                || minecraft.level != null && !minecraft.level.tickRateManager().runsNormally()) {
            return;
        }
        ClientConsists.tickAll();
        ClientRide.tickAll();
    }

    /** The graph copy and the baked meshes are per-connection state; drop them when leaving, with the level's. */
    @SubscribeEvent
    static void onLoggingOut(ClientPlayerNetworkEvent.LoggingOut event) {
        clearLevel();
        ClientRailGraph.clear();
        RailRenderer.clear();
        WagonRenderer.clearBaked();
    }

    /**
     * The client level goes: another dimension (a portal, a respawn there) or
     * the way out. Consist ids repeat across dimensions — each level's
     * manager counts from 1 — so a state kept from the old level mixed its
     * buffered {@code s} with the new level's path. Dropped as the level goes,
     * before the new one's first packet (a new level noticed on a tick, as the
     * rail renderer does for its meshes, would come after the snapshots that
     * arrived with it and throw them away). The rail graph isn't dropped: the
     * sync that follows the change replaces it ({@link ClientRailGraph}).
     */
    @SubscribeEvent
    static void onLevelUnload(LevelEvent.Unload event) {
        if (event.getLevel().isClientSide()) { // the integrated server's levels unload here too
            clearLevel();
        }
    }

    /**
     * Everything of one level, by its consist and entity ids or holding its
     * wagons: the snapshot buffers, the riders' feet, the bodies' sway, the
     * picks under the crosshair, the held control, the view's tilt, the train
     * sounds. The next level's snapshots fill them again.
     */
    private static void clearLevel() {
        ClientConsists.clearAll();
        ClientWalk.clearAll();
        ClientRiderSync.clearAll();
        ClientRide.clearAll();
        ClientCabInteract.clear();
        ClientDoorInteract.clear();
        ClientCouplerInteract.clear();
        ClientBogieHit.clear();
        ClientWagonRay.clear();
        ClientRideCamera.clear();
        TrainSounds.clearAll();
    }
}
