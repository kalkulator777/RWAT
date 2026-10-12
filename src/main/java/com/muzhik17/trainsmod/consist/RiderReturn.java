package com.muzhik17.trainsmod.consist;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;

import com.muzhik17.trainsmod.RailsWheelsAndTrains;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStoppedEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/**
 * Logging out aboard a train, and back in (SPEC v1.5-б). The car stays in its
 * train while its rider is away ({@link WagonEntity#hasExactlyOnePlayerPassenger}):
 * the rider gets off as they go. So the game doesn't lose where they were,
 * the logout ({@code PlayerLoggedOutEvent}, which comes before the player is
 * saved) writes the car and their spot on its floor — or its seat — into the
 * player's persistent data. On the way back in they are put on that spot
 * (vanilla saved a rider at their car's centre line — in a loco's hood, for
 * a driver in a chair off to the side). The car may not be loaded yet:
 * for {@link #WAIT_TICKS} the server looks for it each tick, and once it is
 * there (with its train) sets the player back aboard — if the train hasn't
 * gone on in the meantime ({@link WagonEntity#welcomeBack}). Otherwise the
 * player simply stays where they came back.
 */
@EventBusSubscriber(modid = RailsWheelsAndTrains.MODID)
public final class RiderReturn {

    /** The player's persistent-data key for where they logged out aboard. */
    private static final String TAG = RailsWheelsAndTrains.MODID + ":aboard";
    /** How long a returning player's car may take to load, ticks. */
    private static final int WAIT_TICKS = 200;

    /** A returning player: where they were aboard, and the server tick to give up at. */
    private record Pending(CompoundTag record, int until) {
    }

    private static final Map<UUID, Pending> PENDING = new HashMap<>();

    private RiderReturn() {
    }

    @SubscribeEvent
    static void onLoggedOut(PlayerEvent.PlayerLoggedOutEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) {
            return;
        }
        PENDING.remove(player.getUUID());
        CompoundTag data = player.getPersistentData();
        data.remove(TAG);
        if (player.getVehicle() instanceof WagonEntity wagon) {
            CompoundTag record = wagon.leaveRecord(player);
            if (record != null) {
                data.put(TAG, record);
                RailsWheelsAndTrains.LOGGER.debug("{} logged out aboard wagon {}: {}",
                        player.getName().getString(), wagon.getUUID(), record);
            }
        }
    }

    @SubscribeEvent
    static void onLoggedIn(PlayerEvent.PlayerLoggedInEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) {
            return;
        }
        CompoundTag data = player.getPersistentData();
        if (!data.contains(TAG)) {
            return;
        }
        CompoundTag record = data.getCompound(TAG);
        data.remove(TAG);
        if (record.contains("WX") && !player.isPassenger()) {
            // back on the spot they stood on: vanilla saved a rider at the car's centre line
            player.connection.teleport(record.getDouble("WX"), record.getDouble("WY"), record.getDouble("WZ"),
                    player.getYRot(), player.getXRot());
        }
        PENDING.put(player.getUUID(), new Pending(record, player.server.getTickCount() + WAIT_TICKS));
    }

    @SubscribeEvent
    static void onServerTick(ServerTickEvent.Post event) {
        if (PENDING.isEmpty()) {
            return;
        }
        MinecraftServer server = event.getServer();
        for (Iterator<Map.Entry<UUID, Pending>> it = PENDING.entrySet().iterator(); it.hasNext();) {
            Map.Entry<UUID, Pending> entry = it.next();
            ServerPlayer player = server.getPlayerList().getPlayer(entry.getKey());
            Pending pending = entry.getValue();
            if (player == null || server.getTickCount() > pending.until()) {
                it.remove(); // gone again, or the car never came: they stay where they are
                continue;
            }
            if (player.serverLevel().getEntity(pending.record().getUUID("Wagon")) instanceof WagonEntity wagon
                    && wagon.typeNow() != null) {
                it.remove();
                boolean back = wagon.welcomeBack(player, pending.record());
                RailsWheelsAndTrains.LOGGER.debug("{} back in: {} aboard wagon {}",
                        player.getName().getString(), back ? "set back" : "not set back", wagon.getUUID());
            }
        }
    }

    @SubscribeEvent
    static void onServerStopped(ServerStoppedEvent event) {
        PENDING.clear();
    }
}
